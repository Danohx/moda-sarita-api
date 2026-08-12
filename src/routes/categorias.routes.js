import { Router } from "express";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
} from "../middleware/seguridad.js";
import {
  getCategorias,
  postCategoria,
  patchCategoria,
  patchCategoriaStatus,
  getCategoriasAdmin,
} from "../controllers/categorias.controller.js";

const router = Router();

router.get("/", usePublicDb, getCategorias);
router.get(
  "/admin/list",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.read"),
  getCategoriasAdmin,
);

router.post(
  "/",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.create"),
  postCategoria,
);
router.patch(
  "/:id",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.update"),
  patchCategoria,
);
router.patch(
  "/:id/status",
  useInternalDb,
  requireAuth,
  requireAnyPermission(
    "inventario.categorias.update",
    "inventario.categorias.delete",
  ),
  patchCategoriaStatus,
);

export default router;
