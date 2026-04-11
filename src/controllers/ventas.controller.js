import {
  crearVentaPOS,
  crearApartado,
  abonarApartado,
  liquidarApartado,
  cancelarApartado,
  abrirCorte,
  getCorteAbierto,
  cerrarCorte,
  getCorteById,
  getHistorialCortes,
} from "../models/ventas.model.js";

export async function postVentaPOS(req, res) {
  try {
    const vendedor_id = req.user.id;
    const payload = req.body || {};

    const out = await crearVentaPOS(req.db, {
      ...payload,
      vendedor_id,
    });

    return res.status(201).json({ ok: true, data: out });
  } catch (err) {
    console.error("postVentaPOS error:", err);
    if (err.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }
    if (err.code === "STOCK") {
      return res.status(409).json({ ok: false, msg: err.message });
    }
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando venta", detail: err.message });
  }
}

export async function postApartado(req, res) {
  try {
    const vendedor_id = req.user.id;
    const payload = req.body || {};

    const out = await crearApartado(req.db, {
      ...payload,
      vendedor_id,
    });

    return res.status(201).json({ ok: true, data: out });
  } catch (err) {
    console.error("postApartado error:", err);
    if (err.code === "FORBIDDEN") {
      return res.status(403).json({ ok: false, msg: err.message });
    }
    if (err.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }
    if (err.code === "STOCK") {
      return res.status(409).json({ ok: false, msg: err.message });
    }
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando apartado", detail: err.message });
  }
}

export async function postAbono(req, res) {
  try {
    const pedido_id = String(req.params.id);
    const { monto, metodo_pago, referencia_externa = null } = req.body || {};

    const out = await abonarApartado(req.db, {
      pedido_id,
      monto,
      metodo_pago,
      referencia_externa,
    });

    return res.status(201).json({ ok: true, data: out });
  } catch (err) {
    console.error("postAbono error:", err);
    if (err.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }
    return res
      .status(500)
      .json({ ok: false, msg: "Error registrando abono", detail: err.message });
  }
}

export async function postLiquidar(req, res) {
  try {
    const pedido_id = String(req.params.id);
    const vendedor_id = req.user.id;
    const { metodo_pago, referencia_externa = null } = req.body || {};

    const out = await liquidarApartado(req.db, {
      pedido_id,
      vendedor_id,
      metodo_pago,
      referencia_externa,
    });

    return res.json({ ok: true, data: out });
  } catch (err) {
    console.error("postLiquidar error:", err);
    if (err.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }
    if (err.code === "STOCK") {
      return res.status(409).json({ ok: false, msg: err.message });
    }
    return res.status(500).json({
      ok: false,
      msg: "Error liquidando apartado",
      detail: err.message,
    });
  }
}

export async function postCancelar(req, res) {
  try {
    const pedido_id = String(req.params.id);
    const vendedor_id = req.user.id;
    const { motivo = "Cancelado" } = req.body || {};

    const out = await cancelarApartado(req.db, {
      pedido_id,
      vendedor_id,
      motivo,
    });

    if (!out) {
      return res.status(404).json({ ok: false, msg: "Pedido no encontrado" });
    }

    return res.json({ ok: true, data: out });
  } catch (err) {
    console.error("postCancelar error:", err);
    if (err.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }
    return res.status(500).json({
      ok: false,
      msg: "Error cancelando apartado",
      detail: err.message,
    });
  }
}

export async function postAbrirCorte(req, res) {
  try {
    const usuario_id = req.user.id;
    const actual = await getCorteAbierto(req.db, { usuario_id });

    if (actual) {
      return res
        .status(409)
        .json({ ok: false, msg: "Ya existe un corte abierto", data: actual });
    }

    const { fondo_inicial = 0 } = req.body || {};
    const fondoInicialNum = Number(fondo_inicial);

    if (!Number.isFinite(fondoInicialNum) || fondoInicialNum < 0) {
      return res.status(400).json({
        ok: false,
        msg: "fondo_inicial debe ser un número mayor o igual a 0",
      });
    }

    const out = await abrirCorte(req.db, {
      usuario_id,
      fondo_inicial: fondoInicialNum,
    });

    return res.status(201).json({ ok: true, data: out });
  } catch (err) {
    console.error("postAbrirCorte error:", err);

    if (err.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }

    return res
      .status(500)
      .json({ ok: false, msg: "Error abriendo corte", detail: err.message });
  }
}

export async function getCorteActual(req, res) {
  try {
    const usuario_id = req.user.id;
    const out = await getCorteAbierto(req.db, { usuario_id });
    return res.json({ ok: true, data: out });
  } catch (err) {
    console.error("getCorteActual error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error consultando corte", detail: err.message });
  }
}

export async function postCerrarCorte(req, res) {
  try {
    const usuario_id = req.user.id;
    const corte_id = Number(req.params.id);
    const { total_real, observaciones = null } = req.body || {};

    if (!Number.isFinite(corte_id)) {
      return res.status(400).json({ ok: false, msg: "id inválido" });
    }

    const out = await cerrarCorte(req.db, {
      corte_id,
      usuario_id,
      total_real,
      observaciones,
    });

    return res.json({ ok: true, data: out });
  } catch (err) {
    console.error("postCerrarCorte error:", err);
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }
    if (err.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }
    return res
      .status(500)
      .json({ ok: false, msg: "Error cerrando corte", detail: err.message });
  }
}

export async function getHistorial(req, res) {
  try {
    const out = await getHistorialCortes(req.db);
    return res.json({ ok: true, data: out });
  } catch (err) {
    console.error("getHistorial error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error consultando el historial de cortes", detail: err.message });
  }
}

export async function getCorteDetalle(req, res) {
  try {
    // Lo convertimos a número tal como lo haces en postCerrarCorte
    const corte_id = Number(req.params.id);

    if (!Number.isFinite(corte_id)) {
      return res.status(400).json({ ok: false, msg: "ID de corte inválido" });
    }

    const out = await getCorteById(req.db, corte_id);
    
    return res.json({ ok: true, data: out });
  } catch (err) {
    console.error("getCorteDetalle error:", err);
    
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }
    
    return res
      .status(500)
      .json({ ok: false, msg: "Error consultando el detalle del corte", detail: err.message });
  }
}