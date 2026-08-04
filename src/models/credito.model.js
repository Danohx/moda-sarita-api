// src/models/credito.model.js
// SQL y transacciones del módulo de crédito.

import {
  centavosADinero,
  dineroACentavos,
  normalizarConfiguracionCredito,
  validarElegibilidadCliente,
} from "../services/credito.service.js";

function modelError(message, code = "VALIDATION", details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

async function setAuditContext(client, usuarioId) {
  await client.query("SELECT set_config('app.user_id', $1, true)", [
    usuarioId ? String(usuarioId) : "",
  ]);
}

async function withTransaction(db, callback, { usuarioId = null } = {}) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditContext(client, usuarioId);
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

function toSafeLimit(value, fallback = 50, max = 200) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function toSafeOffset(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return 0;
  return number;
}

export async function obtenerParametrosCredito(db) {
  const { rows } = await db.query(
    `
      SELECT clave, valor, tipo, validacion
      FROM configuracion.parametros_sistema
      WHERE modulo = 'CREDITO'
      ORDER BY orden, clave
    `,
  );

  return rows;
}

export async function obtenerConfiguracionCredito(db) {
  const rows = await obtenerParametrosCredito(db);
  return normalizarConfiguracionCredito(rows);
}

export async function obtenerEstadoCreditoCliente(db, clienteId) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM clientes.v_estado_credito_cliente
      WHERE cliente_id = $1::uuid
      LIMIT 1
    `,
    [clienteId],
  );

  return rows[0] || null;
}

async function obtenerEstadoClienteParaUpdate(client, clienteId) {
  const { rows } = await client.query(
    `
      SELECT
        cl.id AS cliente_id,
        cl.nombres,
        cl.apellido_paterno,
        cl.apellido_materno,
        cl.activo,
        cl.tiene_credito,
        cl.limite_credito,
        cl.saldo_deudor,
        (
          SELECT count(*)::integer
          FROM clientes.creditos c
          WHERE c.cliente_id = cl.id
            AND c.estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
        ) AS creditos_activos,
        (
          SELECT count(*)::integer
          FROM clientes.creditos c
          WHERE c.cliente_id = cl.id
            AND c.estado = 'EN_MORA'
        ) AS creditos_en_mora,
        (
          SELECT count(*)::integer
          FROM clientes.creditos c
          WHERE c.cliente_id = cl.id
            AND c.estado = 'INCUMPLIDO'
        ) AS creditos_incumplidos,
        (
          SELECT count(*)::integer
          FROM clientes.credito_cuotas cc
          JOIN clientes.creditos c ON c.id = cc.credito_id
          WHERE c.cliente_id = cl.id
            AND cc.estado = 'VENCIDA'
            AND cc.saldo_pendiente > 0
        ) AS cuotas_vencidas
      FROM clientes.clientes cl
      WHERE cl.id = $1::uuid
      FOR UPDATE
    `,
    [clienteId],
  );

  return rows[0] || null;
}

export async function listarCreditos(
  db,
  {
    clienteId = null,
    estado = null,
    fechaDesde = null,
    fechaHasta = null,
    conCuotasVencidas = undefined,
    datosCalendarioCompletos = undefined,
    limit = 50,
    offset = 0,
  } = {},
) {
  const params = [];
  const where = [];

  if (clienteId) {
    params.push(clienteId);
    where.push(`cliente_id = $${params.length}::uuid`);
  }

  if (estado) {
    params.push(String(estado).toUpperCase());
    where.push(`estado = $${params.length}::clientes.estado_credito`);
  }

  if (fechaDesde) {
    params.push(fechaDesde);
    where.push(`fecha_otorgamiento >= $${params.length}::date`);
  }

  if (fechaHasta) {
    params.push(fechaHasta);
    where.push(`fecha_otorgamiento < ($${params.length}::date + interval '1 day')`);
  }

  if (conCuotasVencidas !== undefined) {
    params.push(Boolean(conCuotasVencidas));
    where.push(
      `(($${params.length} = true AND cuotas_vencidas > 0) OR ` +
        `($${params.length} = false AND cuotas_vencidas = 0))`,
    );
  }

  if (datosCalendarioCompletos !== undefined) {
    params.push(Boolean(datosCalendarioCompletos));
    where.push(`datos_calendario_completos = $${params.length}`);
  }

  const countParams = [...params];
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countResult = await db.query(
    `
      SELECT count(*)::integer AS total
      FROM clientes.v_creditos_resumen
      ${whereSql}
    `,
    countParams,
  );

  const safeLimit = toSafeLimit(limit);
  const safeOffset = toSafeOffset(offset);
  params.push(safeLimit, safeOffset);

  const { rows } = await db.query(
    `
      SELECT *
      FROM clientes.v_creditos_resumen
      ${whereSql}
      ORDER BY fecha_otorgamiento DESC, credito_id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    params,
  );

  const total = countResult.rows[0]?.total ?? 0;

  return {
    items: rows,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + rows.length < total,
  };
}

