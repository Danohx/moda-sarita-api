#!/usr/bin/env node

/**
 * Construye el dataset de clasificación directamente desde moda_sarita_db.
 *
 * - Lee los clientes objetivo desde el manifiesto del generador local.
 * - Calcula X usando todo el historial válido hasta la fecha de evaluación.
 * - Usa clientes.clientes.tiene_credito como y = credito_habilitado.
 * - No exporta nombres, correo, teléfono, límite ni saldo deudor.
 * - Genera CSV y metadatos reproducibles.
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SCRIPT_DIR, "..");
const PROJECT_ROOT = path.resolve(API_ROOT, "..");
const REQUIRED_DATABASE = "moda_sarita_db";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const DEFAULT_MANIFEST = path.join(
  SCRIPT_DIR,
  "state",
  "datos-analiticos-local.manifest.json",
);
const DEFAULT_SQL = path.join(
  SCRIPT_DIR,
  "datasets",
  "01_extraccion_clasificacion.sql",
);
const DEFAULT_OUTPUT = path.join(
  PROJECT_ROOT,
  "proyecto-ecbd",
  "05_Datasets",
  "clasificacion_credito.csv",
);

const FEATURE_COLUMNS = [
  "antiguedad_cliente_dias",
  "meses_observados",
  "total_compras_historicas",
  "gasto_total_historico",
  "ticket_promedio_historico",
  "frecuencia_mensual_historica",
  "gasto_promedio_mensual_historico",
  "meses_con_compra_historicos",
  "porcentaje_meses_activos",
  "dias_desde_ultima_compra",
  "promedio_dias_entre_compras",
  "unidades_compradas_historicas",
  "productos_distintos_historicos",
  "categorias_distintas_historicas",
  "concentracion_compras_mes_mayor",
  "concentracion_gasto_mes_mayor",
];

function parseArgs(argv) {
  const options = {
    manifest: process.env.LOCAL_DATA_MANIFEST || DEFAULT_MANIFEST,
    sql: DEFAULT_SQL,
    output: DEFAULT_OUTPUT,
    evaluationDate: null,
  };

  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const separator = argument.indexOf("=");
    const rawKey = separator === -1
      ? argument.slice(2)
      : argument.slice(2, separator);
    const value = separator === -1 ? "true" : argument.slice(separator + 1);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (!(key in options)) {
      throw new Error(`Parámetro no reconocido: --${rawKey}`);
    }
    options[key] = value;
  }

  return options;
}

function addUtcDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Fecha inválida: ${isoDate}`);
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildPoolConfig() {
  const connectionString = process.env.DATABASE_URL_LOCAL
    || process.env.LOCAL_DATABASE_URL
    || null;

  if (connectionString) {
    const parsed = new URL(connectionString);
    return {
      connectionString,
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, ""),
      ssl: false,
    };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || REQUIRED_DATABASE,
    ssl: false,
  };
}

async function assertSafeDatabase(client, config) {
  const configuredHost = String(config.host || "").toLowerCase();
  if (!LOCAL_HOSTS.has(configuredHost)) {
    throw new Error(`Host rechazado: ${configuredHost}. Solo se permite PostgreSQL local.`);
  }

  const { rows } = await client.query(`
    SELECT
      current_database() AS database_name,
      inet_server_addr()::text AS server_address
  `);
  const current = rows[0];

  if (current.database_name !== REQUIRED_DATABASE) {
    throw new Error(
      `Base rechazada: ${current.database_name}. Solo se permite ${REQUIRED_DATABASE}.`,
    );
  }

  return current;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  let text;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === "boolean") {
    text = value ? "true" : "false";
  } else {
    text = String(value);
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function rowsToCsv(rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function finiteNumber(value, column, rowIndex) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Valor no numérico en ${column}, fila ${rowIndex + 1}: ${value}`);
  }
  return number;
}

function validateRows(rows, expectedClients) {
  if (rows.length !== expectedClients) {
    throw new Error(
      `Se esperaban ${expectedClients} clientes y la consulta devolvió ${rows.length}.`,
    );
  }

  const ids = new Set();
  const classes = { true: 0, false: 0 };
  const nullCounts = Object.fromEntries(FEATURE_COLUMNS.map((column) => [column, 0]));

  rows.forEach((row, index) => {
    const id = String(row.cliente_id);
    if (ids.has(id)) throw new Error(`Cliente duplicado en el dataset: ${id}`);
    ids.add(id);

    const classKey = String(row.credito_habilitado);
    if (!(classKey in classes)) {
      throw new Error(`Clase inválida en fila ${index + 1}: ${row.credito_habilitado}`);
    }
    classes[classKey] += 1;

    for (const column of FEATURE_COLUMNS) {
      if (row[column] === null || row[column] === undefined || row[column] === "") {
        nullCounts[column] += 1;
      } else {
        const value = finiteNumber(row[column], column, index);
        if (value < 0) {
          throw new Error(`Valor negativo en ${column}, fila ${index + 1}: ${value}`);
        }
      }
    }

    for (const column of [
      "porcentaje_meses_activos",
      "concentracion_compras_mes_mayor",
      "concentracion_gasto_mes_mayor",
    ]) {
      const value = finiteNumber(row[column], column, index);
      if (value < 0 || value > 1.0001) {
        throw new Error(`Valor fuera de [0,1] en ${column}, fila ${index + 1}: ${value}`);
      }
    }
  });

  if (classes.true === 0 || classes.false === 0) {
    throw new Error("El dataset requiere ejemplos de ambas clases.");
  }

  return { classes, nullCounts };
}

function meanByClass(rows, column, enabled) {
  const values = rows
    .filter((row) => Boolean(row.credito_habilitado) === enabled)
    .map((row) => Number(row[column]))
    .filter(Number.isFinite);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function writeAtomically(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, filePath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await fs.readFile(options.manifest, "utf8"));

  if (manifest.database !== REQUIRED_DATABASE) {
    throw new Error(
      `El manifiesto pertenece a ${manifest.database}, no a ${REQUIRED_DATABASE}.`,
    );
  }
  if (!Array.isArray(manifest.clientIds) || manifest.clientIds.length === 0) {
    throw new Error("El manifiesto no contiene clientIds.");
  }
  if (!manifest.period?.end && !options.evaluationDate) {
    throw new Error("El manifiesto no contiene period.end.");
  }

  const evaluationDate = options.evaluationDate
    || addUtcDays(manifest.period.end, 1);
  const evaluationTimestamp = `${evaluationDate}T00:00:00.000Z`;
  const query = await fs.readFile(options.sql, "utf8");

  const config = buildPoolConfig();
  const pool = new Pool(config);
  const client = await pool.connect();

  try {
    const connection = await assertSafeDatabase(client, config);

    console.log("============================================================");
    console.log("DATASET DE CLASIFICACIÓN - CRÉDITO HABILITADO");
    console.log("============================================================");
    console.log(`Base: ${connection.database_name}`);
    console.log(`Clientes del manifiesto: ${manifest.clientIds.length}`);
    console.log(`Fecha de evaluación: ${evaluationDate}`);
    console.log(`Salida: ${options.output}`);
    console.log("");
    console.log("Extrayendo y transformando historial comercial...");

    const { rows } = await client.query(query, [
      evaluationTimestamp,
      manifest.clientIds,
    ]);

    const validation = validateRows(rows, manifest.clientIds.length);
    const csv = rowsToCsv(rows);
    const hash = crypto.createHash("sha256").update(csv).digest("hex");

    await writeAtomically(options.output, csv);

    const metadataPath = options.output.replace(/\.csv$/i, ".metadata.json");
    const metadata = {
      generatedAt: new Date().toISOString(),
      database: REQUIRED_DATABASE,
      manifest: path.resolve(options.manifest),
      manifestSeed: manifest.seed,
      sourcePeriod: manifest.period,
      evaluationDate,
      rows: rows.length,
      columns: rows.length ? Object.keys(rows[0]) : [],
      traceabilityColumns: ["cliente_id", "fecha_evaluacion"],
      featureColumns: FEATURE_COLUMNS,
      targetColumn: "credito_habilitado",
      classDistribution: {
        disabled: validation.classes.false,
        enabled: validation.classes.true,
        enabledPercentage: Number(
          ((validation.classes.true / rows.length) * 100).toFixed(2),
        ),
      },
      nullCounts: validation.nullCounts,
      sha256: hash,
      notes: [
        "Los UUID se conservan solo para trazabilidad y deben excluirse de X.",
        "No se exportan nombres, correos, teléfonos, límite de crédito ni saldo deudor.",
        "El gasto histórico excluye costo de envío.",
        "Las variables X usan únicamente compras válidas anteriores a la fecha de evaluación.",
      ],
    };
    await writeAtomically(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    console.log("");
    console.log("VALIDACIÓN COMPLETADA");
    console.log(`Filas: ${rows.length}`);
    console.log(`Crédito no habilitado: ${validation.classes.false}`);
    console.log(`Crédito habilitado: ${validation.classes.true}`);
    console.log(
      `Porcentaje habilitado: ${metadata.classDistribution.enabledPercentage.toFixed(2)}%`,
    );
    console.log(`Nulos en variables X: ${Object.values(validation.nullCounts).reduce((a, b) => a + b, 0)}`);
    console.log("");
    console.log("Promedios de control por clase:");
    console.table([
      {
        credito_habilitado: false,
        compras: meanByClass(rows, "total_compras_historicas", false).toFixed(2),
        gasto: meanByClass(rows, "gasto_total_historico", false).toFixed(2),
        meses_activos: meanByClass(rows, "meses_con_compra_historicos", false).toFixed(2),
        dias_ultima_compra: meanByClass(rows, "dias_desde_ultima_compra", false).toFixed(2),
      },
      {
        credito_habilitado: true,
        compras: meanByClass(rows, "total_compras_historicas", true).toFixed(2),
        gasto: meanByClass(rows, "gasto_total_historico", true).toFixed(2),
        meses_activos: meanByClass(rows, "meses_con_compra_historicos", true).toFixed(2),
        dias_ultima_compra: meanByClass(rows, "dias_desde_ultima_compra", true).toFixed(2),
      },
    ]);
    console.log(`CSV: ${options.output}`);
    console.log(`Metadatos: ${metadataPath}`);
    console.log(`SHA-256: ${hash}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("");
  console.error(`DATASET CANCELADO: ${error.message}`);
  if (error?.stack) console.error(error.stack);
  process.exitCode = 1;
});
