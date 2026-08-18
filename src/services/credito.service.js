const FRECUENCIAS = new Set(["SEMANAL", "QUINCENAL", "MENSUAL"]);

const CUOTAS_POR_MES = Object.freeze({
  SEMANAL: 4,
  QUINCENAL: 2,
  MENSUAL: 1,
});

function domainError(message, code = "VALIDATION", details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function normalizeInteger(value, fieldName, { min = 0, max = 100000 } = {}) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw domainError(`${fieldName} debe ser un entero entre ${min} y ${max}.`);
  }

  return number;
}

function jsonScalar(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return value.value;
    }
  }
  return value;
}

/**
 * Convierte un importe a centavos enteros. Acepta number o string decimal.
 * Redondea a dos decimales en el límite de entrada y evita cálculos monetarios
 * posteriores con punto flotante.
 */
export function dineroACentavos(value, fieldName = "monto") {
  if (value === null || value === undefined || value === "") {
    throw domainError(`${fieldName} es requerido.`);
  }

  const normalized = String(value).trim().replace(/,/g, "");

  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw domainError(`${fieldName} debe ser un importe válido.`);
  }

  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw domainError(`${fieldName} debe ser un importe finito.`);
  }

  return Math.round(number * 100);
}

export function centavosADinero(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw domainError("El importe en centavos excede el rango seguro.");
  }

  return Number((cents / 100).toFixed(2));
}

