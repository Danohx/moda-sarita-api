// src/utils/pdf/reportesPdf.js
import PDFDocument from "pdfkit";

const BRAND = {
  dark: "#221019",
  pink: "#ec1380",
  lightPink: "#f7d5e9",
  background: "#f8f6f7",
  text: "#5c4b57",
  muted: "#9b8b96",
  border: "#e8dde3",
  white: "#ffffff",
  danger: "#dc2626",
};

const PAGE = {
  margin: 36,
  headerHeight: 36,
  footerHeight: 22,
};

const MONEY_KEYS = new Set([
  "ventas_totales",
  "ingresos_confirmados",
  "ticket_promedio",
  "descuentos_totales",
  "costo_envio_total",
  "ingresos",
  "total_vendido",
  "valor_inventario",
  "precio_costo",
  "precio_venta",
  "valor_costo",
  "saldo_deudor_total",
  "credito_total_autorizado",
  "limite_credito",
  "saldo_deudor",
  "credito_disponible",
  "total_apartado",
  "total_pagado",
  "saldo_pendiente",
  "efectivo",
  "tarjeta",
  "transferencia",
  "credito_tienda",
  "otros",
  "cuentas_por_cobrar",
  "diferencia_cortes_total",
  "total_sistema",
  "total_real",
  "diferencia_total",
  "sobrantes",
  "faltantes",
  "fondo_inicial",
  "diferencia",
  "monto",
  "total",
]);

