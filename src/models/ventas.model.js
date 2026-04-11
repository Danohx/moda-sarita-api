function toMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

async function getVarianteForUpdate(client, varianteId) {
  const { rows } = await client.query(
    `
    SELECT
      v.id,
      v.producto_id,
      v.sku,
      v.precio_venta,
      v.precio_costo,
      v.stock_fisico,
      v.stock_apartado,
      v.stock_minimo,
      v.activo
    FROM inventario.variantes_producto v
    WHERE v.id = $1
    FOR UPDATE
    `,
    [varianteId],
  );

  return rows[0] || null;
}

export async function crearVentaPOS(
  db,
  {
    cliente_id = null,
    vendedor_id,
    items,
    descuento = 0,
    costo_envio = 0,
    cupon_id = null,
    metodo_pago,
    referencia_externa = null,
    tipo = "VENTA_POS",
  },
) {
  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("items requerido");
    e.code = "VALIDATION";
    throw e;
  }

  if (!metodo_pago) {
    const e = new Error("metodo_pago requerido");
    e.code = "VALIDATION";
    throw e;
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const normalizedItems = [];

    for (const it of items) {
      const varianteId = String(it.variante_id || "");
      const cantidad = Number(it.cantidad);

      if (!varianteId || !Number.isInteger(cantidad) || cantidad <= 0) {
        const e = new Error("Cada item requiere variante_id y cantidad > 0");
        e.code = "VALIDATION";
        throw e;
      }

      const v = await getVarianteForUpdate(client, varianteId);

      if (!v) {
        const e = new Error(`Variante no encontrada: ${varianteId}`);
        e.code = "NOT_FOUND";
        throw e;
      }

      if (!v.activo) {
        const e = new Error(`La variante ${varianteId} está inactiva`);
        e.code = "VALIDATION";
        throw e;
      }

      const disponible = Number(v.stock_fisico) - Number(v.stock_apartado);

      if (disponible < cantidad) {
        const e = new Error(
          `Stock insuficiente en variante ${varianteId}. Disponible=${disponible}`,
        );
        e.code = "STOCK";
        throw e;
      }

      const precio_unitario =
        it.precio_unitario !== undefined && it.precio_unitario !== null
          ? toMoney(it.precio_unitario)
          : toMoney(v.precio_venta);

      if (precio_unitario < 0) {
        const e = new Error("precio_unitario inválido");
        e.code = "VALIDATION";
        throw e;
      }

      normalizedItems.push({
        variante_id: varianteId,
        cantidad,
        precio_unitario,
      });
    }

    let subtotal = 0;
    for (const it of normalizedItems) {
      subtotal += toMoney(it.precio_unitario * it.cantidad);
    }

    descuento = toMoney(descuento);
    costo_envio = toMoney(costo_envio);
    const total = toMoney(subtotal - descuento + costo_envio);

    if (total < 0) {
      const e = new Error("El total no puede ser negativo");
      e.code = "VALIDATION";
      throw e;
    }

    const pRes = await client.query(
      `
      INSERT INTO ventas.pedidos
        (
          cliente_id,
          vendedor_id,
          tipo,
          estado,
          subtotal,
          descuento,
          costo_envio,
          total,
          cupon_id
        )
      VALUES
        ($1, $2, $3, 'PENDIENTE', $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        cliente_id,
        vendedor_id,
        tipo,
        subtotal,
        descuento,
        costo_envio,
        total,
        cupon_id,
      ],
    );

    const pedido = pRes.rows[0];

    for (const it of normalizedItems) {
      await client.query(
        `
        INSERT INTO ventas.detalles_pedido (pedido_id, variante_id, cantidad, precio_unitario)
        VALUES ($1,$2,$3,$4)
        `,
        [pedido.id, it.variante_id, it.cantidad, it.precio_unitario],
      );

      await client.query(
        `
        UPDATE inventario.variantes_producto
        SET stock_fisico = stock_fisico - $2,
            updated_at = now()
        WHERE id = $1
        `,
        [it.variante_id, it.cantidad],
      );

      await client.query(
        `
        INSERT INTO inventario.movimientos (variante_id, usuario_id, cantidad, motivo, tipo)
        VALUES ($1,$2,$3,$4,'SALIDA')
        `,
        [
          it.variante_id,
          vendedor_id,
          -Math.abs(it.cantidad),
          `VENTA POS folio ${pedido.folio}`,
        ],
      );
    }

    await client.query(
      `
      INSERT INTO ventas.pagos (pedido_id, monto, metodo, referencia_externa)
      VALUES ($1,$2,$3,$4)
      `,
      [pedido.id, total, metodo_pago, referencia_externa],
    );

    const p2 = await client.query(
      `UPDATE ventas.pedidos SET estado = 'PAGADO' WHERE id = $1 RETURNING *`,
      [pedido.id],
    );

    await client.query("COMMIT");
    return p2.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function crearApartado(
  db,
  {
    cliente_id,
    vendedor_id,
    items,
    fecha_limite_apartado,
    anticipo,
    metodo_pago,
    tipo = "APARTADO",
  },
) {
  if (!cliente_id) {
    const e = new Error("cliente_id requerido para apartado");
    e.code = "VALIDATION";
    throw e;
  }

  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("items requerido");
    e.code = "VALIDATION";
    throw e;
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const clienteRes = await client.query(
      `
      SELECT id, puede_apartar
      FROM clientes.clientes
      WHERE id = $1
      FOR UPDATE
      `,
      [cliente_id],
    );

    const cliente = clienteRes.rows[0];

    if (!cliente) {
      const e = new Error("Cliente no encontrado");
      e.code = "NOT_FOUND";
      throw e;
    }

    if (!cliente.puede_apartar) {
      const e = new Error("El cliente no está autorizado para apartados");
      e.code = "FORBIDDEN";
      throw e;
    }

    const normalizedItems = [];

    for (const it of items) {
      const varianteId = String(it.variante_id || "");
      const cantidad = Number(it.cantidad);

      if (!varianteId || !Number.isInteger(cantidad) || cantidad <= 0) {
        const e = new Error("Cada item requiere variante_id y cantidad > 0");
        e.code = "VALIDATION";
        throw e;
      }

      const v = await getVarianteForUpdate(client, varianteId);

      if (!v) {
        const e = new Error(`Variante no encontrada: ${varianteId}`);
        e.code = "NOT_FOUND";
        throw e;
      }

      if (!v.activo) {
        const e = new Error(`La variante ${varianteId} está inactiva`);
        e.code = "VALIDATION";
        throw e;
      }

      const disponible = Number(v.stock_fisico) - Number(v.stock_apartado);

      if (disponible < cantidad) {
        const e = new Error(
          `Stock insuficiente en variante ${varianteId}. Disponible=${disponible}`,
        );
        e.code = "STOCK";
        throw e;
      }

      const precio_unitario =
        it.precio_unitario !== undefined && it.precio_unitario !== null
          ? toMoney(it.precio_unitario)
          : toMoney(v.precio_venta);

      normalizedItems.push({
        variante_id: varianteId,
        cantidad,
        precio_unitario,
      });
    }

    let subtotal = 0;
    for (const it of normalizedItems) {
      subtotal += toMoney(it.precio_unitario * it.cantidad);
    }

    const total = toMoney(subtotal);
    const anticipoNum = toMoney(anticipo ?? 0);

    if (anticipoNum < 0) {
      const e = new Error("El anticipo no puede ser negativo");
      e.code = "VALIDATION";
      throw e;
    }

    if (anticipoNum > total) {
      const e = new Error("El anticipo no puede ser mayor al total");
      e.code = "VALIDATION";
      throw e;
    }

    if (anticipoNum > 0 && !metodo_pago) {
      const e = new Error("metodo_pago requerido cuando hay anticipo");
      e.code = "VALIDATION";
      throw e;
    }

    const pRes = await client.query(
      `
      INSERT INTO ventas.pedidos
        (cliente_id, vendedor_id, tipo, estado, subtotal, descuento, costo_envio, total, fecha_limite_apartado)
      VALUES
        ($1, $2, $3, $4, $5, 0, 0, $6, $7)
      RETURNING *
      `,
      [
        cliente_id,
        vendedor_id,
        tipo,
        "APARTADO",
        subtotal,
        total,
        fecha_limite_apartado || null,
      ],
    );

    const pedido = pRes.rows[0];

    for (const it of normalizedItems) {
      await client.query(
        `
        INSERT INTO ventas.detalles_pedido
          (pedido_id, variante_id, cantidad, precio_unitario)
        VALUES
          ($1, $2, $3, $4)
        `,
        [pedido.id, it.variante_id, it.cantidad, it.precio_unitario],
      );

      await client.query(
        `
        UPDATE inventario.variantes_producto
        SET stock_apartado = stock_apartado + $2,
            updated_at = now()
        WHERE id = $1
        `,
        [it.variante_id, it.cantidad],
      );
    }

    if (anticipoNum > 0) {
      await client.query(
        `
        INSERT INTO ventas.pagos (pedido_id, monto, metodo)
        VALUES ($1, $2, $3)
        `,
        [pedido.id, anticipoNum, metodo_pago],
      );
    }

    await client.query("COMMIT");
    return pedido;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function abonarApartado(
  db,
  { pedido_id, monto, metodo_pago, referencia_externa = null },
) {
  const m = toMoney(monto);

  if (m <= 0) {
    const e = new Error("monto debe ser > 0");
    e.code = "VALIDATION";
    throw e;
  }

  if (!metodo_pago) {
    const e = new Error("metodo_pago requerido");
    e.code = "VALIDATION";
    throw e;
  }

  const { rows: pRows } = await db.query(
    `
    SELECT id, total, tipo, estado
    FROM ventas.pedidos
    WHERE id = $1
    `,
    [pedido_id],
  );

  if (pRows.length === 0) {
    const e = new Error("Pedido no encontrado");
    e.code = "NOT_FOUND";
    throw e;
  }

  const pedido = pRows[0];

  if (pedido.tipo !== "APARTADO") {
    const e = new Error("El pedido no es un apartado");
    e.code = "VALIDATION";
    throw e;
  }

  if (pedido.estado === "CANCELADO" || pedido.estado === "PAGADO") {
    const e = new Error(
      "No se puede abonar a un apartado cancelado o liquidado",
    );
    e.code = "VALIDATION";
    throw e;
  }

  await db.query(
    `
    INSERT INTO ventas.pagos (pedido_id, monto, metodo, referencia_externa)
    VALUES ($1,$2,$3,$4)
    `,
    [pedido_id, m, metodo_pago, referencia_externa],
  );

  const { rows: sRows } = await db.query(
    `SELECT COALESCE(SUM(monto),0) AS pagado FROM ventas.pagos WHERE pedido_id = $1`,
    [pedido_id],
  );

  return {
    pedido_id,
    pagado: toMoney(sRows[0].pagado),
    total: toMoney(pedido.total),
    saldo: toMoney(toMoney(pedido.total) - toMoney(sRows[0].pagado)),
  };
}

export async function liquidarApartado(
  db,
  { pedido_id, vendedor_id, metodo_pago, referencia_externa = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: pRows } = await client.query(
      `
      SELECT id, total, tipo, estado
      FROM ventas.pedidos
      WHERE id = $1
      FOR UPDATE
      `,
      [pedido_id],
    );

    if (pRows.length === 0) {
      const e = new Error("Pedido no encontrado");
      e.code = "NOT_FOUND";
      throw e;
    }

    const pedido = pRows[0];

    if (pedido.tipo !== "APARTADO") {
      const e = new Error("El pedido no es un apartado");
      e.code = "VALIDATION";
      throw e;
    }

    if (pedido.estado === "CANCELADO") {
      const e = new Error("El apartado está cancelado");
      e.code = "VALIDATION";
      throw e;
    }

    if (pedido.estado === "PAGADO") {
      const e = new Error("El apartado ya fue liquidado");
      e.code = "VALIDATION";
      throw e;
    }

    const total = toMoney(pedido.total);

    const { rows: sRows } = await client.query(
      `SELECT COALESCE(SUM(monto),0) AS pagado FROM ventas.pagos WHERE pedido_id = $1`,
      [pedido_id],
    );

    const pagado = toMoney(sRows[0].pagado);
    const saldo = toMoney(total - pagado);

    if (saldo > 0) {
      if (!metodo_pago) {
        const e = new Error("metodo_pago requerido para liquidar saldo");
        e.code = "VALIDATION";
        throw e;
      }

      await client.query(
        `
        INSERT INTO ventas.pagos (pedido_id, monto, metodo, referencia_externa)
        VALUES ($1,$2,$3,$4)
        `,
        [pedido_id, saldo, metodo_pago, referencia_externa],
      );
    }

    const { rows: dets } = await client.query(
      `
      SELECT variante_id, producto_id, cantidad
      FROM ventas.detalles_pedido
      WHERE pedido_id = $1
      `,
      [pedido_id],
    );

    for (const d of dets) {
      const v = await getVarianteForUpdate(client, d.variante_id);

      if (!v) {
        const e = new Error(`Variante no encontrada: ${d.variante_id}`);
        e.code = "NOT_FOUND";
        throw e;
      }

      if (Number(v.stock_apartado) < Number(d.cantidad)) {
        const e = new Error(
          `Stock apartado insuficiente en variante ${d.variante_id}`,
        );
        e.code = "STOCK";
        throw e;
      }

      if (Number(v.stock_fisico) < Number(d.cantidad)) {
        const e = new Error(
          `Stock físico insuficiente en variante ${d.variante_id}`,
        );
        e.code = "STOCK";
        throw e;
      }

      await client.query(
        `
        UPDATE inventario.variantes_producto
        SET stock_apartado = stock_apartado - $2,
            stock_fisico = stock_fisico - $2,
            updated_at = now()
        WHERE id = $1
        `,
        [d.variante_id, d.cantidad],
      );

      await client.query(
        `
        INSERT INTO inventario.movimientos (variante_id, usuario_id, cantidad, motivo, tipo)
        VALUES ($1,$2,$3,$4,'SALIDA')
        `,
        [
          d.variante_id,
          vendedor_id,
          -Math.abs(d.cantidad),
          `LIQUIDACIÓN APARTADO ${pedido_id}`,
        ],
      );
    }

    const p2 = await client.query(
      `UPDATE ventas.pedidos SET estado = 'PAGADO' WHERE id = $1 RETURNING *`,
      [pedido_id],
    );

    await client.query("COMMIT");
    return p2.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelarApartado(
  db,
  { pedido_id, vendedor_id, motivo = "CANCELADO" },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: pRows } = await client.query(
      `
      SELECT id, tipo, estado
      FROM ventas.pedidos
      WHERE id = $1
      FOR UPDATE
      `,
      [pedido_id],
    );

    if (pRows.length === 0) {
      const e = new Error("Pedido no encontrado");
      e.code = "NOT_FOUND";
      throw e;
    }

    const pedido = pRows[0];

    if (pedido.tipo !== "APARTADO") {
      const e = new Error("El pedido no es un apartado");
      e.code = "VALIDATION";
      throw e;
    }

    if (pedido.estado === "CANCELADO") {
      const e = new Error("El apartado ya está cancelado");
      e.code = "VALIDATION";
      throw e;
    }

    if (pedido.estado === "PAGADO") {
      const e = new Error("No se puede cancelar un apartado liquidado");
      e.code = "VALIDATION";
      throw e;
    }

    const { rows: dets } = await client.query(
      `
      SELECT variante_id, cantidad
      FROM ventas.detalles_pedido
      WHERE pedido_id = $1
      `,
      [pedido_id],
    );

    for (const d of dets) {
      const v = await getVarianteForUpdate(client, d.variante_id);

      if (!v) {
        const e = new Error(`Variante no encontrada: ${d.variante_id}`);
        e.code = "NOT_FOUND";
        throw e;
      }

      await client.query(
        `
        UPDATE inventario.variantes_producto
        SET stock_apartado = GREATEST(stock_apartado - $2, 0),
            updated_at = now()
        WHERE id = $1
        `,
        [d.variante_id, d.cantidad],
      );
    }

    const { rows } = await client.query(
      `
      UPDATE ventas.pedidos
      SET estado = 'CANCELADO'
      WHERE id = $1
      RETURNING *
      `,
      [pedido_id],
    );

    await client.query("COMMIT");
    return rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function abrirCorte(db, { usuario_id, fondo_inicial = 0 }) {
  const fondoInicialNum = toMoney(fondo_inicial);

  if (fondoInicialNum < 0) {
    const e = new Error("fondo_inicial debe ser >= 0");
    e.code = "VALIDATION";
    throw e;
  }

  const { rows } = await db.query(
    `
    INSERT INTO ventas.corte_caja
      (usuario_id, inicio_turno, fin_turno, fondo_inicial, total_sistema, total_real, observaciones)
    VALUES
      ($1, now(), NULL, $2, 0, 0, null)
    RETURNING *
    `,
    [usuario_id, fondoInicialNum],
  );

  return rows[0];
}

export async function getCorteAbierto(db, { usuario_id }) {
  const client = await db.connect();

  try {
    const { rows } = await client.query(
      `
      SELECT 
        c.*,
        COALESCE(u.nombres, 'Usuario') || ' ' || COALESCE(u.apellido_paterno, '') AS usuario_nombre
      FROM ventas.corte_caja c
      LEFT JOIN seguridad.usuarios u ON c.usuario_id = u.id
      WHERE c.usuario_id = $1
        AND c.fin_turno IS NULL
      ORDER BY c.inicio_turno DESC
      LIMIT 1
      `,
      [usuario_id],
    );

    if (rows.length === 0) {
      return null;
    }

    const corte = rows[0];

    const { rows: pagosRows } = await client.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN pa.metodo = 'EFECTIVO' THEN pa.monto ELSE 0 END), 0) AS total_efectivo,
        COALESCE(SUM(CASE WHEN pa.metodo IN ('TARJETA_CREDITO', 'TARJETA_DEBITO') THEN pa.monto ELSE 0 END), 0) AS total_tarjeta,
        COALESCE(SUM(CASE WHEN pa.metodo = 'TRANSFERENCIA' THEN pa.monto ELSE 0 END), 0) AS total_transferencia,
        COALESCE(SUM(pa.monto), 0) AS total_pagos
      FROM ventas.pagos pa
      INNER JOIN ventas.pedidos pe ON pe.id = pa.pedido_id
      WHERE pe.vendedor_id = $1
        AND pa.fecha_pago >= $2
        AND pa.fecha_pago <= now()
        AND pe.estado = 'PAGADO'
      `,
      [usuario_id, corte.inicio_turno],
    );

    const totalEfectivo = toMoney(pagosRows[0].total_efectivo);
    const totalTarjeta = toMoney(pagosRows[0].total_tarjeta);
    const totalTransferencia = toMoney(pagosRows[0].total_transferencia);
    const totalPagos = toMoney(pagosRows[0].total_pagos);
    const fondoInicial = toMoney(corte.fondo_inicial ?? 0);
    const efectivoEsperado = toMoney(fondoInicial + totalEfectivo);

    return {
      ...corte,
      usuario_nombre: corte.usuario_nombre,
      resumen: {
        fondo_inicial: fondoInicial,
        total_efectivo: totalEfectivo,
        total_tarjeta: totalTarjeta,
        total_transferencia: totalTransferencia,
        total_pagos: totalPagos,
        efectivo_esperado: efectivoEsperado,
      },
    };
  } finally {
    client.release();
  }
}

