// src/controllers/reportes.controller.js
import {
  normalizeReportFilters,
  getResumenGeneral,
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
  listExportaciones,
} from "../models/reportes.model.js";

function hasPermission(req, permiso) {
  return (
    Array.isArray(req.user?.permisos) && req.user.permisos.includes(permiso)
  );
}

function hideFinancialFields(rowsOrRow, req) {
  const canSeeCosts = hasPermission(req, "reportes.costos.view");
  const canSeeProfit = hasPermission(req, "reportes.ganancias.view");

  const redact = (row) => {
    if (!row || typeof row !== "object") return row;
    const copy = { ...row };

    if (!canSeeCosts) {
      delete copy.precio_costo;
      delete copy.valor_costo;
      delete copy.valor_inventario;
      delete copy.costo_total;
      delete copy.costo_total_estimado;
      delete copy.costo_unitario_actual;
      delete copy.costo_unitario_historico;
      delete copy.costo_unitario_reporte;
      delete copy.fuente_costo;
    }

    if (!canSeeProfit) {
      delete copy.utilidad;
      delete copy.utilidad_estimada;
      delete copy.margen_porcentaje;
      delete copy.margen_estimado_porcentaje;
      delete copy.margen_potencial;
      delete copy.diferencia_cortes_total;
    }

    return copy;
  };

  return Array.isArray(rowsOrRow) ? rowsOrRow.map(redact) : redact(rowsOrRow);
}

async function handleReport(req, res, loader, { financial = false } = {}) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const filters = normalizeReportFilters(req.query);
    const data = await loader(req.db, filters, req);

    return res.json({
      ok: true,
      filters,
      data: financial ? hideFinancialFields(data, req) : data,
    });
  } catch (err) {
    console.error("reportes error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error generando reporte",
      detail: err.message,
    });
  }
}

export const getReporteResumen = (req, res) =>
  handleReport(req, res, getResumenGeneral, { financial: true });

export const getReporteVentasResumen = (req, res) =>
  handleReport(req, res, getResumenVentas, { financial: true });

export const getReporteVentasTendencia = (req, res) =>
  handleReport(req, res, getTendenciaVentas);

export const getReporteVentasMetodosPago = (req, res) =>
  handleReport(req, res, getVentasPorMetodoPago);

export const getReporteVentasEmpleados = (req, res) =>
  handleReport(req, res, getVentasPorEmpleado);

export const getReporteProductosMasVendidos = (req, res) =>
  handleReport(req, res, getProductosMasVendidos, { financial: true });

export const getReporteProductosMenosVendidos = (req, res) =>
  handleReport(req, res, getProductosMenosVendidos);

export const getReporteProductosSinVentas = (req, res) =>
  handleReport(req, res, getProductosSinVentas);

export const getReporteInventarioResumen = (req, res) =>
  handleReport(req, res, getResumenInventario, { financial: true });

export const getReporteInventarioCritico = (req, res) =>
  handleReport(req, res, getInventarioCritico, { financial: true });

export const getReporteInventarioMovimientos = (req, res) =>
  handleReport(req, res, getMovimientosInventarioResumen);

export const getReporteClientesResumen = (req, res) =>
  handleReport(req, res, getResumenClientes);

export const getReporteClientesTendencia = (req, res) =>
  handleReport(req, res, getClientesNuevosTendencia);

export const getReporteClientesFrecuentes = (req, res) =>
  handleReport(req, res, getClientesFrecuentes);

export const getReporteCreditoResumen = (req, res) =>
  handleReport(req, res, getResumenCredito);

export const getReporteCuentasPorCobrar = (req, res) =>
  handleReport(req, res, getCuentasPorCobrar);

export const getReporteApartadosResumen = (req, res) =>
  handleReport(req, res, getResumenApartados);

export const getReporteApartadosDetalle = (req, res) =>
  handleReport(req, res, getApartadosDetalle);

export const getReporteFinancieroResumen = (req, res) =>
  handleReport(req, res, getResumenFinanciero, { financial: true });

export const getReporteFinancieroMetodosPago = (req, res) =>
  handleReport(req, res, getFinancieroPorMetodoPago);

export const getReporteCortesResumen = (req, res) =>
  handleReport(req, res, getResumenCortesCaja, { financial: true });

export const getReporteCortesDetalle = (req, res) =>
  handleReport(req, res, getCortesCajaDetalle, { financial: true });

export async function getReporteExportaciones(req, res) {
  try {
    const filters = normalizeReportFilters(req.query);
    const data = await listExportaciones(req.db, {
      limit: filters.limit,
      offset: filters.offset,
    });

    return res.json({ ok: true, filters, data });
  } catch (err) {
    console.error("getReporteExportaciones error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error consultando historial de exportaciones",
      detail: err.message,
    });
  }
}
