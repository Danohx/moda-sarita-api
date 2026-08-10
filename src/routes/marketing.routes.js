// src/routes/marketing.routes.js

import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";

import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requirePermission } from "../middleware/seguridad.js";

import {
  getCuponAdminById,
  getCuponesAdmin,
  getPlantillaEmailAdminById,
  getPlantillasEmailAdmin,
  getSegmentoAdminById,
  getSegmentosAdmin,
  getSuscripcionAdminById,
  getSuscripcionesAdmin,
  patchCuponAdmin,
  patchCuponStatusAdmin,
  patchPlantillaEmailAdmin,
  patchSegmentoAdmin,
  patchSuscripcionAdmin,
  patchSuscripcionStatusAdmin,
  postCuponAdmin,
  postPlantillaEmailAdmin,
  postPlantillaEmailTestSendAdmin,
  postSegmentoAdmin,
  postSuscripcionAdmin,
} from "../controllers/marketing.controller.js";

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
router.use(requireAuth);

// ============================================================
// SUSCRIPTORES
// ============================================================

router.get(
  "/admin/suscripciones",
  requirePermission("marketing.suscripciones.view"),
  query("estado").optional().isIn(["ACTIVO", "BAJA", "BLOQUEADO"]),
  query("q").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getSuscripcionesAdmin,
);

router.get(
  "/admin/suscripciones/:id",
  requirePermission("marketing.suscripciones.view"),
  param("id").isUUID(),
  validar,
  getSuscripcionAdminById,
);

router.post(
  "/admin/suscripciones",
  requirePermission("marketing.suscripciones.manage"),
  body("email").isEmail().isLength({ max: 180 }),
  body("nombre").optional({ nullable: true }).isString().isLength({ max: 180 }),
  body("telefono")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 30 }),
  body("origen").optional().isString().isLength({ max: 40 }),
  body("estado").optional().isIn(["ACTIVO", "BAJA", "BLOQUEADO"]),
  body("acepta_marketing").optional().isBoolean(),
  body("notas_admin").optional({ nullable: true }).isString(),
  validar,
  postSuscripcionAdmin,
);

router.patch(
  "/admin/suscripciones/:id",
  requirePermission("marketing.suscripciones.manage"),
  param("id").isUUID(),
  body("nombre").optional({ nullable: true }).isString().isLength({ max: 180 }),
  body("telefono")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 30 }),
  body("acepta_marketing").optional().isBoolean(),
  body("notas_admin").optional({ nullable: true }).isString(),
  validar,
  patchSuscripcionAdmin,
);

router.patch(
  "/admin/suscripciones/:id/status",
  requirePermission("marketing.suscripciones.manage"),
  param("id").isUUID(),
  body("estado").isIn(["ACTIVO", "BAJA", "BLOQUEADO"]),
  body("motivo_baja").optional({ nullable: true }).isString(),
  validar,
  patchSuscripcionStatusAdmin,
);

// ============================================================
// CUPONES
// ============================================================

router.get(
  "/admin/cupones",
  requirePermission("marketing.cupones.view"),
  query("estado")
    .optional()
    .isIn(["ACTIVO", "INACTIVO", "PROGRAMADO", "EXPIRADO", "AGOTADO"]),
  query("canal").optional().isIn(["POS", "WEB", "AMBOS"]),
  query("q").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getCuponesAdmin,
);

router.get(
  "/admin/cupones/:id",
  requirePermission("marketing.cupones.view"),
  param("id").isInt({ min: 1 }),
  validar,
  getCuponAdminById,
);

router.post(
  "/admin/cupones",
  requirePermission("marketing.cupones.manage"),
  body("codigo").isString().isLength({ min: 3, max: 80 }),
  body("nombre").optional({ nullable: true }).isString().isLength({ max: 160 }),
  body("descripcion").optional({ nullable: true }).isString(),
  body("tipo_descuento").isString().isLength({ min: 3, max: 30 }),
  body("valor").isFloat({ gt: 0 }),
  body("monto_minimo_compra").optional().isFloat({ min: 0 }),
  body("fecha_inicio").isISO8601(),
  body("fecha_fin").isISO8601(),
  body("activo").optional().isBoolean(),
  body("canal").optional().isIn(["POS", "WEB", "AMBOS"]),
  body("aplica_a").optional().isIn(["PEDIDO", "PRODUCTO", "CATEGORIA"]),
  body("uso_maximo").optional({ nullable: true }).isInt({ min: 1 }),
  body("uso_maximo_por_cliente").optional({ nullable: true }).isInt({ min: 1 }),
  body("acumulable").optional().isBoolean(),
  body("solo_clientes_registrados").optional().isBoolean(),
  validar,
  postCuponAdmin,
);

