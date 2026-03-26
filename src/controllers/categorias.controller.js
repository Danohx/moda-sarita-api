// src/controllers/categorias.controller.js
import {
  listCategoriasPublicas,
  listCategoriasAdmin,
  createCategoriaInterna,
  updateCategoriaInterna,
  setCategoriaStatusInterna,
} from "../models/categorias.model.js";

export async function getCategorias(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ message: "DB context no configurado (req.db)" });

    const includeInactive = req.query.includeInactive === "true";
    const data = await listCategoriasPublicas(req.db, { includeInactive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({
        ok: false,
        message: "Error listando categorías",
        detail: err.message,
      });
  }
}

export async function getCategoriasAdmin(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ message: "DB context no configurado (req.db)" });

    const data = await listCategoriasAdmin(req.db);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({
        ok: false,
        message: "Error listando categorías",
        detail: err.message,
      });
  }
}

export async function postCategoria(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ message: "DB context no configurado (req.db)" });

    const {
      nombre,
      descripcion = null,
      parent_id = null,
      slug = null,
    } = req.body || {};

    if (!nombre || String(nombre).trim().length < 2) {
      return res
        .status(400)
        .json({
          ok: false,
          message: "nombre es requerido (mínimo 2 caracteres)",
        });
    }

    const created = await createCategoriaInterna(req.db, {
      nombre: String(nombre).trim(),
      descripcion,
      parent_id,
      slug,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    // 23505 = unique violation (por si slug único, etc.)
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ ok: false, message: "Registro duplicado", detail: err.detail });
    }
    console.error(err);
    return res
      .status(500)
      .json({
        ok: false,
        message: "Error creando categoría",
        detail: err.message,
      });
  }
}

export async function patchCategoria(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ message: "DB context no configurado (req.db)" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, message: "id inválido" });

    const {
      nombre = null,
      descripcion = null,
      parent_id = null,
      slug = null,
    } = req.body || {};
    if (parent_id === id)
      return res
        .status(400)
        .json({ ok: false, message: "parent_id no puede ser el mismo id" });

    const updated = await updateCategoriaInterna(req.db, id, {
      nombre,
      descripcion,
      parent_id,
      slug,
    });
    if (!updated)
      return res
        .status(404)
        .json({ ok: false, message: "Categoría no encontrada" });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ ok: false, message: "Registro duplicado", detail: err.detail });
    }
    console.error(err);
    return res
      .status(500)
      .json({
        ok: false,
        message: "Error actualizando categoría",
        detail: err.message,
      });
  }
}

export async function patchCategoriaStatus(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ message: "DB context no configurado (req.db)" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, message: "id inválido" });

    const { activo } = req.body || {};
    if (typeof activo !== "boolean")
      return res
        .status(400)
        .json({ ok: false, message: "activo debe ser boolean" });

    const row = await setCategoriaStatusInterna(req.db, id, activo);
    if (!row)
      return res
        .status(404)
        .json({ ok: false, message: "Categoría no encontrada" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({
        ok: false,
        message: "Error cambiando estatus",
        detail: err.message,
      });
  }
}
