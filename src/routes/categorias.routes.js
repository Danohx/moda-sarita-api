import { Router } from "express";
import { usePublicDb, useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getCategorias,
  postCategoria,
  patchCategoria,
  patchCategoriaStatus,
} from "../controllers/categorias.controller.js";

const router = Router();

router.get("/", usePublicDb, getCategorias);

router.post("/", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), postCategoria);
router.patch("/:id", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchCategoria);
router.patch("/:id/status", useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"), patchCategoriaStatus);

export default router;