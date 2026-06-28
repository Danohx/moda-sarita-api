// src/utils/pdf/ticketPedido.pdf.js
import PDFDocument from "pdfkit";

function money(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number(value ?? 0));
}

function formatDate(value) {
  if (!value) return "N/A";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "N/A";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatEstado(value) {
  const map = {
    ACTIVO: "Activo",
    LIQUIDADO: "Liquidado",
    CANCELADO: "Cancelado",
    VENCIDO: "Vencido",
    PENDIENTE: "Pendiente",
    PAGADO: "Pagado",
    ENVIADO: "Enviado",
    ENTREGADO: "Entregado",
    DEVUELTO: "Devuelto",
  };

  return map[value] || value || "N/A";
}

function formatConcepto(value) {
  const map = {
    PAGO_TOTAL: "Pago total",
    ANTICIPO_APARTADO: "Anticipo",
    ABONO_APARTADO: "Abono",
    LIQUIDACION_APARTADO: "Liquidación",
    REEMBOLSO: "Reembolso",
  };

  return map[value] || value || "Pago";
}

function formatTipo(value) {
  const map = {
    PUNTO_VENTA: "En tienda",
    APARTADO: "Apartado",
    WEB: "Pedido web",
  };
  return map[value] || value || "N/A";
}

function ticketWidthToPoints(anchoMm = 80) {
  const mm = Number(anchoMm);

  if (mm <= 58) return 164; // 58mm aprox
  return 226; // 80mm aprox
}

function getTicketConfig(ticketConfig = {}) {
  return {
    nombreTienda: ticketConfig.nombreTienda || "Moda Sarita",
    telefono: ticketConfig.telefono || "",
    direccion: ticketConfig.direccion || "",
    mostrarVendedor: ticketConfig.mostrarVendedor !== false,
    mostrarCliente: ticketConfig.mostrarCliente !== false,
    mensajeFinal: ticketConfig.mensajeFinal || "¡Gracias por su compra!",
    politicaCambios: ticketConfig.politicaCambios || "",
    politicaApartado: ticketConfig.politicaApartado || "",
    anchoMm: ticketConfig.anchoMm || 80,
  };
}

function textIfExists(doc, value, options = {}) {
  const text = String(value || "").trim();

  if (!text) return;

  doc.text(text, options);
}

function line(doc) {
  doc
    .moveTo(12, doc.y)
    .lineTo(215, doc.y)
    .dash(2, { space: 2 })
    .strokeColor("#999999")
    .stroke()
    .undash()
    .strokeColor("#000000");

  doc.moveDown(0.6);
}

function row(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(8).text(label, { continued: true });

  doc
    .font("Helvetica")
    .fontSize(8)
    .text(` ${value ?? "N/A"}`);
}

export function generarTicketPedidoPdfStream({
  pedido,
  detalles,
  pagos,
  ticketConfig = {},
}) {
  const config = getTicketConfig(ticketConfig);

  const doc = new PDFDocument({
    size: [ticketWidthToPoints(config.anchoMm), 900],
    margins: {
      top: 12,
      bottom: 12,
      left: 12,
      right: 12,
    },
    bufferPages: true,
  });

  const folioLabel =
    pedido.tipo === "APARTADO" ? `APT-${pedido.folio}` : `PED-${pedido.folio}`;

  // Header
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(config.nombreTienda, { align: "center" });

  doc.font("Helvetica").fontSize(7);

  textIfExists(doc, config.telefono, { align: "center" });
  textIfExists(doc, config.direccion, { align: "center" });

  doc
    .font("Helvetica")
    .fontSize(7)
    .text("Ticket de pedido / apartado", { align: "center" });

  doc.moveDown(0.5);
  line(doc);

  // Datos generales
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`Folio: ${folioLabel}`, { align: "center" });

  doc.moveDown(0.5);

  row(doc, "Tipo:", formatTipo(pedido.tipo));

  row(doc, "Estado:", formatEstado(pedido.estado));

  if (config.mostrarCliente && pedido.cliente_nombre) {
    row(doc, "Cliente:", pedido.cliente_nombre);
  }

  if (config.mostrarVendedor) {
    row(doc, "Vendedor:", pedido.vendedor_nombre || "N/A");
  }

  row(doc, "Fecha:", formatDate(pedido.fecha_creacion));

  if (pedido.fecha_limite_apartado) {
    row(doc, "Fecha límite:", formatDate(pedido.fecha_limite_apartado));
  }

  if (pedido.liquidado_at) {
    row(doc, "Liquidado:", formatDate(pedido.liquidado_at));
  }

  if (pedido.fecha_cancelacion) {
    row(doc, "Cancelado:", formatDate(pedido.fecha_cancelacion));
  }

  if (pedido.vencido_at) {
    row(doc, "Vencido:", formatDate(pedido.vencido_at));
  }

  if (pedido.motivo_cancelacion) {
    row(doc, "Motivo:", pedido.motivo_cancelacion);
  }

  doc.moveDown(0.5);
  line(doc);

  // Productos
  doc.font("Helvetica-Bold").fontSize(9).text("PRODUCTOS");

  doc.moveDown(0.4);

  if (!detalles.length) {
    doc.font("Helvetica").fontSize(8).text("Sin productos.");
  }

  detalles.forEach((item) => {
    const variante = [
      item.talla_nombre ? `Talla: ${item.talla_nombre}` : null,
      item.color_nombre ? `Color: ${item.color_nombre}` : null,
    ]
      .filter(Boolean)
      .join(" • ");

    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(item.producto_nombre || "Producto");

    if (variante) {
      doc.font("Helvetica").fontSize(7).text(variante);
    }

    if (item.sku) {
      doc.font("Helvetica").fontSize(7).text(`SKU: ${item.sku}`);
    }

    doc
      .font("Helvetica")
      .fontSize(8)
      .text(
        `${item.cantidad} x ${money(item.precio_unitario)} = ${money(item.importe)}`,
        { align: "right" },
      );

    doc.moveDown(0.4);
  });

  line(doc);

  // Pagos
  doc.font("Helvetica-Bold").fontSize(9).text("PAGOS");

  doc.moveDown(0.4);

  if (!pagos.length) {
    doc.font("Helvetica").fontSize(8).text("Sin pagos registrados.");
  }

  pagos.forEach((pago) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(formatConcepto(pago.concepto), { continued: true });

    doc.font("Helvetica").fontSize(8).text(` • ${pago.metodo}`);

    doc.font("Helvetica").fontSize(7).text(formatDate(pago.fecha_pago));

    if (pago.usuario_nombre) {
      doc
        .font("Helvetica")
        .fontSize(7)
        .text(`Registró: ${pago.usuario_nombre}`);
    }

    if (pago.referencia_externa) {
      doc.font("Helvetica").fontSize(7).text(`Ref: ${pago.referencia_externa}`);
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(money(pago.monto), { align: "right" });

    doc.moveDown(0.4);
  });

  line(doc);

  // Totales
  row(doc, "Subtotal:", money(pedido.subtotal));
  row(doc, "Descuento:", money(pedido.descuento));
  row(doc, "Envío:", money(pedido.costo_envio));

  doc.moveDown(0.3);

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`TOTAL: ${money(pedido.total)}`, { align: "right" });

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`PAGADO: ${money(pedido.total_pagado)}`, { align: "right" });

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`SALDO: ${money(pedido.saldo_pendiente)}`, { align: "right" });

  doc.moveDown(0.8);
  line(doc);

  // Políticas
  if (config.politicaCambios) {
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .text("POLÍTICA DE CAMBIOS", { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(6)
      .text(config.politicaCambios, { align: "center" });

    doc.moveDown(0.5);
  }

  if (pedido.tipo === "APARTADO" && config.politicaApartado) {
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .text("POLÍTICA DE APARTADO", { align: "center" });

    doc
      .font("Helvetica")
      .fontSize(6)
      .text(config.politicaApartado, { align: "center" });

    doc.moveDown(0.5);
  }

  // Footer
  doc
    .font("Helvetica")
    .fontSize(7)
    .text(config.mensajeFinal, { align: "center" });

  doc
    .font("Helvetica")
    .fontSize(6)
    .text("Conserve este comprobante", { align: "center" });

  doc.end();

  return doc;
}

export function generarTicketPagoPdfStream({
  pedido,
  pago,
  total_apartado,
  saldo_antes,
  saldo_despues,
  ticketConfig = {},
}) {
  const config = getTicketConfig(ticketConfig);

  const doc = new PDFDocument({
    size: [ticketWidthToPoints(config.anchoMm), 620],
    margins: {
      top: 12,
      bottom: 12,
      left: 12,
      right: 12,
    },
  });

  const folioLabel =
    pedido.tipo === "APARTADO" ? `APT-${pedido.folio}` : `PED-${pedido.folio}`;

  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(config.nombreTienda, { align: "center" });

  doc.font("Helvetica").fontSize(7);

  textIfExists(doc, config.telefono, { align: "center" });
  textIfExists(doc, config.direccion, { align: "center" });

  doc.font("Helvetica").fontSize(7).text("Ticket de pago", { align: "center" });

  doc.moveDown(0.5);
  line(doc);

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`Folio: ${folioLabel}`, { align: "center" });

  doc.moveDown(0.5);

  if (config.mostrarCliente) {
    row(doc, "Cliente:", pedido.cliente_nombre || "Cliente no asignado");
  }

  if (config.mostrarVendedor) {
    row(doc, "Vendedor:", pedido.vendedor_nombre || "N/A");
  }

  row(doc, "Estado pedido:", formatEstado(pedido.estado));
  row(doc, "Fecha pago:", formatDate(pago.fecha_pago));

  doc.moveDown(0.5);
  line(doc);

  doc.font("Helvetica-Bold").fontSize(9).text("PAGO REGISTRADO");

  doc.moveDown(0.4);

  row(doc, "Concepto:", formatConcepto(pago.concepto));
  row(doc, "Método:", pago.metodo);
  row(doc, "Estado pago:", pago.estado);

  if (pago.usuario_nombre) {
    row(doc, "Registró:", pago.usuario_nombre);
  }

  if (pago.referencia_externa) {
    row(doc, "Referencia:", pago.referencia_externa);
  }

  doc.moveDown(0.5);

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`MONTO: ${money(pago.monto)}`, { align: "right" });

  doc.moveDown(0.5);
  line(doc);

  row(doc, "Total del apartado:", money(total_apartado ?? pedido.total));
  row(doc, "Saldo antes del pago:", money(saldo_antes));
  row(doc, "Pago aplicado:", money(pago.monto));
  row(doc, "Saldo restante:", money(saldo_despues));

  doc.moveDown(0.8);
  line(doc);

  if (pedido.tipo === "APARTADO" && config.politicaApartado) {
    doc
      .font("Helvetica")
      .fontSize(6)
      .text(config.politicaApartado, { align: "center" });

    doc.moveDown(0.5);
  }

  doc
    .font("Helvetica")
    .fontSize(7)
    .text(config.mensajeFinal, { align: "center" });

  doc
    .font("Helvetica")
    .fontSize(6)
    .text("Conserve este comprobante", { align: "center" });

  doc.end();

  return doc;
}
