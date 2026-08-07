function modelError(message, status = 400, code = "VALIDATION") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function nullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function positiveLimit(value, fallback = 20, max = 100) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function safeOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

async function resolveCliente(client, usuarioId, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `
      SELECT
        c.id,
        c.usuario_id,
        c.nombres,
        c.apellido_paterno,
        c.apellido_materno,
        c.telefono,
        c.email,
        c.tiene_credito,
        c.limite_credito,
        c.saldo_deudor,
        c.puede_apartar,
        c.fecha_activacion_credito,
        c.fecha_actualizacion_credito,
        c.fecha_registro,
        c.activo
      FROM clientes.clientes c
      WHERE c.usuario_id = $1::uuid
      ${forUpdate ? "FOR UPDATE" : ""}
      LIMIT 1
    `,
    [usuarioId],
  );

  return rows[0] || null;
}

async function requireCliente(client, usuarioId, options) {
  const cliente = await resolveCliente(client, usuarioId, options);

  if (!cliente) {
    throw modelError(
      "La cuenta autenticada no tiene un perfil de cliente asociado.",
      404,
      "CLIENT_PROFILE_NOT_FOUND",
    );
  }

  if (cliente.activo !== true) {
    throw modelError(
      "El perfil del cliente está inactivo.",
      403,
      "CLIENT_INACTIVE",
    );
  }

  return cliente;
}

export async function obtenerMiCuenta(db, usuarioId) {
  const { rows } = await db.query(
    `
      SELECT
        u.id AS usuario_id,
        u.email,
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno,
        u.activo AS usuario_activo,
        u.tfa_enabled,
        u.fecha_creacion,
        r.id AS rol_id,
        r.nombre AS rol,
        c.id AS cliente_id,
        c.telefono,
        c.tiene_credito,
        c.limite_credito,
        c.saldo_deudor,
        GREATEST(COALESCE(c.limite_credito, 0) - COALESCE(c.saldo_deudor, 0), 0)
          AS credito_disponible,
        c.puede_apartar,
        c.fecha_activacion_credito,
        c.fecha_actualizacion_credito,
        c.fecha_registro,
        c.activo AS cliente_activo
      FROM seguridad.usuarios u
      LEFT JOIN seguridad.roles_sistema r ON r.id = u.rol_id
      LEFT JOIN clientes.clientes c ON c.usuario_id = u.id
      WHERE u.id = $1::uuid
      LIMIT 1
    `,
    [usuarioId],
  );

  return rows[0] || null;
}

