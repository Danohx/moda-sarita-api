const DEFAULT_ML_URL = "http://127.0.0.1:8001";

function getBaseUrl() {
  return String(
    process.env.ML_SERVICE_URL
      || DEFAULT_ML_URL,
  ).replace(/\/+$/, "");
}

async function requestMl(
  endpoint,
  body,
) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    20_000,
  );

  try {
    const response = await fetch(
      `${getBaseUrl()}${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    const payload = await response
      .json()
      .catch(() => null);

    if (!response.ok) {
      const error = new Error(
        payload?.detail
        || payload?.message
        || "Error en servicio analítico",
      );

      error.status = 502;
      error.code = "ML_SERVICE_ERROR";
      throw error;
    }

    return payload;
  } catch (error) {
    if (
      error?.name === "AbortError"
    ) {
      const timeoutError = new Error(
        "El servicio analítico agotó el tiempo de respuesta.",
      );

      timeoutError.status = 504;
      timeoutError.code =
        "ML_SERVICE_TIMEOUT";

      throw timeoutError;
    }

    if (
      error?.code === "ML_SERVICE_ERROR"
    ) {
      throw error;
    }

    const connectionError = new Error(
      "No fue posible conectar con el servicio de modelos. Verifica que moda-sarita-ml esté iniciado.",
    );

    connectionError.status = 503;
    connectionError.code =
      "ML_SERVICE_UNAVAILABLE";

    throw connectionError;
  } finally {
    clearTimeout(timeout);
  }
}

export function predecirCredito(
  features,
) {
  return requestMl(
    "/predict/credito",
    { features },
  );
}

export function predecirVentas(
  features,
) {
  return requestMl(
    "/predict/ventas",
    { features },
  );
}

export async function obtenerSaludMl() {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    5_000,
  );

  try {
    const response = await fetch(
      `${getBaseUrl()}/health`,
      {
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `ML respondió HTTP ${response.status}`,
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}