const DATE_KEYS = new Set([
  "periodo",
  "ultima_compra",
  "fecha_limite_apartado",
  "fecha_creacion",
  "inicio_turno",
  "fin_turno",
  "created_at",
  "fecha_pago",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRows(rowsOrRow) {
  if (Array.isArray(rowsOrRow)) return rowsOrRow.filter(isPlainObject);
  if (isPlainObject(rowsOrRow)) return [rowsOrRow];
  return [];
}

function collectKeys(rows) {
  const keys = [];
  const seen = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  return keys;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(value) {
  const number = Number(value ?? 0);

  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number.isFinite(number) ? number : 0);
}

function formatCellValue(key, value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Si" : "No";

  if (MONEY_KEYS.has(key)) {
    return formatMoney(value);
  }

  if (DATE_KEYS.has(key)) {
    if (String(key).includes("turno") || String(key).includes("created_at")) {
      return formatDateTime(value);
    }

    return formatDate(value);
  }

  if (value instanceof Date) return formatDateTime(value);

  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

function textOrDash(value) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text.length > 0 ? text : "-";
}

function getPageMetrics(doc) {
  const left = PAGE.margin;
  const right = doc.page.width - PAGE.margin;
  const top = PAGE.margin;
  const bottom = doc.page.height - PAGE.margin;

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    usableBottom: bottom - PAGE.footerHeight,
  };
}

function ensureSpace(doc, neededHeight, titulo) {
  const metrics = getPageMetrics(doc);

  if (doc.y + neededHeight <= metrics.usableBottom) {
    return;
  }

  addFooter(doc);
  doc.addPage();
  addPageHeader(doc, titulo);
}

function addPageHeader(doc, titulo) {
  const metrics = getPageMetrics(doc);

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(BRAND.pink)
    .text("Moda Sarita", metrics.left, 22, { continued: true })
    .fillColor(BRAND.muted)
    .font("Helvetica")
    .text(`  /  ${titulo}`);

  doc
    .moveTo(metrics.left, PAGE.margin - 2)
    .lineTo(metrics.right, PAGE.margin - 2)
    .strokeColor(BRAND.border)
    .lineWidth(1)
    .stroke();

  doc.y = PAGE.margin + 10;
}

function addFooter(doc) {
  const metrics = getPageMetrics(doc);
  const y = doc.page.height - 28;

  doc
    .moveTo(metrics.left, y - 8)
    .lineTo(metrics.right, y - 8)
    .strokeColor(BRAND.border)
    .lineWidth(1)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(BRAND.muted)
    .text("Generado por Moda Sarita ERP", metrics.left, y, {
      width: metrics.width / 2,
      align: "left",
    })
    .text(`Pagina ${doc.bufferedPageRange().count}`, metrics.left, y, {
      width: metrics.width,
      align: "right",
    });
}

function addCover(doc, { titulo, reporte, filters, generatedAt, totalRegistros }) {
  const metrics = getPageMetrics(doc);

  doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.background);

  doc
    .roundedRect(metrics.left, metrics.top, metrics.width, doc.page.height - PAGE.margin * 2, 18)
    .fill(BRAND.white);

  doc
    .font("Helvetica-Bold")
    .fontSize(26)
    .fillColor(BRAND.pink)
    .text("Moda Sarita", metrics.left + 34, metrics.top + 42);

  doc
    .font("Helvetica-Bold")
    .fontSize(19)
    .fillColor(BRAND.dark)
    .text(titulo, metrics.left + 34, metrics.top + 82, {
      width: metrics.width - 68,
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(BRAND.text)
    .text("Reporte administrativo generado desde el modulo de Reportes.", metrics.left + 34, metrics.top + 116, {
      width: metrics.width - 68,
    });

  const meta = [
    ["Reporte", reporte],
    ["Fecha inicio", filters.from],
    ["Fecha fin", filters.to],
    ["Agrupacion", filters.groupBy],
    ["Generado", formatDateTime(generatedAt)],
    ["Total registros", totalRegistros],
  ];

  const boxTop = metrics.top + 166;
  const boxLeft = metrics.left + 34;
  const boxWidth = metrics.width - 68;

  doc
    .roundedRect(boxLeft, boxTop, boxWidth, 166, 14)
    .fill(BRAND.background)
    .strokeColor(BRAND.border)
    .stroke();

  let rowY = boxTop + 22;

  for (const [label, value] of meta) {
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(BRAND.dark)
      .text(label, boxLeft + 22, rowY, { width: 140 });

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND.text)
      .text(textOrDash(value), boxLeft + 170, rowY, { width: boxWidth - 200 });

    rowY += 22;
  }

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(BRAND.muted)
    .text("Los datos se generan con base en los filtros aplicados y los permisos del usuario.", boxLeft, boxTop + 190, {
      width: boxWidth,
    });

  addFooter(doc);
}

function addSectionTitle(doc, title, titulo) {
  ensureSpace(doc, 42, titulo);

  const metrics = getPageMetrics(doc);

  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(BRAND.dark)
    .text(title, metrics.left, doc.y, { width: metrics.width });

  doc.moveDown(0.45);
}

function addNoData(doc, titulo) {
  ensureSpace(doc, 48, titulo);

  const metrics = getPageMetrics(doc);
  const y = doc.y;

  doc
    .roundedRect(metrics.left, y, metrics.width, 34, 8)
    .fill(BRAND.background)
    .strokeColor(BRAND.border)
    .stroke();

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(BRAND.muted)
    .text("Sin datos para mostrar", metrics.left + 12, y + 11);

  doc.y = y + 48;
}

function drawTableHeader(doc, keys, x, y, colWidth, rowHeight) {
  doc.rect(x, y, colWidth * keys.length, rowHeight).fill(BRAND.dark);

  keys.forEach((key, index) => {
    const cellX = x + index * colWidth;

    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor(BRAND.white)
      .text(humanizeKey(key), cellX + 5, y + 7, {
        width: colWidth - 10,
        height: rowHeight - 10,
        ellipsis: true,
      });
  });
}

function drawTableRow(doc, row, keys, x, y, colWidth, rowHeight, rowIndex) {
  const fill = rowIndex % 2 === 0 ? BRAND.white : BRAND.background;

  doc
    .rect(x, y, colWidth * keys.length, rowHeight)
    .fill(fill)
    .strokeColor(BRAND.border)
    .lineWidth(0.5)
    .stroke();

  keys.forEach((key, index) => {
    const cellX = x + index * colWidth;
    const value = formatCellValue(key, row[key]);

    doc
      .font("Helvetica")
      .fontSize(7.2)
      .fillColor(BRAND.text)
      .text(value, cellX + 5, y + 6, {
        width: colWidth - 10,
        height: rowHeight - 8,
        ellipsis: true,
      });

    if (index > 0) {
      doc
        .moveTo(cellX, y)
        .lineTo(cellX, y + rowHeight)
        .strokeColor(BRAND.border)
        .lineWidth(0.5)
        .stroke();
    }
  });
}

function addTableChunk(doc, rows, keys, titulo) {
  const metrics = getPageMetrics(doc);
  const rowHeight = 30;
  const headerHeight = 30;
  const colWidth = metrics.width / keys.length;

  ensureSpace(doc, headerHeight + rowHeight + 16, titulo);

  let y = doc.y;
  drawTableHeader(doc, keys, metrics.left, y, colWidth, headerHeight);
  y += headerHeight;

  rows.forEach((row, rowIndex) => {
    if (y + rowHeight > metrics.usableBottom) {
      addFooter(doc);
      doc.addPage();
      addPageHeader(doc, titulo);
      y = doc.y;
      drawTableHeader(doc, keys, metrics.left, y, colWidth, headerHeight);
      y += headerHeight;
    }

    drawTableRow(doc, row, keys, metrics.left, y, colWidth, rowHeight, rowIndex);
    y += rowHeight;
  });

  doc.y = y + 18;
}

function addSection(doc, section, titulo) {
  const rows = normalizeRows(section.rows);
  addSectionTitle(doc, section.title, titulo);

  if (rows.length === 0) {
    addNoData(doc, titulo);
    return;
  }

  const keys = collectKeys(rows);
  const keyChunks = chunkArray(keys, 6);

  keyChunks.forEach((keysChunk, index) => {
    if (keyChunks.length > 1) {
      ensureSpace(doc, 24, titulo);
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(BRAND.pink)
        .text(`Columnas ${index + 1} de ${keyChunks.length}`, getPageMetrics(doc).left, doc.y);
      doc.moveDown(0.4);
    }

    addTableChunk(doc, rows, keysChunk, titulo);
  });
}

export function generarReportePdfBuffer({ reporte, titulo, filters, secciones }) {
  const generatedAt = new Date();
  const totalRegistros = secciones.reduce(
    (total, section) => total + normalizeRows(section.rows).length,
    0,
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: PAGE.margin,
      bufferPages: true,
      info: {
        Title: titulo,
        Author: "Moda Sarita",
        Subject: `Reporte ${reporte}`,
        Creator: "Moda Sarita ERP",
      },
    });

    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => {
      resolve({
        buffer: Buffer.concat(chunks),
        totalRegistros,
        generatedAt,
      });
    });

    addCover(doc, {
      titulo,
      reporte,
      filters,
      generatedAt,
      totalRegistros,
    });

    doc.addPage();
    addPageHeader(doc, titulo);

    secciones.forEach((section) => {
      addSection(doc, section, titulo);
    });

    addFooter(doc);
    doc.end();
  });
}
