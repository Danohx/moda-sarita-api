// src/routes/contacto.routes.js

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, param, query, validationResult } from "express-validator";

import { useInternalDb, usePublicDb } from "../middleware/dbContext.js";
import { requireAuth, requirePermission } from "../middleware/seguridad.js";

import {
  getMensajeContactoAdminById,
  getMensajesContactoAdmin,
  patchMensajeContactoNotas,
  patchMensajeContactoStatus,
  postMensajeContactoPublico,
  postResponderMensajeContacto,
  getResumenMensajesContactoAdmin,
} from "../controllers/contacto.controller.js";

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

const contactoPublicLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    msg: "Demasiados mensajes enviados. Intenta más tarde.",
  },
});

// ============================================================
// PÚBLICO
// ============================================================

router.post(
  "/public/mensajes",
  contactoPublicLimiter,
  usePublicDb,
  body("nombre").isString().isLength({ min: 2, max: 160 }),
  body("email").isEmail().isLength({ max: 180 }),
  body("telefono").optional({ nullable: true }).isString().isLength({ max: 30 }),
  body("asunto").isString().isLength({ min: 3, max: 180 }),
  body("mensaje").isString().isLength({ min: 10 }),
  body("captchaToken").optional({ nullable: true }).isString(),
  body("website").optional({ nullable: true }).isString(),
  body("empresa").optional({ nullable: true }).isString(),
  validar,
  postMensajeContactoPublico,
);

// ============================================================
// ADMIN
// ============================================================

router.get(
  "/admin/mensajes",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.contacto.view"),
  query("estado")
    .optional()
    .isIn(["NUEVO", "LEIDO", "RESPONDIDO", "ARCHIVADO"]),
  query("q").optional().isString(),
  query("includeArchived").optional().isBoolean(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMensajesContactoAdmin,
);

router.get(
  "/admin/mensajes/resumen",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.contacto.view"),
  getResumenMensajesContactoAdmin,
);

router.get(
  "/admin/mensajes/:id",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.contacto.view"),
  param("id").isUUID(),
  validar,
  getMensajeContactoAdminById,
);

router.patch(
  "/admin/mensajes/:id/status",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.contacto.manage"),
  param("id").isUUID(),
  body("estado").isIn(["NUEVO", "LEIDO", "RESPONDIDO", "ARCHIVADO"]),
  validar,
  patchMensajeContactoStatus,
);

router.patch(
  "/admin/mensajes/:id/notas",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.contacto.manage"),
  param("id").isUUID(),
  body("notas_admin").optional({ nullable: true }).isString(),
  validar,
  patchMensajeContactoNotas,
);

router.post(
  "/admin/mensajes/:id/responder",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.contacto.manage"),
  param("id").isUUID(),
  body("respuesta_admin").isString().isLength({ min: 5 }),
  validar,
  postResponderMensajeContacto,
);

export default router;