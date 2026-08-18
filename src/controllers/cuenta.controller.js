import {
  actualizarMiDireccion,
  actualizarMiPerfil,
  crearMiDireccion,
  eliminarMiDireccion,
  establecerMiDireccionPrincipal,
  listarMisDirecciones,
  listarMisMovimientosCredito,
  listarMisMovimientosCreditoPorCredito,
  listarMisCuotasCredito,
  listarMisPagosCredito,
  listarMisPagosPedido,
  listarMisCreditos,
  listarMisPedidos,
  obtenerMiCredito,
  obtenerMiCreditoDetalle,
  obtenerMiCuenta,
  obtenerMiResumenPortal,
  obtenerMiPedido,
} from "../models/cuenta.model.js";
import { crearSolicitudTransferenciaCreditoCliente } from "../models/credito.model.js";

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

  if (error.code === "NOT_FOUND") {
    return res
      .status(404)
      .json({ ok: false, msg: error.message, code: error.code });
  }

  if (error.code === "FORBIDDEN") {
    return res
      .status(403)
      .json({ ok: false, msg: error.message, code: error.code });
  }

  if (error.code === "CONFLICT") {
    return res
      .status(409)
      .json({ ok: false, msg: error.message, code: error.code });
  }

  if (error.code === "VALIDATION") {
    return res
      .status(400)
      .json({ ok: false, msg: error.message, code: error.code });
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

export async function getMiResumenPortal(req, res) {
  try {
    const data = await obtenerMiResumenPortal(req.db, req.user.id);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el resumen de tu cuenta.");
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
    return res.json({
      ok: true,
      msg: "Dirección principal actualizada.",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "Error seleccionando la dirección principal.",
    );
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
    return handleError(
      res,
      error,
      "Error obteniendo los movimientos de crédito.",
    );
  }
}

export async function getMisCreditos(req, res) {
  try {
    const data = await listarMisCreditos(req.db, req.user.id, {
      estado: req.query.estado || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo tus créditos.");
  }
}

export async function getMiCreditoDetalle(req, res) {
  try {
    const data = await obtenerMiCreditoDetalle(
      req.db,
      req.user.id,
      req.params.creditoId,
    );
    if (!data) {
      return res.status(404).json({ ok: false, msg: "Crédito no encontrado." });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el detalle del crédito.");
  }
}

export async function getMisCuotasCredito(req, res) {
  try {
    const data = await listarMisCuotasCredito(
      req.db,
      req.user.id,
      req.params.creditoId,
      req.query,
    );
    if (!data)
      return res.status(404).json({ ok: false, msg: "Crédito no encontrado." });
    return res.json({ ok: true, data: data.items, pagination: data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo las cuotas del crédito.");
  }
}

export async function getMisPagosCredito(req, res) {
  try {
    const data = await listarMisPagosCredito(
      req.db,
      req.user.id,
      req.params.creditoId,
      req.query,
    );
    if (!data)
      return res.status(404).json({ ok: false, msg: "Crédito no encontrado." });
    return res.json({ ok: true, data: data.items, pagination: data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo los pagos del crédito.");
  }
}

export async function postMiPagoCreditoTransferencia(req, res) {
  try {
    const data = await crearSolicitudTransferenciaCreditoCliente(
      req.db,
      req.params.creditoId,
      {
        usuarioId: req.user.id,
        monto: req.body?.monto,
      },
    );

    return res.status(data.reutilizado ? 200 : 201).json({
      ok: true,
      msg: data.reutilizado
        ? "Ya existe una transferencia pendiente para este crédito."
        : "Transferencia registrada como pendiente de confirmación.",
      data,
    });
  } catch (error) {
    return handleError(
      res,
      error,
      "Error registrando la transferencia del crédito.",
    );
  }
}

export async function getMisMovimientosCreditoDetalle(req, res) {
  try {
    const data = await listarMisMovimientosCreditoPorCredito(
      req.db,
      req.user.id,
      req.params.creditoId,
      req.query,
    );
    if (!data)
      return res.status(404).json({ ok: false, msg: "Crédito no encontrado." });
    return res.json({ ok: true, data: data.items, pagination: data });
  } catch (error) {
    return handleError(
      res,
      error,
      "Error obteniendo los movimientos del crédito.",
    );
  }
}

export async function getMisPagosPedido(req, res) {
  try {
    const data = await listarMisPagosPedido(
      req.db,
      req.user.id,
      req.params.pedidoId,
      req.query,
    );
    if (!data)
      return res.status(404).json({ ok: false, msg: "Pedido no encontrado." });
    return res.json({ ok: true, data: data.items, pagination: data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo los pagos del pedido.");
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
    const data = await obtenerMiPedido(
      req.db,
      req.user.id,
      req.params.pedidoId,
    );
    if (!data) {
      return res.status(404).json({ ok: false, msg: "Pedido no encontrado." });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    return handleError(res, error, "Error obteniendo el pedido.");
  }
}
