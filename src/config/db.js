// src/config/db.js
import pg from "pg";
import dotenv from "dotenv";

const { Pool } = pg;
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

function makePool(urlEnvName) {
  const connectionString = process.env[urlEnvName];
  if (!connectionString) {
    console.error(`❌ ERROR CRÍTICO: ${urlEnvName} no está definida.`);
  }

  return new Pool({
    connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    idleTimeoutMillis: 120000,
  });
}

export const poolInterno = makePool("DATABASE_URL_INTERNA");
export const poolPublico = makePool("DATABASE_URL_PUBLICA");

if (isProduction) {
  console.log("🚀 Modo Producción: Conectando a PostgreSQL (SSL Activado).");
} else {
  console.log("🏠 Modo Desarrollo: Conectando a PostgreSQL local.");
}

export async function verificarConexionesBD() {
  const testPool = async (pool, name) => {
    try {
      const client = await pool.connect();
      console.log(`✅ Conexión exitosa a PostgreSQL (${name})`);
      client.release();
    } catch (err) {
      console.error(
        `❌ Error conectando a la Base de Datos (${name}): ${err.message}`,
      );
    }
  };

  await testPool(poolInterno, "INTERNO");
  await testPool(poolPublico, "PUBLICO");
}
