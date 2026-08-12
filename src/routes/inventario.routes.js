import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
} from "../middleware/seguridad.js";
import {
  getExistencias,
  getStockVariante,
  getKardexVariante,
  getKardexProducto,
  postMovimientoInventario,
  getAlertasInventarioController,
} from "../controllers/inventario.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth);

router.get(
  "/alertas",
  requireAnyPermission(
    "inventario.productos.read",
    "inventario.movimientos.read",
  ),
  getAlertasInventarioController,
);
router.get(
  "/existencias",
  requirePermission("inventario.productos.read"),
  getExistencias,
);
router.get(
  "/variantes/:id/stock",
  requirePermission("inventario.productos.read"),
  getStockVariante,
);
router.get(
  "/variantes/:id/movimientos",
  requirePermission("inventario.movimientos.read"),
  getKardexVariante,
);
router.get(
  "/productos/:id/movimientos",
  requirePermission("inventario.movimientos.read"),
  getKardexProducto,
);
router.post(
  "/movimientos",
  requirePermission("inventario.movimientos.create"),
  postMovimientoInventario,
);

export default router;
