import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireAnyPermission } from "../middleware/seguridad.js";
import {
  getCorteActualDetallado,
  getCorteDetalladoPorId,
} from "../controllers/corteCaja.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth);

router.get(
  "/actual",
  requireAnyPermission("ventas.corte_caja.read", "ventas.corte_caja.history"),
  getCorteActualDetallado,
);
router.get(
  "/:id",
  requireAnyPermission("ventas.corte_caja.history", "ventas.corte_caja.read"),
  getCorteDetalladoPorId,
);

export default router;