export async function obtenerCreditosCliente(db, clienteId, filters = {}) {
  return listarCreditos(db, { ...filters, clienteId });
}

export async function obtenerCreditoPorId(db, creditoId) {
  const [summaryResult, installmentsResult, paymentsResult, movementsResult] =
    await Promise.all([
      db.query(
        `
          SELECT *
          FROM clientes.v_creditos_resumen
          WHERE credito_id = $1::uuid
          LIMIT 1
        `,
        [creditoId],
      ),
      db.query(
        `
          SELECT
            id,
            credito_id,
            numero_cuota,
            fecha_vencimiento,
            monto_programado,
            monto_pagado,
            monto_condonado,
            saldo_pendiente,
            fecha_pago_completo,
            estado,
            created_at,
            updated_at
          FROM clientes.credito_cuotas
          WHERE credito_id = $1::uuid
          ORDER BY numero_cuota
        `,
        [creditoId],
      ),
      db.query(
        `
          SELECT
            p.id,
            p.pedido_id,
            p.credito_id,
            p.monto,
            p.metodo,
            p.referencia_externa,
            p.fecha_pago,
            p.concepto,
            p.estado,
            p.usuario_id,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'aplicacion_id', ap.id,
                  'cuota_id', ap.cuota_id,
                  'monto_aplicado', ap.monto_aplicado,
                  'fecha_aplicacion', ap.fecha_aplicacion
                ) ORDER BY ap.fecha_aplicacion, ap.id
              ) FILTER (WHERE ap.id IS NOT NULL),
              '[]'::jsonb
            ) AS aplicaciones
          FROM ventas.pagos p
          LEFT JOIN clientes.credito_aplicaciones_pago ap ON ap.pago_id = p.id
          WHERE p.credito_id = $1::uuid
          GROUP BY p.id
          ORDER BY p.fecha_pago DESC, p.id DESC
        `,
        [creditoId],
      ),
      db.query(
        `
          SELECT
            id,
            cliente_id,
            usuario_id,
            pedido_id,
            pago_id,
            credito_id,
            cuota_id,
            fecha,
            tipo,
            descripcion,
            monto,
            saldo_anterior,
            saldo_resultante,
            metodo_pago,
            referencia_externa,
            observaciones,
            created_at
          FROM clientes.movimientos_credito
          WHERE credito_id = $1::uuid
          ORDER BY fecha DESC, id DESC
        `,
        [creditoId],
      ),
    ]);

  const credito = summaryResult.rows[0];
  if (!credito) return null;

  return {
    credito,
    cuotas: installmentsResult.rows,
    pagos: paymentsResult.rows,
    movimientos: movementsResult.rows,
  };
}

