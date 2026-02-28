import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getClientes,
  getCliente,
  postCliente,
  patchCliente,
  patchCredito,
  postDireccion,
  patchDireccionPrincipal,
  deleteDireccionById,
} from "../controllers/clientes.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));
router.get("/", getClientes);
router.post("/", postCliente);
router.get("/:id", getCliente);
router.patch("/:id", patchCliente);
router.patch("/:id/credito", requireRole("ADMIN"), patchCredito);
router.post("/:id/direcciones", postDireccion);
router.patch(
  "/:id/direcciones/:direccionId/principal",
  patchDireccionPrincipal,
);
router.delete("/:id/direcciones/:direccionId", deleteDireccionById);

export default router;
