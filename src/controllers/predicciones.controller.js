import { getPredictionByProducto } from "../models/predicciones.model.js";

function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function toNumberOrDefault(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

export async function getProductoPrediction(req, res) {
  try {
    if (!req.db) {
      return res.status(500).json({ ok: false, msg: "DB context no configurado (req.db)" });
    }

    const { productoId } = req.params;
    const {
      temporada_id,
      variante_id,
      anio_objetivo,
      target_year,
      from_year,
      history_years,
      margen_seguridad,
      safety_margin,
    } = req.query;

    if (!productoId) {
      return res.status(400).json({ ok: false, msg: "productoId es requerido" });
    }

    const data = await getPredictionByProducto(req.db, {
      productoId: String(productoId),
      varianteId: variante_id ? String(variante_id) : null,
      temporadaId: temporada_id ? Number(temporada_id) : null,
      targetYear: toIntOrNull(anio_objetivo) ?? toIntOrNull(target_year),
      fromYear: toIntOrNull(from_year),
      historyYears: toIntOrNull(history_years) ?? 5,
      safetyMargin: toNumberOrDefault(margen_seguridad ?? safety_margin, 0),
    });

    return res.json({ ok: true, data });
  } catch (error) {
    console.error("getProductoPrediction error:", error);

    if (error?.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: error.message });
    }

    if (error?.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: error.message });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo la predicción del producto",
      detail: error.message,
    });
  }
}
