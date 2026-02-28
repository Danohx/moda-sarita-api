import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getProveedores,
  postProveedor,
  patchProveedor,
  patchProveedorStatus,
} from "../controllers/proveedores.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.get("/", getProveedores);
router.post("/", postProveedor);
router.patch("/:id", patchProveedor);
router.patch("/:id/status", patchProveedorStatus);

export default router;
