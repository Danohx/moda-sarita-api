import { programarSincronizacionAlexa } from "../services/alexa-sync.service.js";
import {
  cancelarCredito,
  crearCredito,
  listarCreditos,
  obtenerComprobantePagoCredito,
  obtenerCreditoPorId,
  obtenerCreditosCliente,
  obtenerEstadoCreditoCliente,
  obtenerParametrosCredito,
  registrarAbonoCredito,
} from "../models/credito.model.js";
import {
  calcularPlanCredito,
  evaluarElegibilidadCliente,
} from "../services/credito.service.js";
import {
  validarClienteId,
  validarCreditoId,
  validarFechaProcesamientoCredito,
  validarFiltrosCreditos,
  validarMotivoCancelacionCredito,
  validarPagoId,
  validarPayloadAbonoCredito,
  validarPayloadCreacionCredito,
  validarPayloadSimulacionCredito,
} from "../validators/credito.validator.js";
import { createAuditLog } from "../utils/audit.util.js";
import { getConfigTicket } from "../services/configuracion.service.js";
import { generarComprobanteCreditoPdfStream } from "../utils/pdf/comprobanteCredito.pdf.js";
import {
  normalizarFiltrosReporteCredito,
  obtenerReporteCreditoOperativo,
  obtenerReporteFinancieroCredito,
  obtenerUltimaEjecucionVencimientos,
  procesarVencimientosConRegistro,
} from "../models/creditoReportes.model.js";
import { generarReporteCreditoPdf } from "../utils/pdf/reporteCredito.pdf.js";
import { generarReporteCreditoExcel } from "../utils/reporteCreditoExcel.js";

function statusForError(error) {
  if (error?.status && Number.isInteger(error.status)) return error.status;

  switch (error?.code) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "CONFLICT":
    case "STOCK":
    case "23505":
      return 409;
    case "CREDIT_NOT_ELIGIBLE":
      return 422;
    case "VALIDATION":
    case "22P02":
    case "22007":
    case "23514":
    case "P0001":
      return 400;
    case "CONFIGURATION":
    case "CREDIT_RECONCILIATION":
      return 500;
    default:
      return 500;
  }
}

function handleCreditoError(res, error, fallbackMessage) {
  const status = statusForError(error);

  console.error(fallbackMessage, error);

  return res.status(status).json({
    ok: false,
    msg: status === 500 && !error?.message ? fallbackMessage : error.message,
    code: error?.code || null,
    details: error?.details || error?.detail || undefined,
  });
}

async function registrarAuditoriaCredito(db, payload) {
  try {
    await createAuditLog(db, payload);
  } catch (error) {
    console.error("registrarAuditoriaCredito error:", error);
  }
}

export async function postSimularCredito(req, res) {
  try {
    const input = validarPayloadSimulacionCredito(req.body || {});
    const [parametros, cliente] = await Promise.all([
      obtenerParametrosCredito(req.db),
      obtenerEstadoCreditoCliente(req.db, input.cliente_id),
    ]);

    if (!cliente) {
      return res.status(404).json({ ok: false, msg: "Cliente no encontrado" });
    }

    const plan = calcularPlanCredito({
      totalCompra: input.total_compra,
      enganche: input.enganche,
      plazoMeses: input.plazo_meses,
      frecuenciaPago: input.frecuencia_pago,
      configuracion: parametros,
    });

    const elegibilidad = evaluarElegibilidadCliente({
      cliente,
      montoFinanciado: plan.monto_financiado,
      configuracion: parametros,
    });

    return res.json({
      ok: true,
      data: {
        ...plan,
        cliente: {
          cliente_id: cliente.cliente_id,
          cliente_nombre: cliente.cliente_nombre,
          limite_credito: Number(cliente.limite_credito || 0),
          saldo_deudor: Number(cliente.saldo_deudor || 0),
          credito_disponible: Number(cliente.credito_disponible || 0),
        },
        elegibilidad,
        validaciones_incumplidas: elegibilidad.validaciones_incumplidas,
      },
    });
  } catch (error) {
    return handleCreditoError(res, error, "Error simulando crédito");
  }
}

