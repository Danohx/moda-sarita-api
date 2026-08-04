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
  getCreditos,
  postAbonoCredito,
  postCancelarCredito,
  postCrearCredito,
  postProcesarVencimientos,
  postSimularCredito,
} from "../controllers/credito.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.post(
  "/simular",
  requirePermission("credito.simulate"),
  postSimularCredito,
);
router.get("/", requirePermission("credito.view"), getCreditos);
router.post("/", requirePermission("credito.create"), postCrearCredito);
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
