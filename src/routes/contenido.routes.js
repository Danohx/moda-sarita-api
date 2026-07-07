// src/routes/contenido.routes.js

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, param, validationResult } from "express-validator";

import { useInternalDb, usePublicDb } from "../middleware/dbContext.js";
import { requireAuth, requirePermission } from "../middleware/seguridad.js";

import {
  getPaginasAdmin,
  getPaginaAdminByIdController,
  getPaginaAdminByClaveController,
  postPagina,
  patchPagina,
  patchPaginaStatus,
  patchPaginaPublicacion,
  getPaginaVersiones,
  postRestaurarPaginaVersion,
  getPaginaPublicaByClave,
  getFaqsAdmin,
  getFaqAdminById,
  postFaq,
  patchFaq,
  patchFaqStatus,
  patchFaqPublicacion,
  patchFaqsOrden,
  getFaqsPublicas,
} from "../controllers/contenido.controller.js";

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

const publicContentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    msg: "Demasiadas solicitudes. Intenta más tarde.",
  },
});

// ============================================================
// RUTAS PÚBLICAS
// ============================================================

router.get(
  "/public/paginas/:clave",
  publicContentLimiter,
  usePublicDb,
  param("clave").isString().notEmpty(),
  validar,
  getPaginaPublicaByClave,
);

router.get("/public/faqs", publicContentLimiter, usePublicDb, getFaqsPublicas);

// ============================================================
// RUTAS ADMIN - PÁGINAS / POLÍTICAS
// ============================================================

router.get(
  "/admin/paginas",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.view"),
  getPaginasAdmin,
);

router.get(
  "/admin/paginas/by-id/:id",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.view"),
  param("id").isUUID(),
  validar,
  getPaginaAdminByIdController,
);

router.get(
  "/admin/paginas/by-clave/:clave",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.view"),
  param("clave").isString().notEmpty(),
  validar,
  getPaginaAdminByClaveController,
);

router.post(
  "/admin/paginas",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.manage"),
  body("clave").isString().isLength({ min: 3 }),
  body("titulo").isString().isLength({ min: 3 }),
  body("resumen").optional({ nullable: true }).isString(),
  body("contenido_html").optional().isString(),
  body("contenido_texto").optional({ nullable: true }).isString(),
  validar,
  postPagina,
);

router.patch(
  "/admin/paginas/:id",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.manage"),
  param("id").isUUID(),
  body("titulo").optional().isString().isLength({ min: 3 }),
  body("resumen").optional({ nullable: true }).isString(),
  body("contenido_html").optional().isString(),
  body("contenido_texto").optional({ nullable: true }).isString(),
  validar,
  patchPagina,
);

router.patch(
  "/admin/paginas/:id/status",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.manage"),
  param("id").isUUID(),
  body("activo").isBoolean(),
  validar,
  patchPaginaStatus,
);

router.patch(
  "/admin/paginas/:id/publicacion",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.publish"),
  param("id").isUUID(),
  body("publicado").isBoolean(),
  validar,
  patchPaginaPublicacion,
);

router.get(
  "/admin/paginas/:id/versiones",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.view"),
  param("id").isUUID(),
  validar,
  getPaginaVersiones,
);

router.post(
  "/admin/paginas/:id/versiones/:versionId/restaurar",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.paginas.manage"),
  param("id").isUUID(),
  param("versionId").isUUID(),
  validar,
  postRestaurarPaginaVersion,
);

// ============================================================
// RUTAS ADMIN - FAQ
// ============================================================

router.get(
  "/admin/faqs",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.faq.view"),
  getFaqsAdmin,
);

router.get(
  "/admin/faqs/:id",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.faq.view"),
  param("id").isUUID(),
  validar,
  getFaqAdminById,
);

router.post(
  "/admin/faqs",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.faq.manage"),
  body("pregunta").isString().isLength({ min: 5 }),
  body("respuesta_html").optional().isString(),
  body("respuesta_texto").optional({ nullable: true }).isString(),
  body("orden").optional({ nullable: true }).isInt({ min: 0 }),
  validar,
  postFaq,
);

router.patch(
  "/admin/faqs/reorder",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.faq.manage"),
  body("items").isArray({ min: 1 }),
  validar,
  patchFaqsOrden,
);

router.patch(
  "/admin/faqs/:id",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.faq.manage"),
  param("id").isUUID(),
  body("pregunta").optional().isString().isLength({ min: 5 }),
  body("respuesta_html").optional().isString(),
  body("respuesta_texto").optional({ nullable: true }).isString(),
  body("orden").optional().isInt({ min: 0 }),
  validar,
  patchFaq,
);

router.patch(
  "/admin/faqs/:id/status",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.faq.manage"),
  param("id").isUUID(),
  body("activo").isBoolean(),
  validar,
  patchFaqStatus,
);

router.patch(
  "/admin/faqs/:id/publicacion",
  useInternalDb,
  requireAuth,
  requirePermission("contenido.faq.manage"),
  param("id").isUUID(),
  body("publicado").isBoolean(),
  validar,
  patchFaqPublicacion,
);

export default router;
