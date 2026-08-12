import {
  normalizeStockItems,
  lockVariantesForUpdate,
  assertStockDisponible,
} from "./stock.model.js";

export async function listPedidosAdmin(
  db,
  { tipo = null, estado = null, cliente_id = null, q = null, limit = 50, offset = 0 } = {},
) {
  const sql = `
    SELECT
      vpr.id,
      vpr.folio,
      vpr.cliente_id,
      vpr.cliente_nombre,
      vpr.vendedor_id,
      vpr.tipo,
      vpr.estado,
      vpr.subtotal,
      vpr.descuento,
      vpr.costo_envio,
      vpr.total,
      vpr.fecha_limite_apartado,
      vpr.fecha_creacion,
      vpr.motivo_cancelacion,
      vpr.fecha_cancelacion,
      vpr.liquidado_at,
      vpr.observaciones,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN pg.estado = 'CONFIRMADO' AND pg.concepto::text LIKE 'REEMBOLSO%'
              THEN -ABS(pg.monto)
            WHEN pg.estado = 'CONFIRMADO'
              THEN pg.monto
            ELSE 0
          END
        )
        FROM ventas.pagos pg
        WHERE pg.pedido_id = vpr.id
      ), 0)::numeric(12,2) AS total_pagado,
      GREATEST(
        vpr.total - COALESCE((
          SELECT SUM(
            CASE
              WHEN pg.estado = 'CONFIRMADO' AND pg.concepto::text LIKE 'REEMBOLSO%'
                THEN -ABS(pg.monto)
              WHEN pg.estado = 'CONFIRMADO'
                THEN pg.monto
              ELSE 0
            END
          )
          FROM ventas.pagos pg
          WHERE pg.pedido_id = vpr.id
        ), 0),
        0
      )::numeric(12,2) AS saldo_pendiente,
      (
        SELECT COALESCE(SUM(d.cantidad), 0)
        FROM ventas.detalles_pedido d
        WHERE d.pedido_id = vpr.id
      ) AS items_count,
      CONCAT_WS(
        ' ',
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno
      ) AS vendedor_nombre
    FROM ventas.v_pedidos_resumen vpr
    LEFT JOIN seguridad.usuarios u ON u.id = vpr.vendedor_id
    WHERE ($1::text IS NULL OR vpr.tipo::text = $1)
      AND ($2::text IS NULL OR vpr.estado::text = $2)
      AND ($3::uuid IS NULL OR vpr.cliente_id = $3::uuid)
      AND (
        $4::text IS NULL
        OR vpr.folio::text ILIKE '%' || $4 || '%'
        OR COALESCE(vpr.cliente_nombre, '') ILIKE '%' || $4 || '%'
      )
    ORDER BY vpr.folio ASC
    LIMIT $5 OFFSET $6;
  `;

  const { rows } = await db.query(sql, [tipo, estado, cliente_id, q, limit, offset]);

  return rows;
}

export async function getPedidoResumenById(db, id) {
  const sql = `
    SELECT
      vpr.id,
      vpr.folio,
      vpr.cliente_id,
      vpr.cliente_nombre,
      vpr.vendedor_id,
      CONCAT_WS(
        ' ',
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno
      ) AS vendedor_nombre,
      vpr.tipo,
      vpr.estado,
      vpr.subtotal,
      vpr.descuento,
      vpr.costo_envio,
      vpr.total,
      vpr.fecha_limite_apartado,
      vpr.fecha_creacion,
      vpr.motivo_cancelacion,
      vpr.fecha_cancelacion,
      vpr.liquidado_at,
      vpr.observaciones,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN pg.estado = 'CONFIRMADO' AND pg.concepto::text LIKE 'REEMBOLSO%'
              THEN -ABS(pg.monto)
            WHEN pg.estado = 'CONFIRMADO'
              THEN pg.monto
            ELSE 0
          END
        )
        FROM ventas.pagos pg
        WHERE pg.pedido_id = vpr.id
      ), 0)::numeric(12,2) AS total_pagado,
      GREATEST(
        vpr.total - COALESCE((
          SELECT SUM(
            CASE
              WHEN pg.estado = 'CONFIRMADO' AND pg.concepto::text LIKE 'REEMBOLSO%'
                THEN -ABS(pg.monto)
              WHEN pg.estado = 'CONFIRMADO'
                THEN pg.monto
              ELSE 0
            END
          )
          FROM ventas.pagos pg
          WHERE pg.pedido_id = vpr.id
        ), 0),
        0
      )::numeric(12,2) AS saldo_pendiente
    FROM ventas.v_pedidos_resumen vpr
    LEFT JOIN seguridad.usuarios u ON u.id = vpr.vendedor_id
    WHERE vpr.id = $1;
  `;

  const { rows } = await db.query(sql, [id]);
  return rows[0] || null;
}

