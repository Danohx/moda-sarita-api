import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requirePermission } from "../middleware/seguridad.js";
import {
  getVariante,
  patchVarianteStock,
  patchVariante,
  patchVarianteStatus,
} from "../controllers/variantes.controller.js";

const router = Router();

router.get(
  "/:id",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.read"),
  getVariante,
);
router.patch(
  "/:id",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  patchVariante,
);
router.patch(
  "/:id/stock",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.movimientos.create"),
  patchVarianteStock,
);
router.patch(
  "/:id/status",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  patchVarianteStatus,
);

export default router;