export async function cerrarCorte(
  db,
  { corte_id, usuario_id, total_real, observaciones = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: cRows } = await client.query(
      `
      SELECT *
      FROM ventas.corte_caja
      WHERE id = $1
        AND usuario_id = $2
      FOR UPDATE
      `,
      [corte_id, usuario_id],
    );

    if (cRows.length === 0) {
      const e = new Error("Corte no encontrado");
      e.code = "NOT_FOUND";
      throw e;
    }

    const corte = cRows[0];

    if (corte.fin_turno) {
      const e = new Error("Corte ya cerrado");
      e.code = "VALIDATION";
      throw e;
    }

    const totalRealNum = toMoney(total_real);

    if (totalRealNum < 0) {
      const e = new Error("total_real debe ser >= 0");
      e.code = "VALIDATION";
      throw e;
    }

    const { rows: pagosRows } = await client.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN pa.metodo = 'EFECTIVO' THEN pa.monto ELSE 0 END), 0) AS total_efectivo,
        COALESCE(SUM(CASE WHEN pa.metodo IN ('TARJETA_CREDITO', 'TARJETA_DEBITO') THEN pa.monto ELSE 0 END), 0) AS total_tarjeta,
        COALESCE(SUM(CASE WHEN pa.metodo = 'TRANSFERENCIA' THEN pa.monto ELSE 0 END), 0) AS total_transferencia,
        COALESCE(SUM(pa.monto), 0) AS total_pagos
      FROM ventas.pagos pa
      INNER JOIN ventas.pedidos pe ON pe.id = pa.pedido_id
      WHERE pe.vendedor_id = $1
        AND pa.fecha_pago >= $2
        AND pa.fecha_pago <= now()
        AND pe.estado = 'PAGADO'
      `,
      [usuario_id, corte.inicio_turno],
    );

    const totalEfectivo = toMoney(pagosRows[0].total_efectivo);
    const totalTarjeta = toMoney(pagosRows[0].total_tarjeta);
    const totalTransferencia = toMoney(pagosRows[0].total_transferencia);
    const totalPagos = toMoney(pagosRows[0].total_pagos);
    const fondoInicial = toMoney(corte.fondo_inicial ?? 0);
    const total_sistema = toMoney(fondoInicial + totalEfectivo);

    const out = await client.query(
      `
      UPDATE ventas.corte_caja
      SET fin_turno = now(),
          total_sistema = $3,
          total_real = $4,
          observaciones = $5
      WHERE id = $1
        AND usuario_id = $2
        AND fin_turno IS NULL
      RETURNING *
      `,
      [corte_id, usuario_id, total_sistema, totalRealNum, observaciones],
    );

    const corteCerrado = out.rows[0];

    const { rows: usuarioRows } = await client.query(
      `
      SELECT
        COALESCE(u.nombres, 'Usuario') || ' ' || COALESCE(u.apellido_paterno, '') AS usuario_nombre
      FROM seguridad.usuarios u
      WHERE u.id = $1
      `,
      [corteCerrado.usuario_id],
    );

    const usuario_nombre = usuarioRows[0]?.usuario_nombre ?? "Usuario";

    await client.query("COMMIT");

    return {
      ...corteCerrado,
      usuario_nombre,
      resumen: {
        fondo_inicial: fondoInicial,
        total_efectivo: totalEfectivo,
        total_tarjeta: totalTarjeta,
        total_transferencia: totalTransferencia,
        total_pagos: totalPagos,
        efectivo_esperado: total_sistema,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getHistorialCortes(db) {
  const { rows } = await db.query(`
    SELECT 
      c.id,
      c.usuario_id,
      c.inicio_turno,
      c.fin_turno,
      c.fondo_inicial,
      c.total_sistema,
      c.total_real,
      c.observaciones,
      COALESCE(u.nombres, 'Usuario') || ' ' || COALESCE(u.apellido_paterno, '') AS usuario_nombre
    FROM ventas.corte_caja c
    LEFT JOIN seguridad.usuarios u ON c.usuario_id = u.id
    ORDER BY c.inicio_turno DESC
  `);

  return rows;
}

export async function getCorteById(db, corte_id) {
  const { rows } = await db.query(
    `
    SELECT 
      c.id,
      c.usuario_id,
      c.inicio_turno,
      c.fin_turno,
      c.fondo_inicial,
      c.total_sistema,
      c.total_real,
      c.observaciones,
      COALESCE(u.nombres, 'Usuario') || ' ' || COALESCE(u.apellido_paterno, '') AS usuario_nombre
    FROM ventas.corte_caja c
    LEFT JOIN seguridad.usuarios u ON c.usuario_id = u.id
    WHERE c.id = $1
    `,
    [corte_id],
  );

  if (rows.length === 0) {
    const e = new Error("Corte no encontrado");
    e.code = "NOT_FOUND";
    throw e;
  }

  return rows[0];
}
