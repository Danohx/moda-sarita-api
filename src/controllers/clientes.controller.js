import {
  listClientes,
  getClienteById,
  listDirecciones,
  createCliente,
  updateCliente,
  setCreditoCliente,
  createDireccion,
  setDireccionPrincipal,
  deleteDireccion,
  abonarCreditoCliente,
  getMovimientosCredito,
  setClientePuedeApartarInterna,
} from "../models/clientes.model.js";

export async function getClientes(req, res) {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const includeInactive = req.query.includeInactive === "true";
    const data = await listClientes(req.db, { q, includeInactive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getClientes error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error listando clientes", detail: err.message });
  }
}

export async function getCliente(req, res) {
  try {
    const id = String(req.params.id);
    const cliente = await getClienteById(req.db, id);
    if (!cliente)
      return res.status(404).json({ ok: false, msg: "Cliente no encontrado" });

    const direcciones = await listDirecciones(req.db, id);
    return res.json({ ok: true, data: { ...cliente, direcciones } });
  } catch (err) {
    console.error("getCliente error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo cliente",
      detail: err.message,
    });
  }
}

export async function postCliente(req, res) {
  try {
    const {
      nombres,
      apellido_paterno,
      apellido_materno = null,
      telefono = null,
      email = null,
    } = req.body || {};
    if (!nombres || String(nombres).trim().length < 2)
      return res.status(400).json({ ok: false, msg: "nombres requerido" });
    if (!apellido_paterno || String(apellido_paterno).trim().length < 2)
      return res
        .status(400)
        .json({ ok: false, msg: "apellido_paterno requerido" });

    const created = await createCliente(req.db, {
      nombres: String(nombres).trim(),
      apellido_paterno: String(apellido_paterno).trim(),
      apellido_materno: apellido_materno
        ? String(apellido_materno).trim()
        : null,
      telefono: telefono ? String(telefono).trim() : null,
      email: email ? String(email).trim().toLowerCase() : null,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({
        ok: false,
        msg: "Teléfono o email duplicado",
        detail: err.detail,
      });
    console.error("postCliente error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando cliente", detail: err.message });
  }
}

export async function patchCliente(req, res) {
  try {
    const id = String(req.params.id);
    const updated = await updateCliente(req.db, id, req.body || {});
    if (!updated)
      return res.status(404).json({ ok: false, msg: "Cliente no encontrado" });
    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({
        ok: false,
        msg: "Teléfono o email duplicado",
        detail: err.detail,
      });
    console.error("patchCliente error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error actualizando cliente",
      detail: err.message,
    });
  }
}

export async function patchCredito(req, res) {
  try {
    const id = String(req.params.id);
    const { tiene_credito, limite_credito } = req.body || {};
    if (typeof tiene_credito !== "boolean")
      return res
        .status(400)
        .json({ ok: false, msg: "tiene_credito debe ser boolean" });

    const row = await setCreditoCliente(req.db, id, {
      tiene_credito,
      limite_credito,
    });
    if (!row)
      return res.status(404).json({ ok: false, msg: "Cliente no encontrado" });
    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchCredito error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error actualizando crédito",
      detail: err.message,
    });
  }
}

export async function getClienteMovimientosCredito(req, res) {
  try {
    const clienteId = String(req.params.id);

    const cliente = await getClienteById(req.db, clienteId);
    if (!cliente) {
      return res.status(404).json({ ok: false, msg: "Cliente no encontrado" });
    }

    const data = await getMovimientosCredito(req.db, clienteId);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getClienteMovimientosCredito error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo movimientos de crédito",
      detail: err.message,
    });
  }
}

export async function postAbonoCredito(req, res) {
  try {
    const id = String(req.params.id);
    const { monto, metodo_pago, referencia_externa } = req.body || {};

    if (!monto || Number(monto) <= 0) {
      return res
        .status(400)
        .json({ ok: false, msg: "Monto inválido o requerido" });
    }

    const row = await abonarCreditoCliente(req.db, id, { monto, metodo_pago });
    if (!row) {
      return res.status(404).json({ ok: false, msg: "Cliente no encontrado" });
    }

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("postAbonoCredito error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error registrando el abono",
      detail: err.message,
    });
  }
}

export async function postDireccion(req, res) {
  try {
    const clienteId = String(req.params.id);
    const { calle, ciudad, estado, codigo_postal } = req.body || {};
    if (!calle || !ciudad || !estado || !codigo_postal) {
      return res.status(400).json({
        ok: false,
        msg: "calle, ciudad, estado y codigo_postal son requeridos",
      });
    }

    const created = await createDireccion(req.db, clienteId, req.body || {});
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    console.error("postDireccion error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando dirección", detail: err.message });
  }
}

export async function patchDireccionPrincipal(req, res) {
  try {
    const clienteId = String(req.params.id);
    const direccionId = String(req.params.direccionId);

    const row = await setDireccionPrincipal(req.db, clienteId, direccionId);
    if (!row)
      return res
        .status(404)
        .json({ ok: false, msg: "Dirección no encontrada" });
    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchDireccionPrincipal error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error asignando principal",
      detail: err.message,
    });
  }
}

export async function deleteDireccionById(req, res) {
  try {
    const clienteId = String(req.params.id);
    const direccionId = String(req.params.direccionId);

    const row = await deleteDireccion(req.db, clienteId, direccionId);
    if (!row)
      return res
        .status(404)
        .json({ ok: false, msg: "Dirección no encontrada" });
    return res.json({ ok: true, msg: "Dirección eliminada" });
  } catch (err) {
    console.error("deleteDireccionById error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error eliminando dirección",
      detail: err.message,
    });
  }
}

export async function patchClientePuedeApartar(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const id = String(req.params.id || "").trim();
    const { puede_apartar } = req.body || {};

    if (!id) {
      return res.status(400).json({
        ok: false,
        message: "id del cliente requerido",
      });
    }

    if (typeof puede_apartar !== "boolean") {
      return res.status(400).json({
        ok: false,
        message: "puede_apartar debe ser boolean",
      });
    }

    const updated = await setClientePuedeApartarInterna(
      req.db,
      id,
      puede_apartar,
    );

    if (!updated) {
      return res.status(404).json({
        ok: false,
        message: "Cliente no encontrado",
      });
    }

    return res.json({
      ok: true,
      message: puede_apartar
        ? "Cliente autorizado para apartados"
        : "Cliente desautorizado para apartados",
      data: updated,
    });
  } catch (err) {
    console.error("patchClientePuedeApartar error:", err);

    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        message: err.message,
      });
    }

    return res.status(500).json({
      ok: false,
      message: "Error actualizando permiso de apartado",
      detail: err.message,
    });
  }
}