export async function obtenerProximaCuota(db, creditoId) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM clientes.credito_cuotas
      WHERE credito_id = $1::uuid
        AND saldo_pendiente > 0
        AND estado IN ('VENCIDA', 'PENDIENTE', 'PARCIAL')
      ORDER BY
        CASE WHEN estado = 'VENCIDA' THEN 0 ELSE 1 END,
        fecha_vencimiento,
        numero_cuota
      LIMIT 1
    `,
    [creditoId],
  );

  return rows[0] || null;
}

async function validarMetodoPagoReal(
  client,
  metodo,
  { canal = "ADMIN", referenciaExterna = null } = {},
) {
  const metodoNormalizado = String(metodo || "").trim().toUpperCase();
  const activeColumn = canal === "POS" ? "activo_pos" : "activo_admin";
  const { rows } = await client.query(
    `
      SELECT
        codigo,
        nombre,
        ${activeColumn} AS activo_canal,
        requiere_referencia,
        es_credito
      FROM configuracion.metodos_pago
      WHERE codigo = $1::public.metodo_pago_enum
      LIMIT 1
    `,
    [metodoNormalizado],
  );

  const config = rows[0];

  if (!config || config.activo_canal !== true) {
    throw modelError("El método de pago no está activo para este canal.");
  }

  if (
    config.es_credito === true ||
    metodoNormalizado === "CREDITO_TIENDA"
  ) {
    throw modelError(
      "El método del enganche o abono debe representar dinero realmente recibido.",
    );
  }

  if (
    config.requiere_referencia === true &&
    !String(referenciaExterna || "").trim()
  ) {
    throw modelError("El método de pago requiere una referencia externa.");
  }

  return config;
}

export async function crearCuotasCredito(client, creditoId, calendario) {
  if (!Array.isArray(calendario) || calendario.length === 0) {
    throw modelError("El calendario de cuotas es requerido.");
  }

  const inserted = [];

  for (const item of calendario) {
    const { rows } = await client.query(
      `
        INSERT INTO clientes.credito_cuotas (
          credito_id,
          numero_cuota,
          fecha_vencimiento,
          monto_programado,
          monto_pagado,
          monto_condonado,
          saldo_pendiente,
          estado
        )
        VALUES ($1, $2, $3::date, $4, 0, 0, $4, 'PENDIENTE')
        RETURNING *
      `,
      [
        creditoId,
        item.numero_cuota,
        item.fecha_vencimiento,
        item.monto_programado,
      ],
    );

    inserted.push(rows[0]);
  }

  return inserted;
}

export async function crearCreditoEnTransaccion(
  client,
  {
    clienteId,
    pedidoId,
    plan,
    origen = "ADMIN",
    usuarioId = null,
    pagoEnganche = null,
  },
) {
  await setAuditContext(client, usuarioId);

  const cliente = await obtenerEstadoClienteParaUpdate(client, clienteId);
  if (!cliente) throw modelError("Cliente no encontrado.", "NOT_FOUND");

  const { rows: pedidoRows } = await client.query(
    `
      SELECT id, folio, cliente_id, total, estado, tipo
      FROM ventas.pedidos
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [pedidoId],
  );

  const pedido = pedidoRows[0];
  if (!pedido) throw modelError("Pedido no encontrado.", "NOT_FOUND");

  if (pedido.cliente_id !== clienteId) {
    throw modelError("El pedido no pertenece al cliente indicado.");
  }

  if (["CANCELADO", "DEVUELTO"].includes(String(pedido.estado))) {
    throw modelError("No se puede financiar un pedido cancelado o devuelto.");
  }

  if (String(pedido.tipo) === "APARTADO") {
    throw modelError(
      "Los apartados utilizan su propio flujo de anticipos y no pueden convertirse en crédito de tienda.",
    );
  }

  if (dineroACentavos(pedido.total) !== dineroACentavos(plan.total_compra)) {
    throw modelError("El total del plan no coincide con el total del pedido.");
  }

  const { rows: duplicateRows } = await client.query(
    `SELECT id FROM clientes.creditos WHERE pedido_id = $1::uuid LIMIT 1`,
    [pedidoId],
  );

  if (duplicateRows.length) {
    throw modelError("El pedido ya tiene un crédito asociado.", "CONFLICT");
  }

  const { rows: confirmedPaymentRows } = await client.query(
    `
      SELECT
        count(*)::integer AS total_pagos,
        COALESCE(sum(monto), 0)::numeric(12,2) AS monto_confirmado
      FROM ventas.pagos
      WHERE pedido_id = $1::uuid
        AND estado = 'CONFIRMADO'
    `,
    [pedidoId],
  );

  if (Number(confirmedPaymentRows[0]?.total_pagos || 0) > 0) {
    throw modelError(
      "El pedido ya contiene pagos confirmados; no puede convertirse automáticamente en crédito.",
      "CONFLICT",
      confirmedPaymentRows[0],
    );
  }

  const rawConfig = await obtenerParametrosCredito(client);
  const elegibilidad = validarElegibilidadCliente({
    cliente,
    montoFinanciado: plan.monto_financiado,
    configuracion: rawConfig,
  });

  const saldoGlobalAnterior = Number(cliente.saldo_deudor || 0);

  const { rows: creditRows } = await client.query(
    `
      INSERT INTO clientes.creditos (
        cliente_id,
        pedido_id,
        monto_compra,
        enganche,
        monto_financiado,
        saldo_pendiente,
        plazo_meses,
        frecuencia_pago,
        numero_cuotas,
        fecha_otorgamiento,
        fecha_primer_vencimiento,
        fecha_vencimiento_final,
        estado,
        dias_gracia,
        origen,
        datos_calendario_completos,
        creado_por
      )
      VALUES (
        $1, $2, $3, $4, $5, $5, $6,
        $7::clientes.frecuencia_pago_credito,
        $8, now(), $9::date, $10::date,
        'ACTIVO', $11, $12::clientes.origen_credito, true, $13
      )
      RETURNING *
    `,
    [
      clienteId,
      pedidoId,
      plan.total_compra,
      plan.enganche,
      plan.monto_financiado,
      plan.plazo_meses,
      plan.frecuencia_pago,
      plan.numero_cuotas,
      plan.fecha_primer_vencimiento,
      plan.fecha_vencimiento_final,
      plan.dias_gracia,
      origen,
      usuarioId,
    ],
  );

  const credito = creditRows[0];
  const cuotas = await crearCuotasCredito(client, credito.id, plan.calendario);

  let enganchePago = null;
  if (dineroACentavos(plan.enganche) > 0) {
    if (!pagoEnganche?.metodo) {
      throw modelError("El método del enganche es requerido.");
    }

    const metodoEngancheConfig = await validarMetodoPagoReal(
      client,
      pagoEnganche.metodo,
      {
        canal: pagoEnganche.canal || "ADMIN",
        referenciaExterna: pagoEnganche.referenciaExterna,
      },
    );

    const { rows } = await client.query(
      `
        INSERT INTO ventas.pagos (
          pedido_id,
          credito_id,
          monto,
          metodo,
          referencia_externa,
          concepto,
          estado,
          usuario_id
        )
        VALUES (
          $1, $2, $3, $4::public.metodo_pago_enum, $5,
          'ENGANCHE_CREDITO', 'CONFIRMADO', $6
        )
        RETURNING *
      `,
      [
        pedidoId,
        credito.id,
        plan.enganche,
        metodoEngancheConfig.codigo,
        pagoEnganche.referenciaExterna || null,
        usuarioId,
      ],
    );

    enganchePago = rows[0];
  }

  await client.query(
    `
      UPDATE ventas.pedidos
      SET metodo_pago_solicitado = 'CREDITO_TIENDA'
      WHERE id = $1::uuid
    `,
    [pedidoId],
  );

  const { rows: balanceRows } = await client.query(
    `SELECT saldo_deudor FROM clientes.clientes WHERE id = $1::uuid`,
    [clienteId],
  );

  const saldoGlobalResultante = Number(balanceRows[0]?.saldo_deudor || 0);
  const expectedResult = centavosADinero(
    dineroACentavos(saldoGlobalAnterior) +
      dineroACentavos(plan.monto_financiado),
  );

  if (dineroACentavos(saldoGlobalResultante) !== dineroACentavos(expectedResult)) {
    throw modelError(
      "La creación del crédito produjo una diferencia de conciliación.",
      "CREDIT_RECONCILIATION",
      { saldoGlobalAnterior, saldoGlobalResultante, expectedResult },
    );
  }

  await client.query(
    `
      INSERT INTO clientes.movimientos_credito (
        cliente_id,
        usuario_id,
        pedido_id,
        credito_id,
        fecha,
        tipo,
        descripcion,
        monto,
        saldo_anterior,
        saldo_resultante,
        metodo_pago,
        referencia_externa,
        observaciones
      )
      VALUES (
        $1, $2, $3, $4, now(), 'COMPRA', $5,
        $6, $7, $8, 'CREDITO_TIENDA', NULL, $9
      )
    `,
    [
      clienteId,
      usuarioId,
      pedidoId,
      credito.id,
      `Crédito de compra para pedido folio ${pedido.folio}`,
      plan.monto_financiado,
      saldoGlobalAnterior,
      saldoGlobalResultante,
      `Plan ${plan.frecuencia_pago} a ${plan.plazo_meses} mes(es), ${plan.numero_cuotas} cuota(s).`,
    ],
  );

  return {
    credito,
    cuotas,
    enganche_pago: enganchePago,
    elegibilidad,
  };
}

