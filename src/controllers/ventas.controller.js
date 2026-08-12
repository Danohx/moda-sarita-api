import {
  crearVentaPOS,
  cancelarVentaPOS,
  abrirCorte,
  getCorteAbierto,
  cerrarCorte,
  getCorteById,
  getHistorialCortes,
  listarHistorialVentas,
  getVentaHistorialDetalle,
} from "../models/ventas.model.js";
import { getConfigPOS } from "../services/configuracion.service.js";
import {
  getPedidoDetalleAdmin,
  crearApartado,
  registrarAbonoApartado,
  liquidarApartado,
  cancelarApartado,
} from "../models/pedidos.model.js";
import { generarTicketPedidoPdfStream } from "../utils/pdf/ticketPedido.pdf.js";
import { getConfigTicket } from "../services/configuracion.service.js";
import { createAuditLog } from "../utils/audit.util.js";

function formatMoney(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number(value ?? 0));
}

function getFolioVenta(row) {
  return `VTA-${row?.folio ?? row?.id ?? "N/A"}`;
}

async function registrarAuditoriaVenta(db, payload) {
  try {
    await createAuditLog(db, payload);
  } catch (err) {
    console.error("registrarAuditoriaVenta error:", err);
  }
}

export async function postVentaPOS(req, res) {
  try {
    const vendedor_id = req.user.id;
    const payload = req.body || {};
    const posConfig = await getConfigPOS(req.db);
    const idempotencyKey =
      req.get("Idempotency-Key") || payload.idempotency_key || null;

    const out = await crearVentaPOS(req.db, {
      ...payload,
      vendedor_id,
      posConfig,
      idempotency_key: idempotencyKey,
    });

    if (!out.idempotent_replay) {
      await registrarAuditoriaVenta(req.db, {
        modulo: "ventas.pos",
        accion: "create",
        descripcion: `Se registró la venta ${getFolioVenta(out)} por ${formatMoney(
          out.total,
        )}.`,
        usuarioId: req.user?.id ?? null,
        metadata: {
          venta_id: out.id,
          folio: out.folio,
          folio_label: getFolioVenta(out),
          estado: out.estado,
          cliente_id: out.cliente_id ?? null,
          vendedor_id: out.vendedor_id ?? null,
          total: Number(out.total ?? 0),
          metodo_pago: payload.metodo_pago ?? null,
          credito_id: out.credito?.id ?? null,
          monto_financiado: out.credito
            ? Number(out.credito.monto_financiado ?? 0)
            : null,
          enganche: out.credito ? Number(out.credito.enganche ?? 0) : null,
          idempotency_key: idempotencyKey,
          origen: "POS",
        },
      });
    }

    return res.status(out.idempotent_replay ? 200 : 201).json({
      ok: true,
      replay: out.idempotent_replay === true,
      data: out,
    });
  } catch (err) {
    console.error("postVentaPOS error:", err);

    const statusByCode = {
      VALIDATION: 400,
      NOT_FOUND: 404,
      STOCK: 409,
      CONFLICT: 409,
      CREDIT_NOT_ELIGIBLE: 422,
      P0001: 400,
      "22P02": 400,
      23505: 409,
      23514: 400,
      CONFIGURATION: 500,
      CREDIT_RECONCILIATION: 500,
    };

    const status = statusByCode[err.code] || 500;

    return res.status(status).json({
      ok: false,
      msg: err.message || "Error creando venta",
      code: err.code || null,
      details: err.details || err.detail || undefined,
    });
  }
}

