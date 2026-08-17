import { Router } from "express";
import { body, param, query, validationResult } from "express-validator";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth } from "../middleware/seguridad.js";
import {
  deleteMiDireccion,
  getMiCredito,
  getMiCreditoDetalle,
  getMisCuotasCredito,
  getMisPagosCredito,
  getMisMovimientosCreditoDetalle,
  getMisPagosPedido,
  getMiCuenta,
  getMiResumenPortal,
  getMiPedido,
  getMisApartados,
  getMisDirecciones,
  getMisMovimientosCredito,
  getMisCreditos,
  getMisPedidos,
  patchMiDireccion,
  patchMiDireccionPrincipal,
  patchMiPerfil,
  postMiDireccion,
} from "../controllers/cuenta.controller.js";
import { postAlexaWidgetTarget } from "../controllers/alexaSync.controller.js";

const router = Router();

function validar(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      msg: "Datos inválidos",
      errores: errors.array(),
    });
  }
  next();
}

const nombreValidator = (field) =>
  body(field)
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .matches(/^[a-zA-ZÁ-ÿ\u00f1\u00d1\s]+$/);

const direccionValidators = [
  body("calle").trim().isLength({ min: 2, max: 200 }),
  body("numero_exterior").optional({ nullable: true }).isLength({ max: 20 }),
  body("numero_interior").optional({ nullable: true }).isLength({ max: 20 }),
  body("colonia").optional({ nullable: true }).isLength({ max: 100 }),
  body("ciudad").trim().isLength({ min: 2, max: 100 }),
  body("estado").trim().isLength({ min: 2, max: 100 }),
  body("codigo_postal")
    .trim()
    .matches(/^\d{5}$/),
  body("referencias").optional({ nullable: true }).isLength({ max: 500 }),
  body("es_principal").optional().isBoolean(),
];

router.use(useInternalDb, requireAuth);

router.get("/", getMiCuenta);
router.get("/resumen", getMiResumenPortal);
router.patch(
  "/perfil",
  nombreValidator("nombres"),
  nombreValidator("apellido_paterno"),
  body("apellido_materno")
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 100 })
    .matches(/^[a-zA-ZÁ-ÿ\u00f1\u00d1\s]*$/),
  body("telefono")
    .optional({ nullable: true })
    .trim()
    .matches(/^\+?[0-9\s-]{7,20}$/),
  validar,
  patchMiPerfil,
);

router.get("/direcciones", getMisDirecciones);
router.post("/direcciones", direccionValidators, validar, postMiDireccion);
router.patch(
  "/direcciones/:direccionId",
  param("direccionId").isUUID(),
  body("calle").optional().trim().isLength({ min: 2, max: 200 }),
  body("numero_exterior").optional({ nullable: true }).isLength({ max: 20 }),
  body("numero_interior").optional({ nullable: true }).isLength({ max: 20 }),
  body("colonia").optional({ nullable: true }).isLength({ max: 100 }),
  body("ciudad").optional().trim().isLength({ min: 2, max: 100 }),
  body("estado").optional().trim().isLength({ min: 2, max: 100 }),
  body("codigo_postal")
    .optional()
    .trim()
    .matches(/^\d{5}$/),
  body("referencias").optional({ nullable: true }).isLength({ max: 500 }),
  body("es_principal").optional().isBoolean(),
  validar,
  patchMiDireccion,
);
router.patch(
  "/direcciones/:direccionId/principal",
  param("direccionId").isUUID(),
  validar,
  patchMiDireccionPrincipal,
);
router.delete(
  "/direcciones/:direccionId",
  param("direccionId").isUUID(),
  validar,
  deleteMiDireccion,
);

router.get("/credito", getMiCredito);
router.get(
  "/credito/creditos",
  query("estado").optional().isString().isLength({ max: 30 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisCreditos,
);
router.get(
  "/credito/creditos/:creditoId",
  param("creditoId").isUUID(),
  validar,
  getMiCreditoDetalle,
);
router.get(
  "/credito/creditos/:creditoId/cuotas",
  param("creditoId").isUUID(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisCuotasCredito,
);
router.get(
  "/credito/creditos/:creditoId/pagos",
  param("creditoId").isUUID(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisPagosCredito,
);
router.get(
  "/credito/creditos/:creditoId/movimientos",
  param("creditoId").isUUID(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisMovimientosCreditoDetalle,
);

router.get(
  "/credito/movimientos",
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisMovimientosCredito,
);

router.get(
  "/pedidos",
  query("estado").optional().isString().isLength({ max: 30 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisPedidos,
);
router.get(
  "/apartados",
  query("estado").optional().isString().isLength({ max: 30 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisApartados,
);
router.get(
  "/pedidos/:pedidoId/pagos",
  param("pedidoId").isUUID(),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  validar,
  getMisPagosPedido,
);
router.get(
  "/pedidos/:pedidoId",
  param("pedidoId").isUUID(),
  validar,
  getMiPedido,
);
router.post("/alexa/widget-target", postAlexaWidgetTarget);

export default router;
