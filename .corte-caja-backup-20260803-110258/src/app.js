import express from "express";
import cors from "cors";

// RUTAS
import authRoutes from "./routes/auth.routes.js";
import securityRoutes from "./routes/security.routes.js";
import suscripcionRoutes from "./routes/suscripcion.routes.js";
import categoriasRoutes from "./routes/categorias.routes.js";
import tallasRoutes from "./routes/tallas.routes.js";
import coloresRoutes from "./routes/colores.routes.js";
import variantesRoutes from "./routes/variantes.routes.js";
import productosRoutes from "./routes/productos.routes.js";
import inventarioRoutes from "./routes/inventario.routes.js";
import proveedoresRoutes from "./routes/proveedores.routes.js";
import clientesRoutes from "./routes/clientes.routes.js";
import cuentaRoutes from "./routes/cuenta.routes.js";
import checkoutRoutes from "./routes/checkout.routes.js";
import cuponesRoutes from "./routes/cupones.routes.js";
import ventasRoutes from "./routes/ventas.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import monitoringRoutes from "./routes/monitoring.routes.js";
// import backupsRoutes from "./routes/backups.routes.js";
import maintenanceRoutes from "./routes/maintenance.routes.js";
import auditLogsRoutes from "./routes/auditLogs.routes.js";
import pedidosRoutes from "./routes/pedidos.routes.js";
import configuracionRoutes from "./routes/configuracion.routes.js";
import reportesRoutes from "./routes/reportes.routes.js";
import contenidoRoutes from "./routes/contenido.routes.js";
import contactoRoutes from "./routes/contacto.routes.js";
import marketingRoutes from "./routes/marketing.routes.js";
import alexaOAuthRoutes from "./routes/alexaOAuth.routes.js";
import tiendaRoutes from "./routes/tienda.routes.js";
import creditoRoutes from "./routes/credito.routes.js";
import creditoCronRoutes from "./routes/creditoCron.routes.js";

const app = express();

app.set("trust proxy", 1);

const whitelist = [
  "http://localhost:3000",
  "https://moda-sarita-api.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "https://moda-sarita.com",
  "https://www.moda-sarita.com",
  "https://moda-sarita-admin.pages.dev",
];

app.use(express.json());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (whitelist.includes(origin)) callback(null, true);
      else
        callback(new Error("Bloqueado por CORS: Tu origen no tiene permiso."));
    },
    credentials: true,
  }),
);

// Health
app.get("/", (req, res) => res.send("API Moda Sarita v1.0.0 âœ…"));

// âœ… Montaje de rutas
app.use("/api/auth", authRoutes);
app.use("/api/security", securityRoutes);
app.use("/api/suscripcion", suscripcionRoutes);
app.use("/api/categorias", categoriasRoutes);
app.use("/api/tallas", tallasRoutes);
app.use("/api/colores", coloresRoutes);
app.use("/api/variantes", variantesRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/inventario", inventarioRoutes);
app.use("/api/proveedores", proveedoresRoutes);
app.use("/api/clientes", clientesRoutes);
app.use("/api/cuenta", cuentaRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/cupones", cuponesRoutes);
app.use("/api/ventas", ventasRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/monitoring", monitoringRoutes);
// app.use("/api/backups", backupsRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/audit-logs", auditLogsRoutes);
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/configuracion", configuracionRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/contenido", contenidoRoutes);
app.use("/api/contacto", contactoRoutes);
app.use("/api/marketing", marketingRoutes);
app.use("/api/alexa/oauth", alexaOAuthRoutes);
app.use("/api/tienda", tiendaRoutes);
app.use("/api/creditos", creditoRoutes);
app.use("/api/cron/creditos", creditoCronRoutes);

export default app;