router.patch(
  "/admin/cupones/:id",
  requirePermission("marketing.cupones.manage"),
  param("id").isInt({ min: 1 }),
  body("nombre").optional({ nullable: true }).isString().isLength({ max: 160 }),
  body("descripcion").optional({ nullable: true }).isString(),
  body("tipo_descuento").optional().isString().isLength({ min: 3, max: 30 }),
  body("valor").optional().isFloat({ gt: 0 }),
  body("monto_minimo_compra").optional().isFloat({ min: 0 }),
  body("fecha_inicio").optional().isISO8601(),
  body("fecha_fin").optional().isISO8601(),
  body("canal").optional().isIn(["POS", "WEB", "AMBOS"]),
  body("aplica_a").optional().isIn(["PEDIDO", "PRODUCTO", "CATEGORIA"]),
  body("uso_maximo").optional({ nullable: true }).isInt({ min: 0 }),
  body("uso_maximo_por_cliente").optional({ nullable: true }).isInt({ min: 0 }),
  body("acumulable").optional().isBoolean(),
  body("solo_clientes_registrados").optional().isBoolean(),
  validar,
  patchCuponAdmin,
);

router.patch(
  "/admin/cupones/:id/status",
  requirePermission("marketing.cupones.manage"),
  param("id").isInt({ min: 1 }),
  body("activo").isBoolean(),
  validar,
  patchCuponStatusAdmin,
);

// ============================================================
// SEGMENTOS
// ============================================================

router.get(
  "/admin/segmentos",
  requirePermission("marketing.segmentos.view"),
  query("activo").optional().isBoolean(),
  query("q").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getSegmentosAdmin,
);

router.get(
  "/admin/segmentos/:id",
  requirePermission("marketing.segmentos.view"),
  param("id").isUUID(),
  validar,
  getSegmentoAdminById,
);

router.post(
  "/admin/segmentos",
  requirePermission("marketing.segmentos.manage"),
  body("nombre").isString().isLength({ min: 3, max: 120 }),
  body("descripcion").optional({ nullable: true }).isString(),
  body("criterios").optional().isObject(),
  body("activo").optional().isBoolean(),
  validar,
  postSegmentoAdmin,
);

router.patch(
  "/admin/segmentos/:id",
  requirePermission("marketing.segmentos.manage"),
  param("id").isUUID(),
  body("nombre").optional().isString().isLength({ min: 3, max: 120 }),
  body("descripcion").optional({ nullable: true }).isString(),
  body("criterios").optional().isObject(),
  body("activo").optional().isBoolean(),
  validar,
  patchSegmentoAdmin,
);

// ============================================================
// PLANTILLAS
// ============================================================

router.get(
  "/admin/plantillas",
  requirePermission("marketing.plantillas.view"),
  query("tipo").optional().isIn(["MARKETING", "TRANSACCIONAL"]),
  query("activo").optional().isBoolean(),
  query("q").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getPlantillasEmailAdmin,
);

router.get(
  "/admin/plantillas/:id",
  requirePermission("marketing.plantillas.view"),
  param("id").isUUID(),
  validar,
  getPlantillaEmailAdminById,
);

router.post(
  "/admin/plantillas",
  requirePermission("marketing.plantillas.manage"),
  body("clave").isString().isLength({ min: 3, max: 80 }),
  body("nombre").isString().isLength({ min: 3, max: 160 }),
  body("descripcion").optional({ nullable: true }).isString(),
  body("tipo").optional().isIn(["MARKETING", "TRANSACCIONAL"]),
  body("asunto").isString().isLength({ min: 3, max: 180 }),
  body("preheader")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 180 }),
  body("cuerpo_html").optional().isString(),
  body("cuerpo_texto").optional({ nullable: true }).isString(),
  body("activo").optional().isBoolean(),
  validar,
  postPlantillaEmailAdmin,
);

router.patch(
  "/admin/plantillas/:id",
  requirePermission("marketing.plantillas.manage"),
  param("id").isUUID(),
  body("nombre").optional().isString().isLength({ min: 3, max: 160 }),
  body("descripcion").optional({ nullable: true }).isString(),
  body("tipo").optional().isIn(["MARKETING", "TRANSACCIONAL"]),
  body("asunto").optional().isString().isLength({ min: 3, max: 180 }),
  body("preheader")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 180 }),
  body("cuerpo_html").optional().isString(),
  body("cuerpo_texto").optional({ nullable: true }).isString(),
  body("activo").optional().isBoolean(),
  validar,
  patchPlantillaEmailAdmin,
);

router.post(
  "/admin/plantillas/:id/test-send",
  requirePermission("marketing.plantillas.test_send"),
  param("id").isUUID(),
  body("email_destino").isEmail(),
  validar,
  postPlantillaEmailTestSendAdmin,
);

export default router;
