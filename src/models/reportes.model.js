// src/models/reportes.model.js

function toDateOrNull(value) {
  if (!value) return null;
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function toUuidOrNull(value) {
  if (!value) return null;
  const s = String(value).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  )
    ? s
    : null;
}

function toTextOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

export function normalizeReportFilters(query = {}) {
  const today = new Date();
  const to = toDateOrNull(query.to) || today.toISOString().slice(0, 10);

  const fromDate = new Date(to + "T00:00:00");
  fromDate.setDate(fromDate.getDate() - 29);
  const from = toDateOrNull(query.from) || fromDate.toISOString().slice(0, 10);

  const groupByRaw = String(query.groupBy || "day").toLowerCase();
  const groupBy = ["day", "week", "month"].includes(groupByRaw)
    ? groupByRaw
    : "day";

  const limit = Math.min(Math.max(toIntOrNull(query.limit) || 20, 1), 200);
  const offset = Math.max(toIntOrNull(query.offset) || 0, 0);

  return {
    from,
    to,
    groupBy,
    limit,
    offset,
    vendedorId: toUuidOrNull(query.vendedorId || query.vendedor_id),
    categoriaId: toIntOrNull(query.categoriaId || query.categoria_id),
    proveedorId: toIntOrNull(query.proveedorId || query.proveedor_id),
    tipo: toTextOrNull(query.tipo)?.toUpperCase() || null,
    estado: toTextOrNull(query.estado)?.toUpperCase() || null,
    metodo: toTextOrNull(query.metodo)?.toUpperCase() || null,
  };
}

async function one(db, sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

async function many(db, sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}

export async function getResumenGeneral(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_resumen_general($1::date, $2::date)`,
    [filters.from, filters.to],
  );
}

export async function getResumenVentas(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_resumen_ventas($1::date, $2::date, $3::uuid, $4::text, $5::text, $6::text)`,
    [
      filters.from,
      filters.to,
      filters.vendedorId,
      filters.tipo,
      filters.estado,
      filters.metodo,
    ],
  );
}

export async function getTendenciaVentas(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_tendencia_ventas($1::date, $2::date, $3::text, $4::uuid, $5::text, $6::text)`,
    [
      filters.from,
      filters.to,
      filters.groupBy,
      filters.vendedorId,
      filters.tipo,
      filters.metodo,
    ],
  );
}

export async function getVentasPorMetodoPago(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_ventas_por_metodo_pago($1::date, $2::date, $3::uuid, $4::text, $5::text)`,
    [
      filters.from,
      filters.to,
      filters.vendedorId,
      filters.tipo,
      filters.estado,
    ],
  );
}

export async function getVentasPorEmpleado(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_ventas_por_empleado($1::date, $2::date, $3::text, $4::text)`,
    [filters.from, filters.to, filters.tipo, filters.metodo],
  );
}

export async function getProductosMasVendidos(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_productos_mas_vendidos($1::date, $2::date, $3::int, $4::int, $5::int)`,
    [
      filters.from,
      filters.to,
      filters.limit,
      filters.categoriaId,
      filters.proveedorId,
    ],
  );
}

export async function getProductosMenosVendidos(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_productos_menos_vendidos($1::date, $2::date, $3::int, $4::int, $5::int)`,
    [
      filters.from,
      filters.to,
      filters.limit,
      filters.categoriaId,
      filters.proveedorId,
    ],
  );
}

export async function getProductosSinVentas(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_productos_sin_ventas($1::date, $2::date, $3::int, $4::int, $5::int)`,
    [
      filters.from,
      filters.to,
      filters.limit,
      filters.categoriaId,
      filters.proveedorId,
    ],
  );
}

export async function getResumenInventario(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_resumen_inventario($1::int, $2::int)`,
    [filters.categoriaId, filters.proveedorId],
  );
}

export async function getInventarioCritico(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_inventario_critico($1::int, $2::int, $3::int)`,
    [filters.limit, filters.categoriaId, filters.proveedorId],
  );
}

export async function getMovimientosInventarioResumen(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_movimientos_inventario_resumen($1::date, $2::date)`,
    [filters.from, filters.to],
  );
}

export async function getResumenClientes(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_resumen_clientes($1::date, $2::date)`,
    [filters.from, filters.to],
  );
}

export async function getClientesNuevosTendencia(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_clientes_nuevos_tendencia($1::date, $2::date, $3::text)`,
    [filters.from, filters.to, filters.groupBy],
  );
}

export async function getClientesFrecuentes(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_clientes_frecuentes($1::date, $2::date, $3::int)`,
    [filters.from, filters.to, filters.limit],
  );
}

export async function getResumenCredito(db) {
  return one(db, `SELECT * FROM reportes.fn_resumen_credito()`);
}

export async function getCuentasPorCobrar(db, filters) {
  return many(db, `SELECT * FROM reportes.fn_cuentas_por_cobrar($1::int)`, [
    filters.limit,
  ]);
}

export async function getResumenApartados(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_resumen_apartados($1::date, $2::date)`,
    [filters.from, filters.to],
  );
}

export async function getApartadosDetalle(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_apartados_detalle($1::date, $2::date, $3::text, $4::int, $5::int)`,
    [filters.from, filters.to, filters.estado, filters.limit, filters.offset],
  );
}

export async function getResumenFinanciero(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_resumen_financiero($1::date, $2::date)`,
    [filters.from, filters.to],
  );
}

export async function getFinancieroPorMetodoPago(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_financiero_por_metodo_pago($1::date, $2::date)`,
    [filters.from, filters.to],
  );
}

export async function getResumenCortesCaja(db, filters) {
  return one(
    db,
    `SELECT * FROM reportes.fn_resumen_cortes_caja($1::date, $2::date)`,
    [filters.from, filters.to],
  );
}

export async function getCortesCajaDetalle(db, filters) {
  return many(
    db,
    `SELECT * FROM reportes.fn_cortes_caja_detalle($1::date, $2::date, $3::int, $4::int)`,
    [filters.from, filters.to, filters.limit, filters.offset],
  );
}

export async function listExportaciones(db, { limit = 50, offset = 0 } = {}) {
  return many(
    db,
    `
      SELECT
        e.id,
        e.tipo_reporte,
        e.formato,
        e.filtros,
        e.usuario_id,
        COALESCE(CONCAT_WS(' ', u.nombres, u.apellido_paterno, u.apellido_materno), u.email, 'Sistema') AS usuario_nombre,
        e.archivo_nombre,
        e.mime_type,
        e.total_registros,
        e.estado,
        e.error_message,
        e.metadata,
        e.created_at
      FROM reportes.exportaciones e
      LEFT JOIN seguridad.usuarios u ON u.id = e.usuario_id
      ORDER BY e.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
}

export async function registrarExportacion(db, payload) {
  return one(
    db,
    `
      SELECT *
      FROM reportes.fn_registrar_exportacion(
        $1::text,
        $2::text,
        $3::jsonb,
        $4::uuid,
        $5::text,
        $6::text,
        $7::int,
        $8::text,
        $9::text,
        $10::jsonb
      )
    `,
    [
      payload.tipoReporte,
      payload.formato,
      JSON.stringify(payload.filtros || {}),
      payload.usuarioId || null,
      payload.archivoNombre || null,
      payload.mimeType || null,
      payload.totalRegistros ?? null,
      payload.estado || "GENERADO",
      payload.errorMessage || null,
      JSON.stringify(payload.metadata || {}),
    ],
  );
}