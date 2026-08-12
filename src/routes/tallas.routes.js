import { Router } from "express";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
} from "../middleware/seguridad.js";
import {
  getTallas,
  postTalla,
  patchTalla,
  patchTallaStatus,
  getTallasAdmin,
} from "../controllers/tallas.controller.js";

const router = Router();

router.get("/", usePublicDb, getTallas);
router.get(
  "/admin/list",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.read"),
  getTallasAdmin,
);

router.post(
  "/",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.create"),
  postTalla,
);
router.patch(
  "/:id",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.categorias.update"),
  patchTalla,
);
router.patch(
  "/:id/status",
  useInternalDb,
  requireAuth,
  requireAnyPermission(
    "inventario.categorias.update",
    "inventario.categorias.delete",
  ),
  patchTallaStatus,
);

export default router;