export async function postCancelarVentaPOS(req, res) {
  try {
    const pedido_id = String(req.params.id || "").trim();
    const { motivo, metodo_reembolso = null, referencia_reembolso = null } =
      req.body || {};

    const permissionSet = new Set([
      ...(Array.isArray(req.user?.permisos) ? req.user.permisos : []),
      ...(Array.isArray(req.user?.permissions) ? req.user.permissions : []),
    ]);
    const roleName = String(req.user?.rol || req.user?.role || "")
      .trim()
      .toUpperCase();
    const legacyRefund = permissionSet.has("ventas.pos.refund");
    const legacyAdmin =
      legacyRefund && ["ADMIN", "ADMINISTRADOR", "SUPERADMIN"].includes(roleName);
    const canRefundAnySale =
      permissionSet.has("ventas.pos.refund.any") || legacyAdmin;
    const canRefundOwnSale =
      canRefundAnySale ||
      permissionSet.has("ventas.pos.refund.own") ||
      legacyRefund;

    if (!canRefundOwnSale) {
      return res.status(403).json({
        ok: false,
        msg: "No tienes permiso para realizar devoluciones POS.",
        code: "REFUND_PERMISSION_REQUIRED",
      });
    }

    const out = await cancelarVentaPOS(req.db, {
      pedido_id,
      usuario_id: req.user?.id ?? null,
      motivo,
      metodo_reembolso,
      referencia_reembolso,
      puede_reembolsar_cualquier_venta: canRefundAnySale,
    });

    const ventaPropia =
      Boolean(req.user?.id) &&
      Boolean(out.venta?.vendedor_id) &&
      String(out.venta.vendedor_id) === String(req.user.id);

    await registrarAuditoriaVenta(req.db, {
      modulo: "ventas.pos",
      accion: "refund",
      descripcion: `Se devolvió la venta ${getFolioVenta(out.venta)} por ${formatMoney(
        out.reembolso?.monto,
      )}.`,
      usuarioId: req.user?.id ?? null,
      metadata: {
        venta_id: out.venta?.id,
        folio: out.venta?.folio,
        vendedor_original_id: out.venta?.vendedor_id ?? null,
        devolucion_por_usuario_id: req.user?.id ?? null,
        venta_propia: ventaPropia,
        alcance_permiso: canRefundAnySale ? "ANY" : "OWN",
        reembolso_id: out.reembolso?.id ?? null,
        monto_reembolso: Number(out.reembolso?.monto ?? 0),
        motivo: String(motivo || "").trim(),
      },
    });

    return res.json({
      ok: true,
      msg: "Venta devuelta y stock reintegrado correctamente.",
      data: out,
    });
  } catch (err) {
    console.error("postCancelarVentaPOS error:", err);

    const statusByCode = {
      VALIDATION: 400,
      NOT_FOUND: 404,
      CONFLICT: 409,
      REFUND_SCOPE_FORBIDDEN: 403,
      CASH_CUT_REQUIRED: 409,
      CREDIT_REFUND_REQUIRED: 409,
      PAYMENT_RECONCILIATION: 409,
      "22P02": 400,
      "23514": 400,
    };

    return res.status(statusByCode[err.code] || 500).json({
      ok: false,
      msg: err.message || "Error devolviendo venta POS",
      code: err.code || null,
      detail: err.detail || undefined,
    });
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

    const out = await registrarAbonoApartado(req.db, pedido_id, {
      monto,
      metodo: String(metodo_pago || "").trim().toUpperCase(),
      referencia_externa,
      usuario_id: req.user?.id ?? null,
    });

    return res.status(201).json({
      ok: true,
      data: out.detalle,
      pago_generado: out.pago_generado,
    });
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

    const out = await liquidarApartado(req.db, pedido_id, {
      metodo: String(metodo_pago || "").trim().toUpperCase(),
      referencia_externa,
      usuario_id: vendedor_id,
    });

    return res.json({
      ok: true,
      data: out.detalle,
      pago_generado: out.pago_generado,
    });
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

    const out = await cancelarApartado(req.db, pedido_id, {
      motivo_cancelacion: motivo,
      usuario_id: vendedor_id,
      reembolso: { modo: "NINGUNO" },
    });

    return res.json({ ok: true, data: out.detalle });
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

    await registrarAuditoriaVenta(req.db, {
      modulo: "ventas.corte_caja",
      accion: "open",
      descripcion: `Se abrió corte de caja con fondo inicial de ${formatMoney(
        out.fondo_inicial,
      )}.`,
      usuarioId: req.user?.id ?? null,
      metadata: {
        corte_id: out.id,
        usuario_id: out.usuario_id,
        fondo_inicial: Number(out.fondo_inicial ?? 0),
        inicio_turno: out.inicio_turno,
      },
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

    await registrarAuditoriaVenta(req.db, {
      modulo: "ventas.corte_caja",
      accion: "close",
      descripcion: `Se cerró corte de caja. Total contado: ${formatMoney(
        out.total_real,
      )}.`,
      usuarioId: req.user?.id ?? null,
      metadata: {
        out_id: out.id,
        usuario_id: out.usuario_id,
        total_sistema: Number(out.total_sistema ?? 0),
        total_real: Number(out.total_real ?? 0),
        diferencia:
          Number(out.total_real ?? 0) - Number(out.total_sistema ?? 0),
        fin_turno: out.fin_turno,
        observaciones: out.observaciones ?? null,
      },
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
    return res.status(500).json({
      ok: false,
      msg: "Error consultando el historial de cortes",
      detail: err.message,
    });
  }
}

export async function getCorteDetalle(req, res) {
  try {
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

    return res.status(500).json({
      ok: false,
      msg: "Error consultando el detalle del corte",
      detail: err.message,
    });
  }
}

export async function getVentaTicketPdf(req, res) {
  try {
    if (!req.db) {
      return res
        .status(500)
        .json({ ok: false, message: "DB context no configurado (req.db)" });
    }

    const ventaId = String(req.params.id || "").trim();

    if (!ventaId) {
      return res
        .status(400)
        .json({ ok: false, message: "id de la venta requerido" });
    }

    const data = await getPedidoDetalleAdmin(req.db, ventaId);

    if (!data) {
      return res
        .status(404)
        .json({ ok: false, message: "Venta no encontrada" });
    }

    if (data.pedido.tipo !== "PUNTO_VENTA") {
      return res.status(400).json({
        ok: false,
        message: "El pedido no es una venta de punto de venta",
      });
    }

    const { pedido, detalles, pagos } = data;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="ticket-VTA-${pedido.folio}.pdf"`,
    );

    const ticketConfig = await getConfigTicket(req.db);

    const pdf = generarTicketPedidoPdfStream({
      pedido,
      detalles,
      pagos,
      ticketConfig,
    });

    const modoTicket = String(req.query.modo || "reimpresion").trim();

    const esGeneracionInicial = modoTicket === "generacion";

    const accionAuditoria = esGeneracionInicial
      ? "ticket_generated"
      : "ticket_reprint";

    const descripcionAuditoria = esGeneracionInicial
      ? `Se generó el ticket de la venta ${getFolioVenta(pedido)}.`
      : `Se reimprimió el ticket de la venta ${getFolioVenta(pedido)}.`;

    await registrarAuditoriaVenta(req.db, {
      modulo: "ventas.pos",
      accion: accionAuditoria,
      descripcion: descripcionAuditoria,
      usuarioId: req.user?.id ?? null,
      metadata: {
        venta_id: pedido.id,
        folio: pedido.folio,
        folio_label: getFolioVenta(pedido),
        total: Number(pedido.total ?? 0),
        estado: pedido.estado,
        origen: esGeneracionInicial,
      },
    });

    pdf.pipe(res);
  } catch (err) {
    if (err.code === "22P02") {
      return res
        .status(400)
        .json({ ok: false, message: "Formato de ID inválido" });
    }
    console.error("getVentaTicketPdf error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error generando ticket PDF",
      detail: err.message,
    });
  }
}

export async function getHistorialVentasPOS(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const result = await listarHistorialVentas(req.db, {
      q: req.query.q || null,
      estado: req.query.estado || null,
      fecha_inicio: req.query.fecha_inicio || null,
      fecha_fin: req.query.fecha_fin || null,
      metodo: req.query.metodo || null,
      vendedor_id: req.query.vendedor_id || null,
      cliente_id: req.query.cliente_id || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json({
      ok: true,
      data: result.rows,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (err) {
    console.error("getHistorialVentasPOS error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error obteniendo historial de ventas",
      detail: err.message,
    });
  }
}

export async function getVentaHistorialPOSById(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({
        ok: false,
        message: "DB context no configurado (req.db)",
      });
    }

    const ventaId = String(req.params.id || "").trim();

    if (!ventaId) {
      return res.status(400).json({
        ok: false,
        message: "id de venta requerido",
      });
    }

    const data = await getVentaHistorialDetalle(req.db, ventaId);

    if (!data) {
      return res.status(404).json({
        ok: false,
        message: "Venta no encontrada",
      });
    }

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    if (err.code === "22P02") {
      return res.status(400).json({
        ok: false,
        message: "Formato de ID inválido",
      });
    }

    console.error("getVentaHistorialPOSById error:", err);

    return res.status(500).json({
      ok: false,
      message: "Error obteniendo detalle de venta",
      detail: err.message,
    });
  }
}
