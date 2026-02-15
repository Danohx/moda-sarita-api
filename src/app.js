import express from "express";
import cors from "cors";

// RUTAS
import authRoutes from "./routes/auth.routes.js";
import securityRoutes from "./routes/security.routes.js";
import suscripcionRoutes from "./routes/suscripcion.routes.js";

const app = express();

app.set("trust proxy", 1);

const whitelist = [
  "http://localhost:5173",
  "https://moda-sarita.com",
  "https://www.moda-sarita.com",
];

app.use(express.json());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (whitelist.includes(origin))
        callback(null, true);
      else
        callback(new Error("Bloqueado por CORS: Tu origen no tiene permiso."));
    },
  })
);

// Health
app.get("/", (req, res) => res.send("API Moda Sarita v1.0.0 ✅"));

// ✅ Montaje de rutas
app.use("/api/auth", authRoutes);
app.use("/api/security", securityRoutes);
app.use("/api/suscripcion", suscripcionRoutes);

export default app;