import cron from "node-cron";
import { procesarVencimientosConRegistro } from "../models/creditoReportes.model.js";

let running = false;

export function iniciarJobVencimientosCredito(db) {
  if (process.env.ENABLE_CREDIT_OVERDUE_CRON === "false") {
    console.log("ℹ️ Job de vencimientos de crédito deshabilitado.");
    return null;
  }

  const expression = process.env.CREDIT_OVERDUE_CRON || "15 2 * * *";
  const timezone = process.env.CREDIT_OVERDUE_TIMEZONE || "America/Mexico_City";

  const task = cron.schedule(
    expression,
    async () => {
      if (running) {
        console.warn("⚠️ Se omitió ejecución de vencimientos: ya existe otra en curso.");
        return;
      }

      running = true;
      try {
        const execution = await procesarVencimientosConRegistro(db, {
          origen: "CRON",
          usuarioId: null,
        });
        console.log("✅ Vencimientos de crédito procesados:", execution.resultado);
      } catch (error) {
        console.error("❌ Error procesando vencimientos de crédito:", error);
      } finally {
        running = false;
      }
    },
    { timezone },
  );

  console.log(
    `⏰ Job de vencimientos activo: ${expression} (${timezone}).`,
  );

  return task;
}
