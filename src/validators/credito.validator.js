// src/validators/credito.validator.js

import {
  dineroACentavos,
  domainError,
  normalizarFechaISO,
} from "../services/credito.service.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ESTADOS_CREDITO = new Set([
  "ACTIVO",
  "EN_MORA",
  "LIQUIDADO",
  "INCUMPLIDO",
  "CANCELADO",
]);

const FRECUENCIAS = new Set(["SEMANAL", "QUINCENAL", "MENSUAL"]);

const METODOS_DINERO = new Set([
  "EFECTIVO",
  "TARJETA_CREDITO",
  "TARJETA_DEBITO",
  "TRANSFERENCIA",
  "PAYPAL",
  "MERCADO_PAGO",
]);

function requiredObject(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw domainError("El cuerpo de la solicitud debe ser un objeto JSON.");
  }

  return payload;
}

function requiredUuid(value, fieldName) {
  const text = String(value || "").trim();
  if (!UUID_REGEX.test(text)) {
    throw domainError(`${fieldName} debe ser un UUID válido.`);
  }
  return text;
}

function optionalUuid(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  return requiredUuid(value, fieldName);
}

function requiredInteger(value, fieldName, { min = 1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw domainError(`${fieldName} debe ser un entero entre ${min} y ${max}.`);
  }
  return number;
}

function optionalBoolean(value, fieldName) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw domainError(`${fieldName} debe ser booleano.`);
}

export function validarPayloadSimulacionCredito(payload) {
  const body = requiredObject(payload);
  const frequency = String(body.frecuencia_pago || "")
    .trim()
    .toUpperCase();

  if (!FRECUENCIAS.has(frequency)) {
    throw domainError("frecuencia_pago no es válida.");
  }

  const totalCents = dineroACentavos(body.total_compra, "total_compra");
  const downPaymentCents = dineroACentavos(body.enganche ?? 0, "enganche");

  if (totalCents <= 0) throw domainError("total_compra debe ser mayor a 0.");
  if (downPaymentCents < 0)
    throw domainError("enganche no puede ser negativo.");

  return Object.freeze({
    cliente_id: requiredUuid(body.cliente_id, "cliente_id"),
    total_compra: totalCents / 100,
    enganche: downPaymentCents / 100,
    plazo_meses: requiredInteger(body.plazo_meses, "plazo_meses", {
      min: 1,
      max: 60,
    }),
    frecuencia_pago: frequency,
    fecha_primer_vencimiento: normalizarFechaISO(
      body.fecha_primer_vencimiento,
      "fecha_primer_vencimiento",
    ),
  });
}

export function validarPayloadCreacionCredito(payload) {
  const body = requiredObject(payload);
  const simulation = validarPayloadSimulacionCredito(body);

  const origin = String(body.origen || "ADMIN")
    .trim()
    .toUpperCase();
  if (!["ADMIN", "POS"].includes(origin)) {
    throw domainError("origen debe ser ADMIN o POS.");
  }

  return Object.freeze({
    ...simulation,
    pedido_id: requiredUuid(body.pedido_id, "pedido_id"),
    origen: origin,
    metodo_enganche:
      body.enganche > 0
        ? validarMetodoDinero(body.metodo_enganche, "metodo_enganche")
        : null,
    referencia_enganche:
      body.referencia_enganche === undefined ||
      body.referencia_enganche === null ||
      body.referencia_enganche === ""
        ? null
        : String(body.referencia_enganche).trim(),
  });
}

export function validarMetodoDinero(value, fieldName = "metodo_pago") {
  const method = String(value || "")
    .trim()
    .toUpperCase();

  if (!METODOS_DINERO.has(method)) {
    throw domainError(
      `${fieldName} debe representar dinero realmente recibido; CREDITO_TIENDA no es válido para un abono.`,
    );
  }

  return method;
}

