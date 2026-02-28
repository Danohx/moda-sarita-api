import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import { getDashboardResumen } from "../controllers/dashboard.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));
router.get("/resumen", getDashboardResumen);

export default router;