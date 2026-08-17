// src/services/alexa-datastore.service.js

import { poolInterno } from "../config/db.js";

import {
  obtenerEstadoCreditoCliente,
} from "../models/credito.model.js";

import {
  obtenerTargetsAlexaCliente,
} from "../models/alexa-sync.model.js";


const ALEXA_TOKEN_URL =
  "https://api.amazon.com/auth/o2/token";

const DATASTORE_ENDPOINT =
  process.env.ALEXA_DATASTORE_ENDPOINT ||
  "https://api.amazonalexa.com";


let cachedAccessToken = null;
let accessTokenExpiresAt = 0;


// ============================================================
// TOKEN LWA
// ============================================================

async function getAlexaDataStoreToken() {
  const now = Date.now();

  if (
    cachedAccessToken &&
    now < accessTokenExpiresAt - 60_000
  ) {
    return cachedAccessToken;
  }

  const clientId = process.env.ALEXA_CLIENT_ID;
  const clientSecret = process.env.ALEXA_CLIENT_SECRET;

  if (!clientId) {
    throw new Error(
      "Falta variable ALEXA_CLIENT_ID",
    );
  }

  if (!clientSecret) {
    throw new Error(
      "Falta variable ALEXA_CLIENT_SECRET",
    );
  }

  const body = new URLSearchParams();

  body.set(
    "grant_type",
    "client_credentials",
  );

  body.set(
    "client_id",
    clientId,
  );

  body.set(
    "client_secret",
    clientSecret,
  );

  body.set(
    "scope",
    "alexa::datastore",
  );


  const response = await fetch(
    ALEXA_TOKEN_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded;charset=UTF-8",
      },

      body,
    },
  );


  const raw = await response.text();

  let data = null;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {
      raw,
    };
  }


  if (!response.ok) {
    console.error(
      "[Alexa DataStore] Error obteniendo token:",
      response.status,
      data,
    );

    throw new Error(
      `No se pudo obtener token de Alexa (${response.status})`,
    );
  }


  if (!data.access_token) {
    throw new Error(
      "Alexa no devolvió access_token",
    );
  }


  cachedAccessToken = data.access_token;

  const expiresIn =
    Number(data.expires_in || 3600);

  accessTokenExpiresAt =
    Date.now() + expiresIn * 1000;


  return cachedAccessToken;
}


// ============================================================
// NORMALIZACIÓN
// ============================================================

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}


function construirCreditoDataStore(estado) {
  const limite =
    toNumber(estado.limite_credito);

  const deuda =
    toNumber(estado.saldo_deudor);

  const disponible =
    estado.credito_disponible !== undefined
      ? toNumber(estado.credito_disponible)
      : Math.max(limite - deuda, 0);


  return {
    clienteId:
      estado.cliente_id,

    limiteCredito:
      limite,

    saldoPendiente:
      deuda,

    creditoDisponible:
      disponible,

    creditosActivos:
      toNumber(estado.creditos_activos),

    cuotasVencidas:
      toNumber(estado.cuotas_vencidas),

    totalVencido:
      toNumber(estado.total_vencido),

    proximaFechaPago:
      estado.proxima_fecha_pago || null,

    montoProximoPago:
      estado.monto_proximo_pago === null ||
      estado.monto_proximo_pago === undefined
        ? null
        : toNumber(estado.monto_proximo_pago),

    actualizadoEn:
      new Date().toISOString(),
  };
}


// ============================================================
// DATA STORE
// ============================================================

async function pushCreditoDataStore(
  alexaUserId,
  content,
) {
  const accessToken =
    await getAlexaDataStoreToken();


  const attemptDeliveryUntil =
    new Date(
      Date.now() +
        10 * 60 * 1000,
    ).toISOString();


  const payload = {
    commands: [
      {
        type: "PUT_OBJECT",

        namespace:
          "ModaSaritaCredito",

        key:
          "resumen",

        content,
      },
    ],

    target: {
      type: "USER",
      id: alexaUserId,
    },

    attemptDeliveryUntil,
  };


  const response = await fetch(
    `${DATASTORE_ENDPOINT}/v1/datastore/commands`,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        "Content-Type":
          "application/json",
      },

      body:
        JSON.stringify(payload),
    },
  );


  const raw =
    await response.text();

  let result = null;

  try {
    result =
      raw ? JSON.parse(raw) : {};
  } catch {
    result = {
      raw,
    };
  }


  if (!response.ok) {
    console.error(
      "[Alexa DataStore] Error:",
      response.status,
      result,
    );

    throw new Error(
      `Alexa Data Store respondió ${response.status}`,
    );
  }


  console.log(
    "[Alexa DataStore] Resultado:",
    JSON.stringify(result),
  );


  return result;
}


// ============================================================
// SINCRONIZACIÓN COMPLETA
// ============================================================

export async function sincronizarCreditoAlexa(
  clienteId,
) {
  if (!clienteId) {
    throw new Error(
      "clienteId requerido para sincronización Alexa",
    );
  }


  // 1. Obtener estado actual directamente de BD
  const estado =
    await obtenerEstadoCreditoCliente(
      poolInterno,
      clienteId,
    );


  if (!estado) {
    console.warn(
      "[Alexa RT] Cliente sin estado de crédito:",
      clienteId,
    );

    return {
      ok: false,
      reason:
        "CREDIT_STATE_NOT_FOUND",
    };
  }


  // 2. Encontrar las cuentas Alexa asociadas
  const targets =
    await obtenerTargetsAlexaCliente(
      poolInterno,
      clienteId,
    );


  if (!targets.length) {
    console.log(
      "[Alexa RT] Cliente sin widget Alexa asociado:",
      clienteId,
    );

    return {
      ok: true,
      skipped: true,
      reason:
        "NO_ALEXA_TARGET",
    };
  }


  // 3. Crear información enviada al Echo
  const content =
    construirCreditoDataStore(
      estado,
    );


  const results = [];


  // 4. Actualizar todos los Alexa userId asociados
  for (const target of targets) {
    try {
      const result =
        await pushCreditoDataStore(
          target.alexa_user_id,
          content,
        );


      results.push({
        alexaUserId:
          target.alexa_user_id,

        ok:
          true,

        result,
      });
    } catch (error) {
      results.push({
        alexaUserId:
          target.alexa_user_id,

        ok:
          false,

        error:
          error.message,
      });
    }
  }


  const ok =
    results.every(
      (item) => item.ok,
    );


  return {
    ok,
    clienteId,
    content,
    results,
  };
}