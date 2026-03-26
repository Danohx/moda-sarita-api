import { getProductoDetallePublic } from "../models/productoDetalle.model.js";

export async function getProductoDetalle(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const productoId = String(req.params.id);
    const data = await getProductoDetallePublic(req.db, productoId);

    if (!data) {
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getProductoDetalle error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo detalle",
      detail: err.message,
    });
  }
}