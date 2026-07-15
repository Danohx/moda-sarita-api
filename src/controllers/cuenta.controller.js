import {
  actualizarMiDireccion,
  actualizarMiPerfil,
  crearMiDireccion,
  eliminarMiDireccion,
  establecerMiDireccionPrincipal,
  listarMisDirecciones,
  listarMisMovimientosCredito,
  listarMisPedidos,
  obtenerMiCredito,
  obtenerMiCuenta,
  obtenerMiPedido,
} from "../models/cuenta.model.js";

function handleError(res, error, fallback) {
  console.error(fallback, error);

  if (error.code === "23505") {
    return res.status(409).json({
      ok: false,
      msg: "El teléfono o correo ya está registrado en otra cuenta.",
      detail: error.detail,
    });
  }

  if (error.code === "22P02") {
    return res.status(400).json({ ok: false, msg: "Identificador inválido." });
  }

  if (error.status) {
    return res.status(error.status).json({
      ok: false,
      msg: error.message,
      code: error.code,
    });
  }

  return res.status(500).json({
    ok: false,
    msg: fallback,
    detail: error.message,
  });
}

export async function getMiCuenta(req, res) {
  try {
    const data = await obtenerMiCuenta(req.db, req.user.id);
    if (!data) {
      return res.status(404).json({ ok: false, msg: "Cuenta no encontrada." });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo la cuenta.");
  }
}

export async function patchMiPerfil(req, res) {
  try {
    const data = await actualizarMiPerfil(req.db, req.user.id, req.body || {});
    return res.json({ ok: true, msg: "Perfil actualizado.", data });
  } catch (error) {
    return handleError(res, error, "Error actualizando el perfil.");
  }
}

export async function getMisDirecciones(req, res) {
  try {
    const data = await listarMisDirecciones(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo las direcciones.");
  }
}

export async function postMiDireccion(req, res) {
  try {
    const data = await crearMiDireccion(req.db, req.user.id, req.body || {});
    return res.status(201).json({ ok: true, msg: "Dirección creada.", data });
  } catch (error) {
    return handleError(res, error, "Error creando la dirección.");
  }
}

export async function patchMiDireccion(req, res) {
  try {
    const data = await actualizarMiDireccion(
      req.db,
      req.user.id,
      req.params.direccionId,
      req.body || {},
    );
    return res.json({ ok: true, msg: "Dirección actualizada.", data });
  } catch (error) {
    return handleError(res, error, "Error actualizando la dirección.");
  }
}

export async function patchMiDireccionPrincipal(req, res) {
  try {
    const data = await establecerMiDireccionPrincipal(
      req.db,
      req.user.id,
      req.params.direccionId,
    );
    return res.json({ ok: true, msg: "Dirección principal actualizada.", data });
  } catch (error) {
    return handleError(res, error, "Error seleccionando la dirección principal.");
  }
}

export async function deleteMiDireccion(req, res) {
  try {
    const data = await eliminarMiDireccion(
      req.db,
      req.user.id,
      req.params.direccionId,
    );
    return res.json({ ok: true, msg: "Dirección eliminada.", data });
  } catch (error) {
    return handleError(res, error, "Error eliminando la dirección.");
  }
}

export async function getMiCredito(req, res) {
  try {
    const data = await obtenerMiCredito(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el crédito.");
  }
}

export async function getMisMovimientosCredito(req, res) {
  try {
    const data = await listarMisMovimientosCredito(req.db, req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({
      ok: true,
      data: data.items,
      pagination: {
        total: data.total,
        limit: data.limit,
        offset: data.offset,
        hasMore: data.hasMore,
      },
    });
  } catch (error) {
    return handleError(res, error, "Error obteniendo los movimientos de crédito.");
  }
}

export async function getMisPedidos(req, res) {
  try {
    const data = await listarMisPedidos(req.db, req.user.id, {
      tipo: "PEDIDOS",
      estado: req.query.estado,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ ok: true, data: data.items, pagination: data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo los pedidos.");
  }
}

export async function getMisApartados(req, res) {
  try {
    const data = await listarMisPedidos(req.db, req.user.id, {
      tipo: "APARTADOS",
      estado: req.query.estado,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ ok: true, data: data.items, pagination: data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo los apartados.");
  }
}

export async function getMiPedido(req, res) {
  try {
    const data = await obtenerMiPedido(req.db, req.user.id, req.params.pedidoId);
    if (!data) {
      return res.status(404).json({ ok: false, msg: "Pedido no encontrado." });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el pedido.");
  }
}
