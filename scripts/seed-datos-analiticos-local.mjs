#!/usr/bin/env node

/**
 * Generador reproducible de datos comerciales para la base local de Moda Sarita.
 *
 * Objetivos analíticos:
 * - Clasificación: credito_habilitado según comportamiento histórico de compra.
 * - Regresión: monto mensual de ventas por producto.
 *
 * Seguridad:
 * - Solo permite localhost/127.0.0.1/::1.
 * - Solo permite la base moda_sarita_db.
 * - No recrea la base y no toca producción.
 * - No modifica el stock actual ni inserta movimientos de inventario.
 * - Los UUID generados se guardan únicamente en un manifiesto local.
 *
 * Uso:
 *   node ./scripts/seed-datos-analiticos-local.mjs --seed=20260805 --clients=360
 *   node ./scripts/seed-datos-analiticos-local.mjs --seed=20260805 --clients=360 --replace=true
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SCRIPT_DIR, "..");
const REQUIRED_DATABASE = "moda_sarita_db";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_MANIFEST = path.join(
  API_ROOT,
  "scripts",
  "state",
  "datos-analiticos-local.manifest.json",
);

const CLASSIFICATION_SQL_PATH = path.join(
  SCRIPT_DIR,
  "datasets",
  "01_extraccion_clasificacion.sql",
);

function parseBoolean(value) {
  return ["1", "true", "yes", "si", "sí", "s"].includes(
    String(value).trim().toLowerCase(),
  );
}

function parseArgs(argv) {
  const options = {
    seed: 20260805,
    clients: 360,
    periodStart: "2024-03-01",
    periodEnd: "2026-07-31",
    replace: false,
    manifest: process.env.LOCAL_DATA_MANIFEST || DEFAULT_MANIFEST,
  };

  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [rawKey, rawValue = "true"] = argument.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (!(key in options)) {
      throw new Error(`Parámetro no reconocido: --${rawKey}`);
    }

    if (["seed", "clients"].includes(key)) {
      const value = Number(rawValue);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--${rawKey} debe ser un entero mayor a cero.`);
      }
      options[key] = value;
    } else if (key === "replace") {
      options[key] = parseBoolean(rawValue);
    } else {
      options[key] = rawValue;
    }
  }

  if (options.clients < 120) {
    throw new Error("Se requieren al menos 120 clientes para generar diversidad suficiente.");
  }

  const start = new Date(`${options.periodStart}T12:00:00.000Z`);
  const end = new Date(`${options.periodEnd}T12:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error("El periodo de generación no es válido.");
  }

  return Object.freeze(options);
}

function createRng(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createHelpers(random) {
  const float = (min = 0, max = 1) => min + random() * (max - min);
  const int = (min, max) => Math.floor(float(min, max + 1));
  const bool = (probability = 0.5) => random() < probability;
  const pick = (items) => items[int(0, items.length - 1)];
  const shuffle = (items) => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = int(0, index);
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  };
  return { random, float, int, bool, pick, shuffle };
}

function money(value) {
  return Number(Number(value).toFixed(2));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function asDate(value, label = "fecha") {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} no es válida.`);
  return date;
}

function isoDate(value) {
  return asDate(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = asDate(value);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date;
}

function addMonths(value, months) {
  const date = asDate(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months));
  return date;
}

function startOfMonth(value) {
  const date = asDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
}

function endOfMonth(value) {
  const date = startOfMonth(value);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date;
}

function monthsBetween(start, end) {
  const months = [];
  let cursor = startOfMonth(start);
  const limit = startOfMonth(end);
  while (cursor <= limit) {
    months.push(new Date(cursor));
    cursor = addMonths(cursor, 1);
  }
  return months;
}

function randomDateBetween(start, end, helpers) {
  const min = asDate(start).getTime();
  const max = asDate(end).getTime();
  return new Date(Math.floor(helpers.float(min, max + 1)));
}

function timestampInMonth(month, registrationDate, periodEnd, helpers) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const lower = new Date(Math.max(first.getTime(), asDate(registrationDate).getTime()));
  const upper = new Date(Math.min(last.getTime(), asDate(periodEnd).getTime()));
  const date = randomDateBetween(lower, upper, helpers);
  date.setUTCHours(helpers.int(9, 20), helpers.int(0, 59), helpers.int(0, 59), 0);
  return date.toISOString();
}

function normalizeEmailPart(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function buildPoolConfig() {
  const host = process.env.LOCAL_DATA_DB_HOST || "localhost";
  const database = process.env.LOCAL_DATA_DB_NAME || REQUIRED_DATABASE;
  return {
    host,
    port: Number(process.env.LOCAL_DATA_DB_PORT || 5432),
    user: process.env.LOCAL_DATA_DB_USER || "postgres",
    password: process.env.LOCAL_DATA_DB_PASSWORD || process.env.PGPASSWORD || undefined,
    database,
    ssl: false,
    max: 2,
  };
}

const NOMBRES = [
  "Ana", "Mariana", "Fernanda", "Sofía", "Valeria", "Daniela", "Alejandra",
  "Ximena", "Camila", "Regina", "Paola", "Gabriela", "Montserrat", "Lucía",
  "Andrea", "Carolina", "Renata", "Jimena", "Diana", "Natalia", "Elena",
  "Karla", "Patricia", "Rosa", "Laura", "Martha", "Claudia", "Verónica",
  "Adriana", "Beatriz", "Leticia", "Mónica", "Isabel", "Teresa", "Julia",
  "Ivonne", "Liliana", "Noemí", "Erika", "Silvia", "Fabiola", "Estefanía",
];

const APELLIDOS = [
  "Hernández", "Martínez", "García", "López", "González", "Rodríguez",
  "Sánchez", "Ramírez", "Cruz", "Flores", "Reyes", "Morales", "Ortiz",
  "Vargas", "Mendoza", "Castillo", "Jiménez", "Torres", "Rivera", "Díaz",
  "Bautista", "Lara", "Aguilar", "Santos", "Domínguez", "Juárez", "Pérez",
  "Cortés", "Salazar", "Mejía", "Álvarez", "Navarro", "Ramos", "Guerrero",
];

const EMAIL_DOMAINS = [
  "gmail.test",
  "outlook.test",
  "hotmail.test",
  "yahoo.test",
  "correo.test",
];

const NATURAL_NOTES = [
  null,
  null,
  null,
  "Entrega en tienda.",
  "Cliente solicita bolsa de regalo.",
  "Pedido confirmado por el cliente.",
  "Venta realizada en mostrador.",
  "Entrega programada durante la tarde.",
];

const PROFILE_CONFIG = Object.freeze({
  FRECUENTE_ESTABLE: {
    share: 0.25,
    creditProbability: 0.88,
    activeProbability: 0.78,
    ordersMin: 1,
    ordersMax: 3,
    itemsMin: 2,
    itemsMax: 4,
    doubleQuantityProbability: 0.22,
    limitMin: 9000,
    limitMax: 18000,
  },
  REGULAR: {
    share: 0.30,
    creditProbability: 0.72,
    activeProbability: 0.58,
    ordersMin: 1,
    ordersMax: 2,
    itemsMin: 1,
    itemsMax: 3,
    doubleQuantityProbability: 0.14,
    limitMin: 6000,
    limitMax: 14000,
  },
  MODERADO: {
    share: 0.20,
    creditProbability: 0.48,
    activeProbability: 0.40,
    ordersMin: 1,
    ordersMax: 2,
    itemsMin: 1,
    itemsMax: 2,
    doubleQuantityProbability: 0.09,
    limitMin: 4000,
    limitMax: 10000,
  },
  CONCENTRADO: {
    share: 0.15,
    creditProbability: 0.30,
    activeProbability: 0.08,
    ordersMin: 2,
    ordersMax: 4,
    itemsMin: 2,
    itemsMax: 4,
    doubleQuantityProbability: 0.25,
    limitMin: 3500,
    limitMax: 8500,
  },
  INACTIVO: {
    share: 0.10,
    creditProbability: 0.08,
    activeProbability: 0.42,
    ordersMin: 1,
    ordersMax: 2,
    itemsMin: 1,
    itemsMax: 2,
    doubleQuantityProbability: 0.05,
    limitMin: 2500,
    limitMax: 6000,
  },
});

function chooseProfile(helpers) {
  const value = helpers.random();
  let cumulative = 0;
  for (const [profile, config] of Object.entries(PROFILE_CONFIG)) {
    cumulative += config.share;
    if (value <= cumulative) return profile;
  }
  return "REGULAR";
}

function monthSeasonFactor(month) {
  const number = asDate(month).getUTCMonth() + 1;
  if (number === 12) return 1.45;
  if (number === 11 || number === 5) return 1.22;
  if (number === 1) return 0.78;
  if (number === 2 || number === 9) return 0.90;
  return 1;
}

function weightedPick(items, getWeight, helpers) {
  const weights = items.map((item) => Math.max(0.0001, Number(getWeight(item))));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = helpers.float(0, total);
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return items[index];
  }
  return items[items.length - 1];
}

async function queryScalar(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  if (!rows.length) return null;
  return Object.values(rows[0])[0];
}

async function assertSafeDatabase(client, poolConfig) {
  const { rows } = await client.query(`
    SELECT
      current_database() AS database_name,
      coalesce(inet_server_addr()::text, 'local_socket') AS server_addr
  `);
  const databaseName = rows[0]?.database_name;
  const configuredHost = String(poolConfig.host || "").toLowerCase();

  if (!LOCAL_HOSTS.has(configuredHost)) {
    throw new Error(`SEGURIDAD: host no permitido: ${poolConfig.host}.`);
  }
  if (databaseName !== REQUIRED_DATABASE) {
    throw new Error(
      `SEGURIDAD: este generador solo puede ejecutarse en '${REQUIRED_DATABASE}'. Base actual: '${databaseName}'.`,
    );
  }
  return rows[0];
}

async function loadAdminUser(client) {
  const { rows } = await client.query(`
    SELECT u.id, u.email, r.nombre AS rol
    FROM seguridad.usuarios u
    LEFT JOIN seguridad.roles_sistema r ON r.id = u.rol_id
    WHERE u.activo = true
    ORDER BY
      CASE WHEN r.nombre IN ('ADMINISTRADOR', 'ADMIN') THEN 0 ELSE 1 END,
      u.fecha_creacion,
      u.id
    LIMIT 1
  `);
  return rows[0] || null;
}

async function loadCatalog(client, helpers) {
  const { rows } = await client.query(`
    SELECT
      v.id AS variante_id,
      v.producto_id,
      p.nombre AS producto_nombre,
      p.categoria_id,
      c.nombre AS categoria_nombre,
      v.precio_venta,
      v.precio_costo
    FROM inventario.variantes_producto v
    JOIN inventario.productos p ON p.id = v.producto_id
    LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
    WHERE v.activo = true
      AND p.activo = true
      AND v.precio_venta IS NOT NULL
      AND v.precio_venta > 0
    ORDER BY p.nombre, v.id
  `);

  const byProduct = new Map();
  for (const row of rows) {
    const variants = byProduct.get(row.producto_id) || [];
    variants.push({
      ...row,
      precio_venta: Number(row.precio_venta),
      precio_costo: Number(row.precio_costo || 0),
    });
    byProduct.set(row.producto_id, variants);
  }

  const products = [...byProduct.entries()].map(([productoId, variants], index) => ({
    productoId,
    nombre: variants[0].producto_nombre,
    categoriaId: variants[0].categoria_id,
    categoriaNombre: variants[0].categoria_nombre,
    variants,
    popularity: helpers.float(0.55, 1.65),
    peakMonth: ((index * 5 + helpers.int(0, 11)) % 12) + 1,
  }));

  if (products.length < 10 || rows.length < 15) {
    throw new Error(
      `Catálogo insuficiente: ${products.length} productos y ${rows.length} variantes activas.`,
    );
  }

  return { products, variants: rows };
}

async function loadExistingIdentityValues(client) {
  const { rows } = await client.query(`
    SELECT lower(email) AS email, telefono
    FROM clientes.clientes
  `);
  return {
    emails: new Set(rows.map((row) => row.email).filter(Boolean)),
    phones: new Set(rows.map((row) => row.telefono).filter(Boolean)),
  };
}

function createUniqueEmail(firstName, lastName, identity, helpers) {
  const base = `${normalizeEmailPart(firstName)}.${normalizeEmailPart(lastName)}`;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 && helpers.bool(0.35)
      ? ""
      : String(helpers.int(10, 9999));
    const domain = helpers.pick(EMAIL_DOMAINS);
    const email = `${base}${suffix}@${domain}`;
    if (!identity.emails.has(email)) {
      identity.emails.add(email);
      return email;
    }
  }
  throw new Error(`No fue posible generar un correo único para ${firstName} ${lastName}.`);
}

function createUniquePhone(identity, helpers) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const phone = `771${String(helpers.int(1, 9999999)).padStart(7, "0")}`;
    if (!identity.phones.has(phone)) {
      identity.phones.add(phone);
      return phone;
    }
  }
  throw new Error("No fue posible generar un teléfono único.");
}

async function cleanupPreviousGeneration(client, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`No se pudo leer el manifiesto anterior: ${error.message}`);
  }

  if (manifest.database !== REQUIRED_DATABASE) {
    throw new Error("El manifiesto anterior pertenece a otra base de datos.");
  }

  const orderIds = Array.isArray(manifest.orderIds) ? manifest.orderIds : [];
  const clientIds = Array.isArray(manifest.clientIds) ? manifest.clientIds : [];

  if (orderIds.length) {
    await client.query(
      `DELETE FROM ventas.pagos WHERE pedido_id = ANY($1::uuid[])`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM ventas.pedidos WHERE id = ANY($1::uuid[])`,
      [orderIds],
    );
  }

  if (clientIds.length) {
    await client.query(
      `DELETE FROM clientes.clientes WHERE id = ANY($1::uuid[])`,
      [clientIds],
    );
  }

  return {
    clients: clientIds.length,
    orders: orderIds.length,
  };
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function log1pSafe(value) {
  return Math.log1p(Math.max(0, safeNumber(value)));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 1;
  const mean = average(values);
  const variance = average(
    values.map((value) => (value - mean) ** 2),
  );
  const result = Math.sqrt(variance);
  return result > 1e-9 ? result : 1;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function calibrateIntercept(zScores, targetMean, slope) {
  let low = -6;
  let high = 6;

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2;
    const meanProbability = average(
      zScores.map((score) => sigmoid(slope * score + middle)),
    );

    if (meanProbability < targetMean) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return (low + high) / 2;
}

async function assignCreditLabelsFromBehavior(
  client,
  customers,
  options,
  helpers,
) {
  const clientIds = customers.map((customer) => customer.id);

  const evaluationDate = addDays(
    new Date(`${options.periodEnd}T00:00:00.000Z`),
    1,
  );

  const extractionSql = await fs.readFile(
    CLASSIFICATION_SQL_PATH,
    "utf8",
  );

  const { rows } = await client.query(
    extractionSql,
    [
      evaluationDate.toISOString(),
      clientIds,
    ],
  );

  if (rows.length !== customers.length) {
    throw new Error(
      `No se pudieron calcular caracteristicas para todos los clientes: ` +
      `${rows.length}/${customers.length}.`,
    );
  }

  const transformed = rows.map((row) => ({
    row,
    values: {
      antiguedad: log1pSafe(row.antiguedad_cliente_dias),
      compras: log1pSafe(row.total_compras_historicas),
      gasto: log1pSafe(row.gasto_total_historico),
      ticket: log1pSafe(row.ticket_promedio_historico),
      frecuencia: safeNumber(row.frecuencia_mensual_historica),
      gastoMensual: log1pSafe(row.gasto_promedio_mensual_historico),
      mesesActivos: safeNumber(row.porcentaje_meses_activos),
      recencia: log1pSafe(row.dias_desde_ultima_compra),
      intervalo: log1pSafe(row.promedio_dias_entre_compras),
      unidades: log1pSafe(row.unidades_compradas_historicas),
      productos: log1pSafe(row.productos_distintos_historicos),
      categorias: log1pSafe(row.categorias_distintas_historicas),
      concentracionCompras: safeNumber(row.concentracion_compras_mes_mayor),
      concentracionGasto: safeNumber(row.concentracion_gasto_mes_mayor),
    },
  }));

  const keys = Object.keys(transformed[0].values);
  const stats = Object.fromEntries(
    keys.map((key) => {
      const values = transformed.map((item) => item.values[key]);
      return [
        key,
        {
          mean: average(values),
          sd: standardDeviation(values),
        },
      ];
    }),
  );

  const scored = transformed.map(({ row, values }) => {
    const z = Object.fromEntries(
      keys.map((key) => [
        key,
        (values[key] - stats[key].mean) / stats[key].sd,
      ]),
    );

    let score =
      (0.90 * z.compras)
      + (0.80 * z.gasto)
      + (0.35 * z.ticket)
      + (0.70 * z.frecuencia)
      + (0.35 * z.gastoMensual)
      + (0.95 * z.mesesActivos)
      - (1.00 * z.recencia)
      - (0.40 * z.intervalo)
      + (0.30 * z.unidades)
      + (0.45 * z.productos)
      + (0.20 * z.categorias)
      - (0.35 * z.concentracionCompras)
      - (0.25 * z.concentracionGasto)
      + (0.15 * z.antiguedad);

    const purchases = safeNumber(row.total_compras_historicas);
    const spend = safeNumber(row.gasto_total_historico);
    const activeRatio = safeNumber(row.porcentaje_meses_activos);
    const recency = safeNumber(row.dias_desde_ultima_compra);
    const concentration = safeNumber(row.concentracion_compras_mes_mayor);

    if (recency <= 45) score += 0.35;
    if (recency >= 150) score -= 0.65;

    if (activeRatio >= 0.65) score += 0.30;
    if (activeRatio <= 0.25) score -= 0.30;

    if (purchases >= 60 && spend >= 50000) score += 0.45;
    if (purchases >= 90 && spend >= 80000) score += 0.25;

    if (concentration >= 0.45) score -= 0.35;

    return { row, score };
  });

  const scoreValues = scored.map((item) => item.score);
  const scoreMean = average(scoreValues);
  const scoreSd = standardDeviation(scoreValues);

  const zScores = scored.map(
    (item) => (item.score - scoreMean) / scoreSd,
  );

  const targetEnabledRatio = 0.58;
  const slope = 1.10;
  const intercept = calibrateIntercept(
    zScores,
    targetEnabledRatio,
    slope,
  );

  let enabledCount = 0;
  let disabledCount = 0;

  const customerById = new Map(
    customers.map((customer) => [customer.id, customer]),
  );

  for (let index = 0; index < scored.length; index += 1) {
    const { row } = scored[index];
    const probability = clamp(
      sigmoid(slope * zScores[index] + intercept),
      0.06,
      0.94,
    );

    const enabled = helpers.bool(probability);
    const customer = customerById.get(row.cliente_id);

    const ticket = safeNumber(row.ticket_promedio_historico);
    const spend = safeNumber(row.gasto_total_historico);
    const purchases = safeNumber(row.total_compras_historicas);

    const rawLimit =
      2500
      + (ticket * 2.4)
      + (Math.sqrt(Math.max(spend, 0)) * 18)
      + (purchases * 45);

    const creditLimit = enabled
      ? money(
        clamp(
          Math.round(rawLimit / 500) * 500,
          3000,
          22000,
        ),
      )
      : 0;

    const activationUpper = asDate(options.periodEnd);
    const requestedLower = addMonths(
      customer.registrationDate,
      helpers.int(2, 7),
    );

    const activationLower = requestedLower > activationUpper
      ? activationUpper
      : requestedLower;

    const activationDate = enabled
      ? randomDateBetween(
        activationLower,
        activationUpper,
        helpers,
      )
      : null;

    await client.query(
      `
        UPDATE clientes.clientes
        SET
          tiene_credito = $2,
          limite_credito = $3,
          saldo_deudor = 0,
          fecha_activacion_credito = $4::timestamptz,
          fecha_actualizacion_credito = $5::timestamptz
        WHERE id = $1::uuid
      `,
      [
        row.cliente_id,
        enabled,
        creditLimit,
        activationDate?.toISOString() || null,
        evaluationDate.toISOString(),
      ],
    );

    customer.creditEnabled = enabled;

    if (enabled) enabledCount += 1;
    else disabledCount += 1;
  }

  return {
    enabled: enabledCount,
    disabled: disabledCount,
    enabledRatio: enabledCount / scored.length,
  };
}
async function createCustomers(client, options, helpers, identity) {
  const customers = [];
  const earliestRegistration = addMonths(startOfMonth(options.periodStart), -8);
  const latestRegistration = addMonths(startOfMonth(options.periodEnd), -4);

  for (let index = 1; index <= options.clients; index += 1) {
    const profile = chooseProfile(helpers);
    const config = PROFILE_CONFIG[profile];

    const highActivityProbability = profile === "FRECUENTE_ESTABLE"
      ? 0.18
      : profile === "REGULAR"
        ? 0.08
        : 0.025;

    const activityMultiplier = helpers.bool(highActivityProbability)
      ? helpers.float(1.55, 2.20)
      : helpers.float(0.90, 1.15);

    const firstName = helpers.pick(NOMBRES);
    const lastName = helpers.pick(APELLIDOS);
    let secondLastName = helpers.pick(APELLIDOS);
    if (secondLastName === lastName) secondLastName = helpers.pick(APELLIDOS);
    const email = createUniqueEmail(firstName, lastName, identity, helpers);
    const phone = createUniquePhone(identity, helpers);
    const registrationDate = randomDateBetween(
      earliestRegistration,
      latestRegistration,
      helpers,
    );
    registrationDate.setUTCHours(helpers.int(9, 18), helpers.int(0, 59), 0, 0);

    const creditEnabled = false;
    const creditLimit = 0;
    const activationDate = null;

    const { rows } = await client.query(
      `
        INSERT INTO clientes.clientes (
          nombres,
          apellido_paterno,
          apellido_materno,
          telefono,
          email,
          tiene_credito,
          limite_credito,
          saldo_deudor,
          fecha_registro,
          activo,
          puede_apartar,
          fecha_activacion_credito,
          fecha_actualizacion_credito
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, 0, $8::timestamptz,
          true, $9, $10::timestamptz, $10::timestamptz
        )
        RETURNING id, nombres, apellido_paterno, apellido_materno,
                  email, telefono, tiene_credito, limite_credito, fecha_registro
      `,
      [
        firstName,
        lastName,
        secondLastName,
        phone,
        email,
        creditEnabled,
        creditLimit,
        registrationDate.toISOString(),
        helpers.bool(
          clamp(
            0.48 + (config.activeProbability * 0.34),
            0.50,
            0.80,
          ),
        ),
        activationDate?.toISOString() || null,
      ],
    );

    customers.push({
      ...rows[0],
      profile,
      registrationDate,
      creditEnabled,
      activityMultiplier,
    });
  }

  return customers;
}

function productWeightForMonth(product, month) {
  const monthNumber = asDate(month).getUTCMonth() + 1;
  const distance = Math.min(
    Math.abs(monthNumber - product.peakMonth),
    12 - Math.abs(monthNumber - product.peakMonth),
  );
  const peakBoost = distance === 0 ? 1.45 : distance === 1 ? 1.18 : 1;
  return product.popularity * peakBoost;
}

function historicalPrice(basePrice, orderDate, periodStart, periodEnd, helpers) {
  const start = asDate(periodStart).getTime();
  const end = asDate(periodEnd).getTime();
  const current = asDate(orderDate).getTime();
  const progress = clamp((current - start) / Math.max(1, end - start), 0, 1);
  const multiplier = 0.88 + progress * 0.12 + helpers.float(-0.025, 0.025);
  return Math.max(1, money(basePrice * multiplier));
}

function chooseBasket(catalog, profile, orderDate, options, helpers) {
  const config = PROFILE_CONFIG[profile];
  const desiredProducts = helpers.int(config.itemsMin, config.itemsMax);
  const selected = new Map();

  while (selected.size < Math.min(desiredProducts, catalog.products.length)) {
    const product = weightedPick(
      catalog.products,
      (item) => productWeightForMonth(item, orderDate),
      helpers,
    );
    selected.set(product.productoId, product);
  }

  return [...selected.values()].map((product) => {
    const variant = helpers.pick(product.variants);
    const quantity = helpers.bool(config.doubleQuantityProbability) ? 2 : 1;
    const unitPrice = historicalPrice(
      variant.precio_venta,
      orderDate,
      options.periodStart,
      options.periodEnd,
      helpers,
    );
    const unitCost = money(
      Math.min(
        unitPrice,
        historicalPrice(
          variant.precio_costo || variant.precio_venta * 0.55,
          orderDate,
          options.periodStart,
          options.periodEnd,
          helpers,
        ),
      ),
    );

    return {
      varianteId: variant.variante_id,
      productId: product.productoId,
      quantity,
      unitPrice,
      unitCost,
    };
  });
}

function choosePaymentMethod(helpers) {
  const value = helpers.random();
  if (value < 0.50) return "EFECTIVO";
  if (value < 0.78) return "TARJETA_DEBITO";
  if (value < 0.93) return "TRANSFERENCIA";
  return "TARJETA_CREDITO";
}

function naturalPaymentReference(method, orderDate, helpers) {
  if (method === "EFECTIVO") return null;
  const compactDate = isoDate(orderDate).replaceAll("-", "");
  if (method === "TRANSFERENCIA") {
    return `TRX-${compactDate}-${helpers.int(100000, 999999)}`;
  }
  return `AUT-${helpers.int(10000000, 99999999)}`;
}

async function createOrder(client, payload, helpers) {
  const subtotal = money(
    payload.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    ),
  );
  const discountRate = helpers.bool(monthSeasonFactor(payload.orderDate) > 1.1 ? 0.30 : 0.16)
    ? helpers.pick([0.05, 0.08, 0.10, 0.15])
    : 0;
  const discount = money(subtotal * discountRate);
  const shipping = payload.type === "WEB" && helpers.bool(0.64)
    ? helpers.pick([69, 79, 89, 99])
    : 0;
  const total = money(subtotal - discount + shipping);
  const paymentMethod = choosePaymentMethod(helpers);
  const deliveryType = payload.type === "WEB" && shipping > 0 ? "DOMICILIO" : "RECOGER";
  const note = helpers.pick(NATURAL_NOTES);

  const { rows } = await client.query(
    `
      INSERT INTO ventas.pedidos (
        cliente_id,
        vendedor_id,
        tipo,
        estado,
        subtotal,
        descuento,
        costo_envio,
        total,
        fecha_creacion,
        observaciones,
        tipo_entrega,
        costo_envio_confirmado,
        metodo_pago_solicitado
      )
      VALUES (
        $1, $2, $3::public.tipo_pedido, $4::public.estado_pedido,
        $5, $6, $7, $8, $9::timestamptz, $10,
        $11, true, $12::public.metodo_pago_enum
      )
      RETURNING id, folio, total, fecha_creacion
    `,
    [
      payload.customerId,
      payload.sellerId,
      payload.type,
      payload.state,
      subtotal,
      discount,
      shipping,
      total,
      payload.orderDate,
      note,
      deliveryType,
      paymentMethod,
    ],
  );
  const order = rows[0];

  for (const item of payload.items) {
    await client.query(
      `
        INSERT INTO ventas.detalles_pedido (
          pedido_id, cantidad, precio_unitario, variante_id, costo_unitario
        )
        VALUES ($1, $2, $3, $4::uuid, $5)
      `,
      [order.id, item.quantity, item.unitPrice, item.varianteId, item.unitCost],
    );
  }

  const { rows: paymentRows } = await client.query(
    `
      INSERT INTO ventas.pagos (
        pedido_id,
        monto,
        metodo,
        referencia_externa,
        fecha_pago,
        concepto,
        estado,
        usuario_id
      )
      VALUES (
        $1, $2, $3::public.metodo_pago_enum, $4,
        $5::timestamptz, 'PAGO_TOTAL', 'CONFIRMADO', $6
      )
      RETURNING id
    `,
    [
      order.id,
      total,
      paymentMethod,
      naturalPaymentReference(paymentMethod, payload.orderDate, helpers),
      payload.orderDate,
      payload.sellerId,
    ],
  );

  return {
    id: order.id,
    paymentId: paymentRows[0].id,
    details: payload.items.length,
    total,
  };
}

function activeMonthsForCustomer(customer, options, helpers) {
  const allMonths = monthsBetween(
    new Date(Math.max(
      startOfMonth(options.periodStart).getTime(),
      startOfMonth(customer.registrationDate).getTime(),
    )),
    options.periodEnd,
  );
  const config = PROFILE_CONFIG[customer.profile];
  const selected = [];

  if (!allMonths.length) return selected;

  if (customer.profile === "CONCENTRADO") {
    const clusterSize = Math.min(allMonths.length, helpers.int(2, 5));
    const startIndex = helpers.int(0, Math.max(0, allMonths.length - clusterSize));
    const cluster = new Set(
      allMonths.slice(startIndex, startIndex + clusterSize).map((date) => isoDate(date)),
    );
    for (const month of allMonths) {
      if (cluster.has(isoDate(month)) || helpers.bool(config.activeProbability)) {
        selected.push(month);
      }
    }
  } else if (customer.profile === "INACTIVO") {
    const inactiveMonths = helpers.int(6, 13);
    const cutoff = addMonths(startOfMonth(options.periodEnd), -inactiveMonths);
    for (const month of allMonths) {
      if (month <= cutoff && helpers.bool(config.activeProbability * monthSeasonFactor(month))) {
        selected.push(month);
      }
    }
  } else {
    for (const month of allMonths) {
      const probability = clamp(
        config.activeProbability
          * Math.sqrt(customer.activityMultiplier || 1)
          * monthSeasonFactor(month),
        0.05,
        0.97,
      );
      if (helpers.bool(probability)) selected.push(month);
    }
  }

  if (!selected.length) {
    const fallbackPool = customer.profile === "INACTIVO"
      ? allMonths.slice(0, Math.max(1, Math.floor(allMonths.length * 0.55)))
      : allMonths;
    selected.push(helpers.pick(fallbackPool.length ? fallbackPool : allMonths));
  }

  return selected;
}

async function generateOrders(
  client,
  customers,
  catalog,
  options,
  helpers,
  adminUser,
  stats,
  manifest,
) {
  let created = 0;

  for (const customer of customers) {
    const config = PROFILE_CONFIG[customer.profile];
    const activeMonths = activeMonthsForCustomer(customer, options, helpers);
    let customerOrders = 0;

    for (const month of activeMonths) {
      const seasonal = monthSeasonFactor(month);
      const baseOrders = helpers.int(config.ordersMin, config.ordersMax);

      const orderCount = Math.min(
        7,
        Math.max(
          1,
          Math.round(
            baseOrders
              * (customer.activityMultiplier || 1)
              * (seasonal > 1.2 ? 1.25 : 1),
          ),
        ),
      );

      for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
        if (customerOrders >= 140) break;
        const orderDate = timestampInMonth(
          month,
          customer.registrationDate,
          options.periodEnd,
          helpers,
        );
        const type = helpers.bool(0.20) ? "WEB" : "PUNTO_VENTA";
        const state = type === "WEB" ? "ENTREGADO" : "PAGADO";
        const items = chooseBasket(catalog, customer.profile, orderDate, options, helpers);

        const order = await createOrder(
          client,
          {
            customerId: customer.id,
            sellerId: adminUser?.id || null,
            type,
            state,
            orderDate,
            items,
          },
          helpers,
        );

        manifest.orderIds.push(order.id);
        stats.orders += 1;
        stats.details += order.details;
        stats.payments += 1;
        stats.totalSales = money(stats.totalSales + order.total);
        customerOrders += 1;
        created += 1;

        if (created % 500 === 0) {
          console.log(`  Pedidos creados: ${created}`);
        }
      }
    }
  }
}

async function validateGeneration(client, manifest, options) {
  const ids = manifest.clientIds;
  const orderIds = manifest.orderIds;

  const { rows: classRows } = await client.query(
    `
      SELECT tiene_credito AS credito_habilitado, count(*)::integer AS clientes
      FROM clientes.clientes
      WHERE id = ANY($1::uuid[])
      GROUP BY tiene_credito
      ORDER BY tiene_credito
    `,
    [ids],
  );
  const classes = Object.fromEntries(
    classRows.map((row) => [String(row.credito_habilitado), Number(row.clientes)]),
  );
  const enabled = Number(classes.true || 0);
  const disabled = Number(classes.false || 0);
  const enabledRatio = enabled / Math.max(1, enabled + disabled);

  const { rows: qualityRows } = await client.query(
    `
      WITH order_summary AS (
        SELECT
          p.cliente_id,
          count(*)::integer AS compras,
          round(sum(p.subtotal - p.descuento), 2) AS gasto,
          count(DISTINCT date_trunc('month', p.fecha_creacion))::integer AS meses_activos,
          max(p.fecha_creacion)::date AS ultima_compra
        FROM ventas.pedidos p
        WHERE p.id = ANY($2::uuid[])
        GROUP BY p.cliente_id
      )
      SELECT
        c.tiene_credito AS credito_habilitado,
        count(*)::integer AS clientes,
        round(avg(coalesce(os.compras, 0)), 2) AS promedio_compras,
        round(avg(coalesce(os.gasto, 0)), 2) AS promedio_gasto,
        round(avg(coalesce(os.meses_activos, 0)), 2) AS promedio_meses_activos,
        round(avg(($3::date - os.ultima_compra)), 2) AS promedio_dias_ultima_compra
      FROM clientes.clientes c
      LEFT JOIN order_summary os ON os.cliente_id = c.id
      WHERE c.id = ANY($1::uuid[])
      GROUP BY c.tiene_credito
      ORDER BY c.tiene_credito
    `,
    [ids, orderIds, options.periodEnd],
  );

  const months = Number(
    await queryScalar(
      client,
      `
        SELECT count(DISTINCT date_trunc('month', fecha_creacion))::integer
        FROM ventas.pedidos
        WHERE id = ANY($1::uuid[])
      `,
      [orderIds],
    ),
  );

  const products = Number(
    await queryScalar(
      client,
      `
        SELECT count(DISTINCT v.producto_id)::integer
        FROM ventas.detalles_pedido d
        JOIN inventario.variantes_producto v ON v.id = d.variante_id
        WHERE d.pedido_id = ANY($1::uuid[])
      `,
      [orderIds],
    ),
  );

  const ordersWithoutDetails = Number(
    await queryScalar(
      client,
      `
        SELECT count(*)::integer
        FROM ventas.pedidos p
        WHERE p.id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1 FROM ventas.detalles_pedido d WHERE d.pedido_id = p.id
          )
      `,
      [orderIds],
    ),
  );

  const ordersWithoutPayment = Number(
    await queryScalar(
      client,
      `
        SELECT count(*)::integer
        FROM ventas.pedidos p
        WHERE p.id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1
            FROM ventas.pagos pg
            WHERE pg.pedido_id = p.id
              AND pg.estado = 'CONFIRMADO'
          )
      `,
      [orderIds],
    ),
  );

  const invalidTotals = Number(
    await queryScalar(
      client,
      `
        SELECT count(*)::integer
        FROM ventas.pedidos p
        WHERE p.id = ANY($1::uuid[])
          AND p.total <> round(p.subtotal - coalesce(p.descuento, 0) + coalesce(p.costo_envio, 0), 2)
      `,
      [orderIds],
    ),
  );

  const visibleMarkers = Number(
    await queryScalar(
      client,
      `
        SELECT
          (
            SELECT count(*)
            FROM clientes.clientes c
            WHERE c.id = ANY($1::uuid[])
              AND (
                lower(coalesce(c.email, '')) LIKE '%ecbd%'
                OR lower(coalesce(c.email, '')) LIKE '%seed%'
                OR lower(coalesce(c.email, '')) LIKE '%modasarita%'
              )
          )
          +
          (
            SELECT count(*)
            FROM ventas.pedidos p
            WHERE p.id = ANY($2::uuid[])
              AND (
                lower(coalesce(p.observaciones, '')) LIKE '%ecbd%'
                OR lower(coalesce(p.observaciones, '')) LIKE '%seed%'
                OR lower(coalesce(p.observaciones, '')) LIKE '%sintetic%'
              )
          )
      `,
      [ids, orderIds],
    ),
  );

  if (enabledRatio < 0.45 || enabledRatio > 0.72) {
    throw new Error(
      `Distribución de crédito fuera del rango esperado: ${(enabledRatio * 100).toFixed(2)}% habilitado.`,
    );
  }
  if (months < 24) {
    throw new Error(`Historial mensual insuficiente: solo ${months} meses.`);
  }
  if (products < 10) {
    throw new Error(`Diversidad de productos insuficiente: ${products}.`);
  }
  if (ordersWithoutDetails || ordersWithoutPayment || invalidTotals || visibleMarkers) {
    throw new Error(
      `Validación fallida: sin_detalle=${ordersWithoutDetails}, sin_pago=${ordersWithoutPayment}, ` +
      `totales_invalidos=${invalidTotals}, marcas_visibles=${visibleMarkers}.`,
    );
  }

  return {
    classDistribution: { enabled, disabled, enabledRatio },
    classBehavior: qualityRows,
    months,
    products,
    ordersWithoutDetails,
    ordersWithoutPayment,
    invalidTotals,
    visibleMarkers,
  };
}

async function writeManifestAtomically(manifestPath, manifest) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, manifestPath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const helpers = createHelpers(createRng(options.seed));
  const poolConfig = buildPoolConfig();
  const pool = new Pool(poolConfig);
  const client = await pool.connect();
  const stats = {
    clients: 0,
    orders: 0,
    details: 0,
    payments: 0,
    totalSales: 0,
  };
  const manifest = {
    version: 1,
    database: REQUIRED_DATABASE,
    host: poolConfig.host,
    seed: options.seed,
    period: { start: options.periodStart, end: options.periodEnd },
    generatedAt: null,
    clientIds: [],
    orderIds: [],
    counts: null,
    validation: null,
  };

  try {
    const connection = await assertSafeDatabase(client, poolConfig);

    let previousManifestExists = false;
    try {
      await fs.access(options.manifest);
      previousManifestExists = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    if (previousManifestExists && !options.replace) {
      throw new Error(
        `Ya existe una generación registrada en ${options.manifest}. ` +
        "Ejecuta con --replace=true para eliminar únicamente esos UUID y regenerar.",
      );
    }

    const adminUser = await loadAdminUser(client);
    const catalog = await loadCatalog(client, helpers);
    const identity = await loadExistingIdentityValues(client);

    console.log("============================================================");
    console.log("DATOS ANALÍTICOS LOCALES - MODA SARITA");
    console.log("============================================================");
    console.log(`Base: ${connection.database_name}`);
    console.log(`Host configurado: ${poolConfig.host}`);
    console.log(`Semilla: ${options.seed}`);
    console.log(`Periodo: ${options.periodStart} a ${options.periodEnd}`);
    console.log(`Clientes a crear: ${options.clients}`);
    console.log(`Catálogo: ${catalog.products.length} productos / ${catalog.variants.length} variantes`);
    console.log(`Usuario de auditoría: ${adminUser?.email || "NULL"}`);
    console.log(`Manifiesto: ${options.manifest}`);
    console.log("");

    await client.query("BEGIN");
    if (adminUser?.id) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [adminUser.id]);
    }

    if (previousManifestExists) {
      console.log("[1/4] Eliminando la generación anterior registrada...");
      const removed = await cleanupPreviousGeneration(client, options.manifest);
      console.log(`  Clientes anteriores: ${removed?.clients || 0}`);
      console.log(`  Pedidos anteriores: ${removed?.orders || 0}`);
    } else {
      console.log("[1/4] No existe una generación anterior registrada.");
    }

    console.log("[2/5] Creando clientes con perfiles comerciales variados...");
    const customers = await createCustomers(client, options, helpers, identity);
    manifest.clientIds = customers.map((customer) => customer.id);
    stats.clients = customers.length;

    console.log("[3/5] Creando historial de pedidos y pagos...");
    await generateOrders(
      client,
      customers,
      catalog,
      options,
      helpers,
      adminUser,
      stats,
      manifest,
    );

    console.log("[4/5] Asignando credito a partir del comportamiento observado...");
    const labeling = await assignCreditLabelsFromBehavior(
      client,
      customers,
      options,
      helpers,
    );

    console.log(
      `  Habilitado: ${labeling.enabled} | ` +
      `No habilitado: ${labeling.disabled} | ` +
      `${(labeling.enabledRatio * 100).toFixed(2)}% habilitado`,
    );

    console.log("[5/5] Validando calidad e integridad...");
    const validation = await validateGeneration(client, manifest, options);
    manifest.generatedAt = new Date().toISOString();
    manifest.counts = stats;
    manifest.validation = validation;

    await client.query("COMMIT");
    await writeManifestAtomically(options.manifest, manifest);

    console.log("");
    console.log("============================================================");
    console.log("GENERACIÓN COMPLETADA");
    console.log("============================================================");
    console.log(`Clientes: ${stats.clients}`);
    console.log(`Pedidos: ${stats.orders}`);
    console.log(`Detalles: ${stats.details}`);
    console.log(`Pagos: ${stats.payments}`);
    console.log(`Venta total generada: $${stats.totalSales.toFixed(2)}`);
    console.log(`Crédito habilitado: ${validation.classDistribution.enabled}`);
    console.log(`Crédito no habilitado: ${validation.classDistribution.disabled}`);
    console.log(`Porcentaje habilitado: ${(validation.classDistribution.enabledRatio * 100).toFixed(2)}%`);
    console.log(`Meses con ventas: ${validation.months}`);
    console.log(`Productos vendidos: ${validation.products}`);
    console.log("");
    console.log("Comportamiento promedio por clase:");
    console.table(validation.classBehavior);
    console.log("");
    console.log(`Manifiesto guardado en: ${options.manifest}`);
    console.log("El stock actual no fue modificado.");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // La transacción podría no haberse iniciado.
    }
    console.error("");
    console.error(`GENERACIÓN CANCELADA: ${error.message}`);
    if (error?.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
