import { Router } from "express";
import { upload } from "../middleware/upload.js";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getProductos,
  getProductoById,
  postProducto,
  patchProducto,
  patchProductoStatus,
  patchProductoDestacado,
  getProductosAdmin,
  getProductoAdminById
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
  requireRole("ADMIN", "EMPLEADO"),
  getProductosAdmin,
);

router.get("/:id/admin", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), getProductoAdminById)
router.get("/:id/detalle", usePublicDb, getProductoDetalle);
router.get("/:id", usePublicDb, getProductoById);
router.post(
  "/",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  postProducto,
);

router.patch(
  "/:id",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  patchProducto,
);

router.patch(
  "/:id/status",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  patchProductoStatus,
);

router.patch(
  "/:id/destacado",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  patchProductoDestacado,
);

router.get("/:id/variantes", usePublicDb, getVariantesProducto);
router.get("/:id/variantes/admin", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), getVariantesProductoAdmin);

router.post(
  "/:id/variantes",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  postVariantesProducto,
);

router.get("/:id/imagenes", usePublicDb, getProductoImagenes);

router.post(
  "/:id/imagenes",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  upload.single("imagen"),
  postProductoImagen,
);

router.patch(
  "/:id/imagenes/:imagenId/principal",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  patchProductoImagenPrincipal,
);

router.delete(
  "/:id/imagenes/:imagenId",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  deleteProductoImagenById,
);

router.patch(
  "/:id/imagenes/reorder",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  patchProductoImagenesReorder,
);

export default router;
