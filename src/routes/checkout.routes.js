import { Router } from "express";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth } from "../middleware/seguridad.js";
import { postPedidoWeb } from "../controllers/checkout.controller.js";

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

router.post(
  "/pedidos",
  checkoutLimiter,
  body("items").isArray({ min: 1, max: 50 }),
  body("items.*.variante_id").optional().isUUID(),
  body("items.*.varianteId").optional().isUUID(),
  body("items.*.cantidad").isInt({ min: 1, max: 100 }),
  body("direccion_id").isUUID(),
  body("metodo_pago").isString().isLength({ min: 3, max: 40 }),
  body("referencia_externa").optional({ nullable: true }).isLength({ max: 150 }),
  body("cupon_codigo").optional({ nullable: true }).isLength({ max: 30 }),
  body("observaciones").optional({ nullable: true }).isLength({ max: 500 }),
  validar,
  postPedidoWeb,
);

export default router;
