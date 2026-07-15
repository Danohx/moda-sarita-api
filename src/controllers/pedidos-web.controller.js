import {
  cancelarPedidoWebPendiente,
  confirmarPagoPedidoWeb,
} from "../models/pedidos-web.model.js";

function handleActionError(res, error, fallback) {
  console.error(fallback, error);
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
  return res.status(500).json({ ok: false, msg: fallback, detail: error.message });
}

export async function postConfirmarPagoWeb(req, res) {
  try {
    const data = await confirmarPagoPedidoWeb(req.db, req.params.id, {
      usuarioId: req.user.id,
      referencia_externa: req.body?.referencia_externa,
    });
    return res.json({ ok: true, msg: "Pago confirmado y stock descontado.", data });
  } catch (error) {
    return handleActionError(res, error, "Error confirmando el pago web.");
  }
}

export async function postCancelarPedidoWeb(req, res) {
  try {
    const data = await cancelarPedidoWebPendiente(req.db, req.params.id, {
      usuarioId: req.user.id,
      motivo_cancelacion: req.body?.motivo_cancelacion,
    });
    return res.json({ ok: true, msg: "Pedido web cancelado.", data });
  } catch (error) {
    return handleActionError(res, error, "Error cancelando el pedido web.");
  }
}
