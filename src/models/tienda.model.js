function validationError(message, code = "VALIDATION") {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function withTransaction(db, callback) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeText(value, { required = false, field = "Campo" } = {}) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  if (required && !text) throw validationError(`${field} es requerido.`);
  return text || null;
}

function normalizePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw validationError(`${field} debe ser un entero mayor a cero.`);
  }
  return number;
}


function normalizeLimit(value, fallback = 20, max = 100) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function normalizeOffset(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return 0;
  return number;
}

function toMoney(value) {
  const number = Number(value || 0);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function normalizeDelivery(value) {
  const delivery = String(value || "").trim().toUpperCase();
  if (!new Set(["RECOGER", "DOMICILIO"]).has(delivery)) {
    throw validationError("La forma de entrega no es válida.");
  }
  return delivery;
}

const WEB_PAYMENT_METHODS = new Set([
  "TRANSFERENCIA",
  "TARJETA_CREDITO",
  "TARJETA_DEBITO",
  "MERCADO_PAGO",
  "PAYPAL",
]);

function normalizePayment(value) {
  const payment = String(value || "").trim().toUpperCase();
  if (!WEB_PAYMENT_METHODS.has(payment)) {
    throw validationError("El método de pago no está disponible para la tienda web.");
  }
  return payment;
}

export async function ensureClienteForUser(db, usuarioId) {
  const { rows: userRows } = await db.query(
    `
      SELECT
        u.id,
        u.email,
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno,
        u.rol_id,
        r.nombre AS rol_nombre
      FROM seguridad.usuarios u
      LEFT JOIN seguridad.roles_sistema r ON r.id = u.rol_id
      WHERE u.id = $1::uuid
        AND u.activo = true
      FOR UPDATE OF u
    `,
    [usuarioId],
  );

  const user = userRows[0];
  if (!user) throw validationError("La cuenta no existe o está inactiva.", "UNAUTHORIZED");

  if (user.rol_nombre && !["CLIENTE_WEB", "CLIENTE"].includes(user.rol_nombre)) {
    throw validationError(
      "Las cuentas administrativas no pueden utilizarse como cuenta de cliente.",
      "FORBIDDEN",
    );
  }

  if (!user.rol_id) {
    const { rows: roleRows } = await db.query(
      `SELECT id FROM seguridad.roles_sistema WHERE nombre = 'CLIENTE_WEB' AND activo = true LIMIT 1`,
    );
    if (!roleRows[0]) {
      throw validationError("No existe el rol CLIENTE_WEB activo.", "CONFIGURATION");
    }
    await db.query(`UPDATE seguridad.usuarios SET rol_id = $2 WHERE id = $1::uuid`, [usuarioId, roleRows[0].id]);
  }

  const { rows: clientRows } = await db.query(
    `
      SELECT *
      FROM clientes.clientes
      WHERE usuario_id = $1::uuid
         OR lower(COALESCE(email, '')) = lower($2)
      ORDER BY (usuario_id = $1::uuid) DESC
      LIMIT 1
      FOR UPDATE
    `,
    [usuarioId, user.email],
  );

  let client = clientRows[0];
  if (client?.usuario_id && String(client.usuario_id) !== String(usuarioId)) {
    throw validationError("El correo ya está vinculado con otro perfil de cliente.", "CONFLICT");
  }

  if (client) {
    const { rows } = await db.query(
      `
        UPDATE clientes.clientes
        SET
          usuario_id = $1::uuid,
          nombres = $2,
          apellido_paterno = $3,
          apellido_materno = $4,
          email = $5,
          activo = true
        WHERE id = $6::uuid
        RETURNING *
      `,
      [usuarioId, user.nombres, user.apellido_paterno, user.apellido_materno, user.email, client.id],
    );
    client = rows[0];
  } else {
    const { rows } = await db.query(
      `
        INSERT INTO clientes.clientes (
          usuario_id, nombres, apellido_paterno, apellido_materno, email, activo
        )
        VALUES ($1::uuid, $2, $3, $4, $5, true)
        RETURNING *
      `,
      [usuarioId, user.nombres, user.apellido_paterno, user.apellido_materno, user.email],
    );
    client = rows[0];
  }

  return {
    ...client,
    nombre_completo: [client.nombres, client.apellido_paterno, client.apellido_materno]
      .filter(Boolean)
      .join(" "),
  };
}

export async function getPerfilTienda(db, usuarioId) {
  return withTransaction(db, (client) => ensureClienteForUser(client, usuarioId));
}

export async function updatePerfilTienda(db, usuarioId, payload = {}) {
  return withTransaction(db, async (client) => {
    const current = await ensureClienteForUser(client, usuarioId);
    const nombres = payload.nombres === undefined
      ? current.nombres
      : normalizeText(payload.nombres, { required: true, field: "Nombre" });
    const apellidoPaterno = payload.apellido_paterno === undefined
      ? current.apellido_paterno
      : normalizeText(payload.apellido_paterno, { required: true, field: "Apellido paterno" });
    const apellidoMaterno = payload.apellido_materno === undefined
      ? current.apellido_materno
      : normalizeText(payload.apellido_materno);
    const telefono = payload.telefono === undefined
      ? current.telefono
      : normalizeText(payload.telefono);

    await client.query(
      `
        UPDATE seguridad.usuarios
        SET nombres = $2, apellido_paterno = $3, apellido_materno = $4
        WHERE id = $1::uuid
      `,
      [usuarioId, nombres, apellidoPaterno, apellidoMaterno],
    );

    const { rows } = await client.query(
      `
        UPDATE clientes.clientes
        SET
          nombres = $2,
          apellido_paterno = $3,
          apellido_materno = $4,
          telefono = $5
        WHERE id = $1::uuid
        RETURNING *
      `,
      [current.id, nombres, apellidoPaterno, apellidoMaterno, telefono],
    );

    const updated = rows[0];
    return {
      ...updated,
      nombre_completo: [updated.nombres, updated.apellido_paterno, updated.apellido_materno]
        .filter(Boolean)
        .join(" "),
    };
  });
}

export async function listDireccionesTienda(db, usuarioId) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const { rows } = await client.query(
      `
        SELECT *
        FROM clientes.direcciones
        WHERE cliente_id = $1::uuid
        ORDER BY es_principal DESC, id DESC
      `,
      [customer.id],
    );
    return rows;
  });
}

