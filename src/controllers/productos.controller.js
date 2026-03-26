import {
  listProductosPublic,
  listProductosAdmin,
  getProductoPublicById,
  createProductoConVarianteBase,
  updateProducto,
  setProductoStatus,
  setProductoDestacado,
  getProductoAdminByIdModel
} from "../models/productos.model.js";

function toBoolOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  return null;
}

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

export async function getProductos(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const q = req.query.q ? String(req.query.q) : null;
    const categoriaId = req.query.categoriaId
      ? Number(req.query.categoriaId)
      : null;
    const destacado = toBoolOrNull(req.query.destacado);

    const data = await listProductosPublic(req.db, {
      q,
      categoriaId: Number.isFinite(categoriaId) ? categoriaId : null,
      destacado,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getProductos error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error listando productos",
      detail: err.message,
    });
  }
}

export async function getProductosAdmin(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        msg: "DB context no configurado (req.db)",
      });
    }

    const q = req.query.q ? String(req.query.q) : null;
    const categoriaId = req.query.categoriaId
      ? Number(req.query.categoriaId)
      : null;
    const destacado = toBoolOrNull(req.query.destacado);
    const activo = toBoolOrNull(req.query.activo);

    const data = await listProductosAdmin(req.db, {
      q,
      categoriaId: Number.isFinite(categoriaId) ? categoriaId : null,
      destacado,
      activo,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getProductosAdmin error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error listando productos",
      detail: err.message,
    });
  }
}

export async function getProductoById(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const id = String(req.params.id);
    const row = await getProductoPublicById(req.db, id);

    if (!row) {
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });
    }

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("getProductoById error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo producto",
      detail: err.message,
    });
  }
}

export async function getProductoAdminById(req, res) {
  try {
    const data = await getProductoAdminByIdModel(req.db, req.params.id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        message: "Producto no encontrado",
      });
    }

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getProductoAdminById error:", error);
    return res.status(500).json({
      ok: false,
      message: "Error al obtener producto admin",
    });
  }
}

export async function postProducto(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const {
      nombre,
      descripcion = null,
      categoria_id = null,
      proveedor_id = null,
      destacado = false,
      slug = null,
      maneja_variantes = true,
      variante_base,
    } = req.body || {};

    if (!nombre || String(nombre).trim().length < 2) {
      return res
        .status(400)
        .json({ ok: false, msg: "nombre requerido (mínimo 2 chars)" });
    }

    if (!variante_base || typeof variante_base !== "object") {
      return res.status(400).json({
        ok: false,
        msg: "variante_base es requerida",
      });
    }

    const sku = variante_base?.sku ? String(variante_base.sku).trim() : "";
    const codigo_barras = variante_base?.codigo_barras
      ? String(variante_base.codigo_barras).trim()
      : null;

    const precio_venta = toNumberOrNull(variante_base?.precio_venta);
    const precio_costo = toNumberOrNull(variante_base?.precio_costo);
    const stock_fisico = toIntOrNull(variante_base?.stock_fisico);
    const stock_apartado = toIntOrNull(variante_base?.stock_apartado);
    const stock_minimo = toIntOrNull(variante_base?.stock_minimo);
    const talla_id = toIntOrNull(variante_base?.talla_id);
    const color_id = toIntOrNull(variante_base?.color_id);

    if (!sku || sku.length < 2) {
      return res.status(400).json({
        ok: false,
        msg: "variante_base.sku es requerido (mínimo 2 caracteres)",
      });
    }

    if (precio_venta === null || precio_venta < 0) {
      return res.status(400).json({
        ok: false,
        msg: "variante_base.precio_venta es requerido y debe ser >= 0",
      });
    }

    if (precio_costo !== null && precio_costo < 0) {
      return res.status(400).json({
        ok: false,
        msg: "variante_base.precio_costo debe ser >= 0",
      });
    }

    if (precio_costo !== null && precio_venta < precio_costo) {
      return res.status(400).json({
        ok: false,
        msg: "variante_base.precio_venta debe ser mayor o igual a precio_costo",
      });
    }

    if (stock_fisico !== null && stock_fisico < 0) {
      return res.status(400).json({
        ok: false,
        msg: "variante_base.stock_fisico debe ser entero >= 0",
      });
    }

    if (stock_apartado !== null && stock_apartado < 0) {
      return res.status(400).json({
        ok: false,
        msg: "variante_base.stock_apartado debe ser entero >= 0",
      });
    }

    if (stock_minimo !== null && stock_minimo < 0) {
      return res.status(400).json({
        ok: false,
        msg: "variante_base.stock_minimo debe ser entero >= 0",
      });
    }

    const created = await createProductoConVarianteBase(req.db, {
      nombre: String(nombre).trim(),
      descripcion,
      categoria_id: categoria_id ? Number(categoria_id) : null,
      proveedor_id: proveedor_id ? Number(proveedor_id) : null,
      destacado: !!destacado,
      slug: slug ? String(slug).trim() : null,
      maneja_variantes: maneja_variantes !== false,
      variante_base: {
        talla_id,
        color_id,
        sku,
        codigo_barras,
        precio_venta,
        precio_costo,
        stock_fisico: stock_fisico ?? 0,
        stock_apartado: stock_apartado ?? 0,
        stock_minimo: stock_minimo ?? 5,
        activo: variante_base?.activo !== false,
      },
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        msg: "Slug, SKU, código de barras o combinación de variante duplicada",
        detail: err.detail,
      });
    }

    console.error("postProducto error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error creando producto",
      detail: err.message,
    });
  }
}

export async function patchProducto(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const id = String(req.params.id);
    const body = req.body || {};

    const payload = {
      nombre:
        body.nombre !== undefined ? String(body.nombre).trim() || null : null,
      descripcion:
        body.descripcion !== undefined ? body.descripcion ?? null : null,
      categoria_id:
        body.categoria_id !== undefined
          ? body.categoria_id
            ? Number(body.categoria_id)
            : null
          : null,
      proveedor_id:
        body.proveedor_id !== undefined
          ? body.proveedor_id
            ? Number(body.proveedor_id)
            : null
          : null,
      slug: body.slug !== undefined ? String(body.slug).trim() || null : null,
      maneja_variantes:
        body.maneja_variantes !== undefined
          ? body.maneja_variantes === null
            ? null
            : body.maneja_variantes !== false
          : null,
    };

    if (body.nombre !== undefined && (!payload.nombre || payload.nombre.length < 2)) {
      return res.status(400).json({
        ok: false,
        msg: "nombre debe tener mínimo 2 caracteres",
      });
    }

    const updated = await updateProducto(req.db, id, payload);

    if (!updated) {
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });
    }

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        msg: "Slug duplicado",
        detail: err.detail,
      });
    }

    console.error("patchProducto error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error actualizando producto",
      detail: err.message,
    });
  }
}

export async function patchProductoStatus(req, res) {
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

    const row = await setProductoStatus(req.db, id, activo);

    if (!row) {
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });
    }

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchProductoStatus error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error cambiando estatus",
      detail: err.message,
    });
  }
}

export async function patchProductoDestacado(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const id = String(req.params.id);
    const { destacado } = req.body || {};

    if (typeof destacado !== "boolean") {
      return res
        .status(400)
        .json({ ok: false, msg: "destacado debe ser boolean" });
    }

    const row = await setProductoDestacado(req.db, id, destacado);

    if (!row) {
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });
    }

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchProductoDestacado error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error cambiando destacado",
      detail: err.message,
    });
  }
}