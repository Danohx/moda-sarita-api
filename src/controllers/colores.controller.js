import {
  listColores,
  createColor,
  updateColor,
  setColorStatus,
} from "../models/colores.model.js";

function isValidHex(hex) {
  if (hex == null) return true;
  const s = String(hex).trim();
  return /^#[0-9A-Fa-f]{6}$/.test(s);
}

export async function getColores(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const includeInactive = req.query.includeInactive === "true";
    const data = await listColores(req.db, { includeInactive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getColores error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error listando colores", detail: err.message });
  }
}

export async function postColor(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const { nombre, hex = null } = req.body || {};
    if (!nombre || String(nombre).trim().length < 1) {
      return res.status(400).json({ ok: false, msg: "nombre es requerido" });
    }
    if (!isValidHex(hex)) {
      return res
        .status(400)
        .json({ ok: false, msg: "hex inválido, usa formato #RRGGBB" });
    }

    const created = await createColor(req.db, {
      nombre: String(nombre).trim(),
      hex: hex ? String(hex).trim() : null,
    });
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ ok: false, msg: "Color duplicado", detail: err.detail });
    }
    console.error("postColor error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando color", detail: err.message });
  }
}

export async function patchColor(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, msg: "id inválido" });

    const { nombre = null, hex = null } = req.body || {};
    if (hex !== null && !isValidHex(hex)) {
      return res
        .status(400)
        .json({ ok: false, msg: "hex inválido, usa formato #RRGGBB" });
    }

    const updated = await updateColor(req.db, id, {
      nombre: nombre ? String(nombre).trim() : null,
      hex: hex ? String(hex).trim() : null,
    });

    if (!updated)
      return res.status(404).json({ ok: false, msg: "Color no encontrado" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ ok: false, msg: "Color duplicado", detail: err.detail });
    }
    console.error("patchColor error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error actualizando color",
        detail: err.message,
      });
  }
}

export async function patchColorStatus(req, res) {
  try {
    if (!req.db)
      return res
        .status(500)
        .json({ ok: false, msg: "DB context no configurado (req.db)" });

    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, msg: "id inválido" });

    const { activo } = req.body || {};
    if (typeof activo !== "boolean")
      return res
        .status(400)
        .json({ ok: false, msg: "activo debe ser boolean" });

    const row = await setColorStatus(req.db, id, activo);
    if (!row)
      return res.status(404).json({ ok: false, msg: "Color no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchColorStatus error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}
