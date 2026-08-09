async function runWithConcurrency(tasks, limit = 3) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= tasks.length) {
        return;
      }

      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    worker(),
  );

  await Promise.all(workers);

  return results;
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function normalizeResumen(row = {}) {
  const ingresosPeriodo = toNumber(row.ingresos_periodo);
  const ventasPeriodo = toNumber(row.ventas_periodo);
  const ticketPromedioPeriodo = toNumber(row.ticket_promedio_periodo);

  return {
    ingresosHoy: ingresosPeriodo,
    ventasHoy: ventasPeriodo,
    ticketPromedioHoy: ticketPromedioPeriodo,

    ingresosPeriodo,
    ventasPeriodo,
    ticketPromedioPeriodo,
    pagosPeriodo: toNumber(row.pagos_periodo),

    apartadosActivos: toNumber(row.apartados_activos),
    apartadosPorVencer: toNumber(row.apartados_por_vencer),
    apartadosVencidos: toNumber(row.apartados_vencidos),

    productosBajoStock: toNumber(row.productos_bajo_stock),
    variantesBajoStock: toNumber(row.variantes_bajo_stock),
    variantesSinStock: toNumber(row.variantes_sin_stock),

    productosActivos: toNumber(row.productos_activos),
    clientesTotales: toNumber(row.clientes_totales),

    cajasAbiertas: toNumber(row.cajas_abiertas),
    ultimoCorteAt: row.ultimo_corte_at ?? null,
  };
}

function normalizeVentaDia(row) {
  return {
    fecha: row.fecha,
    totalIngresos: toNumber(row.total_ingresos),
    pedidosPagados: toNumber(row.pedidos_pagados),
  };
}

function normalizeTopProducto(row) {
  return {
    productoId: row.producto_id,
    nombre: row.nombre,
    imagenPrincipal: row.imagen_principal ?? null,
    unidadesVendidas: toNumber(row.unidades_vendidas),
    totalVendido: toNumber(row.total_vendido),
  };
}

function normalizeActividad(row) {
  return {
    tipo: row.tipo,
    titulo: row.titulo,
    detalle: row.detalle,
    referenciaId: row.referencia_id,
    fecha: row.fecha,
  };
}

function normalizeAlerta(row) {
  return {
    tipo: row.tipo,
    severidad: row.severidad,
    titulo: row.titulo,
    detalle: row.detalle,
    referenciaId: row.referencia_id,
    fecha: row.fecha,
  };
}

function normalizeCajaActual(row) {
  if (!row) {
    return {
      abierta: false,
      corteId: null,
      usuarioId: null,
      usuarioNombre: null,
      inicioTurno: null,
      fondoInicial: 0,
      totalSistema: 0,
      totalEfectivo: 0,
      totalTarjeta: 0,
      totalTransferencia: 0,
      ventasTurno: 0,
      ultimoMovimientoAt: null,
    };
  }

  return {
    abierta: !!row.abierta,
    corteId: row.corte_id ?? null,
    usuarioId: row.usuario_id ?? null,
    usuarioNombre: row.usuario_nombre ?? null,
    inicioTurno: row.inicio_turno ?? null,
    fondoInicial: toNumber(row.fondo_inicial),

    totalSistema: toNumber(row.total_sistema_actual),
    totalEfectivo: toNumber(row.total_efectivo),
    totalTarjeta: toNumber(row.total_tarjeta),
    totalTransferencia: toNumber(row.total_transferencia),

    ventasTurno: toNumber(row.ventas_turno),
    ultimoMovimientoAt: row.ultimo_movimiento_at ?? null,
  };
}

function normalizeProductoCritico(row) {
  return {
    tipo: row.tipo,
    severidad: row.severidad,
    productoId: row.producto_id,
    varianteId: row.variante_id ?? null,
    nombre: row.nombre,
    detalle: row.detalle,
    stockDisponible:
      row.stock_disponible === null || row.stock_disponible === undefined
        ? null
        : toNumber(row.stock_disponible),
    fecha: row.fecha ?? null,
    prioridad: toNumber(row.prioridad),
  };
}

export async function getDashboardData(db, options = {}) {
  const {
    range = "7d",
    fromDate,
    toDate,
    topLimit = 5,
    actividadLimit = 5,
    alertasLimit = 3,
    productosCriticosLimit = 8,
  } = options;

  if (!fromDate || !toDate) {
    const err = new Error(
      "fromDate y toDate son requeridos para consultar el dashboard.",
    );
    err.code = "VALIDATION";
    throw err;
  }

  const [
    resumenRes,
    ventasRes,
    topRes,
    actividadRes,
    alertasRes,
    cajaActualRes,
    productosCriticosRes,
  ] = await runWithConcurrency(
    [
      () =>
        db.query(
          `
            SELECT *
            FROM dashboard.fn_resumen_admin($1::date, $2::date)
          `,
          [fromDate, toDate],
        ),

      () =>
        db.query(
          `
            SELECT *
            FROM dashboard.fn_ventas_por_dia($1::date, $2::date)
          `,
          [fromDate, toDate],
        ),

      () =>
        db.query(
          `
            SELECT *
            FROM dashboard.fn_top_productos(
              $1::date,
              $2::date,
              $3::int
            )
          `,
          [fromDate, toDate, topLimit],
        ),

      () =>
        db.query(
          `
            SELECT *
            FROM dashboard.fn_actividad_reciente(
              $1::date,
              $2::date,
              $3::int
            )
          `,
          [fromDate, toDate, actividadLimit],
        ),

      () =>
        db.query(
          `
            SELECT *
            FROM dashboard.fn_alertas_operativas($1::int)
          `,
          [alertasLimit],
        ),

      () =>
        db.query(
          `
            SELECT *
            FROM dashboard.v_caja_actual
            LIMIT 1
          `,
        ),

      () =>
        db.query(
          `
            SELECT
              tipo,
              severidad,
              producto_id,
              variante_id,
              nombre,
              detalle,
              stock_disponible,
              fecha,
              prioridad
            FROM dashboard.v_productos_criticos
            ORDER BY
              prioridad ASC,
              fecha DESC NULLS LAST
            LIMIT $1
          `,
          [productosCriticosLimit],
        ),
    ],
    3,
  );

  return {
    range: {
      key: range,
      from: fromDate,
      to: toDate,
    },
    resumen: normalizeResumen(resumenRes.rows[0]),
    cajaActual: normalizeCajaActual(cajaActualRes.rows[0]),
    ventasUltimos7Dias: ventasRes.rows.map(normalizeVentaDia),
    topProductos: topRes.rows.map(normalizeTopProducto),
    actividadReciente: actividadRes.rows.map(normalizeActividad),
    alertasOperativas: alertasRes.rows.map(normalizeAlerta),
    productosCriticos: productosCriticosRes.rows.map(normalizeProductoCritico),
  };
}
