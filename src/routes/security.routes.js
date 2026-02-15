import { Router } from "express";
import { body, validationResult } from "express-validator";
import { setup2FA, enable2FA, listRoles, listPermisos, getPermisosRol, setPermisosRol } from "../controllers/security.controller.js";
import { requireAuth, requirePermission } from "../middleware/seguridad.js";

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

router.post("/2fa/setup", requireAuth, setup2FA);

router.post(
  "/2fa/enable",
  requireAuth,
  body("token").isString().notEmpty(),
  validar,
  enable2FA
);

router.get(
  "/roles",
  requireAuth,
  requirePermission("seguridad.roles.manage"),
  listRoles
);

router.get(
  "/permisos",
  requireAuth,
  requirePermission("seguridad.permisos.manage"),
  listPermisos
);

router.get(
  "/roles/:rolId/permisos",
  requireAuth,
  requirePermission("seguridad.permisos.manage"),
  getPermisosRol
);

router.post(
  "/roles/:rolId/permisos",
  requireAuth,
  requirePermission("seguridad.permisos.manage"),
  body("permisos").isArray({ min: 0 }),
  validar,
  setPermisosRol
);

export default router;
