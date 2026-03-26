import {
  getVarianteById,
  adjustStockVariante,
  listVariantesByProductoPublic,
  listVariantesByProductoAdmin,
  createVariante,
  updateVariante,
  setVarianteStatus,
} from "../models/variantes.model.js";

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export async function getVariante(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const id = String(req.params.id);
    const row = await getVarianteById(req.db, id);

    if (!row) {
      return res.status(404).json({ ok: false, msg: "Variante no encontrada" });
    }

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("getVariante error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo variante",
      detail: err.message,
    });
  }
}

export async function patchVarianteStock(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const varianteId = String(req.params.id);
    const cantidad = toIntOrNull(req.body?.cantidad);
    const motivo = req.body?.motivo ? String(req.body.motivo).trim() : "";

    if (cantidad === null || cantidad === 0) {
      return res
        .status(400)
        .json({ ok: false, msg: "cantidad debe ser entero distinto de 0" });
    }

    if (!motivo || motivo.length < 3) {
      return res
        .status(400)
        .json({ ok: false, msg: "motivo es requerido (mínimo 3 caracteres)" });
    }

    const updated = await adjustStockVariante(req.db, {
      varianteId,
      usuarioId: req.user.id,
      cantidad,
      motivo,
    });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error("patchVarianteStock error:", err);

    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }

    if (err.code === "STOCK_NEGATIVO") {
      return res.status(409).json({ ok: false, msg: err.message });
    }

    return res
      .status(500)
      .json({ ok: false, msg: "Error ajustando stock", detail: err.message });
  }
}

export async function getVariantesProducto(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const productoId = String(req.params.id);
    const data = await listVariantesByProductoPublic(req.db, productoId);

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getVariantesProducto error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error listando variantes",
      detail: err.message,
    });
  }
}

export async function getVariantesProductoAdmin(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const productoId = String(req.params.id);
    const data = await listVariantesByProductoAdmin(req.db, productoId);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    console.error("getVariantesProductoAdmin error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo variantes del producto para admin",
      detail: err.message,
    });
  }
}

