import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getVariante,
  patchVarianteStock,
  patchVariante,
  patchVarianteStatus,
} from "../controllers/variantes.controller.js";

const router = Router();

router.get("/:id", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), getVariante);
router.patch("/:id", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchVariante);
router.patch("/:id/stock", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchVarianteStock);
router.patch("/:id/status", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchVarianteStatus);

export default router;