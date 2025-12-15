import mysql from 'mysql2/promise';
import 'dotenv/config';

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 4000,
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Prueba rápida de conexión
pool.getConnection()
  .then(connection => {
    pool.releaseConnection(connection);
    console.log('✅ Conectado a TiDB exitosamente');
  })
  .catch(err => {
    console.error('❌ Error conectando a TiDB:', err);
  });