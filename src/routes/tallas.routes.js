import { Router } from "express";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import { getTallas, postTalla, patchTalla, patchTallaStatus } from "../controllers/tallas.controller.js";

const router = Router();

router.get("/", usePublicDb, getTallas);

router.post("/", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), postTalla);
router.patch("/:id", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchTalla);
router.patch("/:id/status", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchTallaStatus);

export default router;
