import {
  cancelPedidoWebCliente,
  confirmPagoPedidoWeb,
  createDireccionTienda,
  createPedidoWeb,
  deleteDireccionTienda,
  getCreditoTienda,
  getPedidoWebCliente,
  getPerfilTienda,
  listDireccionesTienda,
  listMovimientosCreditoTienda,
  listPedidosWebCliente,
  setDireccionPrincipalTienda,
  updateCostoEnvioPedidoWeb,
  updatePerfilTienda,
} from "../models/tienda.model.js";

function handleError(res, error, fallback) {
  console.error(fallback, error);

  const code = error?.code;
  if (code === "UNAUTHORIZED") return res.status(401).json({ ok: false, msg: error.message });
  if (code === "FORBIDDEN") return res.status(403).json({ ok: false, msg: error.message });
  if (code === "NOT_FOUND") return res.status(404).json({ ok: false, msg: error.message });
  if (code === "CONFLICT" || error?.code === "23505" || error?.code === "23514") {
    return res.status(409).json({ ok: false, msg: error.message, detail: error.detail });
  }
  if (code === "VALIDATION" || code === "CONFIGURATION" || error?.code === "22P02") {
    return res.status(400).json({ ok: false, msg: error.message, detail: error.detail });
  }

  return res.status(500).json({ ok: false, msg: fallback, detail: error?.message });
}

export async function getPerfil(req, res) {
  try {
    const data = await getPerfilTienda(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el perfil de la tienda");
  }
}

export async function patchPerfil(req, res) {
  try {
    const data = await updatePerfilTienda(req.db, req.user.id, req.body || {});
    return res.json({ ok: true, msg: "Perfil actualizado correctamente", data });
  } catch (error) {
    return handleError(res, error, "Error actualizando el perfil");
  }
}

export async function getDirecciones(req, res) {
  try {
    const data = await listDireccionesTienda(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo las direcciones");
  }
}

export async function postDireccion(req, res) {
  try {
    const data = await createDireccionTienda(req.db, req.user.id, req.body || {});
    return res.status(201).json({ ok: true, msg: "Dirección guardada", data });
  } catch (error) {
    return handleError(res, error, "Error guardando la dirección");
  }
}

export async function patchDireccionPrincipal(req, res) {
  try {
    const data = await setDireccionPrincipalTienda(req.db, req.user.id, req.params.id);
    return res.json({ ok: true, msg: "Dirección principal actualizada", data });
  } catch (error) {
    return handleError(res, error, "Error actualizando la dirección principal");
  }
}

export async function deleteDireccion(req, res) {
  try {
    const data = await deleteDireccionTienda(req.db, req.user.id, req.params.id);
    return res.json({ ok: true, msg: "Dirección eliminada", data });
  } catch (error) {
    return handleError(res, error, "Error eliminando la dirección");
  }
}


export async function getCredito(req, res) {
  try {
    const data = await getCreditoTienda(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el crédito del cliente");
  }
}

export async function getMovimientosCredito(req, res) {
  try {
    const data = await listMovimientosCreditoTienda(req.db, req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo los movimientos de crédito");
  }
}


export async function getPedidos(req, res) {
  try {
    const data = await listPedidosWebCliente(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo los pedidos");
  }
}

export async function getPedidoById(req, res) {
  try {
    const data = await getPedidoWebCliente(req.db, req.user.id, req.params.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el pedido");
  }
}

export async function postPedido(req, res) {
  try {
    const data = await createPedidoWeb(req.db, req.user.id, req.body || {});
    return res.status(201).json({ ok: true, msg: "Pedido creado correctamente", data });
  } catch (error) {
    return handleError(res, error, "Error creando el pedido web");
  }
}

export async function postCancelarPedido(req, res) {
  try {
    const data = await cancelPedidoWebCliente(
      req.db,
      req.user.id,
      req.params.id,
      req.body?.motivo,
    );
    return res.json({ ok: true, msg: "Pedido cancelado", data });
  } catch (error) {
    return handleError(res, error, "Error cancelando el pedido");
  }
}

export async function patchCostoEnvioAdmin(req, res) {
  try {
    const data = await updateCostoEnvioPedidoWeb(req.db, req.params.id, req.body?.costo_envio);
    return res.json({ ok: true, msg: "Costo de envío confirmado", data });
  } catch (error) {
    return handleError(res, error, "Error actualizando el costo de envío");
  }
}

export async function postConfirmarPagoAdmin(req, res) {
  try {
    const data = await confirmPagoPedidoWeb(req.db, req.params.id, {
      usuarioId: req.user.id,
      referenciaExterna: req.body?.referencia_externa,
    });
    return res.json({ ok: true, msg: "Pago confirmado y stock descontado", data });
  } catch (error) {
    return handleError(res, error, "Error confirmando el pago web");
  }
}
