// src/controllers/reportesExport.controller.js
import {
  normalizeReportFilters,
  registrarExportacion,
  getResumenVentas,
  getTendenciaVentas,
  getVentasPorMetodoPago,
  getVentasPorEmpleado,
  getProductosMasVendidos,
  getProductosMenosVendidos,
  getProductosSinVentas,
  getResumenInventario,
  getInventarioCritico,
  getMovimientosInventarioResumen,
  getResumenClientes,
  getClientesNuevosTendencia,
  getClientesFrecuentes,
  getResumenCredito,
  getCuentasPorCobrar,
  getResumenApartados,
  getApartadosDetalle,
  getResumenFinanciero,
  getFinancieroPorMetodoPago,
  getResumenCortesCaja,
  getCortesCajaDetalle,
} from "../models/reportes.model.js";
import { generarReporteExcelBuffer } from "../utils/export/reportesExcel.js";
import { generarReportePdfBuffer } from "../utils/pdf/reportesPdf.js";

const REPORTES_VALIDOS = new Set([
  "ventas",
  "productos",
  "inventario",
  "clientes",
  "credito",
  "apartados",
  "financiero",
  "cortes",
]);

const PERMISOS_POR_REPORTE = {
  ventas: "reportes.ventas.view",
  productos: "reportes.productos.view",
  inventario: "reportes.inventario.view",
  clientes: "reportes.clientes.view",
  credito: "reportes.credito.view",
  apartados: "reportes.apartados.view",
  financiero: "reportes.financiero.view",
  cortes: "reportes.cortes.view",
};

const TITULOS = {
  ventas: "Reporte de ventas",
  productos: "Reporte de productos",
  inventario: "Reporte de inventario",
  clientes: "Reporte de clientes",
  credito: "Reporte de crédito y cuentas por cobrar",
  apartados: "Reporte de apartados",
  financiero: "Reporte financiero",
  cortes: "Reporte de cortes de caja",
};

const CAMPOS_COSTOS = new Set([
  "precio_costo",
  "valor_costo",
  "valor_inventario",
  "costo_total",
  "costo_total_estimado",
  "costo_unitario_actual",
  "costo_unitario_historico",
  "costo_unitario_reporte",
  "fuente_costo",
]);

const CAMPOS_GANANCIAS = new Set([
  "utilidad",
  "utilidad_estimada",
  "margen_porcentaje",
  "margen_estimado_porcentaje",
  "margen_potencial",
]);

function hasPermission(req, permiso) {
  return Array.isArray(req.user?.permisos) && req.user.permisos.includes(permiso);
}

function getUserId(req) {
  return req.user?.id || req.user?.userId || req.user?.sub || null;
}

function normalizeExportFilters(query) {
  const filters = normalizeReportFilters(query);
  const rawLimit = Number(query.limit ?? 5000);

  filters.limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 5000)
    : 5000;

  filters.offset = 0;
  return filters;
}

function sanitizeReporte(value) {
  const reporte = String(value || "").trim().toLowerCase();
  return REPORTES_VALIDOS.has(reporte) ? reporte : null;
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildFileName(reporte, filters, extension) {
  const name = sanitizeFilenamePart(reporte);
  return `reporte-${name}-${filters.from}-${filters.to}.${extension}`;
}

function redactRow(row, req) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;

  const canSeeCosts = hasPermission(req, "reportes.costos.view");
  const canSeeProfit = hasPermission(req, "reportes.ganancias.view");
  const clean = { ...row };

  for (const key of Object.keys(clean)) {
    if (!canSeeCosts && CAMPOS_COSTOS.has(key)) {
      delete clean[key];
    }

    if (!canSeeProfit && CAMPOS_GANANCIAS.has(key)) {
      delete clean[key];
    }
  }

  return clean;
}

function redactRows(rowsOrRow, req) {
  if (Array.isArray(rowsOrRow)) return rowsOrRow.map((row) => redactRow(row, req));
  return redactRow(rowsOrRow, req);
}