export async function listPedidoDetalles(db, pedidoId) {
  const sql = `
    SELECT
      d.id,
      d.pedido_id,
      d.variante_id,
      d.cantidad,
      d.precio_unitario,
      d.importe,

      v.producto_id,
      v.talla_id,
      v.color_id,
      v.sku AS sku,
      v.codigo_barras AS codigo_barras,

      p.nombre AS producto_nombre,
      p.descripcion AS producto_descripcion,

      t.nombre AS talla_nombre,
      c.nombre AS color_nombre,
      c.hex AS color_hex,

      (
        SELECT pi.url
        FROM inventario.producto_imagenes pi
        WHERE pi.producto_id = p.id
        ORDER BY pi.es_principal DESC, pi.orden ASC, pi.created_at ASC
        LIMIT 1
      ) AS imagen_principal
    FROM ventas.detalles_pedido d
    JOIN inventario.variantes_producto v ON v.id = d.variante_id
    JOIN inventario.productos p ON p.id = v.producto_id
    LEFT JOIN inventario.tallas t ON t.id = v.talla_id
    LEFT JOIN inventario.colores c ON c.id = v.color_id
    WHERE d.pedido_id = $1
    ORDER BY p.nombre ASC, t.nombre NULLS LAST, c.nombre NULLS LAST;
  `;

  const { rows } = await db.query(sql, [pedidoId]);
  return rows;
}

export async function listPedidoPagos(db, pedidoId) {
  const sql = `
    SELECT
      pg.id,
      pg.pedido_id,
      pg.monto,
      pg.metodo,
      pg.referencia_externa,
      pg.fecha_pago,
      pg.concepto,
      pg.estado,
      pg.usuario_id,

      u.email AS usuario_email,
      CONCAT_WS(
        ' ',
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno
      ) AS usuario_nombre
    FROM ventas.pagos pg
    LEFT JOIN seguridad.usuarios u ON u.id = pg.usuario_id
    WHERE pg.pedido_id = $1
    ORDER BY pg.fecha_pago ASC;
  `;

  const { rows } = await db.query(sql, [pedidoId]);
  return rows;
}

export async function getPedidoDetalleAdmin(db, pedidoId) {
  const pedido = await getPedidoResumenById(db, pedidoId);

  if (!pedido) return null;

  const detalles = await listPedidoDetalles(db, pedidoId);
  const pagos = await listPedidoPagos(db, pedidoId);

  return {
    pedido,
    detalles,
    pagos,
  };
}