export async function crearCredito(db, payload) {
  return withTransaction(
    db,
    (client) => crearCreditoEnTransaccion(client, payload),
    { usuarioId: payload.usuarioId },
  );
}

function construirAplicacionesCuotas({ cuotas, monto, configuracion, fechaPago }) {
  const paymentCents = dineroACentavos(monto);
  let remaining = paymentCents;
  const applications = [];
  const paymentDate = String(fechaPago).slice(0, 10);

  const candidates = cuotas.filter((cuota) => {
    if (cuota.estado === "VENCIDA") return true;
    if (configuracion.permitePagosAnticipados) return true;
    return String(cuota.fecha_vencimiento).slice(0, 10) <= paymentDate;
  });

  if (!candidates.length) {
    throw modelError("No existen cuotas vencidas o exigibles para aplicar el pago.");
  }

  for (const cuota of candidates) {
    if (remaining <= 0) break;
    const installmentBalance = dineroACentavos(cuota.saldo_pendiente);
    const applied = Math.min(remaining, installmentBalance);

    applications.push({
      cuotaId: cuota.id,
      numeroCuota: cuota.numero_cuota,
      montoAplicado: centavosADinero(applied),
      saldoCuotaAntes: centavosADinero(installmentBalance),
    });
    remaining -= applied;
  }

  if (remaining !== 0) {
    throw modelError(
      "No fue posible distribuir el pago completo entre las cuotas elegibles.",
    );
  }

  if (!configuracion.permitePagoMulticuota && applications.length > 1) {
    throw modelError("La configuración no permite cubrir varias cuotas con un pago.");
  }

  const hasPartialApplication = applications.some(
    (item) =>
      dineroACentavos(item.montoAplicado) <
      dineroACentavos(item.saldoCuotaAntes),
  );
  if (!configuracion.permitePagosParciales && hasPartialApplication) {
    throw modelError("La configuración no permite pagos parciales.");
  }

  return applications;
}

