import { Router } from "express";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
} from "../middleware/seguridad.js";
import {
  getColores,
  postColor,
  patchColor,
  patchColorStatus,
  getColoresAdmin,
} from "../controllers/colores.controller.js";

const router = Router();

router.get("/", usePublicDb, getColores);
router.get(
  "/admin/list",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.read"),
  getColoresAdmin,
);
router.post(
  "/",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.create"),
  postColor,
);
router.patch(
  "/:id",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.update"),
  patchColor,
);
router.patch(
  "/:id/status",
  useInternalDb,
  requireAuth,
  requireAnyPermission(
    "inventario.categorias.update",
    "inventario.categorias.delete",
  ),
  patchColorStatus,
);

export default router;
