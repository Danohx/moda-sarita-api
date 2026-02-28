import {
  listProveedores,
  createProveedor,
  updateProveedor,
  setProveedorStatus,
} from "../models/proveedores.model.js";

export async function getProveedores(req, res) {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const includeInactive = req.query.includeInactive === "true";
    const data = await listProveedores(req.db, { q, includeInactive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getProveedores error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error listando proveedores",
        detail: err.message,
      });
  }
}

export async function postProveedor(req, res) {
  try {
    const {
      empresa,
      telefono,
      nombre_contacto = null,
      email = null,
      direccion = null,
    } = req.body || {};
    if (!empresa || String(empresa).trim().length < 2) {
      return res
        .status(400)
        .json({ ok: false, msg: "empresa es requerida (mínimo 2 caracteres)" });
    }
    if (!telefono || String(telefono).trim().length < 6) {
      return res.status(400).json({ ok: false, msg: "telefono es requerido" });
    }

    const created = await createProveedor(req.db, {
      empresa: String(empresa).trim(),
      telefono: String(telefono).trim(),
      nombre_contacto,
      email,
      direccion,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({
          ok: false,
          msg: "Proveedor duplicado (teléfono/email)",
          detail: err.detail,
        });
    }
    console.error("postProveedor error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando proveedor", detail: err.message });
  }
}

export async function patchProveedor(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, msg: "id inválido" });

    const updated = await updateProveedor(req.db, id, req.body || {});
    if (!updated)
      return res
        .status(404)
        .json({ ok: false, msg: "Proveedor no encontrado" });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({
          ok: false,
          msg: "Proveedor duplicado (teléfono/email)",
          detail: err.detail,
        });
    }
    console.error("patchProveedor error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error actualizando proveedor",
        detail: err.message,
      });
  }
}

export async function patchProveedorStatus(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, msg: "id inválido" });

    const { activo } = req.body || {};
    if (typeof activo !== "boolean")
      return res
        .status(400)
        .json({ ok: false, msg: "activo debe ser boolean" });

    const row = await setProveedorStatus(req.db, id, activo);
    if (!row)
      return res
        .status(404)
        .json({ ok: false, msg: "Proveedor no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchProveedorStatus error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}
