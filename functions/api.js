import serverless from 'serverless-http';
import appModule from '../src/app.js';
import { SuscripcionModel } from '../src/models/suscripcion.model.js';
import 'dotenv/config';

// 🔥 ESTA LÍNEA ES LA CLAVE
const app = appModule?.default ?? appModule;

try {
  SuscripcionModel.init().catch(() => {
    console.log("⚠️ La BD conectará en la primera petición...");
  });
} catch (e) {
  console.log("Error inicializando contexto de BD");
}

export const handler = serverless(app);
