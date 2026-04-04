import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import { getAuditLogs } from "../controllers/auditLogs.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN"));

router.get("/", getAuditLogs);

export default router;