export async function actualizarMiPerfil(
  db,
  usuarioId,
  { nombres, apellido_paterno, apellido_materno, telefono } = {},
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuarioId,
    ]);

    const cliente = await requireCliente(client, usuarioId, {
      forUpdate: true,
    });

    const nextNombres =
      nombres === undefined ? cliente.nombres : String(nombres).trim();
    const nextApellidoPaterno =
      apellido_paterno === undefined
        ? cliente.apellido_paterno
        : String(apellido_paterno).trim();
    const nextApellidoMaterno =
      apellido_materno === undefined
        ? cliente.apellido_materno
        : nullableText(apellido_materno);
    const nextTelefono =
      telefono === undefined ? cliente.telefono : nullableText(telefono);

    if (!nextNombres) {
      throw modelError("Los nombres son requeridos.");
    }

    if (!nextApellidoPaterno) {
      throw modelError("El apellido paterno es requerido.");
    }

    await client.query(
      `
        UPDATE seguridad.usuarios
        SET
          nombres = $2,
          apellido_paterno = $3,
          apellido_materno = $4
        WHERE id = $1::uuid
      `,
      [usuarioId, nextNombres, nextApellidoPaterno, nextApellidoMaterno],
    );

    await client.query(
      `
        UPDATE clientes.clientes
        SET
          nombres = $2,
          apellido_paterno = $3,
          apellido_materno = $4,
          telefono = $5
        WHERE usuario_id = $1::uuid
      `,
      [
        usuarioId,
        nextNombres,
        nextApellidoPaterno,
        nextApellidoMaterno,
        nextTelefono,
      ],
    );

    await client.query("COMMIT");
    return obtenerMiCuenta(client, usuarioId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listarMisDirecciones(db, usuarioId) {
  const cliente = await requireCliente(db, usuarioId);

  const { rows } = await db.query(
    `
      SELECT
        id,
        cliente_id,
        calle,
        numero_exterior,
        numero_interior,
        colonia,
        ciudad,
        estado,
        codigo_postal,
        referencias,
        es_principal
      FROM clientes.direcciones
      WHERE cliente_id = $1::uuid
      ORDER BY es_principal DESC, id ASC
    `,
    [cliente.id],
  );

  return rows;
}

export async function crearMiDireccion(db, usuarioId, payload = {}) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuarioId,
    ]);

    const cliente = await requireCliente(client, usuarioId, {
      forUpdate: true,
    });

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM clientes.direcciones WHERE cliente_id = $1`,
      [cliente.id],
    );

    const esPrincipal =
      Boolean(payload.es_principal) ||
      Number(countResult.rows[0]?.total || 0) === 0;

    if (esPrincipal) {
      await client.query(
        `UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1`,
        [cliente.id],
      );
    }

    const { rows } = await client.query(
      `
        INSERT INTO clientes.direcciones (
          cliente_id,
          calle,
          numero_exterior,
          numero_interior,
          colonia,
          ciudad,
          estado,
          codigo_postal,
          referencias,
          es_principal
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `,
      [
        cliente.id,
        String(payload.calle).trim(),
        nullableText(payload.numero_exterior),
        nullableText(payload.numero_interior),
        nullableText(payload.colonia),
        String(payload.ciudad).trim(),
        String(payload.estado).trim(),
        String(payload.codigo_postal).trim(),
        nullableText(payload.referencias),
        esPrincipal,
      ],
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function actualizarMiDireccion(
  db,
  usuarioId,
  direccionId,
  payload = {},
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuarioId,
    ]);

    const cliente = await requireCliente(client, usuarioId, {
      forUpdate: true,
    });

    const currentResult = await client.query(
      `
        SELECT *
        FROM clientes.direcciones
        WHERE id = $1::uuid AND cliente_id = $2::uuid
        FOR UPDATE
      `,
      [direccionId, cliente.id],
    );

    const current = currentResult.rows[0];
    if (!current) {
      throw modelError("Dirección no encontrada.", 404, "NOT_FOUND");
    }

    if (payload.es_principal === true) {
      await client.query(
        `UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1`,
        [cliente.id],
      );
    }

    const { rows } = await client.query(
      `
        UPDATE clientes.direcciones
        SET
          calle = $3,
          numero_exterior = $4,
          numero_interior = $5,
          colonia = $6,
          ciudad = $7,
          estado = $8,
          codigo_postal = $9,
          referencias = $10,
          es_principal = $11
        WHERE id = $1::uuid AND cliente_id = $2::uuid
        RETURNING *
      `,
      [
        direccionId,
        cliente.id,
        payload.calle === undefined
          ? current.calle
          : String(payload.calle).trim(),
        payload.numero_exterior === undefined
          ? current.numero_exterior
          : nullableText(payload.numero_exterior),
        payload.numero_interior === undefined
          ? current.numero_interior
          : nullableText(payload.numero_interior),
        payload.colonia === undefined
          ? current.colonia
          : nullableText(payload.colonia),
        payload.ciudad === undefined
          ? current.ciudad
          : String(payload.ciudad).trim(),
        payload.estado === undefined
          ? current.estado
          : String(payload.estado).trim(),
        payload.codigo_postal === undefined
          ? current.codigo_postal
          : String(payload.codigo_postal).trim(),
        payload.referencias === undefined
          ? current.referencias
          : nullableText(payload.referencias),
        payload.es_principal === true ? true : current.es_principal,
      ],
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function establecerMiDireccionPrincipal(
  db,
  usuarioId,
  direccionId,
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const cliente = await requireCliente(client, usuarioId, {
      forUpdate: true,
    });

    const owned = await client.query(
      `SELECT id FROM clientes.direcciones WHERE id = $1::uuid AND cliente_id = $2::uuid`,
      [direccionId, cliente.id],
    );

    if (!owned.rows[0]) {
      throw modelError("Dirección no encontrada.", 404, "NOT_FOUND");
    }

    await client.query(
      `UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1`,
      [cliente.id],
    );

    const { rows } = await client.query(
      `
        UPDATE clientes.direcciones
        SET es_principal = true
        WHERE id = $1::uuid AND cliente_id = $2::uuid
        RETURNING *
      `,
      [direccionId, cliente.id],
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function eliminarMiDireccion(db, usuarioId, direccionId) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const cliente = await requireCliente(client, usuarioId, {
      forUpdate: true,
    });

    const { rows } = await client.query(
      `
        DELETE FROM clientes.direcciones
        WHERE id = $1::uuid AND cliente_id = $2::uuid
        RETURNING id, es_principal
      `,
      [direccionId, cliente.id],
    );

    const deleted = rows[0];
    if (!deleted) {
      throw modelError("Dirección no encontrada.", 404, "NOT_FOUND");
    }

    if (deleted.es_principal) {
      await client.query(
        `
          UPDATE clientes.direcciones
          SET es_principal = true
          WHERE id = (
            SELECT id
            FROM clientes.direcciones
            WHERE cliente_id = $1::uuid
            ORDER BY id ASC
            LIMIT 1
          )
        `,
        [cliente.id],
      );
    }

    await client.query("COMMIT");
    return deleted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function obtenerMiCredito(db, usuarioId) {
  const cliente = await requireCliente(db, usuarioId);

  const [metricasResult, proximaCuotaResult, lastResult] = await Promise.all([
    db.query(
      `
        SELECT
          COUNT(DISTINCT c.id) FILTER (
            WHERE c.estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
          )::int AS creditos_activos,
          COUNT(DISTINCT c.id) FILTER (
            WHERE c.estado = 'EN_MORA'
          )::int AS creditos_en_mora,
          COUNT(DISTINCT c.id) FILTER (
            WHERE c.estado = 'INCUMPLIDO'
          )::int AS creditos_incumplidos,
          COUNT(cc.id) FILTER (
            WHERE cc.estado = 'VENCIDA'
              AND cc.saldo_pendiente > 0
          )::int AS cuotas_vencidas,
          COALESCE(
            SUM(cc.saldo_pendiente) FILTER (
              WHERE cc.estado = 'VENCIDA'
                AND cc.saldo_pendiente > 0
            ),
            0
          )::numeric(12,2) AS total_vencido,
          COALESCE(
            MAX(
              GREATEST(CURRENT_DATE - cc.fecha_vencimiento, 0)
            ) FILTER (
              WHERE cc.estado = 'VENCIDA'
                AND cc.saldo_pendiente > 0
            ),
            0
          )::int AS dias_maximos_atraso
        FROM clientes.creditos c
        LEFT JOIN clientes.credito_cuotas cc
          ON cc.credito_id = c.id
        WHERE c.cliente_id = $1::uuid
      `,
      [cliente.id],
    ),
    db.query(
      `
        SELECT
          cc.fecha_vencimiento AS proxima_fecha_pago,
          cc.saldo_pendiente AS monto_proximo_pago
        FROM clientes.credito_cuotas cc
        JOIN clientes.creditos c ON c.id = cc.credito_id
        WHERE c.cliente_id = $1::uuid
          AND c.estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
          AND cc.saldo_pendiente > 0
          AND cc.estado IN ('VENCIDA', 'PENDIENTE', 'PARCIAL')
        ORDER BY
          CASE WHEN cc.estado = 'VENCIDA' THEN 0 ELSE 1 END,
          cc.fecha_vencimiento,
          cc.numero_cuota
        LIMIT 1
      `,
      [cliente.id],
    ),
    db.query(
      `
        SELECT
          id,
          credito_id,
          cuota_id,
          fecha,
          tipo,
          descripcion,
          monto,
          saldo_resultante,
          metodo_pago
        FROM clientes.movimientos_credito
        WHERE cliente_id = $1::uuid
        ORDER BY fecha DESC, id DESC
        LIMIT 1
      `,
      [cliente.id],
    ),
  ]);

  const metricas = metricasResult.rows[0] || {};
  const proximaCuota = proximaCuotaResult.rows[0] || {};

  const limite = Number(cliente.limite_credito || 0);
  const saldo = Number(cliente.saldo_deudor || 0);
  const disponible = Math.max(limite - saldo, 0);
  const cuotasVencidas = Number(metricas.cuotas_vencidas || 0);
  const totalVencido = Number(metricas.total_vencido || 0);
  const creditosEnMora = Number(metricas.creditos_en_mora || 0);
  const creditosIncumplidos = Number(metricas.creditos_incumplidos || 0);
  const habilitado = cliente.tiene_credito === true;

  let estado = "AL_CORRIENTE";
  if (!habilitado) estado = "SIN_CREDITO";
  else if (saldo <= 0) estado = "SIN_ADEUDO";
  else if (creditosIncumplidos > 0) estado = "INCUMPLIDO";
  else if (creditosEnMora > 0 || cuotasVencidas > 0) estado = "EN_MORA";
  else if (disponible <= 0) estado = "AL_LIMITE";

  return {
    cliente_id: cliente.id,
    cliente_nombre: [
      cliente.nombres,
      cliente.apellido_paterno,
      cliente.apellido_materno,
    ]
      .filter(Boolean)
      .join(" "),
    habilitado,
    limite,
    limite_credito: limite,
    saldo_deudor: saldo,
    credito_disponible: disponible,
    porcentaje_utilizado:
      limite > 0 ? Math.round((saldo / limite) * 10000) / 100 : 0,
    estado,
    puede_comprar:
      habilitado &&
      disponible > 0 &&
      creditosIncumplidos === 0 &&
      creditosEnMora === 0 &&
      cuotasVencidas === 0,
    puede_apartar: cliente.puede_apartar === true,
    fecha_activacion: cliente.fecha_activacion_credito,
    ultima_actualizacion: cliente.fecha_actualizacion_credito,
    proxima_fecha_pago: proximaCuota.proxima_fecha_pago || null,
    monto_proximo_pago:
      proximaCuota.monto_proximo_pago === null ||
      proximaCuota.monto_proximo_pago === undefined
        ? null
        : Number(proximaCuota.monto_proximo_pago),
    pagos_vencidos: cuotasVencidas,
    cuotas_vencidas: cuotasVencidas,
    total_vencido: totalVencido,
    dias_maximos_atraso: Number(metricas.dias_maximos_atraso || 0),
    creditos_activos: Number(metricas.creditos_activos || 0),
    creditos_en_mora: creditosEnMora,
    creditos_incumplidos: creditosIncumplidos,
    ultimo_movimiento: lastResult.rows[0] || null,
  };
}

export async function listarMisMovimientosCredito(
  db,
  usuarioId,
  { limit = 20, offset = 0 } = {},
) {
  const cliente = await requireCliente(db, usuarioId);
  const safeLimit = positiveLimit(limit);
  const safeOffsetValue = safeOffset(offset);

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM clientes.movimientos_credito WHERE cliente_id = $1`,
    [cliente.id],
  );

  const { rows } = await db.query(
    `
      SELECT
        id,
        pedido_id,
        pago_id,
        fecha,
        LOWER(tipo) AS tipo,
        descripcion,
        monto,
        saldo_anterior,
        saldo_resultante AS "saldoResultante",
        metodo_pago,
        referencia_externa,
        observaciones
      FROM clientes.movimientos_credito
      WHERE cliente_id = $1::uuid
      ORDER BY fecha DESC, id DESC
      LIMIT $2 OFFSET $3
    `,
    [cliente.id, safeLimit, safeOffsetValue],
  );

  const total = Number(countResult.rows[0]?.total || 0);
  return {
    items: rows,
    total,
    limit: safeLimit,
    offset: safeOffsetValue,
    hasMore: safeOffsetValue + rows.length < total,
  };
}

