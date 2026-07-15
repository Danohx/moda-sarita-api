import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import {
  register,
  login,
  sendMagicLink,
  verifyMagicLink,
  verifyLogin2FA,
  requestPasswordReset,
  resetPassword,
  refreshSession,
  logout,
  revokeAllSessions,
  verifySession,
  getMe,
} from "../controllers/auth.controller.js";
import { useInternalDb } from "../middleware/dbContext.js";
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

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: "Demasiados intentos. Intenta más tarde." },
});

const magicLinkLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: "Demasiadas solicitudes. Intenta más tarde." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, msg: "Has superado el límite. Espera 5 minutos." },
});

router.use(useInternalDb);

router.post(
  "/register",
  body("nombre")
    .trim()
    .notEmpty()
    .matches(/^[a-zA-ZÁ-ÿ\u00f1\u00d1\s]+$/),
  body("apellidoPaterno")
    .trim()
    .notEmpty()
    .matches(/^[a-zA-ZÁ-ÿ\u00f1\u00d1\s]+$/),
  body("apellidoMaterno")
    .optional({ nullable: true })
    .trim()
    .matches(/^[a-zA-ZÁ-ÿ\u00f1\u00d1\s]*$/),
  body("correo").trim().isEmail().normalizeEmail(),
  body("contrasena").isString().isLength({ min: 8 }),
  validar,
  register,
);

router.post(
  "/login",
  loginLimiter,
  body("correo").trim().isEmail().normalizeEmail(),
  body("contrasena").isString().notEmpty(),
  validar,
  login,
);

router.post(
  "/magic-link",
  magicLinkLimiter,
  body("correo").trim().isEmail().normalizeEmail(),
  validar,
  sendMagicLink,
);

router.post(
  "/magic-verify",
  body("token").isString().notEmpty(),
  validar,
  verifyMagicLink,
);

router.post(
  "/2fa-verify",
  body("tempToken").isString().notEmpty(),
  body("otpCode").isString().notEmpty(),
  validar,
  verifyLogin2FA,
);

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  body("correo").trim().isEmail().normalizeEmail(),
  validar,
  requestPasswordReset,
);

router.post(
  "/reset-password",
  body("token").isString().notEmpty(),
  body("nuevaContrasena").isString().isLength({ min: 8 }),
  validar,
  resetPassword,
);

router.post(
  "/refresh-token",
  body("refreshToken").isString().notEmpty(),
  validar,
  refreshSession,
);

router.post(
  "/logout",
  body("refreshToken").optional().isString(),
  validar,
  logout,
);

router.post("/revoke-all", requireAuth, revokeAllSessions);
router.get("/verify", requireAuth, verifySession);
router.get("/me", requireAuth, getMe);

router.get(
  "/rbac-test",
  requireAuth,
  requirePermission("seguridad.roles.manage"),
  (req, res) => {
    res.json({
      ok: true,
      mensaje: "Tienes permiso seguridad.roles.manage",
      user: req.user,
    });
  },
);

export default router;
