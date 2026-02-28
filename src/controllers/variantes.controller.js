import {
  adjustStockVariante,
  listVariantesByProductoPublic,
  createVariante,
  updateVariante,
  setVarianteStatus,
} from "../models/variantes.model.js";

export async function patchVarianteStock(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const varianteId = req.params.id;
    const { cantidad, motivo } = req.body || {};

    if (!Number.isInteger(cantidad) || cantidad === 0) {
      return res
        .status(400)
        .json({ ok: false, msg: "cantidad debe ser entero distinto de 0" });
    }
    if (!motivo || String(motivo).trim().length < 3) {
      return res
        .status(400)
        .json({ ok: false, msg: "motivo es requerido (mínimo 3 caracteres)" });
    }

    const updated = await adjustStockVariante(req.db, {
      varianteId,
      usuarioId: req.user.id,
      cantidad,
      motivo: String(motivo).trim(),
    });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error("patchVarianteStock error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error ajustando stock", detail: err.message });
  }
}

export async function getVariantesProducto(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const productoId = String(req.params.id);
    const data = await listVariantesByProductoPublic(req.db, productoId);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getVariantesProducto error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error listando variantes",
        detail: err.message,
      });
  }
}

export async function postVariantesProducto(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const producto_id = String(req.params.id);
    const body = req.body;

    const items = Array.isArray(body) ? body : [body];

    if (items.length === 0)
      return res.status(400).json({ ok: false, msg: "Body vacío" });

    const created = [];
    for (const it of items) {
      const talla_id = it?.talla_id ? Number(it.talla_id) : null;
      const color_id = it?.color_id ? Number(it.color_id) : null;

      const row = await createVariante(req.db, {
        producto_id,
        talla_id: Number.isFinite(talla_id) ? talla_id : null,
        color_id: Number.isFinite(color_id) ? color_id : null,
        sku: it?.sku ? String(it.sku).trim() : null,
        codigo_barras: it?.codigo_barras
          ? String(it.codigo_barras).trim()
          : null,
        precio_venta:
          it?.precio_venta !== undefined && it?.precio_venta !== null
            ? Number(it.precio_venta)
            : null,
        precio_costo:
          it?.precio_costo !== undefined && it?.precio_costo !== null
            ? Number(it.precio_costo)
            : null,
        stock_fisico: Number.isInteger(it?.stock_fisico) ? it.stock_fisico : 0,
        activo: it?.activo !== false,
      });

      created.push(row);
    }

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({
          ok: false,
          msg: "Variante duplicada (talla/color) o SKU/Barcode repetido",
          detail: err.detail,
        });
    }
    console.error("postVariantesProducto error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando variantes", detail: err.message });
  }
}

export async function patchVariante(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = String(req.params.id);
    const updated = await updateVariante(req.db, id, req.body || {});
    if (!updated)
      return res.status(404).json({ ok: false, msg: "Variante no encontrada" });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({
          ok: false,
          msg: "Variante duplicada o SKU/Barcode repetido",
          detail: err.detail,
        });
    }
    console.error("patchVariante error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error actualizando variante",
        detail: err.message,
      });
  }
}

export async function patchVarianteStatus(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = String(req.params.id);
    const { activo } = req.body || {};
    if (typeof activo !== "boolean")
      return res
        .status(400)
        .json({ ok: false, msg: "activo debe ser boolean" });

    const row = await setVarianteStatus(req.db, id, activo);
    if (!row)
      return res.status(404).json({ ok: false, msg: "Variante no encontrada" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchVarianteStatus error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}
