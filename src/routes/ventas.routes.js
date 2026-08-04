import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import {
  requireAuth,
  requirePermission,
  requireRole,
} from "../middleware/seguridad.js";
import {
  postVentaPOS,
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

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

function requireCreditPermissionWhenNeeded(req, res, next) {
  const metodo = String(req.body?.metodo_pago || "")
    .trim()
    .toUpperCase();

  if (metodo !== "CREDITO_TIENDA") return next();

  return requirePermission("credito.create")(req, res, next);
}

router.post("/pos", requireCreditPermissionWhenNeeded, postVentaPOS);

router.get("/historial", getHistorialVentasPOS);
router.get("/historial/:id", getVentaHistorialPOSById);

router.post("/apartados", postApartado);
router.post("/apartados/:id/abonos", postAbono);
router.post("/apartados/:id/liquidar", postLiquidar);
router.post("/apartados/:id/cancelar", postCancelar);

router.post("/corte/abrir", postAbrirCorte);
router.get("/corte/actual", getCorteActual);
router.get("/corte/historial", getHistorial);
router.get("/corte/:id", getCorteDetalle);
router.post("/corte/:id/cerrar", postCerrarCorte);

router.get("/pos/:id/ticket", getVentaTicketPdf);

export default router;