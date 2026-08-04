import PDFDocument from "pdfkit";

function money(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number(value || 0));
}

function line(document, label, value) {
  document
    .font("Helvetica")
    .fontSize(10)
    .text(label, { continued: true })
    .font("Helvetica-Bold")
    .text(`  ${value}`);
}

export function generarReporteCreditoPdf({ tipo, data }) {
  const document = new PDFDocument({ size: "LETTER", margin: 42 });
  const titulo =
    tipo === "financiero"
      ? "Reporte financiero y crédito"
      : "Reporte operativo de créditos";

  document.font("Helvetica-Bold").fontSize(18).text("Moda Sarita");
  document.fontSize(14).text(titulo);
  document
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#555")
    .text(`Periodo: ${data.filtros?.from || "—"} a ${data.filtros?.to || "—"}`);
  document.moveDown();
  document.fillColor("#000");

  if (tipo === "financiero") {
    line(document, "Ventas realizadas:", money(data.ventas_realizadas));
    line(document, "Dinero cobrado:", money(data.dinero_cobrado));
    line(document, "Monto financiado:", money(data.monto_financiado));
    line(document, "Saldo pendiente:", money(data.saldo_pendiente));
    line(document, "Saldo vencido:", money(data.saldo_vencido));
    line(document, "Cobranza de crédito:", money(data.cobranza_credito));
    line(document, "Enganches:", money(data.enganches_credito));
    line(document, "Abonos y liquidaciones:", money(data.abonos_credito));
    document.end();
    return document;
  }

  const summary = data.resumen || {};
  line(document, "Créditos activos:", Number(summary.creditos_activos || 0));
  line(document, "En mora:", Number(summary.creditos_en_mora || 0));
  line(document, "Incumplidos:", Number(summary.creditos_incumplidos || 0));
  line(document, "Financiado en el periodo:", money(summary.monto_financiado_periodo));
  line(document, "Cobranza del periodo:", money(summary.cobranza_periodo));
  line(document, "Saldo pendiente:", money(summary.saldo_pendiente_total));
  line(document, "Saldo vencido:", money(summary.saldo_vencido_total));
  line(document, "Cobranza / financiado:", `${Number(summary.tasa_recuperacion || 0).toFixed(2)}%`);

  document.moveDown();
  document.font("Helvetica-Bold").fontSize(12).text("Cuentas por cobrar");
  document.moveDown(0.5);

  const accounts = Array.isArray(data.cuentasCobrar) ? data.cuentasCobrar : [];
  for (const account of accounts.slice(0, 80)) {
    if (document.y > 700) document.addPage();
    document
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${account.cliente_nombre} · ${account.pedido_folio ? `Pedido #${account.pedido_folio}` : "Crédito histórico"}`);
    document
      .font("Helvetica")
      .fontSize(8)
      .text(
        `Estado: ${account.estado} | Saldo: ${money(account.saldo_pendiente)} | Vencido: ${money(account.total_vencido)}`,
      );
    document.moveDown(0.35);
  }

  document.end();
  return document;
}
