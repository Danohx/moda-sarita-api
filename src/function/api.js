import serverless from 'serverless-http';
import app from '#src/app'; 
import { SuscripcionModel } from '#models/suscripcion.model';
import 'dotenv/config';

try {
  SuscripcionModel.init().then(() => {
    console.log("✅ Conexión a BD inicializada para Netlify");
  }).catch(err => {
    console.log("⚠️ La BD conectará en la primera petición...");
  });
} catch (e) {
  console.log("Error inicializando contexto de BD");
}

export const handler = serverless(app);