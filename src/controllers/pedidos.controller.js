import {
  listPedidosAdmin,
  getPedidoDetalleAdmin,
  registrarAbonoApartado,
  cancelarApartado,
  liquidarApartado,
  vencerApartadosExpirados,
  getPagoTicketData,
} from "../models/pedidos.model.js";
import {
  generarTicketPedidoPdfStream,
  generarTicketPagoPdfStream,
} from "../utils/pdf/ticketPedido.pdf.js";
import { getConfigTicket } from "../services/configuracion.service.js"

const METODOS_PAGO_VALIDOS = new Set([
  "EFECTIVO",
  "TARJETA_CREDITO",
  "TARJETA_DEBITO",
  "TRANSFERENCIA",
  "PAYPAL",
  "MERCADO_PAGO",
  "CREDITO_TIENDA",
]);

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

export async function getPedidosAdmin(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const tipo = req.query.tipo
      ? String(req.query.tipo).trim().toUpperCase()
      : null;
    const estado = req.query.estado
      ? String(req.query.estado).trim().toUpperCase()
      : null;

    const cliente_id = req.query.cliente_id
      ? String(req.query.cliente_id).trim()
      : null;

    const q = req.query.q ? String(req.query.q).trim() : null;

    const limit = toInt(req.query.limit, 50);
    const offset = toInt(req.query.offset, 0);

    if (limit <= 0 || limit > 200) {
      return res.status(400).json({
        ok: false,
        message: "limit inválido (1-200)",
      });
    }

    if (offset < 0) {
      return res.status(400).json({
        ok: false,
        message: "offset inválido",
      });
    }

    const data = await listPedidosAdmin(req.db, {
      tipo,
      estado,
      cliente_id,
      q,
      limit,
      offset,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getPedidosAdmin error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error listando pedidos",
      detail: err.message,
    });
  }
}

export async function getPedidoByIdAdmin(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({
        ok: false,
        message: "id requerido",
      });
    }

    const data = await getPedidoDetalleAdmin(req.db, id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getPedidoByIdAdmin error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error obteniendo pedido",
      detail: err.message,
    });
  }
}

export async function postAbonoApartado(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const pedidoId = String(req.params.id || "").trim();

    if (!pedidoId) {
      return res.status(400).json({
        ok: false,
        message: "id del apartado requerido",
      });
    }

    const { monto, metodo, referencia_externa = null } = req.body || {};

    const montoNumber = Number(monto);

    if (!Number.isFinite(montoNumber) || montoNumber <= 0) {
      return res.status(400).json({
        ok: false,
        message: "monto debe ser un número mayor a 0",
      });
    }

    if (!metodo || !METODOS_PAGO_VALIDOS.has(String(metodo).toUpperCase())) {
      return res.status(400).json({
        ok: false,
        message: "Método de pago inválido",
      });
    }

    const data = await registrarAbonoApartado(req.db, pedidoId, {
      monto: montoNumber,
      metodo: String(metodo).toUpperCase(),
      referencia_externa,
      usuario_id: req.user?.id ?? null,
    });

    return res.status(201).json({
      ok: true,
      message: "Abono registrado correctamente",
      data: data.detalle,
      pago_generado: data.pago_generado,
    });
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        ok: false,
        message: "Formato de ID inválido",
      });
    }

    if (err.code === "23514") {
      return res.status(400).json({
        ok: false,
        message: "El pago no cumple una restricción de la base de datos",
        detail: err.detail,
      });
    }

    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        message: err.message,
      });
    }

    console.error("postAbonoApartado error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error registrando abono",
      detail: err.message,
    });
  }
}

export async function postCancelarApartado(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const pedidoId = String(req.params.id || "").trim();

    if (!pedidoId) {
      return res.status(400).json({
        ok: false,
        message: "id del apartado requerido",
      });
    }

    const { motivo_cancelacion } = req.body || {};

    const motivo = String(motivo_cancelacion || "").trim();

    if (motivo.length < 3) {
      return res.status(400).json({
        ok: false,
        message: "El motivo de cancelación es requerido",
      });
    }

    const data = await cancelarApartado(req.db, pedidoId, {
      motivo_cancelacion: motivo,
    });

    return res.json({
      ok: true,
      message: "Apartado cancelado correctamente",
      data,
    });
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        ok: false,
        message: "Formato de ID inválido",
      });
    }

    if (err.code === "23514") {
      return res.status(400).json({
        ok: false,
        message: "La operación no cumple una restricción de la base de datos",
        detail: err.detail,
      });
    }

    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        message: err.message,
      });
    }

    console.error("postCancelarApartado error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error cancelando apartado",
      detail: err.message,
    });
  }
}

