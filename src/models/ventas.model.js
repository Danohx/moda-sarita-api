function toMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
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

async function getMetodoPagoPOS(client, metodo) {
  const { rows } = await client.query(
    `
      SELECT
        codigo,
        nombre,
        activo_pos,
        requiere_referencia,
        permite_cambio,
        requiere_confirmacion_manual,
        es_credito
      FROM configuracion.metodos_pago
      WHERE codigo = $1
      LIMIT 1;
    `,
    [metodo],
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
    posConfig = {},
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

  const config = {
    permitirVentaSinCliente: true,
    permitirDescuentosManuales: true,
    descuentoManualMaximoPercent: 20,
    requerirCorteAbierto: true,
    metodoPagoDefault: "EFECTIVO",
    ...posConfig,
  };

  const metodoPagoFinal = metodo_pago || config.metodoPagoDefault;

  if (!config.permitirVentaSinCliente && !cliente_id) {
    const e = new Error(
      "La configuración actual requiere seleccionar un cliente para vender.",
    );
    e.code = "VALIDATION";
    throw e;
  }

  if (!config.permitirDescuentosManuales && Number(descuento || 0) > 0) {
    const e = new Error("Los descuentos manuales están desactivados en POS.");
    e.code = "VALIDATION";
    throw e;
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    let corte_id = null;

    if (config.requerirCorteAbierto) {
      const corteRes = await client.query(
        `SELECT id FROM ventas.corte_caja WHERE usuario_id = $1 AND fin_turno IS NULL LIMIT 1`,
        [vendedor_id],
      );

      if (corteRes.rows.length === 0) {
        const e = new Error("Debes abrir turno/corte antes de vender.");
        e.code = "VALIDATION";
        throw e;
      }

      corte_id = corteRes.rows[0].id;
    }

    const metodoPagoConfig = await getMetodoPagoPOS(client, metodoPagoFinal);

    if (!metodoPagoConfig || metodoPagoConfig.activo_pos !== true) {
      const e = new Error(
        "El método de pago seleccionado no está activo para POS.",
      );
      e.code = "VALIDATION";
      throw e;
    }

    const esPagoCredito = metodoPagoConfig.es_credito === true;

    if (esPagoCredito && !cliente_id) {
      const e = new Error(
        "Para pagar con crédito de tienda debes seleccionar un cliente.",
      );
      e.code = "VALIDATION";
      throw e;
    }

    if (
      metodoPagoConfig.requiere_referencia === true &&
      !String(referencia_externa || "").trim()
    ) {
      const e = new Error("Este método de pago requiere referencia.");
      e.code = "VALIDATION";
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

    const descNum = Number(descuento || 0);
    const envioNum = Number(costo_envio || 0);

    if (descNum < 0) {
      const e = new Error("El descuento no puede ser negativo.");
      e.code = "VALIDATION";
      throw e;
    }

    if (descNum > subtotal) {
      const e = new Error("El descuento no puede exceder el subtotal.");
      e.code = "VALIDATION";
      throw e;
    }

    const descuentoMaximo =
      subtotal * (Number(config.descuentoManualMaximoPercent || 0) / 100);

    if (descNum > descuentoMaximo) {
      const e = new Error(
        `El descuento excede el máximo permitido (${config.descuentoManualMaximoPercent}%).`,
      );
      e.code = "VALIDATION";
      throw e;
    }

    const total = toMoney(subtotal - descNum + envioNum);

    if (total < 0) {
      const e = new Error("El total no puede ser negativo");
      e.code = "VALIDATION";
      throw e;
    }

    let clienteCredito = null;

    if (esPagoCredito) {
      const clienteCreditoRes = await client.query(
        `
    SELECT
      id,
      nombres,
      apellido_paterno,
      apellido_materno,
      tiene_credito,
      limite_credito,
      saldo_deudor,
      activo
    FROM clientes.clientes
    WHERE id = $1
    FOR UPDATE
    `,
        [cliente_id],
      );

      clienteCredito = clienteCreditoRes.rows[0];

      if (!clienteCredito || clienteCredito.activo !== true) {
        const e = new Error(
          "El cliente seleccionado no existe o está inactivo.",
        );
        e.code = "VALIDATION";
        throw e;
      }

      if (clienteCredito.tiene_credito !== true) {
        const e = new Error("El cliente seleccionado no tiene crédito activo.");
        e.code = "VALIDATION";
        throw e;
      }

      const limiteCredito = Number(clienteCredito.limite_credito || 0);
      const saldoDeudor = Number(clienteCredito.saldo_deudor || 0);
      const disponibleCredito = limiteCredito - saldoDeudor;

      if (total > disponibleCredito) {
        const e = new Error(
          `Crédito insuficiente. Disponible: $${disponibleCredito.toFixed(2)}.`,
        );
        e.code = "VALIDATION";
        throw e;
      }
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
      INSERT INTO ventas.pagos
        (pedido_id, monto, metodo, referencia_externa, usuario_id)
      VALUES
        ($1,$2,$3,$4,$5)
      `,
      [pedido.id, total, metodoPagoFinal, referencia_externa, vendedor_id],
    );

    if (esPagoCredito && clienteCredito) {
      const saldoAnterior = Number(clienteCredito.saldo_deudor || 0);
      const saldoResultante = toMoney(saldoAnterior + total);

      await client.query(
        `
        UPDATE clientes.clientes
        SET
          saldo_deudor = $2,
          fecha_actualizacion_credito = now()
        WHERE id = $1
        `,
        [cliente_id, saldoResultante],
      );

      await client.query(
        `
    INSERT INTO clientes.movimientos_credito
      (
        cliente_id,
        usuario_id,
        pedido_id,
        tipo,
        descripcion,
        monto,
        saldo_anterior,
        saldo_resultante,
        metodo_pago,
        referencia_externa
      )
    VALUES
      ($1,$2,$3,'COMPRA',$4,$5,$6,$7,$8,$9)
    `,
        [
          cliente_id,
          vendedor_id,
          pedido.id,
          `Compra POS folio ${pedido.folio}`,
          total,
          saldoAnterior,
          saldoResultante,
          metodoPagoFinal,
          referencia_externa,
        ],
      );
    }

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
        "ACTIVO",
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

async function getDesgloseMetodosCorte(
  client,
  { usuario_id, inicio_turno, fin_turno = null },
) {
  const { rows } = await client.query(
    `
    WITH pagos_turno AS (
      SELECT
        pg.metodo::text AS codigo,
        COALESCE(SUM(pg.monto), 0)::numeric(10,2) AS total,
        COUNT(*)::int AS operaciones
      FROM ventas.pagos pg
      JOIN ventas.pedidos pe ON pe.id = pg.pedido_id
      WHERE pg.estado = 'CONFIRMADO'
        AND COALESCE(pg.usuario_id, pe.vendedor_id) = $1
        AND pg.fecha_pago >= $2
        AND ($3::timestamptz IS NULL OR pg.fecha_pago <= $3)
      GROUP BY pg.metodo::text
    ),
    metodos AS (
      SELECT
        mp.codigo::text AS codigo,
        mp.nombre,
        mp.orden,
        mp.activo_pos,
        mp.permite_cambio,
        mp.es_credito
      FROM configuracion.metodos_pago mp
      WHERE mp.activo_pos = true
    )
    SELECT
      COALESCE(m.codigo, p.codigo) AS codigo,
      COALESCE(m.nombre, INITCAP(REPLACE(p.codigo, '_', ' '))) AS nombre,
      COALESCE(p.total, 0)::numeric(10,2) AS total,
      COALESCE(p.operaciones, 0)::int AS operaciones,
      CASE
        WHEN COALESCE(m.codigo, p.codigo) = 'EFECTIVO'
          OR COALESCE(m.permite_cambio, false) = true
        THEN true
        ELSE false
      END AS afecta_caja,
      COALESCE(m.permite_cambio, false) AS permite_cambio,
      COALESCE(m.es_credito, false) AS es_credito,
      COALESCE(m.activo_pos, false) AS activo_pos
    FROM metodos m
    FULL OUTER JOIN pagos_turno p ON p.codigo = m.codigo
    WHERE COALESCE(m.activo_pos, false) = true
       OR COALESCE(p.total, 0) > 0
    ORDER BY
      COALESCE(m.orden, 999),
      COALESCE(m.nombre, p.codigo);
    `,
    [usuario_id, inicio_turno, fin_turno],
  );

  const metodos = rows.map((row) => ({
    codigo: row.codigo,
    nombre: row.nombre,
    total: Number(row.total || 0),
    operaciones: Number(row.operaciones || 0),
    afecta_caja: row.afecta_caja === true,
    permite_cambio: row.permite_cambio === true,
    es_credito: row.es_credito === true,
    activo_pos: row.activo_pos === true,
  }));

  const totalCaja = metodos
    .filter((m) => m.afecta_caja)
    .reduce((acc, m) => acc + m.total, 0);

  const totalPagos = metodos.reduce((acc, m) => acc + m.total, 0);

  return {
    metodos,
    total_caja: Number(totalCaja.toFixed(2)),
    total_pagos: Number(totalPagos.toFixed(2)),
  };
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

    const desglose = await getDesgloseMetodosCorte(client, {
      usuario_id,
      inicio_turno: corte.inicio_turno,
      fin_turno: null,
    });

    const fondoInicial = toMoney(corte.fondo_inicial ?? 0);
    const efectivoEsperado = toMoney(fondoInicial + desglose.total_caja);

    const totalTarjeta = desglose.metodos
      .filter((m) => String(m.codigo).includes("TARJETA"))
      .reduce((acc, m) => acc + m.total, 0);

    const totalTransferencia =
      desglose.metodos.find((m) => m.codigo === "TRANSFERENCIA")?.total ?? 0;

    return {
      ...corte,
      usuario_nombre: corte.usuario_nombre,

      desglose_metodos: desglose.metodos,

      totales_metodos: {
        total_caja: desglose.total_caja,
        total_pagos: desglose.total_pagos,
        efectivo_esperado: efectivoEsperado,
      },

      resumen: {
        fondo_inicial: fondoInicial,
        total_efectivo: desglose.total_caja,
        total_tarjeta: toMoney(totalTarjeta),
        total_transferencia: toMoney(totalTransferencia),
        total_pagos: desglose.total_pagos,
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

    const desglose = await getDesgloseMetodosCorte(client, {
      usuario_id,
      inicio_turno: corte.inicio_turno,
      fin_turno: null,
    });

    const fondoInicial = toMoney(corte.fondo_inicial ?? 0);
    const total_sistema = toMoney(fondoInicial + desglose.total_caja);

    const totalTarjeta = desglose.metodos
      .filter((m) => String(m.codigo).includes("TARJETA"))
      .reduce((acc, m) => acc + m.total, 0);

    const totalTransferencia =
      desglose.metodos.find((m) => m.codigo === "TRANSFERENCIA")?.total ?? 0;

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
      desglose_metodos: desglose.metodos,
      totales_metodos: {
        total_caja: desglose.total_caja,
        total_pagos: desglose.total_pagos,
        efectivo_esperado: total_sistema,
      },
      resumen: {
        fondo_inicial: fondoInicial,
        total_efectivo: desglose.total_caja,
        total_tarjeta: toMoney(totalTarjeta),
        total_transferencia: toMoney(totalTransferencia),
        total_pagos: desglose.total_pagos,
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

  const corte = rows[0];

  const desglose = await getDesgloseMetodosCorte(db, {
    usuario_id: corte.usuario_id,
    inicio_turno: corte.inicio_turno,
    fin_turno: corte.fin_turno,
  });

  const fondoInicial = toMoney(corte.fondo_inicial ?? 0);
  const efectivoEsperado = toMoney(fondoInicial + desglose.total_caja);

  const totalTarjeta = desglose.metodos
    .filter((m) => String(m.codigo).includes("TARJETA"))
    .reduce((acc, m) => acc + m.total, 0);

  const totalTransferencia =
    desglose.metodos.find((m) => m.codigo === "TRANSFERENCIA")?.total ?? 0;

  return {
    ...corte,
    desglose_metodos: desglose.metodos,
    totales_metodos: {
      total_caja: desglose.total_caja,
      total_pagos: desglose.total_pagos,
      efectivo_esperado: efectivoEsperado,
    },
    resumen: {
      fondo_inicial: fondoInicial,
      total_efectivo: desglose.total_caja,
      total_tarjeta: toMoney(totalTarjeta),
      total_transferencia: toMoney(totalTransferencia),
      total_pagos: desglose.total_pagos,
      efectivo_esperado: efectivoEsperado,
    },
  };
}

export async function listarHistorialVentas(
  db,
  {
    q = null,
    estado = null,
    fecha_inicio = null,
    fecha_fin = null,
    metodo = null,
    vendedor_id = null,
    cliente_id = null,
    limit = 50,
    offset = 0,
  } = {},
) {
  const safeLimit = Math.min(Math.max(toInt(limit, 50), 1), 200);
  const safeOffset = Math.max(toInt(offset, 0), 0);

  const params = [];
  const where = [`p.tipo = 'PUNTO_VENTA'`];

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        p.folio::text ILIKE $${params.length}
        OR CONCAT_WS(' ', c.nombres, c.apellido_paterno, c.apellido_materno) ILIKE $${params.length}
        OR c.telefono ILIKE $${params.length}
        OR c.email ILIKE $${params.length}
        OR CONCAT_WS(' ', u.nombres, u.apellido_paterno, u.apellido_materno) ILIKE $${params.length}
        OR u.email ILIKE $${params.length}
      )
    `);
  }

  if (estado) {
    params.push(String(estado).trim().toUpperCase());
    where.push(`p.estado = $${params.length}`);
  }

  if (fecha_inicio) {
    params.push(fecha_inicio);
    where.push(`p.fecha_creacion >= $${params.length}::timestamptz`);
  }

  if (fecha_fin) {
    params.push(fecha_fin);
    where.push(`p.fecha_creacion < ($${params.length}::date + INTERVAL '1 day')`);
  }

  if (vendedor_id) {
    params.push(vendedor_id);
    where.push(`p.vendedor_id = $${params.length}`);
  }

  if (cliente_id) {
    params.push(cliente_id);
    where.push(`p.cliente_id = $${params.length}`);
  }

  if (metodo) {
    params.push(String(metodo).trim().toUpperCase());
    where.push(`
      EXISTS (
        SELECT 1
        FROM ventas.pagos px
        WHERE px.pedido_id = p.id
          AND px.metodo = $${params.length}
      )
    `);
  }

  const whereSql = where.join("\n AND ");

  const countSql = `
    SELECT COUNT(DISTINCT p.id)::integer AS total
    FROM ventas.pedidos p
    LEFT JOIN clientes.clientes c ON c.id = p.cliente_id
    LEFT JOIN seguridad.usuarios u ON u.id = p.vendedor_id
    WHERE ${whereSql}
  `;

  const { rows: countRows } = await db.query(countSql, params);
  const total = countRows[0]?.total ?? 0;

  params.push(safeLimit);
  const limitParam = params.length;

  params.push(safeOffset);
  const offsetParam = params.length;

  const sql = `
    SELECT
      p.id,
      p.folio,
      p.estado,
      p.subtotal,
      p.descuento,
      p.costo_envio,
      p.total,
      p.fecha_creacion,
      p.fecha_cancelacion,
      p.motivo_cancelacion,
      p.observaciones,

      p.cliente_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', c.nombres, c.apellido_paterno, c.apellido_materno)), ''),
        'Público general'
      ) AS cliente_nombre,

      p.vendedor_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', u.nombres, u.apellido_paterno, u.apellido_materno)), ''),
        u.email,
        'N/A'
      ) AS vendedor_nombre,

      COUNT(DISTINCT d.id)::integer AS total_productos,

      COALESCE(
        SUM(
          CASE
            WHEN pg.estado = 'CONFIRMADO' THEN pg.monto
            ELSE 0
          END
        ),
        0
      ) AS total_pagado,

      COALESCE(
        STRING_AGG(DISTINCT pg.metodo::text, ', '),
        'N/A'
      ) AS metodos_pago

    FROM ventas.pedidos p
    LEFT JOIN clientes.clientes c ON c.id = p.cliente_id
    LEFT JOIN seguridad.usuarios u ON u.id = p.vendedor_id
    LEFT JOIN ventas.detalles_pedido d ON d.pedido_id = p.id
    LEFT JOIN ventas.pagos pg ON pg.pedido_id = p.id

    WHERE ${whereSql}

    GROUP BY
      p.id,
      c.id,
      u.id

    ORDER BY p.fecha_creacion DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const { rows } = await db.query(sql, params);

  return {
    rows,
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export async function getVentaHistorialDetalle(db, ventaId) {
  const ventaSql = `
    SELECT
      p.id,
      p.folio,
      p.estado,
      p.subtotal,
      p.descuento,
      p.costo_envio,
      p.total,
      p.fecha_creacion,
      p.fecha_cancelacion,
      p.motivo_cancelacion,
      p.observaciones,

      p.cliente_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', c.nombres, c.apellido_paterno, c.apellido_materno)), ''),
        'Público general'
      ) AS cliente_nombre,
      c.telefono AS cliente_telefono,
      c.email AS cliente_email,

      p.vendedor_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', u.nombres, u.apellido_paterno, u.apellido_materno)), ''),
        u.email,
        'N/A'
      ) AS vendedor_nombre,
      u.email AS vendedor_email

    FROM ventas.pedidos p
    LEFT JOIN clientes.clientes c ON c.id = p.cliente_id
    LEFT JOIN seguridad.usuarios u ON u.id = p.vendedor_id
    WHERE p.id = $1
      AND p.tipo = 'PUNTO_VENTA'
    LIMIT 1
  `;

  const { rows: ventaRows } = await db.query(ventaSql, [ventaId]);
  const venta = ventaRows[0] || null;

  if (!venta) return null;

  const detallesSql = `
    SELECT
      d.id,
      d.variante_id,
      d.cantidad,
      d.precio_unitario,
      d.importe,

      vp.sku,
      vp.codigo_barras,

      p.id AS producto_id,
      p.nombre AS producto_nombre,

      t.nombre AS talla_nombre,
      c.nombre AS color_nombre,
      c.hex AS color_hex

    FROM ventas.detalles_pedido d
    JOIN inventario.variantes_producto vp ON vp.id = d.variante_id
    JOIN inventario.productos p ON p.id = vp.producto_id
    LEFT JOIN inventario.tallas t ON t.id = vp.talla_id
    LEFT JOIN inventario.colores c ON c.id = vp.color_id
    WHERE d.pedido_id = $1
    ORDER BY p.nombre ASC
  `;

  const pagosSql = `
    SELECT
      pg.id,
      pg.monto,
      pg.metodo,
      pg.referencia_externa,
      pg.fecha_pago,
      pg.concepto,
      pg.estado,

      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', u.nombres, u.apellido_paterno, u.apellido_materno)), ''),
        u.email,
        'N/A'
      ) AS usuario_nombre

    FROM ventas.pagos pg
    LEFT JOIN seguridad.usuarios u ON u.id = pg.usuario_id
    WHERE pg.pedido_id = $1
    ORDER BY pg.fecha_pago ASC
  `;

  const [{ rows: detalles }, { rows: pagos }] = await Promise.all([
    db.query(detallesSql, [ventaId]),
    db.query(pagosSql, [ventaId]),
  ]);

  return {
    venta,
    detalles,
    pagos,
  };
}