export function normalizarFechaISO(value, fieldName = "fecha") {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

  if (!match) {
    throw domainError(`${fieldName} debe tener formato YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw domainError(`${fieldName} no es una fecha válida.`);
  }

  return text;
}

function isoToUtcDate(isoDate) {
  const [year, month, day] = normalizarFechaISO(isoDate).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateToIso(date) {
  return date.toISOString().slice(0, 10);
}

export function sumarDiasISO(isoDate, days) {
  const date = isoToUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return utcDateToIso(date);
}

export function obtenerFechaNegocioISO(
  date = new Date(),
  timeZone = process.env.CREDIT_OVERDUE_TIMEZONE || "America/Mexico_City",
) {
  let parts;

  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    throw domainError(
      `La zona horaria de crédito no es válida: ${timeZone}.`,
      "CONFIGURATION",
    );
  }

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function calcularPrimerVencimiento({
  fechaInicioCredito,
  frecuenciaPago,
}) {
  const startDate = normalizarFechaISO(
    fechaInicioCredito,
    "fecha_inicio_credito",
  );
  const frecuencia = String(frecuenciaPago || "")
    .trim()
    .toUpperCase();

  if (!FRECUENCIAS.has(frecuencia)) {
    throw domainError("frecuencia_pago no es válida.");
  }

  if (frecuencia === "SEMANAL") return sumarDiasISO(startDate, 7);
  if (frecuencia === "QUINCENAL") return sumarDiasISO(startDate, 15);
  return sumarMesesAncladosISO(startDate, 1);
}

/**
 * Suma meses conservando el día original cuando existe. Si no existe, usa el
 * último día del mes. Al usar siempre la fecha ancla se evita que 31-ene ->
 * 28-feb termine derivando en 28-mar.
 */
export function sumarMesesAncladosISO(isoDate, months) {
  const anchor = isoToUtcDate(isoDate);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const originalDay = anchor.getUTCDate();

  const firstOfTarget = new Date(Date.UTC(year, month + Number(months), 1));
  const targetYear = firstOfTarget.getUTCFullYear();
  const targetMonth = firstOfTarget.getUTCMonth();
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return utcDateToIso(
    new Date(Date.UTC(targetYear, targetMonth, Math.min(originalDay, lastDay))),
  );
}

export function calcularNumeroCuotas(plazoMeses, frecuenciaPago) {
  const plazo = normalizeInteger(plazoMeses, "plazo_meses", {
    min: 1,
    max: 60,
  });
  const frecuencia = String(frecuenciaPago || "")
    .trim()
    .toUpperCase();

  if (!FRECUENCIAS.has(frecuencia)) {
    throw domainError("frecuencia_pago no es válida.");
  }

  return plazo * CUOTAS_POR_MES[frecuencia];
}

export function calcularFechasVencimiento({
  fechaPrimerVencimiento,
  numeroCuotas,
  frecuenciaPago,
}) {
  const firstDate = normalizarFechaISO(
    fechaPrimerVencimiento,
    "fecha_primer_vencimiento",
  );
  const count = normalizeInteger(numeroCuotas, "numero_cuotas", {
    min: 1,
    max: 720,
  });
  const frecuencia = String(frecuenciaPago || "")
    .trim()
    .toUpperCase();

  if (!FRECUENCIAS.has(frecuencia)) {
    throw domainError("frecuencia_pago no es válida.");
  }

  return Array.from({ length: count }, (_, index) => {
    if (frecuencia === "SEMANAL") {
      return sumarDiasISO(firstDate, index * 7);
    }

    if (frecuencia === "QUINCENAL") {
      return sumarDiasISO(firstDate, index * 15);
    }

    return sumarMesesAncladosISO(firstDate, index);
  });
}

export function repartirMontoEnCuotas(monto, numeroCuotas) {
  const totalCents = dineroACentavos(monto, "monto_financiado");
  const count = normalizeInteger(numeroCuotas, "numero_cuotas", {
    min: 1,
    max: 720,
  });

  if (totalCents <= 0) {
    throw domainError("monto_financiado debe ser mayor a 0.");
  }

  if (totalCents < count) {
    throw domainError(
      "El monto financiado no alcanza para generar cuotas mínimas de $0.01.",
    );
  }

  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const installments = Array(count).fill(base);
  installments[count - 1] += remainder;

  return installments.map(centavosADinero);
}

function indexParametros(parametros) {
  if (Array.isArray(parametros)) {
    return Object.fromEntries(
      parametros.map((item) => [String(item.clave), jsonScalar(item.valor)]),
    );
  }

  return { ...(parametros || {}) };
}

export function normalizarConfiguracionCredito(parametros) {
  const values = indexParametros(parametros);

  const required = [
    "credito.plazos_permitidos",
    "credito.frecuencias_permitidas",
    "credito.dias_gracia",
    "credito.porcentaje_enganche_minimo",
    "credito.permite_enganche_cero",
    "credito.permite_multiples_activos",
    "credito.max_creditos_activos",
    "credito.bloquear_con_cuota_vencida",
    "credito.bloquear_con_mora",
    "credito.bloquear_con_incumplimiento",
    "credito.dias_para_incumplimiento",
    "credito.orden_aplicacion_abonos",
    "credito.permite_pagos_anticipados",
    "credito.permite_pago_multicuota",
    "credito.permite_pagos_parciales",
    "credito.intereses_habilitados",
    "credito.recargos_habilitados",
  ];

  const missing = required.filter((key) => values[key] === undefined);
  if (missing.length) {
    throw domainError(
      "La configuración de crédito está incompleta.",
      "CONFIGURATION",
      { missing },
    );
  }

  const plazos = values["credito.plazos_permitidos"];
  const frecuencias = values["credito.frecuencias_permitidas"];

  if (!Array.isArray(plazos) || !plazos.length) {
    throw domainError(
      "credito.plazos_permitidos debe ser un arreglo no vacío.",
      "CONFIGURATION",
    );
  }

  if (!Array.isArray(frecuencias) || !frecuencias.length) {
    throw domainError(
      "credito.frecuencias_permitidas debe ser un arreglo no vacío.",
      "CONFIGURATION",
    );
  }

  const normalizedFrequencies = frecuencias.map((item) =>
    String(item).trim().toUpperCase(),
  );

  const invalidFrequencies = normalizedFrequencies.filter(
    (item) => !FRECUENCIAS.has(item),
  );
  if (invalidFrequencies.length) {
    throw domainError(
      "La configuración contiene frecuencias no soportadas.",
      "CONFIGURATION",
      { invalidFrequencies },
    );
  }

  return Object.freeze({
    plazosPermitidos: plazos.map((item) =>
      normalizeInteger(item, "plazo permitido", { min: 1, max: 60 }),
    ),
    frecuenciasPermitidas: normalizedFrequencies,
    diasGracia: normalizeInteger(
      values["credito.dias_gracia"],
      "días de gracia",
      {
        min: 0,
        max: 60,
      },
    ),
    porcentajeEngancheMinimo: normalizeInteger(
      values["credito.porcentaje_enganche_minimo"],
      "porcentaje de enganche mínimo",
      { min: 0, max: 100 },
    ),
    permiteEngancheCero: normalizeBoolean(
      values["credito.permite_enganche_cero"],
    ),
    permiteMultiplesActivos: normalizeBoolean(
      values["credito.permite_multiples_activos"],
    ),
    maxCreditosActivos: normalizeInteger(
      values["credito.max_creditos_activos"],
      "máximo de créditos activos",
      { min: 1, max: 100 },
    ),
    bloquearConCuotaVencida: normalizeBoolean(
      values["credito.bloquear_con_cuota_vencida"],
    ),
    bloquearConMora: normalizeBoolean(values["credito.bloquear_con_mora"]),
    bloquearConIncumplimiento: normalizeBoolean(
      values["credito.bloquear_con_incumplimiento"],
    ),
    diasParaIncumplimiento: normalizeInteger(
      values["credito.dias_para_incumplimiento"],
      "días para incumplimiento",
      { min: 0, max: 3650 },
    ),
    ordenAplicacionAbonos: String(
      values["credito.orden_aplicacion_abonos"],
    ).trim(),
    permitePagosAnticipados: normalizeBoolean(
      values["credito.permite_pagos_anticipados"],
    ),
    permitePagoMulticuota: normalizeBoolean(
      values["credito.permite_pago_multicuota"],
    ),
    permitePagosParciales: normalizeBoolean(
      values["credito.permite_pagos_parciales"],
    ),
    interesesHabilitados: normalizeBoolean(
      values["credito.intereses_habilitados"],
    ),
    recargosHabilitados: normalizeBoolean(
      values["credito.recargos_habilitados"],
    ),
  });
}

export function calcularPlanCredito({
  totalCompra,
  enganche = 0,
  plazoMeses,
  frecuenciaPago,
  fechaPrimerVencimiento = null,
  fechaInicioCredito = null,
  diasGracia,
  configuracion,
}) {
  const config = configuracion
    ? normalizarConfiguracionCredito(configuracion)
    : null;

  const totalCents = dineroACentavos(totalCompra, "total_compra");
  const downPaymentCents = dineroACentavos(enganche, "enganche");
  const term = normalizeInteger(plazoMeses, "plazo_meses", {
    min: 1,
    max: 60,
  });
  const frequency = String(frecuenciaPago || "")
    .trim()
    .toUpperCase();
  const graceDays =
    diasGracia === undefined || diasGracia === null
      ? config?.diasGracia
      : normalizeInteger(diasGracia, "dias_gracia", { min: 0, max: 60 });

  if (totalCents <= 0) {
    throw domainError("total_compra debe ser mayor a 0.");
  }

  if (downPaymentCents < 0) {
    throw domainError("enganche no puede ser negativo.");
  }

  if (downPaymentCents >= totalCents) {
    throw domainError(
      "El enganche debe ser menor al total; de lo contrario no existe monto financiado.",
    );
  }

  if (!FRECUENCIAS.has(frequency)) {
    throw domainError("frecuencia_pago no es válida.");
  }

  if (config) {
    if (!config.plazosPermitidos.includes(term)) {
      throw domainError("El plazo solicitado no está permitido.");
    }

    if (!config.frecuenciasPermitidas.includes(frequency)) {
      throw domainError("La frecuencia solicitada no está permitida.");
    }

    if (downPaymentCents === 0 && !config.permiteEngancheCero) {
      throw domainError(
        "La configuración actual no permite enganche de $0.00.",
      );
    }

    const minimumDownPayment = Math.ceil(
      (totalCents * config.porcentajeEngancheMinimo) / 100,
    );

    if (downPaymentCents < minimumDownPayment) {
      throw domainError(
        `El enganche mínimo es $${centavosADinero(minimumDownPayment).toFixed(2)}.`,
      );
    }

    if (config.interesesHabilitados || config.recargosHabilitados) {
      throw domainError(
        "El motor actual no puede calcular intereses o recargos hasta que exista una regla explícita.",
        "CONFIGURATION",
      );
    }
  }

  if (graceDays === undefined || graceDays === null) {
    throw domainError("dias_gracia es requerido.", "CONFIGURATION");
  }

  const financedCents = totalCents - downPaymentCents;
  const installmentCount = calcularNumeroCuotas(term, frequency);
  const amounts = repartirMontoEnCuotas(
    centavosADinero(financedCents),
    installmentCount,
  );

  // La fecha de la primera cuota es una regla de negocio del backend.
  // Se calcula desde la fecha real de inicio/otorgamiento del crédito para
  // evitar que un cliente mande una fecha arbitraria o que el frontend quede
  // desfasado (por ejemplo 10-ago + 15 días debe ser 25-ago).
  const startDate = fechaInicioCredito
    ? normalizarFechaISO(fechaInicioCredito, "fecha_inicio_credito")
    : obtenerFechaNegocioISO();
  const expectedFirstDate = calcularPrimerVencimiento({
    fechaInicioCredito: startDate,
    frecuenciaPago: frequency,
  });

  // Se conserva el parámetro por compatibilidad con clientes anteriores, pero
  // ya no gobierna el calendario. Si llega una fecha válida distinta, el
  // backend la corrige usando la regla de frecuencia.
  if (fechaPrimerVencimiento) {
    normalizarFechaISO(fechaPrimerVencimiento, "fecha_primer_vencimiento");
  }

  const dates = calcularFechasVencimiento({
    fechaPrimerVencimiento: expectedFirstDate,
    numeroCuotas: installmentCount,
    frecuenciaPago: frequency,
  });

  const schedule = dates.map((date, index) => ({
    numero_cuota: index + 1,
    fecha_vencimiento: date,
    monto_programado: amounts[index],
    monto_pagado: 0,
    monto_condonado: 0,
    saldo_pendiente: amounts[index],
    estado: "PENDIENTE",
  }));

  return Object.freeze({
    total_compra: centavosADinero(totalCents),
    enganche: centavosADinero(downPaymentCents),
    monto_financiado: centavosADinero(financedCents),
    porcentaje_enganche: Number(
      ((downPaymentCents / totalCents) * 100).toFixed(2),
    ),
    plazo_meses: term,
    frecuencia_pago: frequency,
    numero_cuotas: installmentCount,
    fecha_inicio_credito: startDate,
    fecha_primer_vencimiento: dates[0],
    fecha_vencimiento_final: dates[dates.length - 1],
    dias_gracia: graceDays,
    calendario: schedule,
  });
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function evaluarElegibilidadCliente({
  cliente,
  montoFinanciado,
  configuracion,
}) {
  const config = normalizarConfiguracionCredito(configuracion);
  const violations = [];

  if (!cliente) {
    return {
      apto: false,
      credito_disponible: 0,
      validaciones_incumplidas: ["CLIENTE_NO_ENCONTRADO"],
    };
  }

  const limit = numberOrZero(cliente.limite_credito);
  const balance = numberOrZero(cliente.saldo_deudor);
  const available = Math.max(limit - balance, 0);
  const financed = numberOrZero(montoFinanciado);
  const activeCredits = numberOrZero(cliente.creditos_activos);
  const overdueInstallments = numberOrZero(cliente.cuotas_vencidas);
  const inArrears = numberOrZero(cliente.creditos_en_mora);
  const defaults = numberOrZero(cliente.creditos_incumplidos);

  if (cliente.activo !== true) violations.push("CLIENTE_INACTIVO");
  if (cliente.tiene_credito !== true) violations.push("CREDITO_NO_HABILITADO");
  if (limit <= 0) violations.push("LIMITE_NO_CONFIGURADO");
  if (financed <= 0) violations.push("MONTO_FINANCIADO_INVALIDO");
  if (financed > available) violations.push("CREDITO_DISPONIBLE_INSUFICIENTE");

  if (!config.permiteMultiplesActivos && activeCredits > 0) {
    violations.push("YA_TIENE_CREDITO_ACTIVO");
  }

  if (
    config.permiteMultiplesActivos &&
    activeCredits >= config.maxCreditosActivos
  ) {
    violations.push("MAXIMO_CREDITOS_ACTIVOS_ALCANZADO");
  }

  if (config.bloquearConCuotaVencida && overdueInstallments > 0) {
    violations.push("CUOTAS_VENCIDAS");
  }

  if (config.bloquearConMora && inArrears > 0) {
    violations.push("CREDITO_EN_MORA");
  }

  if (config.bloquearConIncumplimiento && defaults > 0) {
    violations.push("CREDITO_INCUMPLIDO");
  }

  return Object.freeze({
    apto: violations.length === 0,
    limite_credito: Number(limit.toFixed(2)),
    saldo_deudor: Number(balance.toFixed(2)),
    credito_disponible: Number(available.toFixed(2)),
    creditos_activos: activeCredits,
    cuotas_vencidas: overdueInstallments,
    creditos_en_mora: inArrears,
    creditos_incumplidos: defaults,
    validaciones_incumplidas: violations,
  });
}

export function validarElegibilidadCliente(input) {
  const result = evaluarElegibilidadCliente(input);

  if (!result.apto) {
    throw domainError(
      "El cliente no cumple las reglas para recibir el crédito.",
      "CREDIT_NOT_ELIGIBLE",
      result,
    );
  }

  return result;
}

export { domainError };
