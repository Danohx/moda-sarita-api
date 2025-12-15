import { pool } from '#config/db';

export const SuscripcionModel = {
  async init() {
    const sql = `
      CREATE TABLE IF NOT EXISTS suscripciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(sql);
  },

  // Guardar un nuevo correo
  async create(email) {
    const sql = 'INSERT INTO suscripciones (email) VALUES (?)';
    const [result] = await pool.query(sql, [email]);
    return result;
  },

  // Buscar si ya existe
  async findByEmail(email) {
    const sql = 'SELECT * FROM suscripciones WHERE email = ?';
    const [rows] = await pool.query(sql, [email]);
    return rows[0];
  }
};