import "dotenv/config";
import "../src/config/env.js";
import { SuscripcionModel } from "../src/models/suscripcion.model.js";
import app from "../src/app.js";

let initialized = false;

async function init() {
  if (!initialized) {
    await SuscripcionModel.init();
    initialized = true;
    console.log("✅ Inicialización completada");
  }
}

export default async function handler(req, res) {
  try {
    await init();
    return app(req, res);
  } catch (error) {
    console.error("❌ Error fatal en Vercel:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error interno del servidor",
      detail: error.message,
    });
  }
}