import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
} from "../middleware/seguridad.js";
import {
  postVentaPOS,
  postCancelarVentaPOS,
  postApartado,
  postAbono,
  postLiquidar,
  postCancelar,
  postAbrirCorte,
  getCorteActual,
  postCerrarCorte,
  getCorteDetalle,
  getHistorial,
  getVentaTicketPdf,
  getHistorialVentasPOS,
  getVentaHistorialPOSById,
} from "../controllers/ventas.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth);

function requireCreditPermissionWhenNeeded(req, res, next) {
  const metodo = String(req.body?.metodo_pago || "")
    .trim()
    .toUpperCase();

  if (metodo !== "CREDITO_TIENDA") return next();

  return requirePermission("credito.create")(req, res, next);
}

router.post(
  "/pos",
  requireAnyPermission("ventas.pos.create", "ventas.pedidos.create"),
  requireCreditPermissionWhenNeeded,
  postVentaPOS,
);
router.post(
  "/pos/:id/cancelar",
  requireAnyPermission(
    "ventas.pos.refund.own",
    "ventas.pos.refund.any",
    "ventas.pos.refund",
  ),
  postCancelarVentaPOS,
);

router.get(
  "/historial",
  requireAnyPermission("ventas.pos.read", "ventas.pedidos.read"),
  getHistorialVentasPOS,
);
router.get(
  "/historial/:id",
  requireAnyPermission("ventas.pos.read", "ventas.pedidos.read"),
  getVentaHistorialPOSById,
);

router.post(
  "/apartados",
  requireAnyPermission("ventas.apartados.create", "ventas.pedidos.create"),
  postApartado,
);
router.post(
  "/apartados/:id/abonos",
  requireAnyPermission("ventas.apartados.abono", "ventas.pedidos.update"),
  postAbono,
);
router.post(
  "/apartados/:id/liquidar",
  requireAnyPermission("ventas.apartados.liquidar", "ventas.pedidos.update"),
  postLiquidar,
);
router.post(
  "/apartados/:id/cancelar",
  requireAnyPermission("ventas.apartados.cancel", "ventas.pedidos.cancel"),
  postCancelar,
);

router.post(
  "/corte/abrir",
  requirePermission("ventas.corte_caja.create"),
  postAbrirCorte,
);
router.get(
  "/corte/actual",
  requirePermission("ventas.corte_caja.read"),
  getCorteActual,
);
router.get(
  "/corte/historial",
  requireAnyPermission("ventas.corte_caja.history", "ventas.corte_caja.read"),
  getHistorial,
);
router.get(
  "/corte/:id",
  requireAnyPermission("ventas.corte_caja.history", "ventas.corte_caja.read"),
  getCorteDetalle,
);
router.post(
  "/corte/:id/cerrar",
  requirePermission("ventas.corte_caja.close"),
  postCerrarCorte,
);

router.get(
  "/pos/:id/ticket",
  requireAnyPermission(
    "ventas.pos.ticket.read",
    "ventas.pagos.read",
    "ventas.pedidos.read",
  ),
  getVentaTicketPdf,
);

export default router;
