import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { mensaje: "Demasiados intentos. Espera 5 minutos." },
});

export const magicLinkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.correo || req.ip,
  message: { mensaje: "Límite alcanzado. Espera 10 minutos." },
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.correo || req.ip,
  message: { mensaje: "Has superado el límite. Espera 5 minutos." },
});
