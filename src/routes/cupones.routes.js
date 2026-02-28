import { Router } from "express";
import { useInternalDb, usePublicDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getCupones,
  postCupon,
  patchCupon,
  patchCuponStatus,
  validarCupon,
} from "../controllers/cupones.controller.js";

const router = Router();

router.get("/validar", usePublicDb, validarCupon);
router.get(
  "/",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN", "EMPLEADO"),
  getCupones,
);
router.post("/", useInternalDb, requireAuth, requireRole("ADMIN"), postCupon);
router.patch(
  "/:id",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN"),
  patchCupon,
);
router.patch(
  "/:id/status",
  useInternalDb,
  requireAuth,
  requireRole("ADMIN"),
  patchCuponStatus,
);

export default router;
