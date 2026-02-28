import {
  listProductosPublic,
  getProductoPublicById,
  createProducto,
  updateProducto,
  setProductoStatus,
  setProductoDestacado,
} from "../models/productos.model.js";

function toBoolOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  return null;
}

export async function getProductos(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

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
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error listando productos",
        detail: err.message,
      });
  }
}

export async function getProductoById(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = String(req.params.id);
    const row = await getProductoPublicById(req.db, id);
    if (!row)
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("getProductoById error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error obteniendo producto",
        detail: err.message,
      });
  }
}

export async function postProducto(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const {
      nombre,
      descripcion = null,
      sku = null,
      codigo_barras = null,
      precio_costo,
      precio_venta,
      categoria_id = null,
      proveedor_id = null,
      destacado = false,
      slug = null,
      maneja_variantes = true,
    } = req.body || {};

    if (!nombre || String(nombre).trim().length < 2) {
      return res
        .status(400)
        .json({ ok: false, msg: "nombre requerido (mínimo 2 chars)" });
    }
    if (precio_costo === undefined || precio_venta === undefined) {
      return res
        .status(400)
        .json({ ok: false, msg: "precio_costo y precio_venta son requeridos" });
    }

    const created = await createProducto(req.db, {
      nombre: String(nombre).trim(),
      descripcion,
      sku: sku ? String(sku).trim() : null,
      codigo_barras: codigo_barras ? String(codigo_barras).trim() : null,
      precio_costo: Number(precio_costo),
      precio_venta: Number(precio_venta),
      categoria_id: categoria_id ? Number(categoria_id) : null,
      proveedor_id: proveedor_id ? Number(proveedor_id) : null,
      destacado: !!destacado,
      slug: slug ? String(slug).trim() : null,
      maneja_variantes: maneja_variantes !== false,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({
          ok: false,
          msg: "SKU/slug/código de barras duplicado",
          detail: err.detail,
        });
    }
    console.error("postProducto error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando producto", detail: err.message });
  }
}

export async function patchProducto(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = String(req.params.id);
    const updated = await updateProducto(req.db, id, req.body || {});
    if (!updated)
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({
          ok: false,
          msg: "SKU/slug/código de barras duplicado",
          detail: err.detail,
        });
    }
    console.error("patchProducto error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error actualizando producto",
        detail: err.message,
      });
  }
}

export async function patchProductoStatus(req, res) {
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

    const row = await setProductoStatus(req.db, id, activo);
    if (!row)
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchProductoStatus error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}

export async function patchProductoDestacado(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = String(req.params.id);
    const { destacado } = req.body || {};
    if (typeof destacado !== "boolean")
      return res
        .status(400)
        .json({ ok: false, msg: "destacado debe ser boolean" });

    const row = await setProductoDestacado(req.db, id, destacado);
    if (!row)
      return res.status(404).json({ ok: false, msg: "Producto no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchProductoDestacado error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error cambiando destacado",
        detail: err.message,
      });
  }
}
