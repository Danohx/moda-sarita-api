import {
  listTemporadasByProducto,
  assignTemporadasToProducto,
  removeTemporadaFromProducto,
} from "../models/productoTemporadas.model.js";

export async function getProductoTemporadas(req, res) {
  try {
    const productoId = String(req.params.id);
    const data = await listTemporadasByProducto(req.db, productoId);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, msg: "Error listando temporadas", detail: err.message });
  }
}

export async function postProductoTemporadas(req, res) {
  try {
    const productoId = String(req.params.id);
    const { temporada_ids } = req.body || {};

    if (!Array.isArray(temporada_ids)) {
      return res.status(400).json({ ok: false, msg: "temporada_ids debe ser un arreglo" });
    }

    const cleanIds = [...new Set(
      temporada_ids
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x))
    )];

    const data = await assignTemporadasToProducto(req.db, productoId, cleanIds);
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, msg: "Error asignando temporadas", detail: err.message });
  }
}

export async function deleteProductoTemporada(req, res) {
  try {
    const productoId = String(req.params.id);
    const temporadaId = Number(req.params.temporadaId);

    if (!Number.isFinite(temporadaId)) {
      return res.status(400).json({ ok: false, msg: "temporadaId inválido" });
    }

    const deleted = await removeTemporadaFromProducto(req.db, productoId, temporadaId);

    if (!deleted) {
      return res.status(404).json({ ok: false, msg: "Relación no encontrada" });
    }

    return res.json({ ok: true, msg: "Temporada removida del producto" });
  } catch (err) {
    return res.status(500).json({ ok: false, msg: "Error removiendo temporada", detail: err.message });
  }
}