export function validarPayloadAbonoCredito(payload) {
  const body = requiredObject(payload);
  const cents = dineroACentavos(body.monto, "monto");

  if (cents <= 0) throw domainError("monto debe ser mayor a 0.");

  return Object.freeze({
    monto: cents / 100,
    metodo_pago: validarMetodoDinero(body.metodo_pago),
    referencia_externa:
      body.referencia_externa === undefined ||
      body.referencia_externa === null ||
      body.referencia_externa === ""
        ? null
        : String(body.referencia_externa).trim(),
    observaciones:
      body.observaciones === undefined ||
      body.observaciones === null ||
      body.observaciones === ""
        ? null
        : String(body.observaciones).trim(),
  });
}

export function validarCreditoId(value) {
  return requiredUuid(value, "credito_id");
}

export function validarFiltrosCreditos(query = {}) {
  const state = query.estado ? String(query.estado).trim().toUpperCase() : null;

  if (state && !ESTADOS_CREDITO.has(state)) {
    throw domainError("estado de crédito no válido.");
  }

  return Object.freeze({
    clienteId: optionalUuid(query.cliente_id, "cliente_id"),
    estado: state,
    fechaDesde: query.fecha_desde
      ? normalizarFechaISO(query.fecha_desde, "fecha_desde")
      : null,
    fechaHasta: query.fecha_hasta
      ? normalizarFechaISO(query.fecha_hasta, "fecha_hasta")
      : null,
    conCuotasVencidas: optionalBoolean(
      query.con_cuotas_vencidas,
      "con_cuotas_vencidas",
    ),
    datosCalendarioCompletos: optionalBoolean(
      query.datos_calendario_completos,
      "datos_calendario_completos",
    ),
    limit: requiredInteger(query.limit ?? 50, "limit", { min: 1, max: 200 }),
    offset: requiredInteger(query.offset ?? 0, "offset", {
      min: 0,
      max: 1000000,
    }),
  });
}

export function validarPayloadCreditoPOS(payload) {
  const body = requiredObject(payload);
  const frequency = String(body.frecuencia_pago || "")
    .trim()
    .toUpperCase();

  if (!FRECUENCIAS.has(frequency)) {
    throw domainError("credito.frecuencia_pago no es válida.");
  }

  const downPaymentCents = dineroACentavos(
    body.enganche ?? 0,
    "credito.enganche",
  );
  if (downPaymentCents < 0) {
    throw domainError("credito.enganche no puede ser negativo.");
  }

  const method =
    downPaymentCents > 0
      ? validarMetodoDinero(body.metodo_enganche, "credito.metodo_enganche")
      : null;

  return Object.freeze({
    enganche: downPaymentCents / 100,
    metodo_enganche: method,
    referencia_enganche:
      body.referencia_enganche === undefined ||
      body.referencia_enganche === null ||
      body.referencia_enganche === ""
        ? null
        : String(body.referencia_enganche).trim(),
    plazo_meses: requiredInteger(body.plazo_meses, "credito.plazo_meses", {
      min: 1,
      max: 60,
    }),
    frecuencia_pago: frequency,
    fecha_primer_vencimiento: normalizarFechaISO(
      body.fecha_primer_vencimiento,
      "credito.fecha_primer_vencimiento",
    ),
  });
}

export function validarMotivoCancelacionCredito(payload) {
  const body = requiredObject(payload);
  const motivo = String(body.motivo || "").trim();

  if (motivo.length < 5) {
    throw domainError("motivo debe contener al menos 5 caracteres.");
  }

  if (motivo.length > 500) {
    throw domainError("motivo no puede exceder 500 caracteres.");
  }

  return Object.freeze({ motivo });
}

export function validarFechaProcesamientoCredito(value) {
  if (value === undefined || value === null || value === "") return null;
  return normalizarFechaISO(value, "fecha");
}

export function validarPagoId(value) {
  return requiredUuid(value, "pago_id");
}

export function validarIdempotencyKey(value) {
  if (value === undefined || value === null || value === "") return null;

  const key = String(value).trim();
  if (key.length < 8 || key.length > 120) {
    throw domainError(
      "idempotency_key debe contener entre 8 y 120 caracteres.",
    );
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw domainError(
      "idempotency_key solo puede contener letras, números, punto, guion, guion bajo y dos puntos.",
    );
  }

  return key;
}

export function validarClienteId(value) {
  return requiredUuid(value, "cliente_id");
}