export async function createDireccionTienda(db, usuarioId, payload = {}) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const calle = normalizeText(payload.calle, { required: true, field: "Calle" });
    const ciudad = normalizeText(payload.ciudad, { required: true, field: "Ciudad" });
    const estado = normalizeText(payload.estado, { required: true, field: "Estado" });
    const codigoPostal = normalizeText(payload.codigo_postal, { required: true, field: "Código postal" });
    const principalRequested = Boolean(payload.es_principal);

    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS total FROM clientes.direcciones WHERE cliente_id = $1::uuid`,
      [customer.id],
    );
    const shouldBePrincipal = principalRequested || Number(countRows[0]?.total || 0) === 0;

    if (shouldBePrincipal) {
      await client.query(
        `UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1::uuid`,
        [customer.id],
      );
    }

    const { rows } = await client.query(
      `
        INSERT INTO clientes.direcciones (
          cliente_id, calle, numero_exterior, numero_interior, colonia,
          ciudad, estado, codigo_postal, referencias, es_principal
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        customer.id,
        calle,
        normalizeText(payload.numero_exterior),
        normalizeText(payload.numero_interior),
        normalizeText(payload.colonia),
        ciudad,
        estado,
        codigoPostal,
        normalizeText(payload.referencias),
        shouldBePrincipal,
      ],
    );
    return rows[0];
  });
}

export async function setDireccionPrincipalTienda(db, usuarioId, direccionId) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const { rows: ownedRows } = await client.query(
      `SELECT id FROM clientes.direcciones WHERE id = $1::uuid AND cliente_id = $2::uuid FOR UPDATE`,
      [direccionId, customer.id],
    );
    if (!ownedRows[0]) throw validationError("Dirección no encontrada.", "NOT_FOUND");

    await client.query(`UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1::uuid`, [customer.id]);
    const { rows } = await client.query(
      `UPDATE clientes.direcciones SET es_principal = true WHERE id = $1::uuid RETURNING *`,
      [direccionId],
    );
    return rows[0];
  });
}