function redactSections(secciones, req) {
  return secciones.map((section) => ({
    ...section,
    rows: redactRows(section.rows, req),
  }));
}

async function getExportData(db, reporte, filters) {
  if (reporte === "ventas") {
    const [resumen, tendencia, metodosPago, empleados] = await Promise.all([
      getResumenVentas(db, filters),
      getTendenciaVentas(db, filters),
      getVentasPorMetodoPago(db, filters),
      getVentasPorEmpleado(db, filters),
    ]);

    return {
      titulo: TITULOS.ventas,
      secciones: [
        { title: "Resumen ventas", rows: resumen },
        { title: "Tendencia", rows: tendencia },
        { title: "Métodos de pago", rows: metodosPago },
        { title: "Ventas por empleado", rows: empleados },
      ],
    };
  }

  if (reporte === "productos") {
    const [masVendidos, menosVendidos, sinVentas] = await Promise.all([
      getProductosMasVendidos(db, filters),
      getProductosMenosVendidos(db, filters),
      getProductosSinVentas(db, filters),
    ]);

    return {
      titulo: TITULOS.productos,
      secciones: [
        { title: "Más vendidos", rows: masVendidos },
        { title: "Menos vendidos", rows: menosVendidos },
        { title: "Sin ventas", rows: sinVentas },
      ],
    };
  }

  if (reporte === "inventario") {
    const [resumen, critico, movimientos] = await Promise.all([
      getResumenInventario(db, filters),
      getInventarioCritico(db, filters),
      getMovimientosInventarioResumen(db, filters),
    ]);

    return {
      titulo: TITULOS.inventario,
      secciones: [
        { title: "Resumen inventario", rows: resumen },
        { title: "Inventario crítico", rows: critico },
        { title: "Movimientos", rows: movimientos },
      ],
    };
  }

  if (reporte === "clientes") {
    const [resumen, tendencia, frecuentes] = await Promise.all([
      getResumenClientes(db, filters),
      getClientesNuevosTendencia(db, filters),
      getClientesFrecuentes(db, filters),
    ]);

    return {
      titulo: TITULOS.clientes,
      secciones: [
        { title: "Resumen clientes", rows: resumen },
        { title: "Clientes nuevos", rows: tendencia },
        { title: "Clientes frecuentes", rows: frecuentes },
      ],
    };
  }

  if (reporte === "credito") {
    const [resumen, cuentasCobrar] = await Promise.all([
      getResumenCredito(db, filters),
      getCuentasPorCobrar(db, filters),
    ]);

    return {
      titulo: TITULOS.credito,
      secciones: [
        { title: "Resumen crédito", rows: resumen },
        { title: "Cuentas por cobrar", rows: cuentasCobrar },
      ],
    };
  }

  if (reporte === "apartados") {
    const [resumen, detalle] = await Promise.all([
      getResumenApartados(db, filters),
      getApartadosDetalle(db, filters),
    ]);

    return {
      titulo: TITULOS.apartados,
      secciones: [
        { title: "Resumen apartados", rows: resumen },
        { title: "Detalle apartados", rows: detalle },
      ],
    };
  }

  if (reporte === "financiero") {
    const [resumen, metodosPago] = await Promise.all([
      getResumenFinanciero(db, filters),
      getFinancieroPorMetodoPago(db, filters),
    ]);

    return {
      titulo: TITULOS.financiero,
      secciones: [
        { title: "Resumen financiero", rows: resumen },
        { title: "Métodos de pago", rows: metodosPago },
      ],
    };
  }

  const [resumen, detalle] = await Promise.all([
    getResumenCortesCaja(db, filters),
    getCortesCajaDetalle(db, filters),
  ]);

  return {
    titulo: TITULOS.cortes,
    secciones: [
      { title: "Resumen cortes", rows: resumen },
      { title: "Detalle cortes", rows: detalle },
    ],
  };
}

