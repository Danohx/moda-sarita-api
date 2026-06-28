import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getExistencias,
  getStockVariante,
  getKardexVariante,
  getKardexProducto,
  postMovimientoInventario,
  getAlertasInventarioController,
} from "../controllers/inventario.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.get("/alertas", getAlertasInventarioController)
router.get("/existencias", getExistencias);
router.get("/variantes/:id/stock", getStockVariante);
router.get("/variantes/:id/movimientos", getKardexVariante);
router.get("/productos/:id/movimientos", getKardexProducto);
router.post("/movimientos", postMovimientoInventario);

export default router;