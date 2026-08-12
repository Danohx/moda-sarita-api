import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
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

router.use(useInternalDb, requireAuth);
router.get("/", requirePermission("clientes.clientes.read"), getClientes);
router.post("/", requirePermission("clientes.clientes.create"), postCliente);
router.get(
  "/:id/creditos",
  requireAnyPermission("credito.view", "credito.read"),
  getCreditosCliente,
);
router.get("/:id", requirePermission("clientes.clientes.read"), getCliente);
router.patch(
  "/:id",
  requirePermission("clientes.clientes.update"),
  patchCliente,
);
router.patch(
  "/:id/credito",
  requirePermission("clientes.clientes.credito.manage"),
  patchCredito,
);
router.get(
  "/:id/movimientos-credito",
  requireAnyPermission("credito.view", "credito.read"),
  getClienteMovimientosCredito,
);
router.post(
  "/:id/abonos",
  requirePermission("credito.payments.create"),
  postAbonoCredito,
);
router.post(
  "/:id/direcciones",
  requirePermission("clientes.direcciones.create"),
  postDireccion,
);
router.patch(
  "/:id/direcciones/:direccionId/principal",
  requirePermission("clientes.direcciones.update"),
  patchDireccionPrincipal,
);
router.delete(
  "/:id/direcciones/:direccionId",
  requirePermission("clientes.direcciones.delete"),
  deleteDireccionById,
);
router.patch(
  "/:id/puede-apartar",
  requirePermission("clientes.clientes.update"),
  patchClientePuedeApartar,
);

export default router;
