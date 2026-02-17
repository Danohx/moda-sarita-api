import { listTallas, createTalla, updateTalla, setTallaStatus } from "../models/tallas.model.js";

export async function getTallas(req, res) {
  try {
    if (!req.db) 
        return res.status(500).json({ ok: false, msg: "DB context no configurado (req.db)" });

    const includeInactive = req.query.includeInactive === "true";
    const tipo = req.query.tipo ? String(req.query.tipo) : null;

    const data = await listTallas(req.db, { includeInactive, tipo });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getTallas error:", err);
    return res.status(500).json({ ok: false, msg: "Error listando tallas", detail: err.message });
  }
}

export async function postTalla(req, res) {
  try {
    if (!req.db) 
        return res.status(500).json({ ok: false, msg: "DB context no configurado (req.db)" });

    const { nombre, tipo = null } = req.body || {};
    if (!nombre || String(nombre).trim().length < 1) {
      return res.status(400).json({ ok: false, msg: "nombre es requerido" });
    }

    const created = await createTalla(req.db, { nombre: String(nombre).trim(), tipo });
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    console.error("postTalla error:", err);
    return res.status(500).json({ ok: false, msg: "Error creando talla", detail: err.message });
  }
}

export async function patchTalla(req, res) {
  try {
    if (!req.db) 
        return res.status(500).json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) 
        return res.status(400).json({ ok: false, msg: "id inválido" });

    const { nombre = null, tipo = null } = req.body || {};
    const updated = await updateTalla(req.db, id, { nombre, tipo });

    if (!updated) 
        return res.status(404).json({ ok: false, msg: "Talla no encontrada" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error("patchTalla error:", err);
    return res.status(500).json({ ok: false, msg: "Error actualizando talla", detail: err.message });
  }
}

export async function patchTallaStatus(req, res) {
  try {
    if (!req.db) 
        return res.status(500).json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) 
        return res.status(400).json({ ok: false, msg: "id inválido" });

    const { activo } = req.body || {};
    if (typeof activo !== "boolean") 
        return res.status(400).json({ ok: false, msg: "activo debe ser boolean" });

    const row = await setTallaStatus(req.db, id, activo);
    if (!row) 
        return res.status(404).json({ ok: false, msg: "Talla no encontrada" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchTallaStatus error:", err);
    return res.status(500).json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}
