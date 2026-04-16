import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import { useInternalDb } from "../middleware/dbContext.js";

import {
  getBackups,
  createBackup,
  downloadBackup,
  deleteBackup,
} from "../controllers/backups.controller.js";

const router = Router();

router.use(useInternalDb);

router.post("/internal/auto", createBackup);

router.get("/", getBackups);
router.post("/", createBackup);
router.get("/:id/download", downloadBackup);
router.delete("/:id", deleteBackup);

export default router;