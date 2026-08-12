import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
} from "../middleware/seguridad.js";
import {
  getProductos,
  getProductoById,
  postProducto,
  patchProducto,
  patchProductoStatus,
  patchProductoDestacado,
  getProductosAdmin,
  getProductoAdminById,
} from "../controllers/productos.controller.js";
import {
  getVariantesProducto,
  getVariantesProductoAdmin,
  postVariantesProducto,
} from "../controllers/variantes.controller.js";
import {
  getProductoImagenes,
  postProductoImagen,
  patchProductoImagenPrincipal,
  deleteProductoImagenById,
  patchProductoImagenesReorder,
} from "../controllers/productoImagenes.controller.js";
import { getProductoDetalle } from "../controllers/productoDetalle.controller.js";

const router = Router();

router.get("/", usePublicDb, getProductos);
router.get(
  "/admin/list",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.read"),
  getProductosAdmin,
);

router.get(
  "/:id/admin",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.read"),
  getProductoAdminById,
);
router.get("/:id/detalle", usePublicDb, getProductoDetalle);
router.get("/:id", usePublicDb, getProductoById);
router.post(
  "/",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.create"),
  postProducto,
);

router.patch(
  "/:id",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  patchProducto,
);

router.patch(
  "/:id/status",
  useInternalDb,
  requireAuth,
  requireAnyPermission(
    "inventario.productos.update",
    "inventario.productos.deactivate",
  ),
  patchProductoStatus,
);

router.patch(
  "/:id/destacado",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  patchProductoDestacado,
);

router.get("/:id/variantes", usePublicDb, getVariantesProducto);
router.get(
  "/:id/variantes/admin",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.read"),
  getVariantesProductoAdmin,
);

router.post(
  "/:id/variantes",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  postVariantesProducto,
);

router.get("/:id/imagenes", usePublicDb, getProductoImagenes);

router.post(
  "/:id/imagenes",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  upload.single("imagen"),
  postProductoImagen,
);

router.patch(
  "/:id/imagenes/:imagenId/principal",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  patchProductoImagenPrincipal,
);

router.delete(
  "/:id/imagenes/:imagenId",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  deleteProductoImagenById,
);

router.patch(
  "/:id/imagenes/reorder",
  useInternalDb,
  requireAuth,
  requirePermission("inventario.productos.update"),
  patchProductoImagenesReorder,
);

export default router;
