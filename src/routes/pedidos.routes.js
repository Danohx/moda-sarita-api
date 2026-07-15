import { Router } from "express";
import { body, param, validationResult } from "express-validator";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  getPedidosAdmin,
  getPedidoByIdAdmin,
  postAbonoApartado,
  postCancelarApartado,
  postLiquidarApartado,
  postVencerApartadosExpirados,
  getPedidoTicketPdf,
  getPagoTicketPdf,
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

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.get("/", getPedidosAdmin);
router.post("/vencer-expirados", postVencerApartadosExpirados);
router.get("/vencer-expirados", postVencerApartadosExpirados);

router.post(
  "/:id/confirmar-pago-web",
  param("id").isUUID(),
  body("referencia_externa")
    .optional({ nullable: true })
    .isLength({ max: 150 }),
  validar,
  postConfirmarPagoWeb,
);
router.post(
  "/:id/cancelar-web",
  param("id").isUUID(),
  body("motivo_cancelacion").trim().isLength({ min: 3, max: 500 }),
  validar,
  postCancelarPedidoWeb,
);

router.get("/:id", getPedidoByIdAdmin);
router.get("/:id/ticket", getPedidoTicketPdf);
router.get("/:id/pagos/:pagoId/ticket", getPagoTicketPdf);
router.post("/:id/abonos", postAbonoApartado);
router.post("/:id/cancelar", postCancelarApartado);
router.post("/:id/liquidar", postLiquidarApartado);

export default router;
