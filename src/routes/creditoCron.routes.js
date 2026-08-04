import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { procesarVencimientosCron } from "../controllers/creditoCron.controller.js";

const router = Router();

router.get("/vencimientos", useInternalDb, procesarVencimientosCron);
router.post("/vencimientos", useInternalDb, procesarVencimientosCron);

export default router;
