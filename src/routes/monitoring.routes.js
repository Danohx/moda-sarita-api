import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";

import {
  getDatabaseSummary,
  getDatabaseTables,
  getDatabaseVacuum,
  getDatabaseConnections,
} from "../controllers/monitoring.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN"));

router.get("/summary", getDatabaseSummary);
router.get("/tables", getDatabaseTables);
router.get("/vacuum", getDatabaseVacuum);
router.get("/connections", getDatabaseConnections);

export default router;