export async function deleteDireccionTienda(db, usuarioId, direccionId) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const { rows } = await client.query(
      `DELETE FROM clientes.direcciones WHERE id = $1::uuid AND cliente_id = $2::uuid RETURNING id, es_principal`,
      [direccionId, customer.id],
    );
    const deleted = rows[0];
    if (!deleted) throw validationError("Dirección no encontrada.", "NOT_FOUND");

    if (deleted.es_principal) {
      await client.query(
        `
          UPDATE clientes.direcciones
          SET es_principal = true
          WHERE id = (
            SELECT id FROM clientes.direcciones
            WHERE cliente_id = $1::uuid
            ORDER BY id DESC LIMIT 1
          )
        `,
        [customer.id],
      );
    }
    return { id: deleted.id };
  });
}

async function getPedidoDetalleByCliente(db, pedidoId, clienteId) {
  const { rows: orderRows } = await db.query(
    `
      SELECT
        p.id, p.folio, p.estado, p.subtotal, p.descuento, p.costo_envio,
        p.total, p.fecha_creacion, p.fecha_cancelacion, p.motivo_cancelacion,
        p.observaciones, p.tipo_entrega, p.costo_envio_confirmado,
        p.metodo_pago_solicitado,
        latest_payment.estado AS pago_estado
      FROM ventas.pedidos p
      LEFT JOIN LATERAL (
        SELECT pa.estado
        FROM ventas.pagos pa
        WHERE pa.pedido_id = p.id
        ORDER BY pa.fecha_pago DESC
        LIMIT 1
      ) latest_payment ON true
      WHERE p.id = $1::uuid
        AND p.cliente_id = $2::uuid
        AND p.tipo = 'WEB'
      LIMIT 1
    `,
    [pedidoId, clienteId],
  );
  if (!orderRows[0]) return null;

  const [{ rows: details }, { rows: payments }, { rows: addresses }] = await Promise.all([
    db.query(
      `
        SELECT
          d.id, d.variante_id, d.cantidad, d.precio_unitario, d.importe,
          v.producto_id, p.nombre AS producto_nombre, v.sku,
          t.nombre AS talla_nombre, c.nombre AS color_nombre, c.hex AS color_hex,
          img.url AS imagen_principal
        FROM ventas.detalles_pedido d
        JOIN inventario.variantes_producto v ON v.id = d.variante_id
        JOIN inventario.productos p ON p.id = v.producto_id
        LEFT JOIN inventario.tallas t ON t.id = v.talla_id
        LEFT JOIN inventario.colores c ON c.id = v.color_id
        LEFT JOIN LATERAL (
          SELECT pi.url
          FROM inventario.producto_imagenes pi
          WHERE pi.producto_id = p.id
          ORDER BY pi.es_principal DESC, pi.orden ASC, pi.created_at ASC
          LIMIT 1
        ) img ON true
        WHERE d.pedido_id = $1::uuid
        ORDER BY d.id
      `,
      [pedidoId],
    ),
    db.query(
      `SELECT id, monto, metodo, estado, referencia_externa, fecha_pago FROM ventas.pagos WHERE pedido_id = $1::uuid ORDER BY fecha_pago DESC`,
      [pedidoId],
    ),
    db.query(
      `SELECT id, pedido_id AS cliente_id, nombre_destinatario, telefono, calle, numero_exterior, numero_interior, colonia, ciudad, estado, codigo_postal, referencias, true AS es_principal FROM ventas.direcciones_pedido WHERE pedido_id = $1::uuid LIMIT 1`,
      [pedidoId],
    ),
  ]);

  return {
    pedido: { ...orderRows[0], direccion: addresses[0] || null },
    detalles: details,
    pagos: payments,
  };
}

