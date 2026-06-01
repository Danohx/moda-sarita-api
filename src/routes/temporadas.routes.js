import { Router } from "express";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getTemporadas,
  postTemporada,
  patchTemporada,
  patchTemporadaStatus,
} from "../controllers/temporadas.controller.js";

const router = Router();

router.get("/", usePublicDb, getTemporadas);
router.post("/", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), postTemporada);
router.patch("/:id", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchTemporada);
router.patch("/:id/status", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchTemporadaStatus);

export default router;