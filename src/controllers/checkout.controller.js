import { crearPedidoWeb } from "../models/checkout.model.js";

export async function postPedidoWeb(req, res) {
  try {
    const data = await crearPedidoWeb(req.db, req.user.id, req.body || {});
    return res.status(201).json({
      ok: true,
      msg:
        data.estado === "PAGADO"
          ? "Pedido creado y pagado correctamente."
          : "Pedido creado. El pago está pendiente de confirmación.",
      data,
    });
  } catch (error) {
    console.error("postPedidoWeb error:", error);

    if (error.code === "23505") {
      return res.status(409).json({ ok: false, msg: "Registro duplicado." });
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
      msg: "No se pudo crear el pedido web.",
      detail: error.message,
    });
  }
}
