import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth } from "../middleware/seguridad.js";
import { getDashboard } from "../controllers/dashboard.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth);

router.get("/", getDashboard);

export default router;