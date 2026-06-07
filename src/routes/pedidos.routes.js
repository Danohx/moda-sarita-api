import { Router } from "express";
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

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.get("/", getPedidosAdmin);
router.post("/vencer-expirados", postVencerApartadosExpirados);
router.get("/vencer-expirados", postVencerApartadosExpirados);
router.get("/:id", getPedidoByIdAdmin);
router.get("/:id/ticket", getPedidoTicketPdf);
router.get("/:id/pagos/:pagoId/ticket", getPagoTicketPdf);
router.post("/:id/abonos", postAbonoApartado);
router.post("/:id/cancelar", postCancelarApartado);
router.post("/:id/liquidar", postLiquidarApartado);

export default router;
