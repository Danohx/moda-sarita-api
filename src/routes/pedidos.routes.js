import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requireAnyPermission,
  requirePermission,
} from "../middleware/seguridad.js";
import {
  getPedidosAdmin,
  getPedidoByIdAdmin,
  postAbonoApartado,
  postCancelarApartado,
  postLiquidarApartado,
  postVencerApartadosExpirados,
  getPedidoTicketPdf,
  getPagoTicketPdf,
  patchEstadoPedidoWeb,
} from "../controllers/pedidos.controller.js";
import {
  postCancelarPedidoWeb,
  postConfirmarPagoWeb,
} from "../controllers/pedidos-web.controller.js";

const router = Router();

function validar(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      msg: "Datos inválidos",
      errores: errors.array(),
    });
  }
  next();
}

router.use(useInternalDb, requireAuth);

router.get(
  "/",
  requireAnyPermission("ventas.pedidos.read", "ventas.apartados.read"),
  getPedidosAdmin,
);
router.post(
  "/vencer-expirados",
  requireAnyPermission("ventas.apartados.cancel", "ventas.pedidos.update"),
  postVencerApartadosExpirados,
);
router.get(
  "/vencer-expirados",
  requireAnyPermission("ventas.apartados.cancel", "ventas.pedidos.update"),
  postVencerApartadosExpirados,
);

router.post(
  "/:id/confirmar-pago-web",
  requirePermission("ventas.pedidos.update"),
  param("id").isUUID(),
  body("referencia_externa")
    .optional({ nullable: true })
    .isLength({ max: 150 }),
  validar,
  postConfirmarPagoWeb,
);
router.post(
  "/:id/cancelar-web",
  requirePermission("ventas.pedidos.cancel"),
  param("id").isUUID(),
  body("motivo_cancelacion").trim().isLength({ min: 3, max: 500 }),
  validar,
  postCancelarPedidoWeb,
);

router.get(
  "/:id",
  requireAnyPermission("ventas.pedidos.read", "ventas.apartados.read"),
  getPedidoByIdAdmin,
);
router.get(
  "/:id/ticket",
  requireAnyPermission(
    "ventas.pedidos.read",
    "ventas.apartados.read",
    "ventas.pos.ticket.read",
  ),
  getPedidoTicketPdf,
);
router.get(
  "/:id/pagos/:pagoId/ticket",
  requireAnyPermission("ventas.pagos.read", "ventas.apartados.read"),
  getPagoTicketPdf,
);
router.post(
  "/:id/abonos",
  requireAnyPermission("ventas.apartados.abono", "ventas.pedidos.update"),
  postAbonoApartado,
);
router.post(
  "/:id/cancelar",
  requireAnyPermission("ventas.apartados.cancel", "ventas.pedidos.cancel"),
  postCancelarApartado,
);
router.post(
  "/:id/liquidar",
  requireAnyPermission("ventas.apartados.liquidar", "ventas.pedidos.update"),
  postLiquidarApartado,
);
router.patch(
  "/:id/estado-web",
  requirePermission("ventas.pedidos.update"),
  patchEstadoPedidoWeb,
);

export default router;