export async function createPedidoWeb(db, usuarioId, payload = {}) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const delivery = normalizeDelivery(payload.tipo_entrega);
    const payment = normalizePayment(payload.metodo_pago);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (rawItems.length === 0) throw validationError("El carrito está vacío.");

    const { rows: paymentRows } = await client.query(
      `SELECT codigo, activo_web FROM configuracion.metodos_pago WHERE codigo = $1::metodo_pago_enum LIMIT 1`,
      [payment],
    );
    if (!paymentRows[0]?.activo_web) {
      throw validationError("El método de pago seleccionado no está activo para la tienda web.");
    }

    const quantities = new Map();
    for (const item of rawItems) {
      const variantId = String(item.variante_id || "").trim();
      if (!variantId) throw validationError("Todos los productos requieren una variante.");
      const quantity = normalizePositiveInteger(item.cantidad, "Cantidad");
      quantities.set(variantId, (quantities.get(variantId) || 0) + quantity);
    }

    const variantIds = [...quantities.keys()];
    const { rows: variants } = await client.query(
      `
        SELECT
          v.id, v.producto_id, v.precio_venta, v.precio_costo,
          v.stock_fisico, v.stock_apartado, v.activo,
          p.nombre AS producto_nombre, p.activo AS producto_activo
        FROM inventario.variantes_producto v
        JOIN inventario.productos p ON p.id = v.producto_id
        WHERE v.id = ANY($1::uuid[])
        FOR UPDATE OF v
      `,
      [variantIds],
    );

    if (variants.length !== variantIds.length) {
      throw validationError("Uno o más productos ya no existen.", "CONFLICT");
    }

    let subtotal = 0;
    const normalizedItems = variants.map((variant) => {
      if (!variant.activo || !variant.producto_activo) {
        throw validationError(`${variant.producto_nombre} ya no está disponible.`, "CONFLICT");
      }
      const quantity = quantities.get(String(variant.id));
      const available = Number(variant.stock_fisico) - Number(variant.stock_apartado);
      if (available < quantity) {
        throw validationError(`No hay suficientes existencias de ${variant.producto_nombre}.`, "CONFLICT");
      }
      const unitPrice = Number(variant.precio_venta || 0);
      subtotal += unitPrice * quantity;
      return { ...variant, quantity, unitPrice };
    });

    let address = null;
    if (delivery === "DOMICILIO") {
      const addressId = String(payload.direccion_id || "").trim();
      if (!addressId) throw validationError("Selecciona una dirección de entrega.");
      const { rows } = await client.query(
        `SELECT * FROM clientes.direcciones WHERE id = $1::uuid AND cliente_id = $2::uuid LIMIT 1`,
        [addressId, customer.id],
      );
      address = rows[0];
      if (!address) throw validationError("La dirección seleccionada no es válida.", "NOT_FOUND");
    }

    const shippingConfirmed = delivery === "RECOGER";
    const shippingCost = 0;
    const total = subtotal + shippingCost;
    const { rows: orderRows } = await client.query(
      `
        INSERT INTO ventas.pedidos (
          cliente_id, tipo, estado, subtotal, descuento, costo_envio, total,
          observaciones, tipo_entrega, costo_envio_confirmado, metodo_pago_solicitado
        )
        VALUES ($1::uuid, 'WEB', 'PENDIENTE', $2, 0, $3, $4, $5, $6, $7, $8::metodo_pago_enum)
        RETURNING id
      `,
      [
        customer.id,
        subtotal,
        shippingCost,
        total,
        normalizeText(payload.observaciones),
        delivery,
        shippingConfirmed,
        payment,
      ],
    );
    const orderId = orderRows[0].id;

    for (const item of normalizedItems) {
      await client.query(
        `
          INSERT INTO ventas.detalles_pedido (
            pedido_id, cantidad, precio_unitario, variante_id, costo_unitario
          )
          VALUES ($1::uuid, $2, $3, $4::uuid, $5)
        `,
        [orderId, item.quantity, item.unitPrice, item.id, item.precio_costo],
      );
      await client.query(
        `UPDATE inventario.variantes_producto SET stock_apartado = stock_apartado + $2 WHERE id = $1::uuid`,
        [item.id, item.quantity],
      );
    }

    if (address) {
      await client.query(
        `
          INSERT INTO ventas.direcciones_pedido (
            pedido_id, nombre_destinatario, telefono, calle, numero_exterior,
            numero_interior, colonia, ciudad, estado, codigo_postal, referencias
          )
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          orderId,
          customer.nombre_completo,
          customer.telefono,
          address.calle,
          address.numero_exterior,
          address.numero_interior,
          address.colonia,
          address.ciudad,
          address.estado,
          address.codigo_postal,
          address.referencias,
        ],
      );
    }

    await client.query(
      `
        INSERT INTO ventas.pagos (
          pedido_id, monto, metodo, referencia_externa, concepto, estado, usuario_id
        )
        VALUES ($1::uuid, $2, $3::metodo_pago_enum, $4, 'PAGO_TOTAL', 'PENDIENTE', $5::uuid)
      `,
      [orderId, total, payment, normalizeText(payload.referencia_externa), usuarioId],
    );

    return getPedidoDetalleByCliente(client, orderId, customer.id);
  });
}


export async function getCreditoTienda(db, usuarioId) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const { rows } = await client.query(
      `
        SELECT
          c.id AS cliente_id,
          c.tiene_credito,
          c.limite_credito,
          c.saldo_deudor,
          c.fecha_activacion_credito,
          c.fecha_actualizacion_credito,
          count(mc.id)::int AS total_movimientos,
          max(mc.fecha) AS ultima_actividad
        FROM clientes.clientes c
        LEFT JOIN clientes.movimientos_credito mc ON mc.cliente_id = c.id
        WHERE c.id = $1::uuid
        GROUP BY c.id
        LIMIT 1
      `,
      [customer.id],
    );

    const row = rows[0];
    if (!row) throw validationError("Perfil de cliente no encontrado.", "NOT_FOUND");

    const habilitado = row.tiene_credito === true;
    const limiteCredito = toMoney(row.limite_credito);
    const saldoDeudor = toMoney(row.saldo_deudor);
    const creditoDisponible = toMoney(Math.max(limiteCredito - saldoDeudor, 0));
    const montoExcedido = toMoney(Math.max(saldoDeudor - limiteCredito, 0));
    const porcentajeUtilizado = limiteCredito > 0
      ? Math.round(((saldoDeudor / limiteCredito) * 100 + Number.EPSILON) * 10) / 10
      : 0;

    let estado = "CON_SALDO";
    if (!habilitado) estado = "NO_HABILITADO";
    else if (limiteCredito <= 0) estado = "SIN_LIMITE";
    else if (saldoDeudor <= 0) estado = "SIN_DEUDA";
    else if (saldoDeudor > limiteCredito) estado = "SOBREGIRADO";
    else if (creditoDisponible <= 0) estado = "LIMITE_ALCANZADO";

    return {
      cliente_id: row.cliente_id,
      habilitado,
      limite_credito: limiteCredito,
      saldo_deudor: saldoDeudor,
      credito_disponible: creditoDisponible,
      monto_excedido: montoExcedido,
      porcentaje_utilizado: porcentajeUtilizado,
      estado,
      fecha_activacion_credito: row.fecha_activacion_credito,
      fecha_actualizacion_credito: row.fecha_actualizacion_credito,
      total_movimientos: Number(row.total_movimientos || 0),
      ultima_actividad: row.ultima_actividad,
      calendario_configurado: false,
    };
  });
}

export async function listMovimientosCreditoTienda(
  db,
  usuarioId,
  { limit = 20, offset = 0 } = {},
) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);

    const [{ rows: countRows }, { rows }] = await Promise.all([
      client.query(
        `
          SELECT count(*)::int AS total
          FROM clientes.movimientos_credito
          WHERE cliente_id = $1::uuid
        `,
        [customer.id],
      ),
      client.query(
        `
          SELECT
            mc.id,
            mc.fecha,
            mc.tipo,
            mc.descripcion,
            mc.monto::float8 AS monto,
            mc.saldo_anterior::float8 AS saldo_anterior,
            mc.saldo_resultante::float8 AS saldo_resultante,
            mc.metodo_pago,
            mc.referencia_externa,
            mc.observaciones,
            mc.pedido_id,
            p.folio AS pedido_folio
          FROM clientes.movimientos_credito mc
          LEFT JOIN ventas.pedidos p ON p.id = mc.pedido_id
          WHERE mc.cliente_id = $1::uuid
          ORDER BY mc.fecha DESC, mc.id DESC
          LIMIT $2
          OFFSET $3
        `,
        [customer.id, safeLimit, safeOffset],
      ),
    ]);

    const total = Number(countRows[0]?.total || 0);

    return {
      items: rows,
      total,
      limit: safeLimit,
      offset: safeOffset,
      has_more: safeOffset + rows.length < total,
    };
  });
}


export async function listPedidosWebCliente(db, usuarioId) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const { rows } = await client.query(
      `
        SELECT
          p.id, p.folio, p.estado, p.subtotal, p.descuento, p.costo_envio,
          p.total, p.fecha_creacion, p.fecha_cancelacion, p.motivo_cancelacion,
          p.tipo_entrega, p.costo_envio_confirmado, p.metodo_pago_solicitado,
          count(d.id)::int AS items_count,
          latest_payment.estado AS pago_estado
        FROM ventas.pedidos p
        LEFT JOIN ventas.detalles_pedido d ON d.pedido_id = p.id
        LEFT JOIN LATERAL (
          SELECT pa.estado
          FROM ventas.pagos pa
          WHERE pa.pedido_id = p.id
          ORDER BY pa.fecha_pago DESC LIMIT 1
        ) latest_payment ON true
        WHERE p.cliente_id = $1::uuid AND p.tipo = 'WEB'
        GROUP BY p.id, latest_payment.estado
        ORDER BY p.fecha_creacion DESC
      `,
      [customer.id],
    );
    return rows;
  });
}

export async function getPedidoWebCliente(db, usuarioId, pedidoId) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const detail = await getPedidoDetalleByCliente(client, pedidoId, customer.id);
    if (!detail) throw validationError("Pedido no encontrado.", "NOT_FOUND");
    return detail;
  });
}

export async function cancelPedidoWebCliente(db, usuarioId, pedidoId, motivo) {
  return withTransaction(db, async (client) => {
    const customer = await ensureClienteForUser(client, usuarioId);
    const { rows: orderRows } = await client.query(
      `
        SELECT id, estado
        FROM ventas.pedidos
        WHERE id = $1::uuid AND cliente_id = $2::uuid AND tipo = 'WEB'
        FOR UPDATE
      `,
      [pedidoId, customer.id],
    );
    const order = orderRows[0];
    if (!order) throw validationError("Pedido no encontrado.", "NOT_FOUND");
    if (order.estado !== "PENDIENTE") {
      throw validationError("Solo se pueden cancelar pedidos pendientes.", "CONFLICT");
    }

    const { rows: details } = await client.query(
      `SELECT variante_id, cantidad FROM ventas.detalles_pedido WHERE pedido_id = $1::uuid`,
      [pedidoId],
    );
    for (const detail of details) {
      await client.query(
        `
          UPDATE inventario.variantes_producto
          SET stock_apartado = GREATEST(stock_apartado - $2, 0)
          WHERE id = $1::uuid
        `,
        [detail.variante_id, detail.cantidad],
      );
    }

    await client.query(
      `
        UPDATE ventas.pedidos
        SET estado = 'CANCELADO', motivo_cancelacion = $2, fecha_cancelacion = now()
        WHERE id = $1::uuid
      `,
      [pedidoId, normalizeText(motivo, { required: true, field: "Motivo" })],
    );
    await client.query(
      `UPDATE ventas.pagos SET estado = 'CANCELADO' WHERE pedido_id = $1::uuid AND estado = 'PENDIENTE'`,
      [pedidoId],
    );

    return getPedidoDetalleByCliente(client, pedidoId, customer.id);
  });
}

export async function updateCostoEnvioPedidoWeb(db, pedidoId, costoEnvio) {
  return withTransaction(db, async (client) => {
    const cost = Number(costoEnvio);
    if (!Number.isFinite(cost) || cost < 0) throw validationError("El costo de envío no es válido.");
    const { rows } = await client.query(
      `
        UPDATE ventas.pedidos
        SET costo_envio = $2, total = subtotal - descuento + $2, costo_envio_confirmado = true
        WHERE id = $1::uuid AND tipo = 'WEB' AND estado = 'PENDIENTE' AND tipo_entrega = 'DOMICILIO'
        RETURNING id, total
      `,
      [pedidoId, cost],
    );
    if (!rows[0]) throw validationError("Pedido web pendiente no encontrado.", "NOT_FOUND");
    await client.query(
      `UPDATE ventas.pagos SET monto = $2 WHERE pedido_id = $1::uuid AND estado = 'PENDIENTE'`,
      [pedidoId, rows[0].total],
    );
    return rows[0];
  });
}

export async function confirmPagoPedidoWeb(db, pedidoId, { usuarioId, referenciaExterna = null } = {}) {
  return withTransaction(db, async (client) => {
    const { rows: orderRows } = await client.query(
      `SELECT * FROM ventas.pedidos WHERE id = $1::uuid AND tipo = 'WEB' FOR UPDATE`,
      [pedidoId],
    );
    const order = orderRows[0];
    if (!order) throw validationError("Pedido web no encontrado.", "NOT_FOUND");
    if (order.estado !== "PENDIENTE") throw validationError("El pedido ya no está pendiente.", "CONFLICT");
    if (!order.costo_envio_confirmado) throw validationError("Confirma primero el costo de envío.", "CONFLICT");

    const { rows: details } = await client.query(
      `
        SELECT d.variante_id, d.cantidad, v.stock_fisico, v.stock_apartado
        FROM ventas.detalles_pedido d
        JOIN inventario.variantes_producto v ON v.id = d.variante_id
        WHERE d.pedido_id = $1::uuid
        FOR UPDATE OF v
      `,
      [pedidoId],
    );
    for (const detail of details) {
      if (Number(detail.stock_fisico) < Number(detail.cantidad) || Number(detail.stock_apartado) < Number(detail.cantidad)) {
        throw validationError("El inventario reservado del pedido es inconsistente.", "CONFLICT");
      }
      await client.query(
        `
          UPDATE inventario.variantes_producto
          SET stock_fisico = stock_fisico - $2,
              stock_apartado = stock_apartado - $2
          WHERE id = $1::uuid
        `,
        [detail.variante_id, detail.cantidad],
      );
      await client.query(
        `
          INSERT INTO inventario.movimientos (usuario_id, cantidad, motivo, variante_id, tipo)
          VALUES ($1::uuid, $2, $3, $4::uuid, 'SALIDA')
        `,
        [usuarioId, -Number(detail.cantidad), `Venta web pedido #${order.folio}`, detail.variante_id],
      );
    }

    const { rows: pendingPayments } = await client.query(
      `SELECT id FROM ventas.pagos WHERE pedido_id = $1::uuid AND estado = 'PENDIENTE' ORDER BY fecha_pago DESC LIMIT 1 FOR UPDATE`,
      [pedidoId],
    );
    if (pendingPayments[0]) {
      await client.query(
        `
          UPDATE ventas.pagos
          SET estado = 'CONFIRMADO', monto = $2,
              referencia_externa = COALESCE($3, referencia_externa), usuario_id = $4::uuid,
              fecha_pago = now()
          WHERE id = $1::uuid
        `,
        [pendingPayments[0].id, order.total, normalizeText(referenciaExterna), usuarioId],
      );
    } else {
      await client.query(
        `
          INSERT INTO ventas.pagos (pedido_id, monto, metodo, referencia_externa, concepto, estado, usuario_id)
          VALUES ($1::uuid, $2, $3::metodo_pago_enum, $4, 'PAGO_TOTAL', 'CONFIRMADO', $5::uuid)
        `,
        [pedidoId, order.total, order.metodo_pago_solicitado, normalizeText(referenciaExterna), usuarioId],
      );
    }

    const { rows } = await client.query(
      `UPDATE ventas.pedidos SET estado = 'PAGADO', liquidado_at = now() WHERE id = $1::uuid RETURNING *`,
      [pedidoId],
    );
    return rows[0];
  });
}
