import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import { getProductoPrediction } from "../controllers/predicciones.controller.js";

const router = Router();

// Predicción interna: usa ventas históricas y stock, por eso debe ir protegida.
router.get(
  "/producto/:productoId",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  getProductoPrediction,
);

export default router;
