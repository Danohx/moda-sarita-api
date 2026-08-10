// src/services/configuracion.service.js

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function now() {
  return Date.now();
}

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;

  if (item.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function setCached(key, value) {
  cache.set(key, {
    value,
    expiresAt: now() + CACHE_TTL_MS,
  });
}

export function clearConfiguracionCache() {
  cache.clear();
}

export async function getParametro(db, clave, fallback = null) {
  const cacheKey = `param:${clave}`;
  const cached = getCached(cacheKey);

  if (cached !== null) return cached;

  const { rows } = await db.query(
    `
      SELECT valor
      FROM configuracion.parametros_sistema
      WHERE clave = $1
      LIMIT 1;
    `,
    [clave],
  );

  if (rows.length === 0) {
    setCached(cacheKey, fallback);
    return fallback;
  }

  const value = rows[0].valor;
  setCached(cacheKey, value);

  return value;
}

export async function getParametroText(db, clave, fallback = "") {
  const value = await getParametro(db, clave, fallback);
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export async function getParametroBool(db, clave, fallback = false) {
  const value = await getParametro(db, clave, fallback);
  if (typeof value === "boolean") return value;
  return fallback;
}

export async function getParametroNumber(db, clave, fallback = 0) {
  const value = await getParametro(db, clave, fallback);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getConfigTicket(db) {
  const keys = [
    "ticket.nombre_tienda",
    "ticket.telefono",
    "ticket.direccion",
    "ticket.mostrar_logo",
    "ticket.mostrar_vendedor",
    "ticket.mostrar_cliente",
    "ticket.mensaje_final",
    "ticket.politica_cambios",
    "ticket.politica_apartado",
    "ticket.ancho_mm",
  ];

  const { rows } = await db.query(
    `
      SELECT clave, valor
      FROM configuracion.parametros_sistema
      WHERE clave = ANY($1::text[]);
    `,
    [keys],
  );

  const map = Object.fromEntries(rows.map((row) => [row.clave, row.valor]));

  return {
    nombreTienda: map["ticket.nombre_tienda"] ?? "Moda Sarita",
    telefono: map["ticket.telefono"] ?? "",
    direccion: map["ticket.direccion"] ?? "",
    mostrarLogo: map["ticket.mostrar_logo"] ?? true,
    mostrarVendedor: map["ticket.mostrar_vendedor"] ?? true,
    mostrarCliente: map["ticket.mostrar_cliente"] ?? true,
    mensajeFinal: map["ticket.mensaje_final"] ?? "¡Gracias por su compra!",
    politicaCambios: map["ticket.politica_cambios"] ?? "",
    politicaApartado: map["ticket.politica_apartado"] ?? "",
    anchoMm: map["ticket.ancho_mm"] ?? 80,
  };
}

export async function getConfigPOS(db) {
  const keys = [
    "pos.permitir_venta_sin_cliente",
    "pos.permitir_descuentos_manuales",
    "pos.descuento_manual_maximo_percent",
    "pos.requerir_corte_abierto",
    "pos.permitir_cambio_efectivo",
    "pos.imprimir_ticket_al_finalizar",
    "pos.metodo_pago_default",
  ];

  const { rows } = await db.query(
    `
      SELECT clave, valor
      FROM configuracion.parametros_sistema
      WHERE clave = ANY($1::text[]);
    `,
    [keys],
  );

  const map = Object.fromEntries(rows.map((row) => [row.clave, row.valor]));

  return {
    permitirVentaSinCliente: map["pos.permitir_venta_sin_cliente"] ?? true,

    permitirDescuentosManuales: map["pos.permitir_descuentos_manuales"] ?? true,

    descuentoManualMaximoPercent: Number(
      map["pos.descuento_manual_maximo_percent"] ?? 20,
    ),

    requerirCorteAbierto: map["pos.requerir_corte_abierto"] ?? true,

    permitirCambioEfectivo: map["pos.permitir_cambio_efectivo"] ?? true,

    imprimirTicketAlFinalizar: map["pos.imprimir_ticket_al_finalizar"] ?? true,

    metodoPagoDefault: map["pos.metodo_pago_default"] ?? "EFECTIVO",
  };
}

export async function getConfigCheckout(db) {
  const [
    habilitado,
    permitirRecoleccionTienda,
    permitirEnvioDomicilio,
    costoEnvioDomicilio,
    envioGratisHabilitado,
    envioGratisDesde,
  ] = await Promise.all([
    getParametroBool(db, "checkout.habilitado", false),

    getParametroBool(db, "checkout.permitir_recoleccion_tienda", true),

    getParametroBool(db, "checkout.permitir_envio_domicilio", false),

    getParametroNumber(db, "checkout.costo_envio_domicilio", 0),

    getParametroBool(db, "checkout.envio_gratis_habilitado", false),

    getParametroNumber(db, "checkout.envio_gratis_desde", 0),
  ]);

  return {
    habilitado,
    permitirRecoleccionTienda,
    permitirEnvioDomicilio,
    costoEnvioDomicilio: Math.max(0, Number(costoEnvioDomicilio)),
    envioGratisHabilitado,
    envioGratisDesde: Math.max(0, Number(envioGratisDesde)),
  };
}