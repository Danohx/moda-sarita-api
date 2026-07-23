import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  deleteDireccion,
  getCredito,
  getDirecciones,
  getMovimientosCredito,
  getPedidoById,
  getPedidos,
  getPerfil,
  patchCostoEnvioAdmin,
  patchDireccionPrincipal,
  patchPerfil,
  postCancelarPedido,
  postConfirmarPagoAdmin,
  postDireccion,
  postPedido,
} from "../controllers/tienda.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth);

router.patch(
  "/admin/pedidos/:id/costo-envio",
  requireRole("ADMIN", "EMPLEADO"),
  patchCostoEnvioAdmin,
);
router.post(
  "/admin/pedidos/:id/confirmar-pago",
  requireRole("ADMIN", "EMPLEADO"),
  postConfirmarPagoAdmin,
);

router.get("/perfil", getPerfil);
router.patch("/perfil", patchPerfil);

router.get("/direcciones", getDirecciones);
router.post("/direcciones", postDireccion);
router.patch("/direcciones/:id/principal", patchDireccionPrincipal);
router.delete("/direcciones/:id", deleteDireccion);

router.get("/credito", getCredito);
router.get("/credito/movimientos", getMovimientosCredito);

router.get("/pedidos", getPedidos);
router.post("/pedidos", postPedido);
router.get("/pedidos/:id", getPedidoById);
router.post("/pedidos/:id/cancelar", postCancelarPedido);

export default router;
