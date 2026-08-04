import ExcelJS from "exceljs";

function addSummarySheet(workbook, title, rows) {
  const sheet = workbook.addWorksheet(title);
  sheet.columns = [
    { header: "Indicador", key: "indicador", width: 34 },
    { header: "Valor", key: "valor", width: 22 },
  ];
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  return sheet;
}

export async function generarReporteCreditoExcel({ tipo, data }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Moda Sarita";
  workbook.created = new Date();

  if (tipo === "financiero") {
    addSummarySheet(workbook, "Financiero", [
      { indicador: "Desde", valor: data.filtros?.from || "" },
      { indicador: "Hasta", valor: data.filtros?.to || "" },
      { indicador: "Ventas realizadas", valor: Number(data.ventas_realizadas || 0) },
      { indicador: "Dinero cobrado", valor: Number(data.dinero_cobrado || 0) },
      { indicador: "Monto financiado", valor: Number(data.monto_financiado || 0) },
      { indicador: "Saldo pendiente", valor: Number(data.saldo_pendiente || 0) },
      { indicador: "Saldo vencido", valor: Number(data.saldo_vencido || 0) },
      { indicador: "Cobranza de crédito", valor: Number(data.cobranza_credito || 0) },
      { indicador: "Enganches", valor: Number(data.enganches_credito || 0) },
      { indicador: "Abonos", valor: Number(data.abonos_credito || 0) },
    ]);
    return workbook.xlsx.writeBuffer();
  }

  const summary = data.resumen || {};
  addSummarySheet(workbook, "Resumen", [
    { indicador: "Desde", valor: data.filtros?.from || "" },
    { indicador: "Hasta", valor: data.filtros?.to || "" },
    { indicador: "Créditos activos", valor: Number(summary.creditos_activos || 0) },
    { indicador: "En mora", valor: Number(summary.creditos_en_mora || 0) },
    { indicador: "Incumplidos", valor: Number(summary.creditos_incumplidos || 0) },
    { indicador: "Liquidados en periodo", valor: Number(summary.creditos_liquidados_periodo || 0) },
    { indicador: "Monto financiado", valor: Number(summary.monto_financiado_periodo || 0) },
    { indicador: "Cobranza", valor: Number(summary.cobranza_periodo || 0) },
    { indicador: "Saldo pendiente", valor: Number(summary.saldo_pendiente_total || 0) },
    { indicador: "Saldo vencido", valor: Number(summary.saldo_vencido_total || 0) },
    { indicador: "Cobranza / financiado (%)", valor: Number(summary.tasa_recuperacion || 0) },
  ]);

  const sheet = workbook.addWorksheet("Cuentas por cobrar");
  sheet.columns = [
    { header: "Cliente", key: "cliente", width: 32 },
    { header: "Pedido", key: "pedido", width: 14 },
    { header: "Estado", key: "estado", width: 14 },
    { header: "Financiado", key: "financiado", width: 16 },
    { header: "Saldo", key: "saldo", width: 16 },
    { header: "Vencido", key: "vencido", width: 16 },
    { header: "Próximo vencimiento", key: "proximo", width: 20 },
    { header: "Origen", key: "origen", width: 20 },
  ];
  for (const item of data.cuentasCobrar || []) {
    sheet.addRow({
      cliente: item.cliente_nombre,
      pedido: item.pedido_folio || "Legacy",
      estado: item.estado,
      financiado: Number(item.monto_financiado || 0),
      saldo: Number(item.saldo_pendiente || 0),
      vencido: Number(item.total_vencido || 0),
      proximo: item.proximo_vencimiento || "",
      origen: item.origen,
    });
  }
  sheet.getRow(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}
