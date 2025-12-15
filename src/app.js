import express from 'express';
import cors from 'cors';
import suscripcionRoutes from './routes/suscripcion.routes.js';

const app = express();

const whitelist = [
  'http://localhost:5173',
  'https://moda-sarita.com',
  'https://www.moda-sarita.com',
  'https://moda-sarita-api.netlify.app'
];

// --- 1. Configuraciones (Middlewares) ---
app.use(express.json());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado por CORS: Tu origen no tiene permiso.'));
    }
  }
}));

// --- 2. Rutas ---
app.get('/', (req, res) => res.send('API Moda Sarita v0.1.0 👗'));
app.use('/api/suscripcion', suscripcionRoutes);

// --- 3. Exportar (NO escuchar) ---
export default app;