function createModelError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function crearApartado(
  db,
  {
    cliente_id,
    vendedor_id,
    items,
    fecha_limite_apartado,
    anticipo = 0,
    metodo_pago = null,
    referencia_externa = null,
  },
) {
  if (!cliente_id) {
    throw createModelError("cliente_id requerido para apartado", 400);
  }

  const compactItems = normalizeStockItems(items);
  const anticipoNum = Number(anticipo || 0);

  if (!Number.isFinite(anticipoNum) || anticipoNum < 0) {
    throw createModelError("El anticipo no puede ser negativo", 400);
  }

  if (!fecha_limite_apartado) {
    throw createModelError("fecha_limite_apartado es requerida", 400);
  }

  const client = await db.connect();
  let committed = false;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      vendedor_id ? String(vendedor_id) : "",
    ]);

    const { rows: clienteRows } = await client.query(
      `
        SELECT id, puede_apartar, activo
        FROM clientes.clientes
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [cliente_id],
    );

    const cliente = clienteRows[0];

    if (!cliente) {
      throw createModelError("Cliente no encontrado", 404);
    }

    if (cliente.activo === false) {
      throw createModelError("El cliente está inactivo", 409);
    }

    if (cliente.puede_apartar !== true) {
      throw createModelError("El cliente no está autorizado para apartados", 403);
    }

    const variantesMap = await lockVariantesForUpdate(
      client,
      compactItems.map((item) => item.variante_id),
    );

    if (variantesMap.size !== compactItems.length) {
      const faltantes = compactItems
        .filter((item) => !variantesMap.has(item.variante_id))
        .map((item) => item.variante_id);
      throw createModelError(
        `Variante no encontrada: ${faltantes.join(", ")}`,
        404,
      );
    }

    const normalizedItems = compactItems.map((item) => {
      const variante = variantesMap.get(item.variante_id);
      assertStockDisponible(variante, item.cantidad);

      const precio = Number(variante.precio_venta);
      if (!Number.isFinite(precio) || precio <= 0) {
        throw createModelError(
          `La variante ${item.variante_id} no tiene un precio de venta válido`,
          400,
        );
      }

      return {
        variante_id: item.variante_id,
        cantidad: item.cantidad,
        precio_unitario: Math.round(precio * 100) / 100,
      };
    });

    const subtotal =
      Math.round(
        normalizedItems.reduce(
          (sum, item) => sum + item.precio_unitario * item.cantidad,
          0,
        ) * 100,
      ) / 100;

    if (anticipoNum > subtotal) {
      throw createModelError("El anticipo no puede ser mayor al total", 400);
    }

    if (anticipoNum > 0 && !metodo_pago) {
      throw createModelError("metodo_pago requerido cuando hay anticipo", 400);
    }

    const { rows: pedidoRows } = await client.query(
      `
        INSERT INTO ventas.pedidos (
          cliente_id,
          vendedor_id,
          tipo,
          estado,
          subtotal,
          descuento,
          costo_envio,
          total,
          fecha_limite_apartado
        )
        VALUES ($1::uuid, $2::uuid, 'APARTADO', 'ACTIVO', $3, 0, 0, $3, $4)
        RETURNING *
      `,
      [cliente_id, vendedor_id, subtotal, fecha_limite_apartado],
    );

    const pedido = pedidoRows[0];

    for (const item of normalizedItems) {
      await client.query(
        `
          INSERT INTO ventas.detalles_pedido (
            pedido_id,
            variante_id,
            cantidad,
            precio_unitario
          )
          VALUES ($1::uuid, $2::uuid, $3, $4)
        `,
        [pedido.id, item.variante_id, item.cantidad, item.precio_unitario],
      );

      const { rows: stockRows } = await client.query(
        `
          UPDATE inventario.variantes_producto
          SET stock_apartado = stock_apartado + $2,
              updated_at = now()
          WHERE id = $1::uuid
            AND (stock_fisico - stock_apartado) >= $2
          RETURNING id, stock_fisico, stock_apartado
        `,
        [item.variante_id, item.cantidad],
      );

      if (stockRows.length === 0) {
        throw createModelError(
          `No se pudo reservar stock para la variante ${item.variante_id}`,
          409,
        );
      }
    }

    let pagoGenerado = null;

    if (anticipoNum > 0) {
      const { rows } = await client.query(
        `
          INSERT INTO ventas.pagos (
            pedido_id,
            monto,
            metodo,
            referencia_externa,
            concepto,
            estado,
            usuario_id
          )
          VALUES (
            $1::uuid,
            $2,
            $3::public.metodo_pago_enum,
            $4,
            'ANTICIPO_APARTADO',
            'CONFIRMADO',
            $5::uuid
          )
          RETURNING id, pedido_id, monto, metodo, referencia_externa,
                    concepto, estado, fecha_pago, usuario_id
        `,
        [
          pedido.id,
          Math.round(anticipoNum * 100) / 100,
          String(metodo_pago).trim().toUpperCase(),
          referencia_externa ? String(referencia_externa).trim() : null,
          vendedor_id,
        ],
      );
      pagoGenerado = rows[0] || null;
    }

    await client.query("COMMIT");
    committed = true;

    return {
      ...pedido,
      pago_generado: pagoGenerado,
    };
  } catch (err) {
    if (!committed) await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function registrarAbonoApartado(
  db,
  pedidoId,
  { monto, metodo, referencia_externa = null, usuario_id = null },
) {
  const client = await db.connect();
  let committed = false;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuario_id ? String(usuario_id) : "",
    ]);

    const pedidoSql = `
      SELECT id, folio, tipo, estado, total
      FROM ventas.pedidos
      WHERE id = $1
      FOR UPDATE;
    `;

    const pedidoResult = await client.query(pedidoSql, [pedidoId]);
    const pedido = pedidoResult.rows[0];

    if (!pedido) {
      throw createModelError("Apartado no encontrado", 404);
    }

    if (pedido.tipo !== "APARTADO") {
      throw createModelError("El pedido no es un apartado", 400);
    }

    if (pedido.estado !== "ACTIVO") {
      throw createModelError(
        `Solo se pueden abonar apartados activos. Estado actual: ${pedido.estado}`,
        409,
      );
    }

    const pagosSql = `
      SELECT COALESCE(SUM(monto), 0) AS total_pagado
      FROM ventas.pagos
      WHERE pedido_id = $1
        AND estado = 'CONFIRMADO'
        AND concepto <> 'REEMBOLSO';
    `;

    const pagosResult = await client.query(pagosSql, [pedidoId]);

    const total = Number(pedido.total);
    const totalPagado = Number(pagosResult.rows[0]?.total_pagado ?? 0);
    const saldoPendiente = total - totalPagado;
    const montoAbono = Number(monto);

    if (!Number.isFinite(montoAbono) || montoAbono <= 0) {
      throw createModelError("El monto del abono debe ser mayor a 0", 400);
    }

    if (saldoPendiente <= 0) {
      throw createModelError("El apartado ya no tiene saldo pendiente", 409);
    }

    if (montoAbono > saldoPendiente) {
      throw createModelError(
        `El abono no puede exceder el saldo pendiente de $${saldoPendiente.toFixed(2)}`,
        400,
      );
    }

    if (montoAbono === saldoPendiente) {
      throw createModelError(
        "El monto cubre el saldo total. Usa la opción de liquidar apartado.",
        400,
      );
    }

    const insertPagoSql = `
      INSERT INTO ventas.pagos (
        pedido_id,
        monto,
        metodo,
        referencia_externa,
        concepto,
        estado,
        usuario_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'ABONO_APARTADO',
        'CONFIRMADO',
        $5
      )
      RETURNING id, pedido_id, monto, metodo, concepto, estado, fecha_pago;
    `;

    const pagoResult = await client.query(insertPagoSql, [
      pedidoId,
      montoAbono,
      metodo,
      referencia_externa ?? null,
      usuario_id ?? null,
    ]);

    const pagoGenerado = pagoResult.rows[0];

    await client.query("COMMIT");
    committed = true;

    const detalle = await getPedidoDetalleAdmin(client, pedidoId);

    return { detalle, pago_generado: pagoGenerado };
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }

    throw err;
  } finally {
    client.release();
  }
}

export async function cancelarApartado(
  db,
  pedidoId,
  {
    motivo_cancelacion,
    usuario_id = null,
    reembolso = { modo: "NINGUNO" },
  },
) {
  const client = await db.connect();
  let committed = false;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuario_id ? String(usuario_id) : "",
    ]);

    const pedidoSql = `
      SELECT id, folio, tipo, estado, total
      FROM ventas.pedidos
      WHERE id = $1::uuid
      FOR UPDATE;
    `;

    const pedidoResult = await client.query(pedidoSql, [pedidoId]);
    const pedido = pedidoResult.rows[0];

    if (!pedido) {
      throw createModelError("Apartado no encontrado", 404);
    }

    if (pedido.tipo !== "APARTADO") {
      throw createModelError("El pedido no es un apartado", 400);
    }

    if (pedido.estado !== "ACTIVO") {
      throw createModelError(
        `Solo se pueden cancelar apartados activos. Estado actual: ${pedido.estado}`,
        409,
      );
    }

    const motivo = String(motivo_cancelacion || "").trim();
    if (motivo.length < 3) {
      throw createModelError("El motivo de cancelación es requerido", 400);
    }

    const detallesResult = await client.query(
      `
        SELECT variante_id, SUM(cantidad)::int AS cantidad
        FROM ventas.detalles_pedido
        WHERE pedido_id = $1::uuid
        GROUP BY variante_id
        ORDER BY variante_id;
      `,
      [pedidoId],
    );
    const detalles = detallesResult.rows;

    if (detalles.length === 0) {
      throw createModelError("El apartado no tiene productos registrados", 409);
    }

    const variantesMap = await lockVariantesForUpdate(
      client,
      detalles.map((detalle) => detalle.variante_id),
    );

    if (variantesMap.size !== detalles.length) {
      throw createModelError(
        "Una o más variantes del apartado no existen",
        409,
      );
    }

    for (const detalle of detalles) {
      const variante = variantesMap.get(String(detalle.variante_id));
      const stockApartado = Number(variante.stock_apartado);
      const cantidad = Number(detalle.cantidad);

      if (stockApartado < cantidad) {
        throw createModelError(
          `Stock apartado insuficiente para liberar la variante ${detalle.variante_id}`,
          409,
        );
      }
    }

    const { rows: pagosRows } = await client.query(
      `
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN concepto::text LIKE 'REEMBOLSO%' THEN -ABS(monto)
                ELSE monto
              END
            ),
            0
          )::numeric(12,2) AS total_pagado_neto,
          (
            ARRAY_AGG(metodo ORDER BY fecha_pago DESC, id DESC)
            FILTER (WHERE concepto::text NOT LIKE 'REEMBOLSO%')
          )[1] AS ultimo_metodo
        FROM ventas.pagos
        WHERE pedido_id = $1::uuid
          AND estado = 'CONFIRMADO'
      `,
      [pedidoId],
    );

    const totalPagadoNeto = Number(pagosRows[0]?.total_pagado_neto ?? 0);
    const modoReembolso = String(reembolso?.modo || "NINGUNO")
      .trim()
      .toUpperCase();

    if (!["NINGUNO", "TOTAL", "PARCIAL"].includes(modoReembolso)) {
      throw createModelError(
        "reembolso.modo debe ser NINGUNO, TOTAL o PARCIAL",
        400,
      );
    }

    let montoReembolso = 0;

    if (modoReembolso === "TOTAL") {
      montoReembolso = totalPagadoNeto;
    } else if (modoReembolso === "PARCIAL") {
      montoReembolso = Number(reembolso?.monto);

      if (!Number.isFinite(montoReembolso) || montoReembolso <= 0) {
        throw createModelError(
          "El monto de reembolso parcial debe ser mayor a 0",
          400,
        );
      }
    }

    montoReembolso = Math.round(montoReembolso * 100) / 100;

    if (montoReembolso > totalPagadoNeto) {
      throw createModelError(
        `El reembolso no puede exceder lo pagado ($${totalPagadoNeto.toFixed(2)})`,
        400,
      );
    }

    if (montoReembolso > 0 && totalPagadoNeto <= 0) {
      throw createModelError(
        "El apartado no tiene pagos confirmados disponibles para reembolsar",
        409,
      );
    }

    let reembolsoGenerado = null;

    if (montoReembolso > 0) {
      const metodoReembolso = String(
        reembolso?.metodo || pagosRows[0]?.ultimo_metodo || "",
      )
        .trim()
        .toUpperCase();

      if (!metodoReembolso) {
        throw createModelError(
          "Debes indicar el método usado para el reembolso",
          400,
        );
      }

      const { rows } = await client.query(
        `
          INSERT INTO ventas.pagos (
            pedido_id,
            monto,
            metodo,
            referencia_externa,
            concepto,
            estado,
            usuario_id
          )
          VALUES (
            $1::uuid,
            $2,
            $3::public.metodo_pago_enum,
            $4,
            'REEMBOLSO',
            'CONFIRMADO',
            $5::uuid
          )
          RETURNING id, pedido_id, monto, metodo, referencia_externa,
                    concepto, estado, fecha_pago, usuario_id
        `,
        [
          pedidoId,
          montoReembolso,
          metodoReembolso,
          reembolso?.referencia_externa
            ? String(reembolso.referencia_externa).trim()
            : null,
          usuario_id,
        ],
      );

      reembolsoGenerado = rows[0] || null;
    }

    await client.query(
      `
        UPDATE ventas.pedidos
        SET estado = 'CANCELADO',
            motivo_cancelacion = $2,
            fecha_cancelacion = now()
        WHERE id = $1::uuid
      `,
      [pedidoId, motivo],
    );

    for (const detalle of detalles) {
      const { rows: stockRows } = await client.query(
        `
          UPDATE inventario.variantes_producto
          SET stock_apartado = stock_apartado - $2,
              updated_at = now()
          WHERE id = $1::uuid
            AND stock_apartado >= $2
          RETURNING id, stock_fisico, stock_apartado;
        `,
        [detalle.variante_id, Number(detalle.cantidad)],
      );

      if (stockRows.length === 0) {
        throw createModelError(
          `No se pudo liberar stock apartado para la variante ${detalle.variante_id}`,
          409,
        );
      }
    }

    await client.query("COMMIT");
    committed = true;

    const detalle = await getPedidoDetalleAdmin(client, pedidoId);

    return {
      detalle,
      reembolso_generado: reembolsoGenerado,
      politica_reembolso: {
        modo: modoReembolso,
        total_pagado_neto: totalPagadoNeto,
        monto_reembolsado: montoReembolso,
        monto_retenido: Math.max(0, totalPagadoNeto - montoReembolso),
      },
    };
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }

    throw err;
  } finally {
    client.release();
  }
}

export async function liquidarApartado(
  db,
  pedidoId,
  { metodo, referencia_externa = null, usuario_id = null },
) {
  const client = await db.connect();
  let committed = false;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuario_id ? String(usuario_id) : "",
    ]);

    const pedidoSql = `
      SELECT id, folio, tipo, estado, total
      FROM ventas.pedidos
      WHERE id = $1
      FOR UPDATE;
    `;

    const pedidoResult = await client.query(pedidoSql, [pedidoId]);
    const pedido = pedidoResult.rows[0];

    if (!pedido) {
      throw createModelError("Apartado no encontrado", 404);
    }

    if (pedido.tipo !== "APARTADO") {
      throw createModelError("El pedido no es un apartado", 400);
    }

    if (pedido.estado !== "ACTIVO") {
      throw createModelError(
        `Solo se pueden liquidar apartados activos. Estado actual: ${pedido.estado}`,
        409,
      );
    }

    const detallesSql = `
      SELECT
        d.variante_id,
        v.producto_id,
        SUM(d.cantidad)::int AS cantidad
      FROM ventas.detalles_pedido d
      JOIN inventario.variantes_producto v ON v.id = d.variante_id
      WHERE d.pedido_id = $1
      GROUP BY d.variante_id, v.producto_id;
    `;

    const detallesResult = await client.query(detallesSql, [pedidoId]);
    const detalles = detallesResult.rows;

    if (detalles.length === 0) {
      throw createModelError("El apartado no tiene productos registrados", 409);
    }

    const varianteIds = detalles.map((detalle) => detalle.variante_id);

    const variantesSql = `
      SELECT
        id,
        producto_id,
        stock_fisico,
        stock_apartado
      FROM inventario.variantes_producto
      WHERE id = ANY($1::uuid[])
      ORDER BY id
      FOR UPDATE;
    `;

    const variantesResult = await client.query(variantesSql, [varianteIds]);

    if (variantesResult.rows.length !== varianteIds.length) {
      throw createModelError(
        "Una o más variantes del apartado no existen",
        409,
      );
    }

    const variantesMap = new Map(
      variantesResult.rows.map((variante) => [variante.id, variante]),
    );

    for (const detalle of detalles) {
      const variante = variantesMap.get(detalle.variante_id);

      const cantidad = Number(detalle.cantidad);
      const stockFisico = Number(variante.stock_fisico);
      const stockApartado = Number(variante.stock_apartado);

      if (stockApartado < cantidad) {
        throw createModelError(
          `Stock apartado insuficiente para la variante ${detalle.variante_id}`,
          409,
        );
      }

      if (stockFisico < cantidad) {
        throw createModelError(
          `Stock físico insuficiente para la variante ${detalle.variante_id}`,
          409,
        );
      }
    }

    const pagosSql = `
      SELECT COALESCE(SUM(monto), 0) AS total_pagado
      FROM ventas.pagos
      WHERE pedido_id = $1
        AND estado = 'CONFIRMADO'
        AND concepto <> 'REEMBOLSO';
    `;

    const pagosResult = await client.query(pagosSql, [pedidoId]);

    const total = Number(pedido.total);
    const totalPagado = Number(pagosResult.rows[0]?.total_pagado ?? 0);
    const saldoPendiente = total - totalPagado;

    if (!Number.isFinite(saldoPendiente) || saldoPendiente <= 0) {
      throw createModelError(
        "El apartado no tiene saldo pendiente para liquidar",
        409,
      );
    }

    const insertPagoSql = `
      INSERT INTO ventas.pagos (
        pedido_id,
        monto,
        metodo,
        referencia_externa,
        concepto,
        estado,
        usuario_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'LIQUIDACION_APARTADO',
        'CONFIRMADO',
        $5
      )
      RETURNING id;
    `;

    const pagoResult = await client.query(insertPagoSql, [
      pedidoId,
      saldoPendiente,
      metodo,
      referencia_externa ?? null,
      usuario_id ?? null,
    ]);

    const pagoGenerado = pagoResult.rows[0];

    const updatePedidoSql = `
      UPDATE ventas.pedidos
      SET
        estado = 'LIQUIDADO',
        liquidado_at = now()
      WHERE id = $1
      RETURNING id, folio, estado, liquidado_at;
    `;

    await client.query(updatePedidoSql, [pedidoId]);

    for (const detalle of detalles) {
      const cantidad = Number(detalle.cantidad);

      const updateStockSql = `
        UPDATE inventario.variantes_producto
        SET
          stock_fisico = stock_fisico - $2,
          stock_apartado = stock_apartado - $2,
          updated_at = now()
        WHERE id = $1
          AND stock_fisico >= $2
          AND stock_apartado >= $2
        RETURNING id, stock_fisico, stock_apartado;
      `;

      const stockResult = await client.query(updateStockSql, [
        detalle.variante_id,
        cantidad,
      ]);

      if (stockResult.rows.length === 0) {
        throw createModelError(
          `No se pudo actualizar stock para la variante ${detalle.variante_id}`,
          409,
        );
      }

      const movimientoSql = `
        INSERT INTO inventario.movimientos (
          variante_id,
          usuario_id,
          cantidad,
          motivo,
          tipo
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'SALIDA'
        );
      `;

      await client.query(movimientoSql, [
        detalle.variante_id,
        usuario_id ?? null,
        -Math.abs(cantidad),
        `Liquidación de apartado folio ${pedido.folio}`,
      ]);
    }

    await client.query("COMMIT");
    committed = true;

    const detalle = await getPedidoDetalleAdmin(client, pedidoId);
    return { detalle, pago_generado: pagoGenerado };
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }

    throw err;
  } finally {
    client.release();
  }
}

export async function vencerApartadosExpirados(db) {
  const client = await db.connect();
  let committed = false;

  try {
    await client.query("BEGIN");

    const pedidosSql = `
      SELECT id, folio
      FROM ventas.pedidos
      WHERE tipo = 'APARTADO'
        AND estado = 'ACTIVO'
        AND fecha_limite_apartado < CURRENT_DATE
      ORDER BY id
      FOR UPDATE;
    `;

    const pedidosResult = await client.query(pedidosSql);
    const pedidos = pedidosResult.rows;

    if (pedidos.length === 0) {
      await client.query("COMMIT");
      committed = true;

      return {
        vencidos: 0,
        pedidos: [],
        message: "No hay apartados expirados por vencer",
      };
    }

    const pedidoIds = pedidos.map((pedido) => pedido.id);

    const detallesSql = `
      SELECT
        variante_id,
        SUM(cantidad)::int AS cantidad
      FROM ventas.detalles_pedido
      WHERE pedido_id = ANY($1::uuid[])
      GROUP BY variante_id;
    `;

    const detallesResult = await client.query(detallesSql, [pedidoIds]);
    const detalles = detallesResult.rows;

    const varianteIds = detalles.map((detalle) => detalle.variante_id);

    if (varianteIds.length > 0) {
      const variantesSql = `
        SELECT id, stock_apartado
        FROM inventario.variantes_producto
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE;
      `;

      const variantesResult = await client.query(variantesSql, [varianteIds]);

      if (variantesResult.rows.length !== varianteIds.length) {
        throw createModelError(
          "Una o más variantes de los apartados expirados no existen",
          409,
        );
      }

      const variantesMap = new Map(
        variantesResult.rows.map((variante) => [variante.id, variante]),
      );

      for (const detalle of detalles) {
        const variante = variantesMap.get(detalle.variante_id);
        const stockApartado = Number(variante.stock_apartado);
        const cantidad = Number(detalle.cantidad);

        if (stockApartado < cantidad) {
          throw createModelError(
            `Stock apartado insuficiente para vencer la variante ${detalle.variante_id}`,
            409,
          );
        }
      }

      for (const detalle of detalles) {
        const updateStockSql = `
          UPDATE inventario.variantes_producto
          SET
            stock_apartado = stock_apartado - $2,
            updated_at = now()
          WHERE id = $1
            AND stock_apartado >= $2
          RETURNING id, stock_apartado;
        `;

        const updateResult = await client.query(updateStockSql, [
          detalle.variante_id,
          Number(detalle.cantidad),
        ]);

        if (updateResult.rows.length === 0) {
          throw createModelError(
            `No se pudo liberar stock apartado para la variante ${detalle.variante_id}`,
            409,
          );
        }
      }
    }

    const updatePedidosSql = `
      UPDATE ventas.pedidos
      SET
        estado = 'VENCIDO',
        vencido_at = now()
      WHERE id = ANY($1::uuid[])
      RETURNING id, folio, estado, fecha_limite_apartado, vencido_at;
    `;

    const updatePedidosResult = await client.query(updatePedidosSql, [
      pedidoIds,
    ]);

    await client.query("COMMIT");
    committed = true;

    return {
      vencidos: updatePedidosResult.rows.length,
      pedidos: updatePedidosResult.rows,
      message: "Apartados expirados vencidos correctamente",
    };
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }

    throw err;
  } finally {
    client.release();
  }
}

export async function getPagoTicketData(db, pedidoId, pagoId) {
  const detalle = await getPedidoDetalleAdmin(db, pedidoId);

  if (!detalle) return null;

  const pagoSql = `
    WITH pagos_ordenados AS (
      SELECT
        pg.id,
        pg.pedido_id,
        pg.monto,
        pg.metodo,
        pg.referencia_externa,
        pg.fecha_pago,
        pg.concepto,
        pg.estado,
        pg.usuario_id,
        COALESCE(
          SUM(pg.monto) OVER (
            ORDER BY pg.fecha_pago ASC, pg.id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        ) AS total_pagado_antes
      FROM ventas.pagos pg
      WHERE pg.pedido_id = $1
        AND pg.estado = 'CONFIRMADO'
        AND pg.concepto <> 'REEMBOLSO'
    )
    SELECT
      po.*,
      u.email AS usuario_email,
      CONCAT_WS(
        ' ',
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno
      ) AS usuario_nombre
    FROM pagos_ordenados po
    LEFT JOIN seguridad.usuarios u ON u.id = po.usuario_id
    WHERE po.id = $2;
  `;

  const pagoResult = await db.query(pagoSql, [pedidoId, pagoId]);
  const pago = pagoResult.rows[0];

  if (!pago) return null;

  const total = Number(detalle.pedido.total ?? 0);
  const montoPago = Number(pago.monto ?? 0);
  const totalPagadoAntes = Number(pago.total_pagado_antes ?? 0);

  const saldoAntes = Math.max(total - totalPagadoAntes, 0);
  const saldoDespues = Math.max(saldoAntes - montoPago, 0);

  return {
    pedido: detalle.pedido,
    total_apartado: total,
    pago,
    saldo_antes: saldoAntes,
    saldo_despues: saldoDespues,
  };
}

export async function cambiarEstadoPedidoWeb(db, pedidoId, nuevoEstado) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
        SELECT
          id,
          folio,
          tipo,
          estado
        FROM ventas.pedidos
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [pedidoId],
    );

    const pedido = rows[0];

    if (!pedido) {
      const error = new Error("Pedido no encontrado.");
      error.code = "NOT_FOUND";
      throw error;
    }

    if (pedido.tipo !== "WEB") {
      const error = new Error("El pedido no es un pedido web.");
      error.code = "VALIDATION";
      throw error;
    }

    const transicionesValidas = {
      PAGADO: "ENVIADO",
      ENVIADO: "ENTREGADO",
    };

    const estadoEsperado = transicionesValidas[pedido.estado];

    if (!estadoEsperado || estadoEsperado !== nuevoEstado) {
      const error = new Error(
        `No se permite cambiar un pedido ${pedido.estado} a ${nuevoEstado}.`,
      );
      error.code = "INVALID_STATE";
      throw error;
    }

    const { rows: updatedRows } = await client.query(
      `
        UPDATE ventas.pedidos
        SET estado = $2
        WHERE id = $1::uuid
        RETURNING *
      `,
      [pedido.id, nuevoEstado],
    );

    await client.query("COMMIT");

    return updatedRows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}