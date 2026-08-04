import {
  obtenerCorteActualDetallado,
  obtenerCorteDetalladoPorId,
} from "../models/corteCaja.model.js";

export async function getCorteActualDetallado(req, res) {
  try {
    const data = await obtenerCorteActualDetallado(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("getCorteActualDetallado error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error consultando el corte detallado",
      detail: error.message,
    });
  }
}

export async function getCorteDetalladoPorId(req, res) {
  try {
    const corteId = Number(req.params.id);

    if (!Number.isInteger(corteId) || corteId <= 0) {
      return res.status(400).json({ ok: false, msg: "ID de corte invalido" });
    }

    const data = await obtenerCorteDetalladoPorId(req.db, corteId, req.user);
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("getCorteDetalladoPorId error:", error);

    if (error.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: error.message });
    }

    if (error.code === "FORBIDDEN") {
      return res.status(403).json({ ok: false, msg: error.message });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error consultando el corte detallado",
      detail: error.message,
    });
  }
}
