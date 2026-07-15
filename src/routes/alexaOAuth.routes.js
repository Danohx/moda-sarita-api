// src/routes/alexaOAuth.routes.js

import express, { Router } from "express";
import rateLimit from "express-rate-limit";

import { useInternalDb } from "../middleware/dbContext.js";

import {
  getAlexaAuthorize,
  postAlexaAuthorize,
  postAlexaToken,
} from "../controllers/alexaOAuth.controller.js";

const router = Router();

const authorizeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Demasiados intentos de vinculación. Intenta más tarde.",
});

const tokenLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "temporarily_unavailable",
    error_description: "Demasiadas solicitudes de token. Intenta más tarde.",
  },
});

router.use(useInternalDb);

router.get(
  "/authorize",
  authorizeLimiter,
  getAlexaAuthorize,
);

router.post(
  "/authorize",
  authorizeLimiter,
  express.urlencoded({
    extended: false,
    limit: "20kb",
  }),
  postAlexaAuthorize,
);

router.post(
  "/token",
  tokenLimiter,
  express.urlencoded({
    extended: false,
    limit: "20kb",
  }),
  postAlexaToken,
);

export default router;
