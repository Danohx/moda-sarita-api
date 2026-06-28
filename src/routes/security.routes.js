import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import {
  setup2FA,
  enable2FA,
  listRoles,
  createRole,
  updateRole,
  listPermisos,
  getPermisosRol,
  setPermisosRol,
  updateRoleStatus,
  getEmpleados,
  postEmpleado,
  patchEmpleado,
  patchEmpleadoStatus,
  getMisSesiones,
  patchRevocarSesion,
  patchRevocarOtrasSesiones,
  getEstadoSeguridad
} from "../controllers/security.controller.js";
import { requireAuth, requirePermission } from "../middleware/seguridad.js";
import { useInternalDb } from "../middleware/dbContext.js";

const router = Router();

const validar = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      msg: "Datos inválidos",
      errores: errors.array(),
    });
  }

  next();
};

router.use(useInternalDb);
router.post("/2fa/setup", requireAuth, setup2FA);
router.post(
  "/2fa/enable",
  requireAuth,
  body("token").isString().trim().notEmpty(),
  validar,
  enable2FA,
);
router.get(
  "/roles",
  requireAuth,
  requirePermission("seguridad.roles.view"),
  listRoles,
);
router.post(
  "/roles",
  requireAuth,
  requirePermission("seguridad.roles.manage"),
  body("nombre").isString().trim().isLength({ min: 2 }),
  body("descripcion").optional({ nullable: true }).isString(),
  body("permisos").optional().isArray(),
  validar,
  createRole,
);
router.patch(
  "/roles/:rolId",
  requireAuth,
  requirePermission("seguridad.roles.manage"),
  param("rolId").isInt({ min: 1 }),
  body("nombre").isString().trim().isLength({ min: 2 }),
  body("descripcion").optional({ nullable: true }).isString(),
  validar,
  updateRole,
);
router.get(
  "/permisos",
  requireAuth,
  requirePermission("seguridad.permisos.view"),
  listPermisos,
);
router.get(
  "/roles/:rolId/permisos",
  requireAuth,
  requirePermission("seguridad.permisos.view"),
  param("rolId").isInt({ min: 1 }),
  validar,
  getPermisosRol,
);
router.post(
  "/roles/:rolId/permisos",
  requireAuth,
  requirePermission("seguridad.permisos.manage"),
  param("rolId").isInt({ min: 1 }),
  body("permisos").isArray({ min: 0 }),
  validar,
  setPermisosRol,
);
router.patch(
  "/roles/:rolId/status",
  requireAuth,
  requirePermission("seguridad.roles.manage"),
  param("rolId").isInt({ min: 1 }),
  body("activo").isBoolean(),
  validar,
  updateRoleStatus,
);
router.get(
  "/empleados",
  requireAuth,
  requirePermission("seguridad.empleados.view"),
  getEmpleados,
);
router.post(
  "/empleados",
  requireAuth,
  requirePermission("seguridad.empleados.manage"),
  body("nombres").isString().trim().notEmpty(),
  body("apellido_paterno").isString().trim().notEmpty(),
  body("email").isEmail().normalizeEmail(),
  body("rol_id").isInt(),
  body("password_temporal").isString().isLength({ min: 8 }),
  validar,
  postEmpleado,
);
router.patch(
  "/empleados/:usuarioId",
  requireAuth,
  requirePermission("seguridad.empleados.manage"),
  patchEmpleado,
);
router.patch(
  "/empleados/:usuarioId/status",
  requireAuth,
  requirePermission("seguridad.empleados.manage"),
  body("activo").isBoolean(),
  validar,
  patchEmpleadoStatus,
);
router.get("/sessions", requireAuth, getMisSesiones);
router.patch("/sessions/revoke-others", requireAuth, patchRevocarOtrasSesiones);
router.patch("/sessions/:sessionId/revoke", requireAuth, patchRevocarSesion);
router.get("/status", requireAuth, getEstadoSeguridad);

export default router;