export async function listarMisPedidos(
  db,
  usuarioId,
  { tipo = "PEDIDOS", estado = null, limit = 20, offset = 0 } = {},
) {
  const cliente = await requireCliente(db, usuarioId);
  const safeLimit = positiveLimit(limit);
  const safeOffsetValue = safeOffset(offset);
  const esApartado = String(tipo).toUpperCase() === "APARTADOS";
  const estadoNormalizado = estado ? String(estado).trim().toUpperCase() : null;

  const tipoCondition = esApartado
    ? `vpr.tipo = 'APARTADO'`
    : `vpr.tipo IN ('WEB', 'PUNTO_VENTA')`;

  const params = [cliente.id, estadoNormalizado];
  const where = `
    vpr.cliente_id = $1::uuid
    AND ${tipoCondition}
    AND ($2::text IS NULL OR vpr.estado::text = $2)
  `;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total FROM ventas.v_pedidos_resumen vpr WHERE ${where}`,
    params,
  );

  const { rows } = await db.query(
    `
      SELECT
        vpr.*,
        (
          SELECT COALESCE(SUM(d.cantidad), 0)::int
          FROM ventas.detalles_pedido d
          WHERE d.pedido_id = vpr.id
        ) AS items_count
      FROM ventas.v_pedidos_resumen vpr
      WHERE ${where}
      ORDER BY vpr.fecha_creacion DESC, vpr.folio DESC
      LIMIT $3 OFFSET $4
    `,
    [...params, safeLimit, safeOffsetValue],
  );

  const total = Number(countResult.rows[0]?.total || 0);
  return {
    items: rows,
    total,
    limit: safeLimit,
    offset: safeOffsetValue,
    hasMore: safeOffsetValue + rows.length < total,
  };
}

export async function obtenerMiPedido(db, usuarioId, pedidoId) {
  const cliente = await requireCliente(db, usuarioId);

  const pedidoResult = await db.query(
    `
      SELECT *
      FROM ventas.v_pedidos_resumen
      WHERE id = $1::uuid AND cliente_id = $2::uuid
      LIMIT 1
    `,
    [pedidoId, cliente.id],
  );

  const pedido = pedidoResult.rows[0];
  if (!pedido) return null;

  const detallesResult = await db.query(
    `
      SELECT
        d.id,
        d.pedido_id,
        d.variante_id,
        d.cantidad,
        d.precio_unitario,
        d.importe,
        v.producto_id,
        v.sku,
        v.codigo_barras,
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
      WHERE d.pedido_id = $1::uuid
      ORDER BY p.nombre ASC
    `,
    [pedidoId],
  );

  const pagosResult = await db.query(
    `
      SELECT
        id,
        pedido_id,
        monto,
        metodo,
        referencia_externa,
        fecha_pago,
        concepto,
        estado
      FROM ventas.pagos
      WHERE pedido_id = $1::uuid
      ORDER BY fecha_pago ASC
    `,
    [pedidoId],
  );

  return {
    pedido,
    detalles: detallesResult.rows,
    pagos: pagosResult.rows,
  };
}