import { createHash } from "node:crypto";
import { getConfigCheckout } from "../services/configuracion.service.js";
import {
  crearCreditoEnTransaccion,
  obtenerParametrosCredito,
} from "./credito.model.js";
import {
  calcularPlanCredito,
  evaluarElegibilidadCliente,
  normalizarConfiguracionCredito,
  sumarDiasISO,
  sumarMesesAncladosISO,
} from "../services/credito.service.js";

function checkoutError(message, status = 400, code = "VALIDATION") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw checkoutError("El pedido debe contener al menos un producto.");
  }

  const grouped = new Map();

  for (const item of items) {
    const varianteId = String(item.variante_id || item.varianteId || "").trim();
    const cantidad = Number(item.cantidad);

    if (!varianteId || !Number.isInteger(cantidad) || cantidad <= 0) {
      throw checkoutError(
        "Cada producto requiere variante_id y cantidad mayor a cero.",
      );
    }

    grouped.set(varianteId, (grouped.get(varianteId) || 0) + cantidad);
  }

  return [...grouped.entries()].map(([variante_id, cantidad]) => ({
    variante_id,
    cantidad,
  }));
}

function normalizeOptional(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function buildCheckoutFingerprint({
  items,
  tipo_entrega,
  direccion_id,
  metodo_pago,
  referencia_externa,
  cupon_codigo,
  observaciones,
  credito,
}) {
  const payload = {
    items,
    tipo_entrega: String(tipo_entrega || "RECOGER").toUpperCase(),
    direccion_id: direccion_id ? String(direccion_id) : null,
    metodo_pago: String(metodo_pago).toUpperCase(),
    referencia_externa: normalizeOptional(referencia_externa),
    cupon_codigo: normalizeOptional(cupon_codigo)?.toUpperCase() ?? null,
    observaciones: normalizeOptional(observaciones),
    credito: credito
      ? {
          plazo_meses: Number(credito.plazo_meses),
          frecuencia_pago: String(credito.frecuencia_pago || "").toUpperCase(),
        }
      : null,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function getCheckoutResultByPedidoId(
  client,
  pedidoId,
  { replayed = false } = {},
) {
  const { rows: pedidoRows } = await client.query(
    `
      SELECT
        p.id AS pedido_id,
        p.folio,
        p.estado,
        p.subtotal,
        p.descuento,
        p.costo_envio,
        p.total,
        COALESCE(pg.metodo::text, p.metodo_pago_solicitado::text) AS metodo_pago,
        CASE
          WHEN p.metodo_pago_solicitado::text = 'CREDITO_TIENDA' AND pg.estado IS NULL THEN 'FINANCIADO'
          ELSE pg.estado::text
        END AS pago_estado
      FROM ventas.pedidos p
      LEFT JOIN LATERAL (
        SELECT
          pago.metodo,
          pago.estado
        FROM ventas.pagos pago
        WHERE pago.pedido_id = p.id
          AND pago.concepto = 'PAGO_TOTAL'
        ORDER BY pago.fecha_pago DESC, pago.id DESC
        LIMIT 1
      ) pg ON TRUE
      WHERE p.id = $1::uuid
      LIMIT 1
    `,
    [pedidoId],
  );

  const pedido = pedidoRows[0];

  if (!pedido) {
    throw checkoutError("Pedido no encontrado.", 404, "ORDER_NOT_FOUND");
  }

  const { rows: items } = await client.query(
    `
      SELECT
        d.variante_id,
        d.cantidad,
        d.precio_unitario,
        p.nombre AS producto_nombre
      FROM ventas.detalles_pedido d
      JOIN inventario.variantes_producto v
        ON v.id = d.variante_id
      JOIN inventario.productos p
        ON p.id = v.producto_id
      WHERE d.pedido_id = $1::uuid
      ORDER BY d.variante_id
    `,
    [pedidoId],
  );

  return {
    pedido_id: pedido.pedido_id,
    folio: pedido.folio,
    estado: pedido.estado,
    subtotal: money(pedido.subtotal),
    descuento: money(pedido.descuento),
    costo_envio: money(pedido.costo_envio),
    total: money(pedido.total),
    metodo_pago: pedido.metodo_pago,
    pago_estado: pedido.pago_estado,
    items: items.map((item) => ({
      variante_id: item.variante_id,
      cantidad: Number(item.cantidad),
      precio_unitario: money(item.precio_unitario),
      producto_nombre: item.producto_nombre,
    })),
    replayed,
  };
}

async function getClienteCreditoByUsuario(db, usuarioId, { lock = false } = {}) {
  const lockClause = lock ? "FOR UPDATE" : "";
  const { rows } = await db.query(
    `
      SELECT
        c.*,
        CONCAT_WS(' ', c.nombres, c.apellido_paterno, c.apellido_materno) AS nombre_completo,
        (
          SELECT count(*)::integer FROM clientes.creditos cr
          WHERE cr.cliente_id = c.id AND cr.estado IN ('ACTIVO','EN_MORA','INCUMPLIDO')
        ) AS creditos_activos,
        (
          SELECT count(*)::integer FROM clientes.creditos cr
          WHERE cr.cliente_id = c.id AND cr.estado = 'EN_MORA'
        ) AS creditos_en_mora,
        (
          SELECT count(*)::integer FROM clientes.creditos cr
          WHERE cr.cliente_id = c.id AND cr.estado = 'INCUMPLIDO'
        ) AS creditos_incumplidos,
        (
          SELECT count(*)::integer
          FROM clientes.credito_cuotas cc
          JOIN clientes.creditos cr ON cr.id = cc.credito_id
          WHERE cr.cliente_id = c.id AND cc.estado = 'VENCIDA' AND cc.saldo_pendiente > 0
        ) AS cuotas_vencidas
      FROM clientes.clientes c
      WHERE c.usuario_id = $1::uuid
        AND c.activo = true
      ${lockClause}
    `,
    [usuarioId],
  );
  return rows[0] || null;
}

async function getClienteForUpdate(client, usuarioId) {
  return getClienteCreditoByUsuario(client, usuarioId, { lock: true });
}

function nextCreditDueDate(frequency) {
  const today = new Date().toISOString().slice(0, 10);
  const normalized = String(frequency || "").toUpperCase();
  if (normalized === "SEMANAL") return sumarDiasISO(today, 7);
  if (normalized === "QUINCENAL") return sumarDiasISO(today, 15);
  return sumarMesesAncladosISO(today, 1);
}

export async function obtenerOpcionesCreditoWeb(db, usuarioId, totalCompra) {
  const total = money(totalCompra);
  if (total <= 0) {
    return { mostrar: false, elegible: false, motivo: "TOTAL_INVALIDO" };
  }

  const cliente = await getClienteCreditoByUsuario(db, usuarioId);
  if (!cliente) {
    return { mostrar: false, elegible: false, motivo: "CLIENT_PROFILE_NOT_FOUND" };
  }

  const metodo = await getMetodoPagoWeb(db, "CREDITO_TIENDA");
  if (!metodo || metodo.activo_web !== true) {
    return { mostrar: false, elegible: false, motivo: "METODO_WEB_INACTIVO" };
  }

  const limiteCredito = money(cliente.limite_credito || 0);
  const creditoActivo = cliente.tiene_credito === true && limiteCredito > 0;

  if (!creditoActivo) {
    return {
      mostrar: false,
      elegible: false,
      motivo: cliente.tiene_credito === true
        ? "LIMITE_NO_CONFIGURADO"
        : "CREDITO_NO_HABILITADO",
      limite_credito: limiteCredito,
      saldo_deudor: money(cliente.saldo_deudor || 0),
      credito_disponible: Math.max(
        money(limiteCredito - Number(cliente.saldo_deudor || 0)),
        0,
      ),
    };
  }

  const parametros = await obtenerParametrosCredito(db);
  const config = normalizarConfiguracionCredito(parametros);
  if (!config.permiteEngancheCero || config.porcentajeEngancheMinimo > 0) {
    return {
      mostrar: true,
      elegible: false,
      motivo: "ENGANCHE_WEB_REQUERIDO",
      mensaje: "Tu crédito está activo, pero la configuración actual exige enganche y todavía no se cobra el enganche desde la tienda web.",
      limite_credito: limiteCredito,
      saldo_deudor: money(cliente.saldo_deudor || 0),
      credito_disponible: Math.max(
        money(limiteCredito - Number(cliente.saldo_deudor || 0)),
        0,
      ),
      plazos: config.plazosPermitidos,
      frecuencias: config.frecuenciasPermitidas,
    };
  }

  const elegibilidad = evaluarElegibilidadCliente({
    cliente,
    montoFinanciado: total,
    configuracion: parametros,
  });

  return {
    // "mostrar" significa que el cliente posee una línea de crédito activa.
    // "elegible" indica si puede usarla para ESTA compra concreta.
    mostrar: true,
    elegible: elegibilidad.apto,
    motivo: elegibilidad.apto
      ? null
      : elegibilidad.validaciones_incumplidas[0] || "NO_ELEGIBLE",
    ...elegibilidad,
    plazos: config.plazosPermitidos,
    frecuencias: config.frecuenciasPermitidas,
  };
}

async function getMetodoPagoWeb(client, metodo) {
  const { rows } = await client.query(
    `
      SELECT
        codigo,
        nombre,
        activo_web,
        requiere_referencia,
        requiere_confirmacion_manual,
        es_credito
      FROM configuracion.metodos_pago
      WHERE codigo = $1
      LIMIT 1
    `,
    [metodo],
  );

  return rows[0] || null;
}

async function calcularCupon(
  client,
  codigo,
  subtotal,
  clienteId,
  { bloquear = true } = {},
) {
  if (!codigo) {
    return {
      cupon_id: null,
      codigo: null,
      descuento: 0,
    };
  }

  const codigoNormalizado = String(codigo).trim().toUpperCase();

  if (!codigoNormalizado) {
    return {
      cupon_id: null,
      codigo: null,
      descuento: 0,
    };
  }

  if (!clienteId) {
    throw checkoutError(
      "Se requiere un cliente para aplicar el cupón.",
      400,
      "COUPON_CUSTOMER_REQUIRED",
    );
  }

  const lockClause = bloquear ? "FOR UPDATE" : "";

  const { rows } = await client.query(
    `
      SELECT
        id,
        codigo,
        tipo_descuento,
        valor,
        monto_minimo_compra,
        fecha_inicio,
        fecha_fin,
        activo,
        canal,
        aplica_a,
        uso_maximo,
        uso_maximo_por_cliente,
        solo_clientes_registrados,
        acumulable,
        CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin AS vigente
      FROM marketing.cupones
      WHERE UPPER(codigo) = UPPER($1)
      LIMIT 1
      FOR UPDATE
    `,
    [codigoNormalizado],
  );

  const cupon = rows[0];

  if (!cupon) {
    throw checkoutError("El cupón no existe.", 400, "INVALID_COUPON");
  }

  if (cupon.activo !== true) {
    throw checkoutError("El cupón está inactivo.", 400, "INACTIVE_COUPON");
  }

  if (cupon.vigente !== true) {
    throw checkoutError(
      "El cupón está fuera de vigencia.",
      400,
      "EXPIRED_COUPON",
    );
  }

  const canal = String(cupon.canal || "")
    .trim()
    .toUpperCase();

  if (!["WEB", "AMBOS"].includes(canal)) {
    throw checkoutError(
      "Este cupón no está disponible para compras en línea.",
      400,
      "COUPON_NOT_AVAILABLE_WEB",
    );
  }

  const aplicaA = String(cupon.aplica_a || "PEDIDO")
    .trim()
    .toUpperCase();

  if (aplicaA !== "PEDIDO") {
    throw checkoutError(
      "Este cupón no es compatible actualmente con el checkout.",
      400,
      "UNSUPPORTED_COUPON_SCOPE",
    );
  }

  if (cupon.solo_clientes_registrados === true && !clienteId) {
    throw checkoutError(
      "Este cupón requiere una cuenta registrada.",
      400,
      "REGISTERED_CUSTOMER_REQUIRED",
    );
  }

  const minimo = money(cupon.monto_minimo_compra || 0);

  if (subtotal < minimo) {
    throw checkoutError(
      `El cupón requiere una compra mínima de $${minimo.toFixed(2)}.`,
      400,
      "COUPON_MINIMUM_NOT_MET",
    );
  }

  const usageResult = await client.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE estado <> 'CANCELADO'
        )::int AS usos_globales,

        COUNT(*) FILTER (
          WHERE estado <> 'CANCELADO'
            AND cliente_id = $2::uuid
        )::int AS usos_cliente

      FROM ventas.pedidos
      WHERE cupon_id = $1
    `,
    [cupon.id, clienteId],
  );

  const usosGlobales = Number(usageResult.rows[0]?.usos_globales || 0);

  const usosCliente = Number(usageResult.rows[0]?.usos_cliente || 0);

  const usoMaximo = cupon.uso_maximo === null ? null : Number(cupon.uso_maximo);

  if (usoMaximo !== null && usosGlobales >= usoMaximo) {
    throw checkoutError(
      "Este cupón alcanzó su límite máximo de usos.",
      409,
      "COUPON_GLOBAL_LIMIT_REACHED",
    );
  }

  const usoMaximoPorCliente =
    cupon.uso_maximo_por_cliente === null
      ? null
      : Number(cupon.uso_maximo_por_cliente);

  if (usoMaximoPorCliente !== null && usosCliente >= usoMaximoPorCliente) {
    throw checkoutError(
      usoMaximoPorCliente === 1
        ? "Ya utilizaste este cupón."
        : `Ya alcanzaste el límite de ${usoMaximoPorCliente} usos para este cupón.`,
      409,
      "COUPON_CUSTOMER_LIMIT_REACHED",
    );
  }

  const tipo = String(cupon.tipo_descuento || "")
    .trim()
    .toUpperCase();

  const valor = Number(cupon.valor || 0);

  if (!Number.isFinite(valor) || valor <= 0) {
    throw checkoutError(
      "El cupón tiene un valor de descuento inválido.",
      400,
      "INVALID_COUPON_VALUE",
    );
  }

  let descuento = 0;

  if (["PORCENTAJE", "PERCENT", "PORCENTUAL"].includes(tipo)) {
    if (valor > 100) {
      throw checkoutError(
        "El porcentaje del cupón no puede ser mayor a 100%.",
        400,
        "INVALID_COUPON_VALUE",
      );
    }

    descuento = subtotal * (valor / 100);
  } else if (["MONTO_FIJO", "FIJO", "MONTO"].includes(tipo)) {
    descuento = valor;
  } else {
    throw checkoutError(
      "El tipo de descuento del cupón no es compatible con checkout.",
      400,
      "UNSUPPORTED_COUPON",
    );
  }

  descuento = Math.min(money(descuento), subtotal);

  return {
    cupon_id: cupon.id,
    codigo: cupon.codigo,
    descuento,

    uso_maximo: usoMaximo,
    uso_maximo_por_cliente: usoMaximoPorCliente,

    usos_globales: usosGlobales,
    usos_cliente: usosCliente,

    usos_globales_restantes:
      usoMaximo === null ? null : Math.max(usoMaximo - usosGlobales - 1, 0),

    usos_cliente_restantes:
      usoMaximoPorCliente === null
        ? null
        : Math.max(usoMaximoPorCliente - usosCliente - 1, 0),
  };
}

function calcularCostoEnvio({ tipoEntrega, subtotal, descuento, config }) {
  if (!config.habilitado) {
    throw checkoutError(
      "El checkout se encuentra temporalmente deshabilitado.",
      409,
      "CHECKOUT_DISABLED",
    );
  }

  const subtotalNeto = money(Math.max(Number(subtotal) - Number(descuento), 0));

  if (tipoEntrega === "RECOGER") {
    if (!config.permitirRecoleccionTienda) {
      throw checkoutError(
        "La recolección en tienda no está disponible.",
        409,
        "PICKUP_DISABLED",
      );
    }

    return {
      costoEnvio: 0,
      envioGratis: true,
      subtotalNeto,
    };
  }

  if (tipoEntrega === "DOMICILIO") {
    if (!config.permitirEnvioDomicilio) {
      throw checkoutError(
        "El envío a domicilio no está disponible.",
        409,
        "DELIVERY_DISABLED",
      );
    }

    const envioGratis =
      config.envioGratisHabilitado === true &&
      subtotalNeto >= config.envioGratisDesde;

    return {
      costoEnvio: envioGratis ? 0 : money(config.costoEnvioDomicilio),

      envioGratis,
      subtotalNeto,
    };
  }

  throw checkoutError(
    "Tipo de entrega inválido.",
    400,
    "INVALID_DELIVERY_TYPE",
  );
}

export async function crearPedidoWeb(
  db,
  usuarioId,
  {
    items,
    tipo_entrega,
    direccion_id,
    metodo_pago,
    referencia_externa = null,
    cupon_codigo = null,
    observaciones = null,
    credito = null,
    idempotency_key,
  },
) {
  const normalizedItems = normalizeItems(items).sort((a, b) =>
    a.variante_id.localeCompare(b.variante_id),
  );

  const metodo = String(metodo_pago || "")
    .trim()
    .toUpperCase();

  const idempotencyKey = String(idempotency_key || "").trim();

  if (!idempotencyKey) {
    throw checkoutError(
      "Idempotency-Key es requerido.",
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }

  const tipoEntrega = String(tipo_entrega || "RECOGER")
    .trim()
    .toUpperCase();

  if (!["RECOGER", "DOMICILIO"].includes(tipoEntrega)) {
    throw checkoutError("Tipo de entrega inválido.");
  }

  if (tipoEntrega === "DOMICILIO" && !direccion_id) {
    throw checkoutError("direccion_id es requerido para entrega a domicilio.");
  }

  if (!metodo) throw checkoutError("metodo_pago es requerido.");

  const fingerprint = buildCheckoutFingerprint({
    items: normalizedItems,
    tipo_entrega: tipoEntrega,
    direccion_id: tipoEntrega == "DOMICILIO" ? direccion_id : null,
    metodo_pago: metodo,
    referencia_externa,
    cupon_codigo,
    observaciones,
    credito: metodo === "CREDITO_TIENDA" ? credito : null,
  });

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuarioId,
    ]);

    const cliente = await getClienteForUpdate(client, usuarioId);

    if (!cliente) {
      throw checkoutError(
        "La cuenta no tiene un perfil de cliente activo.",
        404,
        "CLIENT_PROFILE_NOT_FOUND",
      );
    }

    await client.query(
      `
        SELECT pg_advisory_xact_lock(
          hashtextextended($1, 0)
        )
      `,
      [`checkout:${cliente.id}:${idempotencyKey}`],
    );

    const existingResult = await client.query(
      `
        SELECT
          id,
          idempotency_hash
        FROM ventas.pedidos
        WHERE cliente_id = $1::uuid
          AND idempotency_key = $2
        LIMIT 1
      `,
      [cliente.id, idempotencyKey],
    );

    const existing = existingResult.rows[0];

    if (existing) {
      if (existing.idempotency_hash !== fingerprint) {
        throw checkoutError(
          "La misma llave de idempotencia fue utilizada con datos diferentes.",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
      }

      const previousResult = await getCheckoutResultByPedidoId(
        client,
        existing.id,
        { replayed: true },
      );

      await client.query("COMMIT");

      return previousResult;
    }

    let direccion = null;

    if (tipoEntrega === "DOMICILIO") {
      const addressResult = await client.query(
        `
          SELECT *
          FROM clientes.direcciones
          WHERE id = $1::uuid
            AND cliente_id = $2::uuid
          LIMIT 1
        `,
        [direccion_id, cliente.id],
      );

      direccion = addressResult.rows[0];

      if (!direccion) {
        throw checkoutError(
          "La dirección no pertenece a la cuenta.",
          404,
          "ADDRESS_NOT_FOUND",
        );
      }
    }

    const paymentConfig = await getMetodoPagoWeb(client, metodo);
    if (!paymentConfig || paymentConfig.activo_web !== true) {
      throw checkoutError(
        "El método de pago no está disponible en la tienda web.",
      );
    }

    if (
      paymentConfig.requiere_referencia === true &&
      !String(referencia_externa || "").trim()
    ) {
      throw checkoutError("El método de pago requiere una referencia.");
    }

    const orderItems = [];

    for (const item of normalizedItems) {
      const { rows } = await client.query(
        `
          SELECT
            v.id,
            v.producto_id,
            v.precio_venta,
            v.stock_fisico,
            v.stock_apartado,
            v.activo AS variante_activa,
            p.activo AS producto_activo,
            p.nombre AS producto_nombre
          FROM inventario.variantes_producto v
          JOIN inventario.productos p ON p.id = v.producto_id
          WHERE v.id = $1::uuid
          FOR UPDATE OF v
        `,
        [item.variante_id],
      );

      const variante = rows[0];
      if (!variante) {
        throw checkoutError(
          `No se encontró la variante ${item.variante_id}.`,
          404,
          "VARIANT_NOT_FOUND",
        );
      }

      if (
        variante.variante_activa !== true ||
        variante.producto_activo !== true
      ) {
        throw checkoutError(
          `${variante.producto_nombre} ya no está disponible.`,
        );
      }

      const disponible =
        Number(variante.stock_fisico || 0) -
        Number(variante.stock_apartado || 0);

      if (disponible < item.cantidad) {
        throw checkoutError(
          `Stock insuficiente para ${variante.producto_nombre}. Disponible: ${disponible}.`,
          409,
          "STOCK",
        );
      }

      const precio = money(variante.precio_venta);
      if (precio <= 0) {
        throw checkoutError(
          `${variante.producto_nombre} no tiene un precio válido.`,
        );
      }

      orderItems.push({
        ...item,
        precio_unitario: precio,
        producto_nombre: variante.producto_nombre,
      });
    }

    const subtotal = money(
      orderItems.reduce(
        (sum, item) => sum + item.precio_unitario * item.cantidad,
        0,
      ),
    );

    const coupon = await calcularCupon(
      client,
      cupon_codigo,
      subtotal,
      cliente.id,
    );
    const checkoutConfig = await getConfigCheckout(client);

    const envio = calcularCostoEnvio({
      tipoEntrega,
      subtotal,
      descuento: coupon.descuento,
      config: checkoutConfig,
    });

    const costoEnvio = envio.costoEnvio;

    const total = money(subtotal - coupon.descuento + costoEnvio);

    const esCredito =
      paymentConfig.es_credito === true || metodo === "CREDITO_TIENDA";

    let planCredito = null;
    if (esCredito) {
      const parametrosCredito = await obtenerParametrosCredito(client);
      const configCredito = normalizarConfiguracionCredito(parametrosCredito);

      if (!configCredito.permiteEngancheCero || configCredito.porcentajeEngancheMinimo > 0) {
        throw checkoutError(
          "El crédito web no está disponible porque la configuración actual requiere enganche.",
          409,
          "WEB_CREDIT_DOWNPAYMENT_REQUIRED",
        );
      }

      const plazoMeses = Number(credito?.plazo_meses);
      const frecuenciaPago = String(credito?.frecuencia_pago || "").trim().toUpperCase();
      if (!Number.isInteger(plazoMeses) || !frecuenciaPago) {
        throw checkoutError("Selecciona plazo y frecuencia para el crédito de tienda.", 400, "CREDIT_PLAN_REQUIRED");
      }

      const elegibilidad = evaluarElegibilidadCliente({
        cliente,
        montoFinanciado: total,
        configuracion: parametrosCredito,
      });
      if (!elegibilidad.apto) {
        throw checkoutError(
          "Tu línea de crédito no cumple actualmente las condiciones para financiar esta compra.",
          409,
          "CREDIT_NOT_ELIGIBLE",
        );
      }

      planCredito = calcularPlanCredito({
        totalCompra: total,
        enganche: 0,
        plazoMeses,
        frecuenciaPago,
        fechaPrimerVencimiento: nextCreditDueDate(frecuenciaPago),
        configuracion: parametrosCredito,
      });
    }

    const costoEnvioConfirmado = true;
    const pedidoResult = await client.query(
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
          cupon_id,
          observaciones,
          tipo_entrega,
          costo_envio_confirmado,
          metodo_pago_solicitado,
          idempotency_key,
          idempotency_hash
        )
        VALUES ($1, NULL, 'WEB', 'PENDIENTE', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
      [
        cliente.id,
        subtotal,
        coupon.descuento,
        costoEnvio,
        total,
        coupon.cupon_id,
        observaciones ? String(observaciones).trim() : null,
        tipoEntrega,
        costoEnvioConfirmado,
        metodo,
        idempotencyKey,
        fingerprint,
      ],
    );

    const pedido = pedidoResult.rows[0];

    if (tipoEntrega == "DOMICILIO") {
      await client.query(
        `
        INSERT INTO ventas.direcciones_pedido (
          pedido_id,
          nombre_destinatario,
          telefono,
          calle,
          numero_exterior,
          numero_interior,
          colonia,
          ciudad,
          estado,
          codigo_postal,
          referencias
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
        [
          pedido.id,
          cliente.nombre_completo,
          cliente.telefono,
          direccion.calle,
          direccion.numero_exterior,
          direccion.numero_interior,
          direccion.colonia,
          direccion.ciudad,
          direccion.estado,
          direccion.codigo_postal,
          direccion.referencias,
        ],
      );
    }

    for (const item of orderItems) {
      await client.query(
        `
          INSERT INTO ventas.detalles_pedido (
            pedido_id,
            variante_id,
            cantidad,
            precio_unitario
          )
          VALUES ($1,$2,$3,$4)
        `,
        [pedido.id, item.variante_id, item.cantidad, item.precio_unitario],
      );

      if (esCredito) {
        const salidaResult = await client.query(
          `
            UPDATE inventario.variantes_producto
            SET stock_fisico = stock_fisico - $2, updated_at = now()
            WHERE id = $1::uuid
              AND activo = true
              AND (stock_fisico - stock_apartado) >= $2
            RETURNING id
          `,
          [item.variante_id, item.cantidad],
        );
        if (!salidaResult.rows[0]) {
          throw checkoutError(`El stock de ${item.producto_nombre} cambió antes de confirmar el pedido.`, 409, "STOCK");
        }
        await client.query(
          `INSERT INTO inventario.movimientos (variante_id, usuario_id, cantidad, motivo, tipo) VALUES ($1,$2,$3,$4,'SALIDA')`,
          [item.variante_id, usuarioId, -Math.abs(item.cantidad), `Venta web a crédito, folio ${pedido.folio}`],
        );
      } else {
        const reservaResult = await client.query(
          `
            UPDATE inventario.variantes_producto
            SET stock_apartado = stock_apartado + $2, updated_at = now()
            WHERE id = $1::uuid
              AND activo = true
              AND (stock_fisico - stock_apartado) >= $2
            RETURNING id
          `,
          [item.variante_id, item.cantidad],
        );
        if (!reservaResult.rows[0]) {
          throw checkoutError(`El stock de ${item.producto_nombre} cambió antes de confirmar el pedido.`, 409, "STOCK");
        }
      }
    }

    let pagoEstado = "PENDIENTE";
    let creditoCreado = null;

    if (esCredito) {
      creditoCreado = await crearCreditoEnTransaccion(client, {
        clienteId: cliente.id,
        pedidoId: pedido.id,
        plan: planCredito,
        origen: "WEB",
        usuarioId,
        pagoEnganche: null,
      });
      await client.query(
        `UPDATE ventas.pedidos SET estado = 'PAGADO', liquidado_at = now(), metodo_pago_solicitado = 'CREDITO_TIENDA' WHERE id = $1::uuid`,
        [pedido.id],
      );
      pagoEstado = "FINANCIADO";
    } else {
      await client.query(
        `
          INSERT INTO ventas.pagos (
            pedido_id, monto, metodo, referencia_externa, concepto, estado, usuario_id
          )
          VALUES ($1,$2,$3,$4,'PAGO_TOTAL','PENDIENTE',NULL)
        `,
        [pedido.id, total, metodo, referencia_externa ? String(referencia_externa).trim() : null],
      );
    }

    await client.query("COMMIT");

    return {
      pedido_id: pedido.id,
      folio: pedido.folio,
      estado: esCredito ? "PAGADO" : "PENDIENTE",
      subtotal,
      descuento: coupon.descuento,
      costo_envio: costoEnvio,
      total,
      metodo_pago: metodo,
      pago_estado: pagoEstado,
      credito_id: creditoCreado?.credito?.id ?? null,
      items: orderItems,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmarPedidoWeb(
  db,
  pedidoId,
  usuarioId,
  { referencia_externa = null } = {},
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuarioId,
    ]);

    const { rows: pedidoRows } = await client.query(
      `
        SELECT
          id,
          folio,
          tipo,
          estado,
          total
        FROM ventas.pedidos
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [pedidoId],
    );

    const pedido = pedidoRows[0];

    if (!pedido) {
      throw checkoutError("Pedido no encontrado.", 404, "ORDER_NOT_FOUND");
    }

    if (pedido.tipo !== "WEB") {
      throw checkoutError(
        "El pedido no es un pedido WEB.",
        400,
        "INVALID_ORDER_TYPE",
      );
    }

    // Idempotencia de la operación.
    if (pedido.estado === "PAGADO") {
      const result = await getCheckoutResultByPedidoId(client, pedido.id);

      await client.query("COMMIT");
      return result;
    }

    if (pedido.estado !== "PENDIENTE") {
      throw checkoutError(
        `No se puede confirmar un pedido en estado ${pedido.estado}.`,
        409,
        "INVALID_ORDER_STATE",
      );
    }

    const { rows: pagoRows } = await client.query(
      `
        SELECT
          id,
          estado,
          monto,
          metodo
        FROM ventas.pagos
        WHERE pedido_id = $1::uuid
          AND concepto = 'PAGO_TOTAL'
        ORDER BY fecha_pago DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [pedido.id],
    );

    const pago = pagoRows[0];

    if (!pago) {
      throw checkoutError(
        "El pedido no tiene un pago registrado.",
        409,
        "PAYMENT_NOT_FOUND",
      );
    }

    if (pago.estado === "CANCELADO" || pago.estado === "RECHAZADO") {
      throw checkoutError(
        `El pago está ${pago.estado}.`,
        409,
        "INVALID_PAYMENT_STATE",
      );
    }

    const { rows: detalles } = await client.query(
      `
        SELECT
          variante_id,
          cantidad
        FROM ventas.detalles_pedido
        WHERE pedido_id = $1::uuid
        ORDER BY variante_id
      `,
      [pedido.id],
    );

    if (!detalles.length) {
      throw checkoutError(
        "El pedido no contiene productos.",
        409,
        "ORDER_WITHOUT_ITEMS",
      );
    }

    const varianteIds = detalles.map((detalle) => detalle.variante_id);

    const { rows: variantes } = await client.query(
      `
        SELECT
          id,
          stock_fisico,
          stock_apartado
        FROM inventario.variantes_producto
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE
      `,
      [varianteIds],
    );

    const variantesMap = new Map(
      variantes.map((variante) => [variante.id, variante]),
    );

    if (variantes.length !== detalles.length) {
      throw checkoutError(
        "Una o más variantes del pedido ya no existen.",
        409,
        "VARIANT_NOT_FOUND",
      );
    }

    for (const detalle of detalles) {
      const variante = variantesMap.get(detalle.variante_id);

      const cantidad = Number(detalle.cantidad);
      const stockFisico = Number(variante.stock_fisico);
      const stockApartado = Number(variante.stock_apartado);

      if (stockApartado < cantidad) {
        throw checkoutError(
          `La reserva de la variante ${detalle.variante_id} es inconsistente.`,
          409,
          "RESERVATION_INCONSISTENT",
        );
      }

      if (stockFisico < cantidad) {
        throw checkoutError(
          `Stock físico insuficiente para la variante ${detalle.variante_id}.`,
          409,
          "STOCK",
        );
      }
    }

    for (const detalle of detalles) {
      const cantidad = Number(detalle.cantidad);

      const stockResult = await client.query(
        `
          UPDATE inventario.variantes_producto
          SET
            stock_fisico = stock_fisico - $2,
            stock_apartado = stock_apartado - $2,
            updated_at = now()
          WHERE id = $1::uuid
            AND stock_fisico >= $2
            AND stock_apartado >= $2
          RETURNING id
        `,
        [detalle.variante_id, cantidad],
      );

      if (!stockResult.rows.length) {
        throw checkoutError(
          `No se pudo consumir la reserva de ${detalle.variante_id}.`,
          409,
          "STOCK",
        );
      }

      await client.query(
        `
          INSERT INTO inventario.movimientos (
            variante_id,
            usuario_id,
            cantidad,
            motivo,
            tipo
          )
          VALUES ($1,$2,$3,$4,'SALIDA')
        `,
        [
          detalle.variante_id,
          usuarioId,
          -Math.abs(cantidad),
          `CONFIRMACIÓN PEDIDO WEB ${pedido.folio}`,
        ],
      );
    }

    await client.query(
      `
        UPDATE ventas.pagos
        SET
          estado = 'CONFIRMADO',
          usuario_id = $2,
          referencia_externa =
            COALESCE($3, referencia_externa),
          fecha_pago = now()
        WHERE id = $1::uuid
      `,
      [pago.id, usuarioId, normalizeOptional(referencia_externa)],
    );

    await client.query(
      `
        UPDATE ventas.pedidos
        SET
          estado = 'PAGADO',
          liquidado_at = now()
        WHERE id = $1::uuid
      `,
      [pedido.id],
    );

    await client.query("COMMIT");

    return await getCheckoutResultByPedidoId(client, pedido.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelarPedidoWeb(
  db,
  pedidoId,
  usuarioId,
  { motivo } = {},
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuarioId,
    ]);

    const { rows: pedidoRows } = await client.query(
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

    const pedido = pedidoRows[0];

    if (!pedido) {
      throw checkoutError("Pedido no encontrado.", 404, "ORDER_NOT_FOUND");
    }

    if (pedido.tipo !== "WEB") {
      throw checkoutError(
        "El pedido no es un pedido WEB.",
        400,
        "INVALID_ORDER_TYPE",
      );
    }

    if (pedido.estado === "CANCELADO") {
      const result = await getCheckoutResultByPedidoId(client, pedido.id);

      await client.query("COMMIT");
      return result;
    }

    if (pedido.estado !== "PENDIENTE") {
      throw checkoutError(
        `No se puede cancelar una reserva WEB en estado ${pedido.estado}.`,
        409,
        "INVALID_ORDER_STATE",
      );
    }

    const { rows: detalles } = await client.query(
      `
        SELECT
          variante_id,
          cantidad
        FROM ventas.detalles_pedido
        WHERE pedido_id = $1::uuid
        ORDER BY variante_id
      `,
      [pedido.id],
    );

    const varianteIds = detalles.map((detalle) => detalle.variante_id);

    if (varianteIds.length) {
      const { rows: variantes } = await client.query(
        `
          SELECT
            id,
            stock_apartado
          FROM inventario.variantes_producto
          WHERE id = ANY($1::uuid[])
          ORDER BY id
          FOR UPDATE
        `,
        [varianteIds],
      );

      const variantesMap = new Map(
        variantes.map((variante) => [variante.id, variante]),
      );

      if (variantes.length !== detalles.length) {
        throw checkoutError(
          "Una o más variantes de la reserva ya no existen.",
          409,
          "VARIANT_NOT_FOUND",
        );
      }

      for (const detalle of detalles) {
        const variante = variantesMap.get(detalle.variante_id);

        if (Number(variante.stock_apartado) < Number(detalle.cantidad)) {
          throw checkoutError(
            `La reserva de ${detalle.variante_id} es inconsistente.`,
            409,
            "RESERVATION_INCONSISTENT",
          );
        }
      }

      for (const detalle of detalles) {
        const stockResult = await client.query(
          `
            UPDATE inventario.variantes_producto
            SET
              stock_apartado =
                stock_apartado - $2,
              updated_at = now()
            WHERE id = $1::uuid
              AND stock_apartado >= $2
            RETURNING id
          `,
          [detalle.variante_id, Number(detalle.cantidad)],
        );

        if (!stockResult.rows.length) {
          throw checkoutError(
            `No se pudo liberar la reserva ${detalle.variante_id}.`,
            409,
            "RESERVATION_INCONSISTENT",
          );
        }
      }
    }

    await client.query(
      `
        UPDATE ventas.pagos
        SET
          estado = 'CANCELADO',
          usuario_id = COALESCE(usuario_id, $2)
        WHERE pedido_id = $1::uuid
          AND estado = 'PENDIENTE'
      `,
      [pedido.id, usuarioId],
    );

    await client.query(
      `
        UPDATE ventas.pedidos
        SET
          estado = 'CANCELADO',
          motivo_cancelacion = $2,
          fecha_cancelacion = now()
        WHERE id = $1::uuid
      `,
      [pedido.id, normalizeOptional(motivo) ?? "Pedido web cancelado"],
    );

    await client.query("COMMIT");

    return await getCheckoutResultByPedidoId(client, pedido.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function validarCuponCheckout(db, usuarioId, { codigo, items }) {
  const normalizedItems = normalizeItems(items);

  const { rows: clienteRows } = await db.query(
    `
      SELECT id
      FROM clientes.clientes
      WHERE usuario_id = $1::uuid
        AND activo = true
      LIMIT 1
    `,
    [usuarioId],
  );

  const cliente = clienteRows[0];

  if (!cliente) {
    throw checkoutError(
      "No se encontró el perfil del cliente.",
      404,
      "CLIENT_PROFILE_NOT_FOUND",
    );
  }

  let subtotal = 0;

  for (const item of normalizedItems) {
    const { rows } = await db.query(
      `
        SELECT
          v.precio_venta,
          v.activo AS variante_activa,
          p.activo AS producto_activo
        FROM inventario.variantes_producto v
        JOIN inventario.productos p
          ON p.id = v.producto_id
        WHERE v.id = $1::uuid
        LIMIT 1
      `,
      [item.variante_id],
    );

    const variante = rows[0];

    if (!variante) {
      throw checkoutError(
        "Uno de los productos ya no existe.",
        404,
        "VARIANT_NOT_FOUND",
      );
    }

    if (
      variante.variante_activa !== true ||
      variante.producto_activo !== true
    ) {
      throw checkoutError(
        "Uno de los productos ya no está disponible.",
        409,
        "PRODUCT_UNAVAILABLE",
      );
    }

    subtotal += Number(variante.precio_venta) * item.cantidad;
  }

  subtotal = money(subtotal);

  const cupon = await calcularCupon(db, codigo, subtotal, cliente.id, {
    bloquear: false,
  });

  const total = money(subtotal - cupon.descuento);

  return {
    codigo: cupon.codigo,
    subtotal,
    descuento: cupon.descuento,
    total,

    uso_maximo: cupon.uso_maximo,
    uso_maximo_por_cliente: cupon.uso_maximo_por_cliente,

    usos_globales_restantes: cupon.usos_globales_restantes,

    usos_cliente_restantes: cupon.usos_cliente_restantes,
  };
}
