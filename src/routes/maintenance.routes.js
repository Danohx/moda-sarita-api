import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getMaintenanceHistory,
  getMaintenanceTables,
  runMaintenance,
} from "../controllers/maintenance.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN"));

router.get("/", getMaintenanceHistory);
router.get("/tables", getMaintenanceTables)
router.post("/run", runMaintenance);

export default router;
