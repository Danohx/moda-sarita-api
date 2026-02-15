import pg from 'pg';
import dotenv from "dotenv";

const { Pool } = pg;
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const connectionConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
};

export const pool = new Pool(connectionConfig);

// Eliminar antes de mandar a producción
if (isProduction) {
  console.log("🚀 Modo Producción: Conectando a PostgreSQL (SSL Activado).");
  if (!process.env.DATABASE_URL) {
    console.error("❌ ERROR CRÍTICO: DATABASE_URL no está definida.");
  }
} else {
  console.log("🏠 Modo Desarrollo: Conectando a PostgreSQL local.");
}
// =========================== //
pool.connect()
  .then(client => {
    // Eliminar comentarios
    console.log(`✅ Conexión exitosa a PostgreSQL (${isProduction ? 'Nube' : 'Local'})`);
    client.release();
  })
  .catch(err => {
    // Eliminar primer comentario
    console.error('❌ Error conectando a la Base de Datos:');
    console.error(err.message);
  });