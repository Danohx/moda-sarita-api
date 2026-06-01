import {
  listTemporadas,
  createTemporada,
  updateTemporada,
  setTemporadaStatus,
} from "../models/temporadas.model.js";

export async function getTemporadas(req, res) {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const data = await listTemporadas(req.db, { includeInactive });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, msg: "Error listando temporadas", detail: err.message });
  }
}

export async function postTemporada(req, res) {
  try {
    const { nombre, descripcion = null, mes_inicio, dia_inicio, mes_fin, dia_fin } = req.body || {};

    if (!nombre || String(nombre).trim().length < 2) {
      return res.status(400).json({ ok: false, msg: "nombre es requerido" });
    }

    const data = await createTemporada(req.db, {
      nombre: String(nombre).trim(),
      descripcion,
      mes_inicio,
      dia_inicio,
      mes_fin,
      dia_fin
    });

    return res.status(201).json({ ok: true, data });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ ok: false, msg: "Temporada duplicada" });
    }
    return res.status(500).json({ ok: false, msg: "Error creando temporada", detail: err.message });
  }
}

export async function patchTemporada(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, msg: "id inválido" });
    }

    const { nombre = null, descripcion = null, mes_inicio = null, dia_inicio = null, mes_fin = null, dia_fin = null } = req.body || {};
    const data = await updateTemporada(req.db, id, { nombre, descripcion, mes_inicio, dia_inicio, mes_fin, dia_fin });

    if (!data) {
      return res.status(404).json({ ok: false, msg: "Temporada no encontrada" });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ ok: false, msg: "Temporada duplicada" });
    }
    return res.status(500).json({ ok: false, msg: "Error actualizando temporada", detail: err.message });
  }
}

export async function patchTemporadaStatus(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, msg: "id inválido" });
    }

    const { activo } = req.body || {};
    if (typeof activo !== "boolean") {
      return res.status(400).json({ ok: false, msg: "activo debe ser boolean" });
    }

    const data = await setTemporadaStatus(req.db, id, activo);
    if (!data) {
      return res.status(404).json({ ok: false, msg: "Temporada no encontrada" });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}