export async function postVariantesProducto(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const producto_id = String(req.params.id);
    const body = req.body;
    const items = Array.isArray(body) ? body : [body];

    if (items.length === 0) {
      return res.status(400).json({ ok: false, msg: "Body vacío" });
    }

    const created = [];

    for (const it of items) {
      const talla_id = toIntOrNull(it?.talla_id);
      const color_id = toIntOrNull(it?.color_id);
      const sku = it?.sku ? String(it.sku).trim() : "";
      const codigo_barras = it?.codigo_barras
        ? String(it.codigo_barras).trim()
        : null;

      const precio_venta = toNumberOrNull(it?.precio_venta);
      const precio_costo = toNumberOrNull(it?.precio_costo);
      const stock_fisico = toIntOrNull(it?.stock_fisico);
      const stock_apartado = toIntOrNull(it?.stock_apartado);
      const stock_minimo = toIntOrNull(it?.stock_minimo);

      if (!sku || sku.length < 2) {
        return res.status(400).json({
          ok: false,
          msg: "Cada variante requiere sku (mínimo 2 caracteres)",
        });
      }

      if (precio_venta === null || precio_venta < 0) {
        return res.status(400).json({
          ok: false,
          msg: "Cada variante requiere precio_venta >= 0",
        });
      }

      if (precio_costo !== null && precio_costo < 0) {
        return res.status(400).json({
          ok: false,
          msg: "precio_costo debe ser >= 0",
        });
      }

      if (precio_costo !== null && precio_venta < precio_costo) {
        return res.status(400).json({
          ok: false,
          msg: "precio_venta debe ser mayor o igual a precio_costo",
        });
      }

      if (stock_fisico !== null && stock_fisico < 0) {
        return res.status(400).json({
          ok: false,
          msg: "stock_fisico debe ser entero >= 0",
        });
      }

      if (stock_apartado !== null && stock_apartado < 0) {
        return res.status(400).json({
          ok: false,
          msg: "stock_apartado debe ser entero >= 0",
        });
      }

      if (stock_minimo !== null && stock_minimo < 0) {
        return res.status(400).json({
          ok: false,
          msg: "stock_minimo debe ser entero >= 0",
        });
      }

      const row = await createVariante(req.db, {
        producto_id,
        talla_id,
        color_id,
        sku,
        codigo_barras,
        precio_venta,
        precio_costo,
        stock_fisico: stock_fisico ?? 0,
        stock_apartado: stock_apartado ?? 0,
        stock_minimo: stock_minimo ?? 5,
        activo: it?.activo !== false,
      });

      created.push(row);
    }

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        msg: "Variante duplicada, SKU repetido, código de barras repetido o combinación de variante repetida",
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
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const id = String(req.params.id);
    const body = req.body || {};

    const payload = {};

    if (Object.prototype.hasOwnProperty.call(body, "talla_id")) {
      payload.talla_id = toIntOrNull(body.talla_id);
    }

    if (Object.prototype.hasOwnProperty.call(body, "color_id")) {
      payload.color_id = toIntOrNull(body.color_id);
    }

    if (Object.prototype.hasOwnProperty.call(body, "sku")) {
      const sku = body.sku === null ? null : String(body.sku).trim();
      if (!sku || sku.length < 2) {
        return res.status(400).json({
          ok: false,
          msg: "sku debe tener mínimo 2 caracteres",
        });
      }
      payload.sku = sku;
    }

    if (Object.prototype.hasOwnProperty.call(body, "codigo_barras")) {
      payload.codigo_barras =
        body.codigo_barras === null ? null : String(body.codigo_barras).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, "precio_venta")) {
      const precio_venta = toNumberOrNull(body.precio_venta);
      if (precio_venta === null || precio_venta < 0) {
        return res.status(400).json({
          ok: false,
          msg: "precio_venta debe ser >= 0",
        });
      }
      payload.precio_venta = precio_venta;
    }

    if (Object.prototype.hasOwnProperty.call(body, "precio_costo")) {
      const precio_costo = toNumberOrNull(body.precio_costo);
      if (precio_costo !== null && precio_costo < 0) {
        return res.status(400).json({
          ok: false,
          msg: "precio_costo debe ser >= 0",
        });
      }
      payload.precio_costo = precio_costo;
    }

    if (Object.prototype.hasOwnProperty.call(body, "stock_minimo")) {
      const stock_minimo = toIntOrNull(body.stock_minimo);
      if (stock_minimo === null || stock_minimo < 0) {
        return res.status(400).json({
          ok: false,
          msg: "stock_minimo debe ser entero >= 0",
        });
      }
      payload.stock_minimo = stock_minimo;
    }

    if (
      payload.precio_venta !== undefined &&
      payload.precio_costo !== undefined &&
      payload.precio_costo !== null &&
      payload.precio_venta < payload.precio_costo
    ) {
      return res.status(400).json({
        ok: false,
        msg: "precio_venta debe ser mayor o igual a precio_costo",
      });
    }

    const updated = await updateVariante(req.db, id, payload);

    if (!updated) {
      return res.status(404).json({ ok: false, msg: "Variante no encontrada" });
    }

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        msg: "Variante duplicada, SKU repetido, código de barras repetido o combinación de variante repetida",
        detail: err.detail,
      });
    }

    console.error("patchVariante error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error actualizando variante",
      detail: err.message,
    });
  }
}

export async function patchVarianteStatus(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const id = String(req.params.id);
    const { activo } = req.body || {};

    if (typeof activo !== "boolean") {
      return res
        .status(400)
        .json({ ok: false, msg: "activo debe ser boolean" });
    }

    const row = await setVarianteStatus(req.db, id, activo);

    if (!row) {
      return res.status(404).json({ ok: false, msg: "Variante no encontrada" });
    }

    return res.json({ ok: true, data: row });
  } catch (err) {
    if (err.code === "LAST_ACTIVE_VARIANT") {
      return res.status(409).json({ ok: false, msg: err.message });
    }

    console.error("patchVarianteStatus error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}