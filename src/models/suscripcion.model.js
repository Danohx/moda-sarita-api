import { poolPublico } from "../config/db.js";

export const SuscripcionModel = {
  async init() {
    const sql = `
      CREATE TABLE IF NOT EXISTS marketing.suscripciones (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        fecha_registro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `;
    try {
      await poolPublico.query(sql);
    } catch (error) {
      console.log(
        "Nota: Asegúrate de que el esquema 'marketing' exista en tu BD",
      );
    }
  },

  async create(email) {
    const sql = `INSERT INTO marketing.suscripciones (email) VALUES ($1) RETURNING *`;
    const { rows } = await poolPublico.query(sql, [email]);
    return rows[0];
  },

  async findByEmail(email) {
    const sql = `SELECT * FROM marketing.suscripciones WHERE email = $1`;
    const { rows } = await poolPublico.query(sql, [email]);
    return rows[0] || null;
  },

  async findAll() {
    const sql = `SELECT email FROM marketing.suscripciones`;
    const { rows } = await poolPublico.query(sql);
    return rows;
  },
};
