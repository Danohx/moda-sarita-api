import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/seguridad.js";
import {
  getComprobantePagoCreditoPdf,
  getCredito,
  getReporteCreditoOperativo,
  getReporteCreditoOperativoExcel,
  getReporteCreditoOperativoPdf,
  getReporteFinancieroCredito,
  getReporteFinancieroCreditoExcel,
  getReporteFinancieroCreditoPdf,
  getUltimaEjecucionVencimientos,
  getCreditos,
  postAbonoCredito,
  postCancelarCredito,
  postCrearCredito,
  postProcesarVencimientos,
  postSimularCredito,
} from "../controllers/credito.controller.js";

const router = Router();

function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    const available = new Set(req.user?.permisos || []);
    if (permissions.some((permission) => available.has(permission))) {
      return next();
    }

    return res.status(403).json({
      ok: false,
      message: "No autorizado (permiso)",
      requiredAny: permissions,
      rol: req.user?.rol || null,
    });
  };
}

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.post(
  "/simular",
  requirePermission("credito.simulate"),
  postSimularCredito,
);
router.get("/", requirePermission("credito.view"), getCreditos);
router.post("/", requirePermission("credito.create"), postCrearCredito);

router.get(
  "/vencimientos/ultima-ejecucion",
  requirePermission("credito.view"),
  getUltimaEjecucionVencimientos,
);
router.get(
  "/reportes/operativo",
  requireAnyPermission("credito.view", "reportes.credito.view"),
  getReporteCreditoOperativo,
);
router.get(
  "/reportes/financiero",
  requireAnyPermission("credito.view", "reportes.financiero.view"),
  getReporteFinancieroCredito,
);
router.get(
  "/reportes/operativo/export/pdf",
  requireAnyPermission("credito.view", "reportes.credito.view"),
  requirePermission("reportes.export"),
  getReporteCreditoOperativoPdf,
);
router.get(
  "/reportes/operativo/export/excel",
  requireAnyPermission("credito.view", "reportes.credito.view"),
  requirePermission("reportes.export"),
  getReporteCreditoOperativoExcel,
);
router.get(
  "/reportes/financiero/export/pdf",
  requireAnyPermission("credito.view", "reportes.financiero.view"),
  requirePermission("reportes.export"),
  getReporteFinancieroCreditoPdf,
);
router.get(
  "/reportes/financiero/export/excel",
  requireAnyPermission("credito.view", "reportes.financiero.view"),
  requirePermission("reportes.export"),
  getReporteFinancieroCreditoExcel,
);
router.post(
  "/procesar-vencimientos",
  requirePermission("credito.overdue.run"),
  postProcesarVencimientos,
);
router.get(
  "/:creditoId",
  requirePermission("credito.view"),
  getCredito,
);
router.post(
  "/:creditoId/abonos",
  requirePermission("credito.payments.create"),
  postAbonoCredito,
);
router.post(
  "/:creditoId/cancelar",
  requirePermission("credito.cancel"),
  postCancelarCredito,
);
router.get(
  "/:creditoId/pagos/:pagoId/comprobante",
  requirePermission("credito.view"),
  getComprobantePagoCreditoPdf,
);

export default router;
