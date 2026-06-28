// src/utils/export/reportesExcel.js
import ExcelJS from "exceljs";

const BRAND = {
  dark: "221019",
  pink: "EC1380",
  lightPink: "F7D5E9",
  background: "F8F6F7",
  text: "5C4B57",
  white: "FFFFFF",
  border: "E8DDE3",
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatDate(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function safeSheetName(name) {
  return String(name)
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "Reporte";
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

function normalizeCellValue(value) {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) return value;

  if (typeof value === "number") return value;

  if (typeof value === "boolean") return value ? "Sí" : "No";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const number = Number(trimmed);
      return Number.isFinite(number) ? number : value;
    }
    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function autoWidth(worksheet, keys) {
  keys.forEach((key, index) => {
    const column = worksheet.getColumn(index + 1);
    let maxLength = humanizeKey(key).length;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const length = value === null || value === undefined ? 0 : String(value).length;
      maxLength = Math.max(maxLength, length);
    });

    column.width = Math.min(Math.max(maxLength + 2, 12), 42);
  });
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: BRAND.white } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND.dark },
    };
    cell.border = {
      top: { style: "thin", color: { argb: BRAND.dark } },
      left: { style: "thin", color: { argb: BRAND.dark } },
      bottom: { style: "thin", color: { argb: BRAND.dark } },
      right: { style: "thin", color: { argb: BRAND.dark } },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function styleBodyRows(worksheet, startRow = 2) {
  for (let rowNumber = startRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: BRAND.border } },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.font = { color: { argb: BRAND.text } };
    });
  }
}

function addMetadataSheet(workbook, { titulo, reporte, filters, generatedAt, totalRegistros }) {
  const sheet = workbook.addWorksheet("Resumen");

  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "Moda Sarita";
  sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: BRAND.pink } };

  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = titulo;
  sheet.getCell("A2").font = { bold: true, size: 14, color: { argb: BRAND.dark } };

  const metadata = [
    ["Reporte", reporte],
    ["Fecha inicio", filters.from],
    ["Fecha fin", filters.to],
    ["Agrupación", filters.groupBy],
    ["Generado", formatDate(generatedAt)],
    ["Total registros", totalRegistros],
  ];

  sheet.addRow([]);
  metadata.forEach(([label, value]) => {
    sheet.addRow([label, value]);
  });

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 42;

  for (let i = 4; i <= sheet.rowCount; i += 1) {
    const row = sheet.getRow(i);
    row.getCell(1).font = { bold: true, color: { argb: BRAND.dark } };
    row.getCell(2).font = { color: { argb: BRAND.text } };
  }
}

function addDataSheet(workbook, section) {
  const rows = normalizeRows(section.rows);
  const sheet = workbook.addWorksheet(safeSheetName(section.title));

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  if (rows.length === 0) {
    sheet.addRow(["Sin datos"]);
    sheet.getCell("A1").font = { bold: true, color: { argb: BRAND.text } };
    sheet.getColumn(1).width = 28;
    return 0;
  }

  const keys = collectKeys(rows);
  sheet.addRow(keys.map(humanizeKey));
  styleHeaderRow(sheet.getRow(1));

  for (const row of rows) {
    sheet.addRow(keys.map((key) => normalizeCellValue(row[key])));
  }

  styleBodyRows(sheet, 2);
  autoWidth(sheet, keys);
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: keys.length },
  };

  return rows.length;
}

export async function generarReporteExcelBuffer({ reporte, titulo, filters, secciones }) {
  const workbook = new ExcelJS.Workbook();
  const generatedAt = new Date();

  workbook.creator = "Moda Sarita";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.properties.date1904 = false;

  const totalRegistros = secciones.reduce(
    (total, section) => total + normalizeRows(section.rows).length,
    0,
  );

  addMetadataSheet(workbook, {
    titulo,
    reporte,
    filters,
    generatedAt,
    totalRegistros,
  });

  for (const section of secciones) {
    addDataSheet(workbook, section);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    totalRegistros,
    generatedAt,
  };
}
