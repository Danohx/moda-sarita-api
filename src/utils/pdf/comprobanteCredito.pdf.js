import PDFDocument from "pdfkit";

function money(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ticketWidthToPoints(mm) {
  const safeMm = Number(mm) === 58 ? 58 : 80;
  return (safeMm / 25.4) * 72;
}

function line(doc) {
  const y = doc.y;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor("#999999")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);
}

function row(doc, label, value) {
  doc.font("Helvetica-Bold").fontSize(7).text(label, { continued: true });
  doc.font("Helvetica").fontSize(7).text(` ${value ?? "N/A"}`);
}

function getConfig(ticketConfig = {}) {
  return {
    nombreTienda: ticketConfig.nombreTienda || "Moda Sarita",
    telefono: ticketConfig.telefono || "",
    direccion: ticketConfig.direccion || "",
    mostrarCliente: ticketConfig.mostrarCliente !== false,
    mostrarVendedor: ticketConfig.mostrarVendedor !== false,
    mensajeFinal: ticketConfig.mensajeFinal || "¡Gracias por su pago!",
    anchoMm: Number(ticketConfig.anchoMm || 80),
  };
}

export function generarComprobanteCreditoPdfStream({
  data,
  ticketConfig = {},
}) {
  const config = getConfig(ticketConfig);
  const doc = new PDFDocument({
    size: [ticketWidthToPoints(config.anchoMm), 680],
    margins: { top: 12, bottom: 12, left: 12, right: 12 },
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(config.nombreTienda, { align: "center" });

  if (config.telefono) {
    doc.font("Helvetica").fontSize(7).text(config.telefono, { align: "center" });
  }

  if (config.direccion) {
    doc.font("Helvetica").fontSize(7).text(config.direccion, { align: "center" });
  }

  doc.moveDown(0.4);
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("COMPROBANTE DE PAGO DE CRÉDITO", { align: "center" });

  doc.moveDown(0.5);
  line(doc);

  row(doc, "Crédito:", data.credito_id);
  row(doc, "Pedido:", data.pedido_folio ? `VTA-${data.pedido_folio}` : "Crédito histórico");
  row(doc, "Fecha:", formatDate(data.fecha_pago));

  if (config.mostrarCliente) {
    row(doc, "Cliente:", data.cliente_nombre || "N/A");
  }

  if (config.mostrarVendedor) {
    row(doc, "Registró:", data.usuario_nombre || "N/A");
  }

  doc.moveDown(0.5);
  line(doc);

  row(doc, "Concepto:", data.concepto);
  row(doc, "Método:", data.metodo);
  row(doc, "Estado:", data.estado_pago);

  if (data.referencia_externa) {
    row(doc, "Referencia:", data.referencia_externa);
  }

  doc.moveDown(0.5);
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`MONTO: ${money(data.monto_pago)}`, { align: "right" });

  doc.moveDown(0.5);
  line(doc);

  row(doc, "Monto financiado:", money(data.monto_financiado));
  row(doc, "Saldo antes:", money(data.saldo_antes_pago));
  row(doc, "Pago aplicado:", money(data.monto_pago));
  row(doc, "Saldo después:", money(data.saldo_despues_pago));
  row(doc, "Estado crédito:", data.estado_credito);

  if (Array.isArray(data.aplicaciones) && data.aplicaciones.length > 0) {
    doc.moveDown(0.5);
    line(doc);
    doc.font("Helvetica-Bold").fontSize(8).text("APLICACIÓN A CUOTAS");
    doc.moveDown(0.3);

    for (const item of data.aplicaciones) {
      doc
        .font("Helvetica")
        .fontSize(7)
        .text(
          `Cuota ${item.numero_cuota} · ${String(item.fecha_vencimiento).slice(0, 10)} · ${money(item.monto_aplicado)}`,
        );
    }
  } else if (data.datos_calendario_completos === false) {
    doc.moveDown(0.5);
    doc
      .font("Helvetica-Oblique")
      .fontSize(7)
      .text("Crédito histórico sin calendario de cuotas verificable.", {
        align: "center",
      });
  }

  doc.moveDown(0.8);
  line(doc);
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
