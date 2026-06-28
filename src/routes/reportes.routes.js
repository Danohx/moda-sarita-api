// src/routes/reportes.routes.js
import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requirePermission } from "../middleware/seguridad.js";
import {
  getReporteResumen,
  getReporteVentasResumen,
  getReporteVentasTendencia,
  getReporteVentasMetodosPago,
  getReporteVentasEmpleados,
  getReporteProductosMasVendidos,
  getReporteProductosMenosVendidos,
  getReporteProductosSinVentas,
  getReporteInventarioResumen,
  getReporteInventarioCritico,
  getReporteInventarioMovimientos,
  getReporteClientesResumen,
  getReporteClientesTendencia,
  getReporteClientesFrecuentes,
  getReporteCreditoResumen,
  getReporteCuentasPorCobrar,
  getReporteApartadosResumen,
  getReporteApartadosDetalle,
  getReporteFinancieroResumen,
  getReporteFinancieroMetodosPago,
  getReporteCortesResumen,
  getReporteCortesDetalle,
  getReporteExportaciones,
} from "../controllers/reportes.controller.js";
import { exportReporteExcel, exportReportePdf } from "../controllers/reportesExport.controller.js";

const router = Router();

router.use(useInternalDb);
router.use(requireAuth);
router.use(requirePermission("reportes.view"));

router.get(
  "/resumen",
  requirePermission("reportes.resumen.view"),
  getReporteResumen,
);

router.get(
  "/ventas/resumen",
  requirePermission("reportes.ventas.view"),
  getReporteVentasResumen,
);
router.get(
  "/ventas/tendencia",
  requirePermission("reportes.ventas.view"),
  getReporteVentasTendencia,
);
router.get(
  "/ventas/metodos-pago",
  requirePermission("reportes.ventas.view"),
  getReporteVentasMetodosPago,
);
router.get(
  "/ventas/empleados",
  requirePermission("reportes.empleados.view"),
  getReporteVentasEmpleados,
);

router.get(
  "/productos/mas-vendidos",
  requirePermission("reportes.productos.view"),
  getReporteProductosMasVendidos,
);
router.get(
  "/productos/menos-vendidos",
  requirePermission("reportes.productos.view"),
  getReporteProductosMenosVendidos,
);
router.get(
  "/productos/sin-ventas",
  requirePermission("reportes.productos.view"),
  getReporteProductosSinVentas,
);

router.get(
  "/inventario/resumen",
  requirePermission("reportes.inventario.view"),
  getReporteInventarioResumen,
);
router.get(
  "/inventario/critico",
  requirePermission("reportes.inventario.view"),
  getReporteInventarioCritico,
);
router.get(
  "/inventario/movimientos",
  requirePermission("reportes.inventario.view"),
  getReporteInventarioMovimientos,
);

router.get(
  "/clientes/resumen",
  requirePermission("reportes.clientes.view"),
  getReporteClientesResumen,
);
router.get(
  "/clientes/tendencia",
  requirePermission("reportes.clientes.view"),
  getReporteClientesTendencia,
);
router.get(
  "/clientes/frecuentes",
  requirePermission("reportes.clientes.view"),
  getReporteClientesFrecuentes,
);

router.get(
  "/credito/resumen",
  requirePermission("reportes.credito.view"),
  getReporteCreditoResumen,
);
router.get(
  "/credito/cuentas-cobrar",
  requirePermission("reportes.credito.view"),
  getReporteCuentasPorCobrar,
);

router.get(
  "/apartados/resumen",
  requirePermission("reportes.apartados.view"),
  getReporteApartadosResumen,
);
router.get(
  "/apartados/detalle",
  requirePermission("reportes.apartados.view"),
  getReporteApartadosDetalle,
);

router.get(
  "/financiero/resumen",
  requirePermission("reportes.financiero.view"),
  getReporteFinancieroResumen,
);
router.get(
  "/financiero/metodos-pago",
  requirePermission("reportes.financiero.view"),
  getReporteFinancieroMetodosPago,
);

router.get(
  "/cortes/resumen",
  requirePermission("reportes.cortes.view"),
  getReporteCortesResumen,
);
router.get(
  "/cortes/detalle",
  requirePermission("reportes.cortes.view"),
  getReporteCortesDetalle,
);

router.get(
  "/exportaciones",
  requirePermission("reportes.exportaciones.view"),
  getReporteExportaciones,
);

router.get(
  "/export/excel",
  requirePermission("reportes.export"),
  exportReporteExcel,
);

router.get(
  "/export/pdf",
  requirePermission("reportes.export"),
  exportReportePdf,
);

export default router;