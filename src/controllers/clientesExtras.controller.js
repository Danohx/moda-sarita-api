// src/controllers/clientesExtras.controller.js
import {
  getClienteHistorialComercial,
  setClienteActivoSeguro,
  updateDireccionCliente,
} from '../models/clientesInsights.model.js';

function statusForError(error) {
  if (error?.code === 'NOT_FOUND') return 404;
  if (error?.code === 'CLIENTE_CON_DEUDA') return 409;
  if (error?.code === 'CLIENTE_CON_OPERACIONES_ACTIVAS') return 409;
  return 500;
}

export async function getHistorialComercialCliente(req, res) {
  try {
    const data = await getClienteHistorialComercial(req.db, String(req.params.id), {
      limit: req.query.limit,
    });

    if (!data) {
      return res.status(404).json({ ok: false, msg: 'Cliente no encontrado' });
    }

    return res.json({ ok: true, data });
  } catch (error) {
    console.error('getHistorialComercialCliente error:', error);
    return res.status(500).json({
      ok: false,
      msg: 'No se pudo consultar el historial comercial del cliente.',
      detail: error.message,
    });
  }
}

export async function patchEstadoCliente(req, res) {
  try {
    const { activo } = req.body || {};
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ ok: false, msg: 'activo debe ser boolean' });
    }

    const data = await setClienteActivoSeguro(
      req.db,
      String(req.params.id),
      activo,
      req.user?.id || null,
    );

    return res.json({
      ok: true,
      msg: activo ? 'Cliente reactivado correctamente.' : 'Cliente desactivado correctamente.',
      data,
    });
  } catch (error) {
    console.error('patchEstadoCliente error:', error);
    return res.status(statusForError(error)).json({
      ok: false,
      code: error.code,
      msg: error.message || 'No se pudo cambiar el estado del cliente.',
    });
  }
}

export async function patchDireccionCliente(req, res) {
  try {
    const data = await updateDireccionCliente(
      req.db,
      String(req.params.id),
      String(req.params.direccionId),
      req.body || {},
    );

    if (!data) {
      return res.status(404).json({ ok: false, msg: 'Dirección no encontrada' });
    }

    return res.json({ ok: true, data });
  } catch (error) {
    console.error('patchDireccionCliente error:', error);
    return res.status(statusForError(error)).json({
      ok: false,
      code: error.code,
      msg: error.message || 'No se pudo actualizar la dirección.',
    });
  }
}