export async function getCreditos(req, res) {
  try {
    const filters = validarFiltrosCreditos(req.query || {});
    const result = await listarCreditos(req.db, filters);

    return res.json({
      ok: true,
      data: result.items,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    return handleCreditoError(res, error, "Error listando créditos");
  }
}

export async function getCredito(req, res) {
  try {
    const creditoId = validarCreditoId(req.params.creditoId);
    const data = await obtenerCreditoPorId(req.db, creditoId);

    if (!data) {
      return res.status(404).json({ ok: false, msg: "Crédito no encontrado" });
    }

    return res.json({ ok: true, data });
  } catch (error) {
    return handleCreditoError(res, error, "Error consultando crédito");
  }
}

export async function getCreditosCliente(req, res) {
  try {
    const clienteId = validarClienteId(req.params.id || req.params.clienteId);
    const filters = validarFiltrosCreditos({
      ...req.query,
      cliente_id: clienteId,
    });
    const result = await obtenerCreditosCliente(req.db, clienteId, filters);

    return res.json({
      ok: true,
      data: result.items,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    return handleCreditoError(
      res,
      error,
      "Error consultando créditos del cliente",
    );
  }
}

export async function postCrearCredito(req, res) {
  try {
    const input = validarPayloadCreacionCredito(req.body || {});
    const parametros = await obtenerParametrosCredito(req.db);
    const plan = calcularPlanCredito({
      totalCompra: input.total_compra,
      enganche: input.enganche,
      plazoMeses: input.plazo_meses,
      frecuenciaPago: input.frecuencia_pago,
      configuracion: parametros,
    });

    const created = await crearCredito(req.db, {
      clienteId: input.cliente_id,
      pedidoId: input.pedido_id,
      plan,
      origen: "ADMIN",
      usuarioId: req.user?.id ?? null,
      pagoEnganche:
        plan.enganche > 0
          ? {
              metodo: input.metodo_enganche,
              referenciaExterna: input.referencia_enganche,
              canal: "ADMIN",
            }
          : null,
    });

    const detail = await obtenerCreditoPorId(req.db, created.credito.id);

    await registrarAuditoriaCredito(req.db, {
      modulo: "clientes.creditos",
      accion: "create",
      descripcion: `Se creó el crédito ${created.credito.id} por $${Number(
        created.credito.monto_financiado,
      ).toFixed(2)}.`,
      usuarioId: req.user?.id ?? null,
      metadata: {
        credito_id: created.credito.id,
        cliente_id: created.credito.cliente_id,
        pedido_id: created.credito.pedido_id,
        monto_financiado: Number(created.credito.monto_financiado),
        enganche: Number(created.credito.enganche),
        origen: created.credito.origen,
      },
    });
    programarSincronizacionAlexa(created.credito.cliente_id);

    return res.status(201).json({ ok: true, data: detail });
  } catch (error) {
    return handleCreditoError(res, error, "Error creando crédito");
  }
}

export async function postAbonoCredito(req, res) {
  try {
    const creditoId = validarCreditoId(req.params.creditoId);
    const input = validarPayloadAbonoCredito(req.body || {});
    const result = await registrarAbonoCredito(req.db, creditoId, {
      monto: input.monto,
      metodoPago: input.metodo_pago,
      referenciaExterna: input.referencia_externa,
      observaciones: input.observaciones,
      usuarioId: req.user?.id ?? null,
      canal: "ADMIN",
    });

    await registrarAuditoriaCredito(req.db, {
      modulo: "clientes.creditos",
      accion: "payment_create",
      descripcion: `Se registró un abono de $${Number(
        result.pago.monto,
      ).toFixed(2)} al crédito ${creditoId}.`,
      usuarioId: req.user?.id ?? null,
      metadata: {
        credito_id: creditoId,
        pago_id: result.pago.id,
        concepto: result.pago.concepto,
        metodo: result.pago.metodo,
        monto: Number(result.pago.monto),
        saldo_pendiente: Number(result.credito.saldo_pendiente),
      },
    });
    programarSincronizacionAlexa(created.credito.cliente_id);

    return res.status(201).json({
      ok: true,
      data: {
        ...result,
        comprobante_url: `/api/creditos/${creditoId}/pagos/${result.pago.id}/comprobante`,
      },
    });
  } catch (error) {
    return handleCreditoError(res, error, "Error registrando abono de crédito");
  }
}

export async function postCancelarCredito(req, res) {
  try {
    const creditoId = validarCreditoId(req.params.creditoId);
    const { motivo } = validarMotivoCancelacionCredito(req.body || {});
    const data = await cancelarCredito(req.db, creditoId, {
      motivo,
      usuarioId: req.user?.id ?? null,
    });

    await registrarAuditoriaCredito(req.db, {
      modulo: "clientes.creditos",
      accion: "cancel",
      descripcion: `Se canceló el crédito ${creditoId}.`,
      usuarioId: req.user?.id ?? null,
      metadata: {
        credito_id: creditoId,
        cliente_id: data.cliente_id,
        pedido_id: data.pedido_id,
        motivo,
      },
    });

    programarSincronizacionAlexa(created.credito.cliente_id);

    return res.json({ ok: true, data });
  } catch (error) {
    return handleCreditoError(res, error, "Error cancelando crédito");
  }
}

export async function postProcesarVencimientos(req, res) {
  try {
    const fecha = validarFechaProcesamientoCredito(req.body?.fecha);
    const ejecucion = await procesarVencimientosConRegistro(req.db, {
      fecha,
      origen: "MANUAL",
      usuarioId: req.user?.id ?? null,
    });
    const resultado = ejecucion.resultado || {};

    await registrarAuditoriaCredito(req.db, {
      modulo: "clientes.creditos",
      accion: "overdue_process",
      descripcion: `Se procesaron vencimientos de crédito${fecha ? ` con fecha ${fecha}` : ""}.`,
      usuarioId: req.user?.id ?? null,
      metadata: { fecha: fecha || null, resultado },
    });

    return res.json({ ok: true, data: { ...resultado, ejecucion } });
  } catch (error) {
    return handleCreditoError(res, error, "Error procesando vencimientos");
  }
}

export async function getUltimaEjecucionVencimientos(req, res) {
  try {
    const data = await obtenerUltimaEjecucionVencimientos(req.db);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleCreditoError(
      res,
      error,
      "Error consultando la última ejecución de vencimientos",
    );
  }
}

export async function getReporteCreditoOperativo(req, res) {
  try {
    const filters = normalizarFiltrosReporteCredito(req.query || {});
    const data = await obtenerReporteCreditoOperativo(req.db, filters);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleCreditoError(res, error, "Error generando reporte de crédito");
  }
}

export async function getReporteFinancieroCredito(req, res) {
  try {
    const filters = normalizarFiltrosReporteCredito(req.query || {});
    const data = await obtenerReporteFinancieroCredito(req.db, filters);
    return res.json({ ok: true, data });
  } catch (error) {
    return handleCreditoError(
      res,
      error,
      "Error generando reporte financiero de crédito",
    );
  }
}

async function exportarReporteCredito(req, res, tipo, formato) {
  const filters = normalizarFiltrosReporteCredito(req.query || {});
  const data =
    tipo === "financiero"
      ? await obtenerReporteFinancieroCredito(req.db, filters)
      : await obtenerReporteCreditoOperativo(req.db, filters);

  const suffix = `${filters.from}-${filters.to}`;

  if (formato === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reporte-${tipo}-${suffix}.pdf"`,
    );
    generarReporteCreditoPdf({ tipo, data }).pipe(res);
    return;
  }

  const buffer = await generarReporteCreditoExcel({ tipo, data });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="reporte-${tipo}-${suffix}.xlsx"`,
  );
  return res.send(Buffer.from(buffer));
}

export async function getReporteCreditoOperativoPdf(req, res) {
  try {
    return await exportarReporteCredito(req, res, "credito", "pdf");
  } catch (error) {
    if (res.headersSent) return res.end();
    return handleCreditoError(
      res,
      error,
      "Error exportando reporte de crédito",
    );
  }
}

export async function getReporteCreditoOperativoExcel(req, res) {
  try {
    return await exportarReporteCredito(req, res, "credito", "excel");
  } catch (error) {
    return handleCreditoError(
      res,
      error,
      "Error exportando reporte de crédito",
    );
  }
}

export async function getReporteFinancieroCreditoPdf(req, res) {
  try {
    return await exportarReporteCredito(req, res, "financiero", "pdf");
  } catch (error) {
    if (res.headersSent) return res.end();
    return handleCreditoError(
      res,
      error,
      "Error exportando reporte financiero",
    );
  }
}

export async function getReporteFinancieroCreditoExcel(req, res) {
  try {
    return await exportarReporteCredito(req, res, "financiero", "excel");
  } catch (error) {
    return handleCreditoError(
      res,
      error,
      "Error exportando reporte financiero",
    );
  }
}

export async function getComprobantePagoCreditoPdf(req, res) {
  try {
    const creditoId = validarCreditoId(req.params.creditoId);
    const pagoId = validarPagoId(req.params.pagoId);
    const data = await obtenerComprobantePagoCredito(req.db, creditoId, pagoId);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Pago de crédito no encontrado",
      });
    }

    const ticketConfig = await getConfigTicket(req.db);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="credito-${creditoId}-pago-${pagoId}.pdf"`,
    );

    const pdf = generarComprobanteCreditoPdfStream({ data, ticketConfig });
    pdf.pipe(res);
  } catch (error) {
    if (res.headersSent) return res.end();
    return handleCreditoError(
      res,
      error,
      "Error generando comprobante de crédito",
    );
  }
}
