// src/models/suscripcion.model.js
import { poolPublico } from "../config/db.js";

export async function createSuscripcion(email) {
  const sql = `INSERT INTO marketing.suscripciones (email) VALUES ($1) RETURNING *`;
  const { rows } = await poolPublico.query(sql, [email]);
  return rows[0];
}

export async function findSuscripcionByEmail(email) {
  const sql = `SELECT * FROM marketing.suscripciones WHERE email = $1`;
  const { rows } = await poolPublico.query(sql, [email]);
  return rows[0] || null;
}

export async function listAllSuscripciones() {
  const sql = `SELECT email FROM marketing.suscripciones`;
  const { rows } = await poolPublico.query(sql);
  return rows;
}