import {
  crearPedidoWeb,
  confirmarPedidoWeb,
  cancelarPedidoWeb,
  validarCuponCheckout,
  obtenerOpcionesCreditoWeb,
} from "../models/checkout.model.js";

function handleCheckoutError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);

  if (error.code === "23505") {
    return res.status(409).json({
      ok: false,
      msg: "Registro duplicado.",
    });
  }

  if (error.code === "22P02") {
    return res.status(400).json({
      ok: false,
      msg: "Identificador inválido.",
    });
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
    msg: fallbackMessage,
    detail: error.message,
  });
}

export async function postPedidoWeb(req, res) {
  try {
    const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();

    const data = await crearPedidoWeb(req.db, req.user.id, {
      ...(req.body || {}),
      idempotency_key: idempotencyKey,
    });

    return res.status(data.replayed ? 200 : 201).json({
      ok: true,
      msg: data.replayed
        ? "El pedido ya había sido procesado."
        : data.pago_estado === "ENGANCHE_PENDIENTE"
          ? "Pedido reservado. El enganche por transferencia está pendiente de confirmación."
          : data.estado === "PAGADO"
            ? "Pedido creado y pagado correctamente."
            : "Pedido creado. El pago está pendiente de confirmación.",
      data,
    });
  } catch (error) {
    return handleCheckoutError(res, error, "No se pudo crear el pedido web.");
  }
}

export async function postConfirmarPedidoWeb(req, res) {
  try {
    const data = await confirmarPedidoWeb(
      req.db,
      req.params.id,
      req.user.id,
      req.body || {},
    );

    return res.json({
      ok: true,
      msg: data.credito_id
        ? "Enganche confirmado, crédito activado y reserva aplicada al inventario."
        : "Pago confirmado y reserva aplicada al inventario.",
      data,
    });
  } catch (error) {
    return handleCheckoutError(
      res,
      error,
      "No se pudo confirmar el pedido web.",
    );
  }
}

export async function postCancelarPedidoWeb(req, res) {
  try {
    const data = await cancelarPedidoWeb(
      req.db,
      req.params.id,
      req.user.id,
      req.body || {},
    );

    return res.json({
      ok: true,
      msg: "Pedido cancelado y reserva liberada.",
      data,
    });
  } catch (error) {
    return handleCheckoutError(
      res,
      error,
      "No se pudo cancelar el pedido web.",
    );
  }
}

export async function postValidarCuponCheckout(req, res) {
  try {
    const data = await validarCuponCheckout(req.db, req.user.id, req.body);

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("postValidarCuponCheckout:", error);

    return res.status(error.status || 400).json({
      ok: false,
      code: error.code || "COUPON_ERROR",
      msg: error.message || "No se pudo validar el cupón.",
    });
  }
}

export async function getOpcionesCreditoWeb(req, res) {
  try {
    const data = await obtenerOpcionesCreditoWeb(req.db, req.user.id, req.query.total);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleCheckoutError(res, error, "No se pudo consultar la disponibilidad de crédito.");
  }
}
