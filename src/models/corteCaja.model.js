function toMoney(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(2));
}

function corteError(message, code = "NOT_FOUND") {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function obtenerCorteBaseActual(client, usuarioId) {
  const { rows } = await client.query(
    `
      SELECT
        c.*,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', u.nombres, u.apellido_paterno, u.apellido_materno)), ''),
          u.email,
          'Usuario'
        ) AS usuario_nombre
      FROM ventas.corte_caja c
      LEFT JOIN seguridad.usuarios u ON u.id = c.usuario_id
      WHERE c.usuario_id = $1
        AND c.fin_turno IS NULL
      ORDER BY c.inicio_turno DESC
      LIMIT 1
    `,
    [usuarioId],
  );

  return rows[0] || null;
}

async function obtenerCorteBasePorId(client, corteId) {
  const { rows } = await client.query(
    `
      SELECT
        c.*,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', u.nombres, u.apellido_paterno, u.apellido_materno)), ''),
          u.email,
          'Usuario'
        ) AS usuario_nombre
      FROM ventas.corte_caja c
      LEFT JOIN seguridad.usuarios u ON u.id = c.usuario_id
      WHERE c.id = $1
      LIMIT 1
    `,
    [corteId],
  );

  return rows[0] || null;
}

async function obtenerMetodosCobrados(
  client,
  { usuarioId, inicioTurno, finTurno = null },
) {
  const { rows } = await client.query(
    `
      WITH pagos_turno AS (
        SELECT
          pg.metodo::text AS codigo,
          COALESCE(SUM(
            CASE
              WHEN pg.concepto::text LIKE 'REEMBOLSO%' THEN -ABS(pg.monto)
              ELSE pg.monto
            END
          ), 0)::numeric(12,2) AS total,
          COUNT(*)::integer AS operaciones
        FROM ventas.pagos pg
        LEFT JOIN ventas.pedidos pe ON pe.id = pg.pedido_id
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
      )
      SELECT
        COALESCE(m.codigo, p.codigo) AS codigo,
        COALESCE(m.nombre, INITCAP(REPLACE(p.codigo, '_', ' '))) AS nombre,
        COALESCE(p.total, 0)::numeric(12,2) AS total,
        COALESCE(p.operaciones, 0)::integer AS operaciones,
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
      WHERE COALESCE(m.codigo, p.codigo) <> 'CREDITO_TIENDA'
        AND COALESCE(m.es_credito, false) = false
        AND (
          COALESCE(m.activo_pos, false) = true
          OR COALESCE(p.total, 0) <> 0
        )
      ORDER BY COALESCE(m.orden, 999), COALESCE(m.nombre, p.codigo)
    `,
    [usuarioId, inicioTurno, finTurno],
  );

  const metodos = rows.map((row) => ({
    codigo: row.codigo,
    nombre: row.nombre,
    total: toMoney(row.total),
    operaciones: Number(row.operaciones ?? 0),
    afecta_caja: row.afecta_caja === true,
    permite_cambio: row.permite_cambio === true,
    es_credito: false,
    activo_pos: row.activo_pos === true,
  }));

  const totalCaja = toMoney(
    metodos
      .filter((metodo) => metodo.afecta_caja)
      .reduce((sum, metodo) => sum + metodo.total, 0),
  );

  const totalPagos = toMoney(
    metodos.reduce((sum, metodo) => sum + metodo.total, 0),
  );

  return { metodos, totalCaja, totalPagos };
}

async function obtenerConceptosCobrados(
  client,
  { usuarioId, inicioTurno, finTurno = null },
) {
  const { rows } = await client.query(
    `
      SELECT
        pg.concepto::text AS codigo,
        CASE pg.concepto::text
          WHEN 'PAGO_TOTAL' THEN 'Ventas cobradas'
          WHEN 'ANTICIPO' THEN 'Anticipos de apartados'
          WHEN 'ABONO' THEN 'Abonos de apartados'
          WHEN 'LIQUIDACION' THEN 'Liquidaciones de apartados'
          WHEN 'ENGANCHE_CREDITO' THEN 'Enganches de credito'
          WHEN 'ABONO_CREDITO' THEN 'Abonos de credito'
          WHEN 'LIQUIDACION_CREDITO' THEN 'Liquidaciones de credito'
          WHEN 'REEMBOLSO' THEN 'Reembolsos'
          ELSE INITCAP(REPLACE(pg.concepto::text, '_', ' '))
        END AS nombre,
        COUNT(*)::integer AS operaciones,
        COALESCE(SUM(
          CASE
            WHEN pg.concepto::text LIKE 'REEMBOLSO%' THEN -ABS(pg.monto)
            ELSE pg.monto
          END
        ), 0)::numeric(12,2) AS total
      FROM ventas.pagos pg
      LEFT JOIN ventas.pedidos pe ON pe.id = pg.pedido_id
      LEFT JOIN configuracion.metodos_pago mp ON mp.codigo = pg.metodo
      WHERE pg.estado = 'CONFIRMADO'
        AND COALESCE(pg.usuario_id, pe.vendedor_id) = $1
        AND pg.fecha_pago >= $2
        AND ($3::timestamptz IS NULL OR pg.fecha_pago <= $3)
        AND pg.metodo::text <> 'CREDITO_TIENDA'
        AND COALESCE(mp.es_credito, false) = false
      GROUP BY pg.concepto::text
      ORDER BY
        CASE pg.concepto::text
          WHEN 'PAGO_TOTAL' THEN 1
          WHEN 'ANTICIPO' THEN 2
          WHEN 'ABONO' THEN 3
          WHEN 'LIQUIDACION' THEN 4
          WHEN 'ENGANCHE_CREDITO' THEN 5
          WHEN 'ABONO_CREDITO' THEN 6
          WHEN 'LIQUIDACION_CREDITO' THEN 7
          WHEN 'REEMBOLSO' THEN 8
          ELSE 99
        END
    `,
    [usuarioId, inicioTurno, finTurno],
  );

  return rows.map((row) => ({
    codigo: row.codigo,
    nombre: row.nombre,
    operaciones: Number(row.operaciones ?? 0),
    total: toMoney(row.total),
  }));
}

async function obtenerFinanciamientoTurno(
  client,
  { usuarioId, inicioTurno, finTurno = null },
) {
  const { rows } = await client.query(
    `
      SELECT
        COUNT(*)::integer AS ventas_credito,
        COALESCE(SUM(c.monto_compra), 0)::numeric(12,2) AS monto_ventas_credito,
        COALESCE(SUM(c.enganche), 0)::numeric(12,2) AS enganches_pactados,
        COALESCE(SUM(c.monto_financiado), 0)::numeric(12,2) AS monto_financiado
      FROM clientes.creditos c
      JOIN ventas.pedidos pe ON pe.id = c.pedido_id
      WHERE COALESCE(c.creado_por, pe.vendedor_id) = $1
        AND c.created_at >= $2
        AND ($3::timestamptz IS NULL OR c.created_at <= $3)
        AND c.origen = 'POS'
        AND c.estado <> 'CANCELADO'
    `,
    [usuarioId, inicioTurno, finTurno],
  );

  const row = rows[0] || {};

  return {
    ventas_credito: Number(row.ventas_credito ?? 0),
    monto_ventas_credito: toMoney(row.monto_ventas_credito),
    enganches_pactados: toMoney(row.enganches_pactados),
    monto_financiado: toMoney(row.monto_financiado),
  };
}

function construirCobranzaCredito(conceptos) {
  const porCodigo = new Map(conceptos.map((item) => [item.codigo, item]));

  const enganches = porCodigo.get('ENGANCHE_CREDITO') || {
    total: 0,
    operaciones: 0,
  };
  const abonos = porCodigo.get('ABONO_CREDITO') || {
    total: 0,
    operaciones: 0,
  };
  const liquidaciones = porCodigo.get('LIQUIDACION_CREDITO') || {
    total: 0,
    operaciones: 0,
  };

  return {
    enganches: toMoney(enganches.total),
    operaciones_enganches: Number(enganches.operaciones ?? 0),
    abonos: toMoney(abonos.total),
    operaciones_abonos: Number(abonos.operaciones ?? 0),
    liquidaciones: toMoney(liquidaciones.total),
    operaciones_liquidaciones: Number(liquidaciones.operaciones ?? 0),
    total: toMoney(enganches.total + abonos.total + liquidaciones.total),
  };
}

async function enriquecerCorte(client, corte) {
  const args = {
    usuarioId: corte.usuario_id,
    inicioTurno: corte.inicio_turno,
    finTurno: corte.fin_turno || null,
  };

  const [metodos, conceptos, financiamiento] = await Promise.all([
    obtenerMetodosCobrados(client, args),
    obtenerConceptosCobrados(client, args),
    obtenerFinanciamientoTurno(client, args),
  ]);

  const cobranzaCreditos = construirCobranzaCredito(conceptos);
  const fondoInicial = toMoney(corte.fondo_inicial);
  const efectivoEsperado = toMoney(fondoInicial + metodos.totalCaja);

  const totalTarjeta = toMoney(
    metodos.metodos
      .filter((metodo) => String(metodo.codigo).includes('TARJETA'))
      .reduce((sum, metodo) => sum + metodo.total, 0),
  );

  const totalTransferencia = toMoney(
    metodos.metodos.find((metodo) => metodo.codigo === 'TRANSFERENCIA')?.total,
  );

  return {
    ...corte,
    desglose_metodos: metodos.metodos,
    desglose_conceptos: conceptos,
    cobranza_creditos: cobranzaCreditos,
    financiamiento_creditos: financiamiento,
    totales_metodos: {
      total_caja: metodos.totalCaja,
      total_pagos: metodos.totalPagos,
      efectivo_esperado: efectivoEsperado,
    },
    resumen: {
      fondo_inicial: fondoInicial,
      total_efectivo: metodos.totalCaja,
      total_tarjeta: totalTarjeta,
      total_transferencia: totalTransferencia,
      total_pagos: metodos.totalPagos,
      efectivo_esperado: efectivoEsperado,
    },
  };
}

export async function obtenerCorteActualDetallado(db, usuarioId) {
  const client = await db.connect();

  try {
    const corte = await obtenerCorteBaseActual(client, usuarioId);
    if (!corte) return null;
    return enriquecerCorte(client, corte);
  } finally {
    client.release();
  }
}

export async function obtenerCorteDetalladoPorId(db, corteId, usuario) {
  const client = await db.connect();

  try {
    const corte = await obtenerCorteBasePorId(client, corteId);
    if (!corte) throw corteError('Corte no encontrado');

    if (usuario?.rol !== 'ADMIN' && String(corte.usuario_id) !== String(usuario?.id)) {
      throw corteError('No tienes permiso para consultar este corte', 'FORBIDDEN');
    }

    return enriquecerCorte(client, corte);
  } finally {
    client.release();
  }
}
