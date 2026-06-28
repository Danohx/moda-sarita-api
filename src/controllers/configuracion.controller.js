// src/controllers/configuracion.controller.js

import {
  listParametrosAdmin,
  listParametrosPublicos,
  getParametrosPorModulo,
  updateParametroSistema,
  listMetodosPagoAdmin,
  listMetodosPagoPOS,
  listMetodosPagoWeb,
  updateMetodoPago,
} from "../models/configuracion.model.js";

import { clearConfiguracionCache } from "../services/configuracion.service.js";

function handleConfigError(res, err, fallbackMessage) {
  console.error(fallbackMessage, err);

  if (err.code === "VALIDATION") {
    return res.status(400).json({ ok: false, msg: err.message });
  }

  if (err.code === "P0001" || err.code === "23514" || err.code === "22P02") {
    return res.status(400).json({
      ok: false,
      msg: err.message,
      detail: err.detail,
    });
  }

  return res.status(500).json({
    ok: false,
    msg: fallbackMessage,
    detail: err.message,
  });
}

export async function getParametrosAdmin(req, res) {
  try {
    const modulo = req.query.modulo ? String(req.query.modulo) : null;
    const data = await listParametrosAdmin(req.db, { modulo });

    return res.json({ ok: true, data });
  } catch (err) {
    return handleConfigError(res, err, "Error listando parámetros");
  }
}

export async function getParametrosModuloAdmin(req, res) {
  try {
    const modulo = String(req.params.modulo || "");
    const data = await listParametrosAdmin(req.db, { modulo });

    return res.json({ ok: true, data });
  } catch (err) {
    return handleConfigError(res, err, "Error listando parámetros por módulo");
  }
}

export async function getParametrosAgrupadosAdmin(req, res) {
  try {
    const data = await getParametrosPorModulo(req.db);
    return res.json({ ok: true, data });
  } catch (err) {
    return handleConfigError(res, err, "Error obteniendo parámetros agrupados");
  }
}

export async function getParametrosPublicos(req, res) {
  try {
    const data = await listParametrosPublicos(req.db);
    return res.json({ ok: true, data });
  } catch (err) {
    return handleConfigError(res, err, "Error obteniendo configuración pública");
  }
}

export async function patchParametro(req, res) {
  try {
    const clave = String(req.params.clave || "").trim();
    const { valor } = req.body || {};

    if (!clave) {
      return res.status(400).json({ ok: false, msg: "clave requerida" });
    }

    if (valor === undefined) {
      return res.status(400).json({ ok: false, msg: "valor es requerido" });
    }

    const data = await updateParametroSistema(req.db, clave, {
      valor,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Parámetro no encontrado o no editable",
      });
    }

    clearConfiguracionCache();

    return res.json({
      ok: true,
      msg: "Parámetro actualizado correctamente",
      data,
    });
  } catch (err) {
    return handleConfigError(res, err, "Error actualizando parámetro");
  }
}

export async function getMetodosPagoAdmin(req, res) {
  try {
    const data = await listMetodosPagoAdmin(req.db);
    return res.json({ ok: true, data });
  } catch (err) {
    return handleConfigError(res, err, "Error listando métodos de pago");
  }
}

export async function getMetodosPagoPOS(req, res) {
  try {
    const data = await listMetodosPagoPOS(req.db);
    return res.json({ ok: true, data });
  } catch (err) {
    return handleConfigError(res, err, "Error listando métodos de pago POS");
  }
}

export async function getMetodosPagoWeb(req, res) {
  try {
    const data = await listMetodosPagoWeb(req.db);
    return res.json({ ok: true, data });
  } catch (err) {
    return handleConfigError(res, err, "Error listando métodos de pago web");
  }
}

export async function patchMetodoPago(req, res) {
  try {
    const codigo = String(req.params.codigo || "").trim();

    if (!codigo) {
      return res.status(400).json({ ok: false, msg: "codigo requerido" });
    }

    const data = await updateMetodoPago(
      req.db,
      codigo,
      req.body || {},
      req.user?.id ?? null,
    );

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Método de pago no encontrado",
      });
    }

    clearConfiguracionCache();

    return res.json({
      ok: true,
      msg: "Método de pago actualizado correctamente",
      data,
    });
  } catch (err) {
    return handleConfigError(res, err, "Error actualizando método de pago");
  }
}