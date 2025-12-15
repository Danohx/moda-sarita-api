import serverless from 'serverless-http';
import app from '../src/app.js';
import { SuscripcionModel } from '../src/models/suscripcion.model.js';
import 'dotenv/config';

try {
  SuscripcionModel.init().catch(() => {
    console.log("⚠️ La BD conectará en la primera petición...");
  });
} catch (e) {
  console.log("Error inicializando contexto de BD");
}

export const handler = serverless(app);
