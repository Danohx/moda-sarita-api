import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getCorteActualDetallado,
  getCorteDetalladoPorId,
} from "../controllers/corteCaja.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.get("/actual", getCorteActualDetallado);
router.get("/:id", getCorteDetalladoPorId);

export default router;
