import jwt from "jsonwebtoken";
import crypto from "crypto";
import speakeasy from "speakeasy";
import { pool } from "../config/db.js";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateAccessToken({ userId, correo, sid, tfa }) {
  return jwt.sign(
    { sub: userId, correo, sid, tfa: !!tfa },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

export function generateRefreshToken({ userId, sid }) {
  return jwt.sign(
    { sub: userId, sid },
    process.env.REFRESH_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.REFRESH_SECRET);
}

export function generateTempToken({ userId, correo }) {
  return jwt.sign(
    { sub: userId, correo, tfa_pending: true },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
}

export function verifyTempToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!decoded.tfa_pending) throw new Error("Token no válido para 2FA");
  return decoded;
}

export function generate2FASecret(email) {
  const secret = speakeasy.generateSecret({ name: `ModaSarita (${email})` });
  return { base32: secret.base32, otpauth_url: secret.otpauth_url };
}

export function verify2FAToken(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });
}

export const authenticateJWT = async (req, res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) 
    return res.status(401).json({ mensaje: "No autenticado" });

  try {
    const token = h.split(" ")[1];
    const payload = verifyAccessToken(token);

    if (!payload?.sub) 
      return res.status(401).json({ mensaje: "Token inválido (sin sub)" });

    const sid = payload.sid;
    if (!sid) 
      return res.status(401).json({ mensaje: "Sesión inválida (sin sid)" });

    let rows;
    try {
      const r = await pool.query(
        `select id, user_id, expires_at, revoked_at
         from seguridad.user_sessions
         where id = $1`,
        [sid]
      );
      rows = r.rows;
    } catch (dbErr) {
      console.error("DB error en authenticateJWT:", dbErr);
      return res.status(500).json({ mensaje: "Error verificando sesión." });
    }

    if (rows.length === 0) 
      return res.status(401).json({ mensaje: "Sesión no existe" });

    const s = rows[0];
    if (s.revoked_at) 
      return res.status(401).json({ mensaje: "Sesión revocada" });
    if (new Date(s.expires_at) <= new Date()) 
      return res.status(401).json({ mensaje: "Sesión expirada" });

    req.user = { id: payload.sub, correo: payload.correo, sid: payload.sid, tfa: payload.tfa };
    next();
  } catch (e) {
    return res.status(403).json({ mensaje: "Token inválido o expirado" });
  }
};
