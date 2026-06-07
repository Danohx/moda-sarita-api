// src/jobs/vencerApartados.job.js
import cron from "node-cron";
import { poolInterno } from "../config/db.js";
import { vencerApartadosExpirados } from "../models/pedidos.model.js";

let running = false;

export async function ejecutarVencimientoApartados() {
  if (running) {
    console.log("⏳ Job de vencimiento ya está en ejecución. Se omite.");
    return;
  }

  running = true;

  try {
    const result = await vencerApartadosExpirados(poolInterno);

    console.log(
      `✅ Vencimiento de apartados ejecutado. Vencidos: ${result.vencidos}`,
    );
  } catch (error) {
    console.error("❌ Error ejecutando vencimiento de apartados:", error);
  } finally {
    running = false;
  }
}

export function iniciarVencimientoApartadosJob() {
  void ejecutarVencimientoApartados();

  cron.schedule(
    "00 0 * * *",
    () => {
      void ejecutarVencimientoApartados();
    },
    {
      timezone: "America/Mexico_City",
    },
  );

  console.log("🕛 Job de vencimiento de apartados programado.");
}