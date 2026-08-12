import { Router } from "express";
import { body, header, param, query, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import { postPedidoWeb, postConfirmarPedidoWeb, postCancelarPedidoWeb, postValidarCuponCheckout, getOpcionesCreditoWeb } from "../controllers/checkout.controller.js";

const router = Router();

const checkoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: "Demasiados intentos de checkout." },
});

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

router.use(useInternalDb, requireAuth);

router.get(
  "/credito/opciones",
  query("total").isFloat({ gt: 0 }),
  validar,
  getOpcionesCreditoWeb,
);

router.post(
  "/pedidos",
  checkoutLimiter,
  header("Idempotency-Key")
    .exists({ checkFalsy: true })
    .withMessage("Idempotency-Key es requerido.")
    .bail()
    .isUUID()
    .withMessage("Idempotency-Key debe ser un UUID."),
  body("items").isArray({ min: 1, max: 50 }),
  body("items.*.variante_id").optional().isUUID(),
  body("items.*.varianteId").optional().isUUID(),
  body("items.*.cantidad").isInt({ min: 1, max: 100 }),
  body("tipo_entrega").isIn(["RECOGER", "DOMICILIO"]),
  body("direccion_id").optional({ nullable: true }).isUUID(),
  body("metodo_pago").isString().isLength({ min: 3, max: 40 }),
  body("credito").optional({ nullable: true }).isObject(),
  body("credito.plazo_meses").optional().isInt({ min: 1, max: 60 }),
  body("credito.frecuencia_pago").optional().isIn(["SEMANAL", "QUINCENAL", "MENSUAL"]),
  body("referencia_externa").optional({ nullable: true }).isLength({ max: 150 }),
  body("cupon_codigo").optional({ nullable: true }).isLength({ max: 30 }),
  body("observaciones").optional({ nullable: true }).isLength({ max: 500 }),
  validar,
  postPedidoWeb,
);

router.post(
  "/pedidos/:id/confirmar",
  requireRole("ADMIN", "EMPLEADO"),

  param("id").isUUID(),

  body("referencia_externa")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 150 }),

  validar,
  postConfirmarPedidoWeb,
);

router.post(
  "/pedidos/:id/cancelar",
  requireRole("ADMIN", "EMPLEADO"),

  param("id").isUUID(),

  body("motivo")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 500 }),

  validar,
  postCancelarPedidoWeb,
);

router.post(
  "/cupon/validar",
  requireAuth,

  body("codigo")
    .isString()
    .trim()
    .isLength({ min: 3, max: 80 }),

  body("items")
    .isArray({ min: 1 }),

  body("items.*.variante_id")
    .isUUID(),

  body("items.*.cantidad")
    .isInt({ min: 1 }),

  validar,

  postValidarCuponCheckout,
);

export default router;
