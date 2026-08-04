import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/seguridad.js";
import {
  getClientes,
  getCliente,
  postCliente,
  patchCliente,
  patchCredito,
  postDireccion,
  patchDireccionPrincipal,
  deleteDireccionById,
  postAbonoCredito,
  getClienteMovimientosCredito,
  patchClientePuedeApartar,
} from "../controllers/clientes.controller.js";
import { getCreditosCliente } from "../controllers/credito.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));
router.get("/", getClientes);
router.post("/", postCliente);
router.get(
  "/:id/creditos",
  requirePermission("credito.view"),
  getCreditosCliente,
);
router.get("/:id", getCliente);
router.patch("/:id", patchCliente);
router.patch("/:id/credito", requireRole("ADMIN"), patchCredito);
router.get("/:id/movimientos-credito", getClienteMovimientosCredito);
router.post("/:id/abonos", postAbonoCredito);
router.post("/:id/direcciones", postDireccion);
router.patch(
  "/:id/direcciones/:direccionId/principal",
  patchDireccionPrincipal,
);
router.delete("/:id/direcciones/:direccionId", deleteDireccionById);
router.patch("/:id/puede-apartar", patchClientePuedeApartar);

export default router;
