import {
  obtenerFeaturesCredito,
  obtenerFeaturesVentas,
} from "../models/analitica.model.js";

import {
  obtenerSaludMl,
  predecirCredito,
  predecirVentas,
} from "../services/analitica.service.js";

function toNumberOrNull(value) {
  if (
    value === null
    || value === undefined
    || value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function numericFeatures(
  row,
  excluded = [],
) {
  const excludedSet =
    new Set(excluded);

  return Object.fromEntries(
    Object.entries(row)
      .filter(
        ([key]) => !excludedSet.has(key),
      )
      .map(
        ([key, value]) => [
          key,
          toNumberOrNull(value),
        ],
      ),
  );
}

export async function getAnaliticaHealth(
  req,
  res,
) {
  try {
    const ml = await obtenerSaludMl();

    return res.json({
      ok: true,
      data: ml,
    });
  } catch (error) {
    return res.status(
      error?.status || 503,
    ).json({
      ok: false,
      message: error?.message
        || "Servicio analítico no disponible.",
      code: error?.code
        || "ML_SERVICE_UNAVAILABLE",
    });
  }
}

export async function postEvaluarCreditoCliente(
  req,
  res,
) {
  try {
    const clienteId =
      String(req.params.clienteId || "");

    const row =
      await obtenerFeaturesCredito(
        req.db,
        clienteId,
      );

    if (!row) {
      return res.status(404).json({
        ok: false,
        message:
          "Cliente no encontrado.",
      });
    }

    const totalCompras = Number(
      row.total_compras_historicas || 0,
    );

    if (totalCompras < 1) {
      return res.status(422).json({
        ok: false,
        code:
          "INSUFFICIENT_PURCHASE_HISTORY",
        message:
          "El cliente todavía no cuenta con compras históricas suficientes para realizar la evaluación.",
      });
    }

    const features = numericFeatures(
      row,
      [
        "cliente_id",
        "cliente_nombre",
        "tiene_credito",
        "fecha_evaluacion",
      ],
    );

    const prediction =
      await predecirCredito(
        features,
      );

    return res.json({
      ok: true,
      data: {
        cliente: {
          id: row.cliente_id,
          nombre: row.cliente_nombre,
          credito_actual:
            row.tiene_credito === true,
        },
        fecha_evaluacion:
          row.fecha_evaluacion,
        resultado:
          prediction.resultado,
        clase:
          prediction.clase,
        probabilidad:
          prediction.probabilidad,
        modelo:
          prediction.modelo,
        caracteristicas_utilizadas:
          prediction.caracteristicas_utilizadas,
        resumen: {
          total_compras_historicas:
            totalCompras,
          gasto_total_historico:
            Number(
              row.gasto_total_historico || 0,
            ),
          ticket_promedio_historico:
            Number(
              row.ticket_promedio_historico || 0,
            ),
          meses_con_compra_historicos:
            Number(
              row.meses_con_compra_historicos || 0,
            ),
          porcentaje_meses_activos:
            Number(
              row.porcentaje_meses_activos || 0,
            ),
          dias_desde_ultima_compra:
            Number(
              row.dias_desde_ultima_compra || 0,
            ),
        },
      },
    });
  } catch (error) {
    console.error(
      "postEvaluarCreditoCliente:",
      error,
    );

    return res.status(
      error?.status || 500,
    ).json({
      ok: false,
      message:
        error?.message
        || "No se pudo evaluar el cliente.",
      code:
        error?.code
        || "ANALYTICS_CREDIT_ERROR",
    });
  }
}

export async function postPredecirVentasProducto(
  req,
  res,
) {
  try {
    const productoId =
      String(req.params.productoId || "");

    const row =
      await obtenerFeaturesVentas(
        req.db,
        productoId,
      );

    if (!row) {
      return res.status(422).json({
        ok: false,
        code:
          "INSUFFICIENT_SALES_HISTORY",
        message:
          "El producto no cuenta con historial de ventas suficiente para generar la predicción.",
      });
    }

    const features = {
      categoria_nombre:
        row.categoria_nombre,

      ...numericFeatures(
        row,
        [
          "producto_id",
          "producto_nombre",
          "categoria_nombre",
          "fecha_corte",
          "mes_objetivo_fecha",
        ],
      ),
    };

    const prediction =
      await predecirVentas(
        features,
      );

    return res.json({
      ok: true,
      data: {
        producto: {
          id: row.producto_id,
          nombre:
            row.producto_nombre,
          categoria:
            row.categoria_nombre,
        },
        fecha_corte:
          row.fecha_corte,
        mes_objetivo:
          row.mes_objetivo_fecha,
        monto_mes_actual:
          Number(
            row.monto_mes_actual || 0,
          ),
        cambio_estimado:
          prediction.delta_predicho,
        monto_estimado:
          prediction.monto_estimado,
        modelo:
          prediction.modelo,
        r2_modelo:
          prediction.r2_modelo,
        r2_baseline:
          prediction.r2_baseline,
      },
    });
  } catch (error) {
    console.error(
      "postPredecirVentasProducto:",
      error,
    );

    return res.status(
      error?.status || 500,
    ).json({
      ok: false,
      message:
        error?.message
        || "No se pudo predecir la venta.",
      code:
        error?.code
        || "ANALYTICS_SALES_ERROR",
    });
  }
}
