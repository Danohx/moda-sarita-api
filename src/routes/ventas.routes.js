import { Router } from "express";
import { useInternalDb } from "../middleware/dbContext.js";
import { requireAuth, requireRole } from "../middleware/seguridad.js";
import {
  postVentaPOS,
  postApartado,
  postAbono,
  postLiquidar,
  postCancelar,
  postAbrirCorte,
  getCorteActual,
  postCerrarCorte,
} from "../controllers/ventas.controller.js";

const router = Router();

router.use(useInternalDb, requireAuth, requireRole("ADMIN", "EMPLEADO"));

router.post("/pos", postVentaPOS);

router.post("/apartados", postApartado);
router.post("/apartados/:id/abonos", postAbono);
router.post("/apartados/:id/liquidar", postLiquidar);
router.post("/apartados/:id/cancelar", postCancelar);

router.post("/corte/abrir", postAbrirCorte);
router.get("/corte/actual", getCorteActual);
router.post("/corte/:id/cerrar", postCerrarCorte);

export default router;
