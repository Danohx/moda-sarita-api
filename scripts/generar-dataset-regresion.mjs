import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);

  if (index === -1) {
    return fallback;
  }

  return process.argv[index + 1] ?? fallback;
}

function repararMojibake(value) {
  if (value === null || value === undefined) {
    return value;
  }

  const text = String(value);

  const patrones = [
    "Ã",
    "Â",
    "â€",
    "â€™",
    "â€œ",
    "â€",
    "â€“",
    "â€”",
    "ðŸ",
    "ï¿½",
  ];

  if (!patrones.some((patron) => text.includes(patron))) {
    return text;
  }

  try {
    const reparado = Buffer.from(text, "latin1").toString("utf8");

    if (reparado.includes("�")) {
      return text;
    }

    return reparado;
  } catch {
    return text;
  }
}

function formatearFechaCSV(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }

  const year = value.getUTCFullYear();

  const month = String(value.getUTCMonth() + 1).padStart(2, "0");

  const day = String(value.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const fecha = formatearFechaCSV(value);

  if (fecha !== null) {
    return fecha;
  }

  const text = repararMojibake(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

const host = getArg("host", "localhost");

const port = Number(getArg("port", "5432"));

const database = getArg("database", "moda_sarita_db");

const user = getArg("user", "postgres");

const password = process.env.PGPASSWORD || getArg("password");

const output = path.resolve(
  getArg(
    "out",
    path.join(
      process.cwd(),
      "proyecto-ecbd",
      "datasets",
      "regresion_ventas_producto.csv",
    ),
  ),
);

if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error("Por seguridad, este script solo permite PostgreSQL local.");
}

if (database !== "moda_sarita_db") {
  throw new Error(
    `Base rechazada: ${database}. Debe ser exactamente moda_sarita_db.`,
  );
}

if (!password) {
  throw new Error("Falta PGPASSWORD.");
}

const sqlCandidates = [
  path.resolve(
    process.cwd(),
    "moda-sarita-api",
    "scripts",
    "datasets",
    "02_extraccion_regresion.sql",
  ),
  path.resolve(
    process.cwd(),
    "scripts",
    "datasets",
    "02_extraccion_regresion.sql",
  ),
  path.resolve(process.cwd(), "02_extraccion_regresion.sql"),
];

const sqlPath = sqlCandidates.find((candidate) => fs.existsSync(candidate));

if (!sqlPath) {
  throw new Error("No se encontró 02_extraccion_regresion.sql.");
}

const sql = fs.readFileSync(sqlPath, "utf8");

const pool = new Pool({
  host,
  port,
  database,
  user,
  password,
  ssl: false,
});

try {
  const { rows, fields } = await pool.query(sql);

  if (!rows.length) {
    throw new Error("La consulta no produjo registros.");
  }

  const columns = fields.map((field) => field.name);

  fs.mkdirSync(path.dirname(output), { recursive: true });

  const lines = [
    columns.join(","),
    ...rows.map((row) =>
      columns.map((column) => csvValue(row[column])).join(","),
    ),
  ];

  const csv = `${lines.join("\n")}\n`;
  const csvUtf8Bom = `\uFEFF${csv}`;

  fs.writeFileSync(output, csvUtf8Bom, "utf8");

  const hash = crypto.createHash("sha256").update(csvUtf8Bom).digest("hex");

  const target = "monto_ventas_mes_siguiente";

  const targetValues = rows.map((row) => Number(row[target] ?? 0));

  const dates = rows.map((row) => String(row.fecha_corte)).sort();

  const products = new Set(rows.map((row) => String(row.producto_id)));

  const metadata = {
    proyecto: "Moda Sarita",
    solucion: "Regresión residual de ventas mensuales por producto",
    unidad_analisis: "Producto evaluado al cierre de un mes histórico",
    objetivo_negocio: "monto_ventas_mes_siguiente",
    objetivo_modelado: "delta_ventas_mes_siguiente",
    unidad_objetivo: "MXN",
    filas: rows.length,
    productos: products.size,
    fecha_corte_min: dates[0],
    fecha_corte_max: dates.at(-1),
    objetivo_min: Math.min(...targetValues),
    objetivo_max: Math.max(...targetValues),
    objetivo_promedio:
      targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length,
    sha256_csv: hash,
    generado_en: new Date().toISOString(),
  };

  const metadataPath = output.replace(/\.csv$/i, ".metadata.json");

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

  console.log("Dataset generado:", output);

  console.log("Filas:", rows.length);

  console.log("Productos:", products.size);

  console.log(
    "Periodo:",
    metadata.fecha_corte_min,
    "a",
    metadata.fecha_corte_max,
  );

  console.log("Metadata:", metadataPath);
} finally {
  await pool.end();
}