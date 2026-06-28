// src/routes/configuracion.routes.js

import { Router } from "express";
import { useInternalDb, usePublicDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/seguridad.js";

import {
  getParametrosAdmin,
  getParametrosModuloAdmin,
  getParametrosAgrupadosAdmin,
  getParametrosPublicos,
  patchParametro,
  getMetodosPagoAdmin,
  getMetodosPagoPOS,
  getMetodosPagoWeb,
  patchMetodoPago,
} from "../controllers/configuracion.controller.js";

const router = Router();

router.get("/tienda/parametros", usePublicDb, getParametrosPublicos);
router.get("/tienda/metodos-pago/web", usePublicDb, getMetodosPagoWeb);

router.get(
  "/pos/metodos-pago",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  getMetodosPagoPOS,
);

router.get(
  "/admin/parametros",
  useInternalDb,
  requireAuth,
  requirePermission("configuracion.ajustes.view"),
  getParametrosAdmin,
);

router.get(
  "/admin/parametros/agrupados",
  useInternalDb,
  requireAuth,
  requirePermission("configuracion.ajustes.view"),
  getParametrosAgrupadosAdmin,
);

router.get(
  "/admin/parametros/modulo/:modulo",
  useInternalDb,
  requireAuth,
  requirePermission("configuracion.ajustes.view"),
  getParametrosModuloAdmin,
);

router.patch(
  "/admin/parametros/:clave",
  useInternalDb,
  requireAuth,
  requirePermission("configuracion.ajustes.manage"),
  patchParametro,
);

router.get(
  "/admin/metodos-pago",
  useInternalDb,
  requireAuth,
  requirePermission("configuracion.metodos_pago.view"),
  getMetodosPagoAdmin,
);

router.patch(
  "/admin/metodos-pago/:codigo",
  useInternalDb,
  requireAuth,
  requirePermission("configuracion.metodos_pago.manage"),
  patchMetodoPago,
);

export default router;