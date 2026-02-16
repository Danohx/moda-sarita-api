import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { suscribirUsuario, anunciarLanzamiento } from "../controllers/suscripcion.controller.js";
import { useInternalDb, usePublicDb } from "../middleware/dbContext.js"
import { requireAuth, requirePermission } from "../middleware/seguridad.js"

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

const subscribeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: "Demasiadas solicitudes. Intenta más tarde." },
});

const launchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: "Límite de lanzamientos alcanzado." },
});

router.post(
  "/",
  subscribeLimiter,
  usePublicDb,
  body("email").trim().isEmail().normalizeEmail(),
  validar,
  suscribirUsuario
);

router.post("/lanzamiento-oficial", useInternalDb, requireAuth, requirePermission("marketing.suscripciones.create"), launchLimiter, anunciarLanzamiento);

export default router;
