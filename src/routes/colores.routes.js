import { Router } from "express";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import { getColores, postColor, patchColor, patchColorStatus, getColoresAdmin } from "../controllers/colores.controller.js";

const router = Router();

router.get("/", usePublicDb, getColores);
router.get("/admin/list", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), getColoresAdmin);
router.post("/", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), postColor);
router.patch("/:id", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchColor);
router.patch("/:id/status", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchColorStatus);

export default router;