export async function postLiquidarApartado(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const pedidoId = String(req.params.id || "").trim();

    if (!pedidoId) {
      return res.status(400).json({
        ok: false,
        message: "id del apartado requerido",
      });
    }

    const { metodo, referencia_externa = null } = req.body || {};

    if (!metodo || !METODOS_PAGO_VALIDOS.has(String(metodo).toUpperCase())) {
      return res.status(400).json({
        ok: false,
        message: "Método de pago inválido",
      });
    }

    const data = await liquidarApartado(req.db, pedidoId, {
      metodo: String(metodo).toUpperCase(),
      referencia_externa,
      usuario_id: req.user?.id ?? null,
    });

    return res.json({
      ok: true,
      message: "Apartado liquidado correctamente",
      data: data.detalle,
      pago_generado: data.pago_generado,
    });
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        ok: false,
        message: "Formato de ID inválido",
      });
    }

    if (err.code === "23514") {
      return res.status(400).json({
        ok: false,
        message: "La operación no cumple una restricción de la base de datos",
        detail: err.detail,
      });
    }

    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        message: err.message,
      });
    }

    console.error("postLiquidarApartado error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error liquidando apartado",
      detail: err.message,
    });
  }
}

export async function postVencerApartadosExpirados(req, res) {
  const authHeader = req.headers.authorization;

  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({
      ok: false,
      message: "No autorizado",
    });
  }

  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const data = await vencerApartadosExpirados(req.db);

    return res.json({
      ok: true,
      message: data.message,
      data,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        ok: false,
        message: err.message,
      });
    }

    console.error("postVencerApartadosExpirados error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error venciendo apartados expirados",
      detail: err.message,
    });
  }
}

export async function getPedidoTicketPdf(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const pedidoId = String(req.params.id || "").trim();

    if (!pedidoId) {
      return res.status(400).json({
        ok: false,
        message: "id del pedido requerido",
      });
    }

    const data = await getPedidoDetalleAdmin(req.db, pedidoId);

    if (!data) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    const { pedido, detalles, pagos } = data;

    const folioLabel =
      pedido.tipo === "APARTADO"
        ? `APT-${pedido.folio}`
        : `PED-${pedido.folio}`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="ticket-${folioLabel}.pdf"`,
    );

    const ticketConfig = await getConfigTicket(req.db);

    const pdf = generarTicketPedidoPdfStream({
      pedido,
      detalles,
      pagos,
      ticketConfig,
    });

    pdf.pipe(res);
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        ok: false,
        message: "Formato de ID inválido",
      });
    }

    console.error("getPedidoTicketPdf error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error generando ticket PDF",
      detail: err.message,
    });
  }
}

export async function getPagoTicketPdf(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const pedidoId = String(req.params.id || "").trim();
    const pagoId = String(req.params.pagoId || "").trim();

    if (!pedidoId || !pagoId) {
      return res.status(400).json({
        ok: false,
        message: "id del pedido y pago son requeridos",
      });
    }

    const data = await getPagoTicketData(req.db, pedidoId, pagoId);

    if (!data) {
      return res.status(404).json({
        ok: false,
        message: "Pago o pedido no encontrado",
      });
    }

    const { pedido, pago } = data;

    const folioLabel =
      pedido.tipo === "APARTADO"
        ? `APT-${pedido.folio}`
        : `PED-${pedido.folio}`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="ticket-pago-${folioLabel}-${pago.id}.pdf"`,
    );

    const ticketConfig = await getConfigTicket(req.db);

    const pdf = generarTicketPagoPdfStream({
      ...data,
      ticketConfig,
    });

    pdf.pipe(res);
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        ok: false,
        message: "Formato de ID inválido",
      });
    }

    console.error("getPagoTicketPdf error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error generando ticket de pago",
      detail: err.message,
    });
  }
}