export async function registrarAbonoCredito(
  db,
  creditoId,
  {
    monto,
    metodoPago,
    referenciaExterna = null,
    observaciones = null,
    usuarioId = null,
    canal = "ADMIN",
    fechaPago = new Date().toISOString(),
  },
) {
  return withTransaction(
    db,
    async (client) => {
      const { rows: creditRows } = await client.query(
        `
          SELECT
            c.*,
            cl.saldo_deudor AS saldo_global_cliente,
            cl.tiene_credito,
            cl.activo AS cliente_activo
          FROM clientes.creditos c
          JOIN clientes.clientes cl ON cl.id = c.cliente_id
          WHERE c.id = $1::uuid
          FOR UPDATE OF c, cl
        `,
        [creditoId],
      );

      const credito = creditRows[0];
      if (!credito) throw modelError("Crédito no encontrado.", "NOT_FOUND");

      if (!["ACTIVO", "EN_MORA", "INCUMPLIDO"].includes(credito.estado)) {
        throw modelError(`No se puede abonar a un crédito ${credito.estado}.`);
      }

      const paymentCents = dineroACentavos(monto, "monto");
      const creditBalanceCents = dineroACentavos(
        credito.saldo_pendiente,
        "saldo_pendiente",
      );

      if (paymentCents <= 0) throw modelError("El abono debe ser mayor a 0.");
      if (paymentCents > creditBalanceCents) {
        throw modelError("El abono no puede exceder el saldo del crédito.");
      }

      const metodoConfig = await validarMetodoPagoReal(client, metodoPago, {
        canal,
        referenciaExterna,
      });

      if (!usuarioId) {
        throw modelError("El usuario que registra el abono es requerido.");
      }

      const { rows: openShiftRows } = await client.query(
        `
          SELECT id
          FROM ventas.corte_caja
          WHERE usuario_id = $1::uuid
            AND fin_turno IS NULL
          LIMIT 1
        `,
        [usuarioId],
      );

      if (!openShiftRows[0]) {
        throw modelError(
          "Debes abrir turno/corte antes de registrar un abono de crédito.",
        );
      }

      const rawConfig = await obtenerParametrosCredito(client);
      const config = normalizarConfiguracionCredito(rawConfig);
      const concepto =
        paymentCents === creditBalanceCents
          ? "LIQUIDACION_CREDITO"
          : "ABONO_CREDITO";

      const { rows: paymentRows } = await client.query(
        `
          INSERT INTO ventas.pagos (
            pedido_id,
            credito_id,
            monto,
            metodo,
            referencia_externa,
            fecha_pago,
            concepto,
            estado,
            usuario_id
          )
          VALUES (
            $1, $2, $3, $4::public.metodo_pago_enum, $5,
            $6::timestamptz, $7::public.concepto_pago,
            'CONFIRMADO', $8
          )
          RETURNING *
        `,
        [
          credito.pedido_id,
          credito.id,
          centavosADinero(paymentCents),
          metodoConfig.codigo,
          referenciaExterna,
          fechaPago,
          concepto,
          usuarioId,
        ],
      );

      const pago = paymentRows[0];
      let aplicaciones = [];

      if (credito.datos_calendario_completos) {
        const { rows: installments } = await client.query(
          `
            SELECT *
            FROM clientes.credito_cuotas
            WHERE credito_id = $1::uuid
              AND saldo_pendiente > 0
              AND estado IN ('VENCIDA', 'PENDIENTE', 'PARCIAL')
            ORDER BY
              CASE WHEN estado = 'VENCIDA' THEN 0 ELSE 1 END,
              fecha_vencimiento,
              numero_cuota
            FOR UPDATE
          `,
          [credito.id],
        );

        const installmentBalance = installments.reduce(
          (sum, item) => sum + dineroACentavos(item.saldo_pendiente),
          0,
        );

        if (installmentBalance !== creditBalanceCents) {
          throw modelError(
            "El saldo del crédito no coincide con la suma de cuotas pendientes.",
            "CREDIT_RECONCILIATION",
          );
        }

        aplicaciones = construirAplicacionesCuotas({
          cuotas: installments,
          monto: centavosADinero(paymentCents),
          configuracion: config,
          fechaPago,
        });

        for (const application of aplicaciones) {
          const { rows } = await client.query(
            `
              INSERT INTO clientes.credito_aplicaciones_pago (
                credito_id,
                cuota_id,
                pago_id,
                monto_aplicado,
                fecha_aplicacion,
                aplicado_por
              )
              VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
              RETURNING *
            `,
            [
              credito.id,
              application.cuotaId,
              pago.id,
              application.montoAplicado,
              fechaPago,
              usuarioId,
            ],
          );

          application.aplicacion = rows[0];
        }
      } else {
        const remainingCents = creditBalanceCents - paymentCents;

        await client.query(
          `
            UPDATE clientes.creditos
            SET
              saldo_pendiente = $2,
              estado = CASE
                WHEN $2::numeric = 0 THEN 'LIQUIDADO'::clientes.estado_credito
                ELSE estado
              END,
              fecha_liquidacion = CASE
                WHEN $2::numeric = 0 THEN $3::timestamptz
                ELSE NULL
              END,
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [credito.id, centavosADinero(remainingCents), fechaPago],
        );
      }

      const { rows: updatedCreditRows } = await client.query(
        `SELECT * FROM clientes.creditos WHERE id = $1::uuid`,
        [credito.id],
      );
      const { rows: clientBalanceRows } = await client.query(
        `SELECT saldo_deudor FROM clientes.clientes WHERE id = $1::uuid`,
        [credito.cliente_id],
      );

      const updatedCredit = updatedCreditRows[0];
      const globalBalanceBefore = Number(credito.saldo_global_cliente || 0);
      const globalBalanceAfter = Number(clientBalanceRows[0]?.saldo_deudor || 0);
      const expectedGlobalAfter = centavosADinero(
        dineroACentavos(globalBalanceBefore) - paymentCents,
      );

      if (
        dineroACentavos(globalBalanceAfter) !==
        dineroACentavos(expectedGlobalAfter)
      ) {
        throw modelError(
          "El abono produjo una diferencia de conciliación en el saldo global.",
          "CREDIT_RECONCILIATION",
          { globalBalanceBefore, globalBalanceAfter, expectedGlobalAfter },
        );
      }

      await client.query(
        `
          INSERT INTO clientes.movimientos_credito (
            cliente_id,
            usuario_id,
            pedido_id,
            pago_id,
            credito_id,
            fecha,
            tipo,
            descripcion,
            monto,
            saldo_anterior,
            saldo_resultante,
            metodo_pago,
            referencia_externa,
            observaciones
          )
          VALUES (
            $1, $2, $3, $4, $5, $6::timestamptz,
            'ABONO', $7, $8, $9, $10, $11, $12, $13
          )
        `,
        [
          credito.cliente_id,
          usuarioId,
          credito.pedido_id,
          pago.id,
          credito.id,
          fechaPago,
          concepto === "LIQUIDACION_CREDITO"
            ? "Liquidación de crédito"
            : "Abono a crédito",
          -centavosADinero(paymentCents),
          globalBalanceBefore,
          globalBalanceAfter,
          metodoConfig.codigo,
          referenciaExterna,
          observaciones,
        ],
      );

      return {
        pago,
        aplicaciones,
        credito: updatedCredit,
        saldo_global_cliente: globalBalanceAfter,
      };
    },
    { usuarioId },
  );
}

export async function cancelarCredito(
  db,
  creditoId,
  { motivo, usuarioId = null } = {},
) {
  if (!String(motivo || "").trim()) {
    throw modelError("El motivo de cancelación es requerido.");
  }

  return withTransaction(
    db,
    async (client) => {
      const { rows } = await client.query(
        `
          SELECT
            c.*,
            cl.saldo_deudor AS saldo_global_cliente
          FROM clientes.creditos c
          JOIN clientes.clientes cl ON cl.id = c.cliente_id
          WHERE c.id = $1::uuid
          FOR UPDATE OF c, cl
        `,
        [creditoId],
      );

      const credito = rows[0];
      if (!credito) throw modelError("Crédito no encontrado.", "NOT_FOUND");
      if (credito.estado === "CANCELADO") return credito;
      if (credito.estado === "LIQUIDADO") {
        throw modelError("No se puede cancelar un crédito liquidado.");
      }
      if (credito.origen === "MIGRACION_LEGACY" || !credito.pedido_id) {
        throw modelError(
          "Un crédito histórico no puede cancelarse como una venta actual; requiere un ajuste administrativo documentado.",
        );
      }

      const { rows: orderRows } = await client.query(
        `
          SELECT id, tipo, estado, folio
          FROM ventas.pedidos
          WHERE id = $1::uuid
          FOR UPDATE
        `,
        [credito.pedido_id],
      );
      const pedido = orderRows[0];
      if (!pedido) {
        throw modelError("Pedido relacionado no encontrado.", "NOT_FOUND");
      }
      if (
        dineroACentavos(credito.saldo_pendiente) !==
        dineroACentavos(credito.monto_financiado)
      ) {
        throw modelError(
          "No se puede cancelar un crédito que ya recibió abonos sin un proceso de reversión.",
        );
      }

      const { rows: paymentRows } = await client.query(
        `
          SELECT id, concepto, monto
          FROM ventas.pagos
          WHERE credito_id = $1::uuid
            AND estado = 'CONFIRMADO'
            AND concepto IN (
              'ENGANCHE_CREDITO',
              'ABONO_CREDITO',
              'LIQUIDACION_CREDITO'
            )
          LIMIT 1
        `,
        [credito.id],
      );

      if (paymentRows.length) {
        throw modelError(
          "No se puede cancelar el crédito porque existe dinero confirmado. Primero debe implementarse y autorizarse el reembolso.",
        );
      }

      if (["CANCELADO", "DEVUELTO"].includes(String(pedido.estado))) {
        throw modelError("El pedido relacionado ya está cancelado o devuelto.");
      }

      const { rows: details } = await client.query(
        `
          SELECT variante_id, cantidad
          FROM ventas.detalles_pedido
          WHERE pedido_id = $1::uuid
          ORDER BY id
        `,
        [credito.pedido_id],
      );

      for (const detail of details) {
        const { rows: variantRows } = await client.query(
          `
            SELECT id
            FROM inventario.variantes_producto
            WHERE id = $1::uuid
            FOR UPDATE
          `,
          [detail.variante_id],
        );

        if (!variantRows.length) {
          throw modelError(
            `No se encontró la variante ${detail.variante_id} para reponer inventario.`,
            "NOT_FOUND",
          );
        }

        await client.query(
          `
            UPDATE inventario.variantes_producto
            SET stock_fisico = stock_fisico + $2,
                updated_at = now()
            WHERE id = $1::uuid
          `,
          [detail.variante_id, Number(detail.cantidad)],
        );

        await client.query(
          `
            INSERT INTO inventario.movimientos (
              variante_id,
              usuario_id,
              cantidad,
              motivo,
              tipo
            )
            VALUES ($1, $2, $3, $4, 'ENTRADA')
          `,
          [
            detail.variante_id,
            usuarioId,
            Math.abs(Number(detail.cantidad)),
            `CANCELACIÓN CRÉDITO pedido ${pedido.folio || credito.pedido_id}`,
          ],
        );
      }

      const balanceBefore = Number(credito.saldo_global_cliente || 0);

      const { rows: updatedRows } = await client.query(
        `
          UPDATE clientes.creditos
          SET
            estado = 'CANCELADO',
            cancelado_por = $2,
            cancelado_at = now(),
            motivo_cancelacion = $3,
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING *
        `,
        [credito.id, usuarioId, String(motivo).trim()],
      );

      await client.query(
        `
          UPDATE ventas.pedidos
          SET
            estado = 'CANCELADO',
            fecha_cancelacion = now(),
            motivo_cancelacion = $2
          WHERE id = $1::uuid
        `,
        [
          credito.pedido_id,
          `Cancelación del crédito ${credito.id}: ${String(motivo).trim()}`,
        ],
      );

      const { rows: clientRows } = await client.query(
        `SELECT saldo_deudor FROM clientes.clientes WHERE id = $1::uuid`,
        [credito.cliente_id],
      );
      const balanceAfter = Number(clientRows[0]?.saldo_deudor || 0);
      const expectedAfter = centavosADinero(
        dineroACentavos(balanceBefore) -
          dineroACentavos(credito.saldo_pendiente),
      );

      if (dineroACentavos(balanceAfter) !== dineroACentavos(expectedAfter)) {
        throw modelError(
          "La cancelación produjo una diferencia de conciliación.",
          "CREDIT_RECONCILIATION",
          { balanceBefore, balanceAfter, expectedAfter },
        );
      }

      await client.query(
        `
          INSERT INTO clientes.movimientos_credito (
            cliente_id,
            usuario_id,
            pedido_id,
            credito_id,
            fecha,
            tipo,
            descripcion,
            monto,
            saldo_anterior,
            saldo_resultante,
            metodo_pago,
            observaciones
          )
          VALUES (
            $1, $2, $3, $4, now(), 'AJUSTE',
            'Cancelación de venta a crédito y reposición de inventario',
            $5, $6, $7, NULL, $8
          )
        `,
        [
          credito.cliente_id,
          usuarioId,
          credito.pedido_id,
          credito.id,
          -Number(credito.saldo_pendiente),
          balanceBefore,
          balanceAfter,
          String(motivo).trim(),
        ],
      );

      return updatedRows[0];
    },
    { usuarioId },
  );
}

export async function actualizarEstadosVencidos(
  db,
  fecha = null,
  { usuarioId = null } = {},
) {
  return withTransaction(
    db,
    async (client) => {
      const { rows } = await client.query(
        `SELECT clientes.fn_actualizar_estados_credito(COALESCE($1::date, CURRENT_DATE)) AS resultado`,
        [fecha],
      );

      return rows[0]?.resultado || null;
    },
    { usuarioId },
  );
}

export async function obtenerComprobantePagoCredito(db, creditoId, pagoId) {
  const { rows } = await db.query(
    `
      WITH pago_objetivo AS (
        SELECT p.*
        FROM ventas.pagos p
        WHERE p.id = $2::uuid
          AND p.credito_id = $1::uuid
          AND p.concepto IN ('ABONO_CREDITO', 'LIQUIDACION_CREDITO')
          AND p.estado = 'CONFIRMADO'
        LIMIT 1
      ),
      pagos_ordenados AS (
        SELECT
          p.id,
          p.credito_id,
          p.monto,
          p.fecha_pago,
          sum(p.monto) OVER (
            PARTITION BY p.credito_id
            ORDER BY p.fecha_pago, p.id
            ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
          ) AS pagado_despues
        FROM ventas.pagos p
        WHERE p.credito_id = $1::uuid
          AND p.estado = 'CONFIRMADO'
          AND p.concepto IN ('ABONO_CREDITO', 'LIQUIDACION_CREDITO')
      ),
      aplicaciones AS (
        SELECT
          ap.pago_id,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'aplicacion_id', ap.id,
                'cuota_id', ap.cuota_id,
                'numero_cuota', cc.numero_cuota,
                'fecha_vencimiento', cc.fecha_vencimiento,
                'monto_aplicado', ap.monto_aplicado
              ) ORDER BY cc.numero_cuota
            ),
            '[]'::jsonb
          ) AS items
        FROM clientes.credito_aplicaciones_pago ap
        JOIN clientes.credito_cuotas cc ON cc.id = ap.cuota_id
        WHERE ap.pago_id = $2::uuid
        GROUP BY ap.pago_id
      )
      SELECT
        c.id AS credito_id,
        c.cliente_id,
        c.pedido_id,
        c.monto_compra,
        c.enganche,
        c.monto_financiado,
        c.saldo_pendiente AS saldo_actual_credito,
        c.estado AS estado_credito,
        c.origen,
        c.datos_calendario_completos,
        cl.nombres,
        cl.apellido_paterno,
        cl.apellido_materno,
        concat_ws(' ', cl.nombres, cl.apellido_paterno, cl.apellido_materno) AS cliente_nombre,
        cl.telefono AS cliente_telefono,
        cl.email AS cliente_email,
        pe.folio AS pedido_folio,
        po.id AS pago_id,
        po.monto AS monto_pago,
        po.metodo,
        po.referencia_externa,
        po.fecha_pago,
        po.concepto,
        po.estado AS estado_pago,
        po.usuario_id,
        COALESCE(
          NULLIF(trim(concat_ws(' ', u.nombres, u.apellido_paterno, u.apellido_materno)), ''),
          u.email,
          'N/A'
        ) AS usuario_nombre,
        round(c.saldo_pendiente + COALESCE(ord.pagado_despues, 0) + po.monto, 2)::numeric(12,2) AS saldo_antes_pago,
        round(c.saldo_pendiente + COALESCE(ord.pagado_despues, 0), 2)::numeric(12,2) AS saldo_despues_pago,
        COALESCE(a.items, '[]'::jsonb) AS aplicaciones
      FROM pago_objetivo po
      JOIN clientes.creditos c ON c.id = po.credito_id
      JOIN clientes.clientes cl ON cl.id = c.cliente_id
      LEFT JOIN ventas.pedidos pe ON pe.id = c.pedido_id
      LEFT JOIN seguridad.usuarios u ON u.id = po.usuario_id
      LEFT JOIN pagos_ordenados ord ON ord.id = po.id
      LEFT JOIN aplicaciones a ON a.pago_id = po.id
    `,
    [creditoId, pagoId],
  );

  return rows[0] || null;
}
