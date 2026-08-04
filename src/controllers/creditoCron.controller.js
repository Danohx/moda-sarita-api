import { procesarVencimientosConRegistro } from "../models/creditoReportes.model.js";

function isAuthorized(req) {
  const configuredSecret = String(process.env.CRON_SECRET || "").trim();
  if (!configuredSecret) return false;

  const authorization = String(req.get("Authorization") || "").trim();
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerSecret = String(req.get("x-cron-secret") || "").trim();

  return bearer === configuredSecret || headerSecret === configuredSecret;
}

export async function procesarVencimientosCron(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, msg: "Cron no autorizado" });
  }

  try {
    const execution = await procesarVencimientosConRegistro(req.db, {
      origen: "CRON",
      usuarioId: null,
    });

    return res.json({ ok: true, data: execution });
  } catch (error) {
    console.error("procesarVencimientosCron error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error procesando vencimientos",
      detail: error?.message,
    });
  }
}