async function safeRegistrarExportacion(db, payload) {
  try {
    await registrarExportacion(db, payload);
  } catch (err) {
    console.warn("No se pudo registrar exportación:", err.message);
  }
}

export async function exportReporteExcel(req, res) {
  const reporte = sanitizeReporte(req.query.reporte);

  if (!reporte) {
    return res.status(400).json({
      ok: false,
      msg: "Reporte inválido",
    });
  }

  const permisoReporte = PERMISOS_POR_REPORTE[reporte];

  if (permisoReporte && !hasPermission(req, permisoReporte)) {
    return res.status(403).json({
      ok: false,
      msg: "No tienes permiso para exportar este reporte",
    });
  }

  const filters = normalizeExportFilters(req.query);
  const archivoNombre = buildFileName(reporte, filters, "xlsx");

  try {
    const exportData = await getExportData(req.db, reporte, filters);
    const secciones = redactSections(exportData.secciones, req);

    const { buffer, totalRegistros } = await generarReporteExcelBuffer({
      reporte,
      titulo: exportData.titulo,
      filters,
      secciones,
    });

    await safeRegistrarExportacion(req.db, {
      tipoReporte: reporte,
      formato: "EXCEL",
      filtros: filters,
      usuarioId: getUserId(req),
      archivoNombre,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      totalRegistros,
      estado: "GENERADO",
      metadata: {
        secciones: secciones.map((section) => section.title),
      },
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename=\"${archivoNombre}\"`);
    res.setHeader("Content-Length", buffer.length);

    return res.status(200).send(buffer);
  } catch (err) {
    console.error("exportReporteExcel error:", err);

    await safeRegistrarExportacion(req.db, {
      tipoReporte: reporte,
      formato: "EXCEL",
      filtros: filters,
      usuarioId: getUserId(req),
      archivoNombre,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      totalRegistros: 0,
      estado: "ERROR",
      errorMessage: err.message,
    });

    return res.status(500).json({
      ok: false,
      msg: "Error exportando reporte a Excel",
      detail: err.message,
    });
  }
}


export async function exportReportePdf(req, res) {
  const reporte = sanitizeReporte(req.query.reporte);

  if (!reporte) {
    return res.status(400).json({
      ok: false,
      msg: "Reporte inválido",
    });
  }

  const permisoReporte = PERMISOS_POR_REPORTE[reporte];

  if (permisoReporte && !hasPermission(req, permisoReporte)) {
    return res.status(403).json({
      ok: false,
      msg: "No tienes permiso para exportar este reporte",
    });
  }

  const filters = normalizeExportFilters(req.query);
  const archivoNombre = buildFileName(reporte, filters, "pdf");

  try {
    const exportData = await getExportData(req.db, reporte, filters);
    const secciones = redactSections(exportData.secciones, req);

    const { buffer, totalRegistros } = await generarReportePdfBuffer({
      reporte,
      titulo: exportData.titulo,
      filters,
      secciones,
    });

    await safeRegistrarExportacion(req.db, {
      tipoReporte: reporte,
      formato: "PDF",
      filtros: filters,
      usuarioId: getUserId(req),
      archivoNombre,
      mimeType: "application/pdf",
      totalRegistros,
      estado: "GENERADO",
      metadata: {
        secciones: secciones.map((section) => section.title),
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${archivoNombre}\"`);
    res.setHeader("Content-Length", buffer.length);

    return res.status(200).send(buffer);
  } catch (err) {
    console.error("exportReportePdf error:", err);

    await safeRegistrarExportacion(req.db, {
      tipoReporte: reporte,
      formato: "PDF",
      filtros: filters,
      usuarioId: getUserId(req),
      archivoNombre,
      mimeType: "application/pdf",
      totalRegistros: 0,
      estado: "ERROR",
      errorMessage: err.message,
    });

    return res.status(500).json({
      ok: false,
      msg: "Error exportando reporte a PDF",
      detail: err.message,
    });
  }
}
