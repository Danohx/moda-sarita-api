import { actualizarEstadosVencidos } from "./credito.model.js";

function normalizeDate(value, fallback) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function safeLimit(value, fallback = 100, max = 500) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function todayYmd() {
  const timezone =
    process.env.CREDIT_OVERDUE_TIMEZONE || "America/Mexico_City";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function monthStartYmd() {
  return `${todayYmd().slice(0, 8)}01`;
}

export function normalizarFiltrosReporteCredito(filters = {}) {
  return {
    from: normalizeDate(filters.from, monthStartYmd()),
    to: normalizeDate(filters.to, todayYmd()),
    limit: safeLimit(filters.limit),
  };
}

export async function obtenerReporteCreditoOperativo(db, rawFilters = {}) {
  const filters = normalizarFiltrosReporteCredito(rawFilters);

  const [summaryResult, accountsResult] = await Promise.all([
    db.query(
      `
        WITH credit_stats AS (
          SELECT
            COUNT(*) FILTER (WHERE c.estado = 'ACTIVO')::integer AS creditos_activos,
            COUNT(*) FILTER (WHERE c.estado = 'EN_MORA')::integer AS creditos_en_mora,
            COUNT(*) FILTER (WHERE c.estado = 'INCUMPLIDO')::integer AS creditos_incumplidos,
            COUNT(*) FILTER (
              WHERE c.estado = 'LIQUIDADO'
                AND c.fecha_liquidacion >= $1::date
                AND c.fecha_liquidacion < ($2::date + interval '1 day')
            )::integer AS creditos_liquidados_periodo,
            COALESCE(SUM(c.monto_financiado) FILTER (
              WHERE c.fecha_otorgamiento >= $1::date
                AND c.fecha_otorgamiento < ($2::date + interval '1 day')
                AND c.estado <> 'CANCELADO'
            ), 0)::numeric(14,2) AS monto_financiado_periodo,
            COALESCE(SUM(c.saldo_pendiente) FILTER (
              WHERE c.estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
            ), 0)::numeric(14,2) AS saldo_pendiente_total
          FROM clientes.creditos c
        ),
        cobranza AS (
          SELECT
            COALESCE(SUM(
              CASE
                WHEN p.concepto = 'REEMBOLSO_CREDITO' THEN -ABS(p.monto)
                ELSE p.monto
              END
            ), 0)::numeric(14,2) AS cobranza_periodo,
            COALESCE(SUM(p.monto) FILTER (
              WHERE p.concepto = 'ENGANCHE_CREDITO'
            ), 0)::numeric(14,2) AS enganches_periodo,
            COALESCE(SUM(p.monto) FILTER (
              WHERE p.concepto IN ('ABONO_CREDITO', 'LIQUIDACION_CREDITO')
            ), 0)::numeric(14,2) AS abonos_periodo
          FROM ventas.pagos p
          WHERE p.estado = 'CONFIRMADO'
            AND p.concepto IN (
              'ENGANCHE_CREDITO',
              'ABONO_CREDITO',
              'LIQUIDACION_CREDITO',
              'REEMBOLSO_CREDITO'
            )
            AND p.fecha_pago >= $1::date
            AND p.fecha_pago < ($2::date + interval '1 day')
        ),
        vencido AS (
          SELECT COALESCE(SUM(cc.saldo_pendiente), 0)::numeric(14,2) AS total
          FROM clientes.credito_cuotas cc
          JOIN clientes.creditos c ON c.id = cc.credito_id
          WHERE c.datos_calendario_completos = true
            AND c.estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
            AND cc.estado = 'VENCIDA'
            AND cc.saldo_pendiente > 0
        )
        SELECT
          credit_stats.creditos_activos,
          credit_stats.creditos_en_mora,
          credit_stats.creditos_incumplidos,
          credit_stats.creditos_liquidados_periodo,
          credit_stats.monto_financiado_periodo,
          credit_stats.saldo_pendiente_total,
          vencido.total AS saldo_vencido_total,
          cobranza.cobranza_periodo,
          cobranza.enganches_periodo,
          cobranza.abonos_periodo,
          CASE
            WHEN credit_stats.monto_financiado_periodo = 0 THEN 0
            ELSE ROUND(
              cobranza.cobranza_periodo * 100.0 /
              NULLIF(credit_stats.monto_financiado_periodo, 0),
              2
            )
          END::numeric(8,2) AS tasa_recuperacion
        FROM credit_stats
        CROSS JOIN cobranza
        CROSS JOIN vencido
      `,
      [filters.from, filters.to],
    ),
    db.query(
      `
        SELECT *
        FROM clientes.v_creditos_resumen
        WHERE saldo_pendiente > 0
          AND estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
        ORDER BY
          CASE estado
            WHEN 'INCUMPLIDO' THEN 0
            WHEN 'EN_MORA' THEN 1
            ELSE 2
          END,
          total_vencido DESC,
          proximo_vencimiento NULLS LAST,
          fecha_otorgamiento
        LIMIT $1
      `,
      [filters.limit],
    ),
  ]);

  return {
    filtros: filters,
    resumen: summaryResult.rows[0],
    cuentasCobrar: accountsResult.rows,
  };
}

export async function obtenerReporteFinancieroCredito(db, rawFilters = {}) {
  const filters = normalizarFiltrosReporteCredito(rawFilters);

  const { rows } = await db.query(
    `
      WITH ventas_periodo AS (
        SELECT COALESCE(SUM(p.total), 0)::numeric(14,2) AS total
        FROM ventas.pedidos p
        WHERE p.tipo <> 'APARTADO'
          AND p.estado IN ('PAGADO', 'ENVIADO', 'ENTREGADO', 'LIQUIDADO')
          AND p.fecha_creacion >= $1::date
          AND p.fecha_creacion < ($2::date + interval '1 day')
      ),
      cobros_periodo AS (
        SELECT
          COALESCE(SUM(
            CASE
              WHEN pg.concepto IN ('REEMBOLSO', 'REEMBOLSO_CREDITO')
                THEN -ABS(pg.monto)
              ELSE pg.monto
            END
          ), 0)::numeric(14,2) AS dinero_cobrado,
          COALESCE(SUM(pg.monto) FILTER (
            WHERE pg.concepto IN (
              'ENGANCHE_CREDITO',
              'ABONO_CREDITO',
              'LIQUIDACION_CREDITO'
            )
          ), 0)::numeric(14,2) AS cobranza_credito,
          COALESCE(SUM(pg.monto) FILTER (
            WHERE pg.concepto = 'ENGANCHE_CREDITO'
          ), 0)::numeric(14,2) AS enganches_credito,
          COALESCE(SUM(pg.monto) FILTER (
            WHERE pg.concepto IN ('ABONO_CREDITO', 'LIQUIDACION_CREDITO')
          ), 0)::numeric(14,2) AS abonos_credito
        FROM ventas.pagos pg
        WHERE pg.estado = 'CONFIRMADO'
          AND pg.fecha_pago >= $1::date
          AND pg.fecha_pago < ($2::date + interval '1 day')
      ),
      financiado_periodo AS (
        SELECT COALESCE(SUM(c.monto_financiado), 0)::numeric(14,2) AS total
        FROM clientes.creditos c
        WHERE c.estado <> 'CANCELADO'
          AND c.fecha_otorgamiento >= $1::date
          AND c.fecha_otorgamiento < ($2::date + interval '1 day')
      ),
      cartera AS (
        SELECT COALESCE(SUM(c.saldo_pendiente), 0)::numeric(14,2) AS saldo
        FROM clientes.creditos c
        WHERE c.estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
      ),
      vencido AS (
        SELECT COALESCE(SUM(cc.saldo_pendiente), 0)::numeric(14,2) AS saldo
        FROM clientes.credito_cuotas cc
        JOIN clientes.creditos c ON c.id = cc.credito_id
        WHERE c.datos_calendario_completos = true
          AND c.estado IN ('ACTIVO', 'EN_MORA', 'INCUMPLIDO')
          AND cc.estado = 'VENCIDA'
          AND cc.saldo_pendiente > 0
      )
      SELECT
        ventas_periodo.total AS ventas_realizadas,
        cobros_periodo.dinero_cobrado,
        financiado_periodo.total AS monto_financiado,
        cartera.saldo AS saldo_pendiente,
        vencido.saldo AS saldo_vencido,
        cobros_periodo.cobranza_credito,
        cobros_periodo.enganches_credito,
        cobros_periodo.abonos_credito
      FROM ventas_periodo
      CROSS JOIN cobros_periodo
      CROSS JOIN financiado_periodo
      CROSS JOIN cartera
      CROSS JOIN vencido
    `,
    [filters.from, filters.to],
  );

  return { filtros: filters, ...rows[0] };
}

export async function procesarVencimientosConRegistro(
  db,
  {
    fecha = null,
    origen = "MANUAL",
    usuarioId = null,
  } = {},
) {
  const fechaObjetivo = normalizeDate(fecha, todayYmd());

  const insertResult = await db.query(
    `
      INSERT INTO clientes.credito_ejecuciones_vencimiento (
        origen,
        fecha_objetivo,
        iniciado_at,
        exitoso,
        ejecutado_por
      )
      VALUES ($1, $2::date, now(), false, $3)
      RETURNING id
    `,
    [origen, fechaObjetivo, usuarioId],
  );

  const executionId = insertResult.rows[0].id;

  try {
    const resultado = await actualizarEstadosVencidos(db, fechaObjetivo, {
      usuarioId,
    });

    const { rows } = await db.query(
      `
        UPDATE clientes.credito_ejecuciones_vencimiento
        SET
          finalizado_at = now(),
          exitoso = true,
          resultado = $2::jsonb,
          error_message = NULL
        WHERE id = $1
        RETURNING *
      `,
      [executionId, JSON.stringify(resultado || {})],
    );

    return rows[0];
  } catch (error) {
    await db.query(
      `
        UPDATE clientes.credito_ejecuciones_vencimiento
        SET
          finalizado_at = now(),
          exitoso = false,
          error_message = $2
        WHERE id = $1
      `,
      [executionId, String(error?.message || error)],
    );

    throw error;
  }
}

export async function obtenerUltimaEjecucionVencimientos(db) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM clientes.credito_ejecuciones_vencimiento
      ORDER BY iniciado_at DESC, id DESC
      LIMIT 1
    `,
  );

  return rows[0] || null;
}
