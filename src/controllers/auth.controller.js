import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool } from "../config/db.js";
import {
  generateAccessToken,
  generateRefreshToken,
  generateTempToken,
  verifyTempToken,
  verify2FAToken,
  verifyRefreshToken,
  hashToken,
} from "../middleware/seguridad.js";

const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/;

function getIp(req) {
  const ip = req.headers["cf-connecting-ip"] || req.ip || "127.0.0.1";
  return String(ip).replace("::1", "127.0.0.1");
}

function mailTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

// ========================= REGISTER =========================
export const register = async (req, res) => {
  const { nombre, apellidoPaterno, apellidoMaterno, correo, contrasena } = req.body;

  if (!nombre || !apellidoPaterno || !correo || !contrasena) {
    return res.status(400).json({
      mensaje: "Nombre, Apellido Paterno, Correo y Contraseña son requeridos.",
    });
  }

  if (!passwordRegex.test(contrasena)) {
    return res.status(400).json({
      mensaje:
        "La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula, un número y un carácter especial.",
    });
  }

  try {
    const email = correo.toLowerCase();

    const { rows: exists } = await pool.query(
      "SELECT id FROM seguridad.usuarios WHERE email = $1",
      [email]
    );

    if (exists.length > 0) 
      return res.status(409).json({ mensaje: "El correo ya está registrado." });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(contrasena, salt);

    const { rows } = await pool.query(
      `INSERT INTO seguridad.usuarios
        (email, password_hash, nombres, apellido_paterno, apellido_materno, tfa_enabled)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING id`,
      [email, passwordHash, nombre, apellidoPaterno, apellidoMaterno || null]
    );

    return res.status(201).json({
      mensaje: "Usuario registrado exitosamente.",
      userId: rows[0].id,
    });
  } catch (e) {
    console.error("Error en el registro:", e);
    return res.status(500).json({ mensaje: "Error interno del servidor." });
  }
};

// ========================= LOGIN =========================
export const login = async (req, res) => {
  const { correo, contrasena } = req.body;

  if (!correo || !contrasena) {
    return res.status(400).json({ mensaje: "Correo y contraseña son requeridos." });
  }

  try {
    const email = correo.toLowerCase();

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, tfa_secret, tfa_enabled
       FROM seguridad.usuarios
       WHERE email = $1`,
      [email]
    );

    if (rows.length === 0) 
      return res.status(401).json({ mensaje: "Credenciales inválidas." });

    const user = rows[0];

    const ok = await bcrypt.compare(contrasena, user.password_hash);
    if (!ok) 
      return res.status(401).json({ mensaje: "Credenciales inválidas." });

    if (user.tfa_enabled) {
      const tempToken = generateTempToken({ userId: user.id, correo: user.email });
      return res.json({
        requires2FA: true,
        tempToken,
        mensaje: "Credenciales válidas. Se requiere 2FA.",
      });
    }

    const sid = crypto.randomUUID();
    const refreshToken = generateRefreshToken({ userId: user.id, sid });
    const refreshHash = hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const userAgent = req.headers["user-agent"] || "Unknown";
    const ip = getIp(req);

    await pool.query(
      `INSERT INTO seguridad.user_sessions
        (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5::inet, $6)`,
      [sid, user.id, refreshHash, userAgent, ip, expiresAt]
    );

    const accessToken = generateAccessToken({
      userId: user.id,
      correo: user.email,
      sid,
      tfa: false,
    });

    return res.json({
      requires2FA: false,
      accessToken,
      refreshToken,
      user: { correo: user.email, tfaEnabled: false },
      mensaje: "Inicio de sesión exitoso.",
    });
  } catch (e) {
    console.error("Error en el login:", e);
    return res.status(500).json({ mensaje: "Error interno del servidor." });
  }
};

// ========================= 2FA VERIFY (LOGIN) =========================
export const verifyLogin2FA = async (req, res) => {
  const { tempToken, otpCode } = req.body;
  if (!tempToken || !otpCode) 
    return res.status(400).json({ mensaje: "Faltan datos." });

  try {
    const decoded = verifyTempToken(tempToken);
    const userId = decoded.sub;
    const correo = decoded.correo;

    const { rows } = await pool.query(
      `SELECT id, email, tfa_secret, tfa_enabled
       FROM seguridad.usuarios
       WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) 
      return res.status(404).json({ mensaje: "Usuario no encontrado." });

    const user = rows[0];
    if (!user.tfa_enabled) 
      return res.status(400).json({ mensaje: "2FA no está habilitado." });

    const valid = verify2FAToken(user.tfa_secret, otpCode);
    if (!valid) 
      return res.status(401).json({ success: false, mensaje: "Código 2FA inválido." });

    const sid = crypto.randomUUID();
    const refreshToken = generateRefreshToken({ userId, sid });
    const refreshHash = hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const userAgent = req.headers["user-agent"] || "Unknown";
    const ip = getIp(req);

    await pool.query(
      `INSERT INTO seguridad.user_sessions
        (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5::inet, $6)`,
      [sid, userId, refreshHash, userAgent, ip, expiresAt]
    );

    const accessToken = generateAccessToken({ userId, correo, sid, tfa: true });

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { correo, tfaEnabled: true },
      mensaje: "Inicio de sesión 2FA exitoso.",
    });
  } catch (e) {
    console.error("Error al verificar 2FA:", e);
    return res.status(401).json({ mensaje: "Error al verificar 2FA." });
  }
};

// ========================= MAGIC LINK =========================
export const sendMagicLink = async (req, res) => {
  const { correo } = req.body;
  if (!correo) 
    return res.status(400).json({ mensaje: "Debes ingresar un correo." });

  try {
    const email = correo.toLowerCase();

    const { rows } = await pool.query("SELECT id FROM seguridad.usuarios WHERE email = $1", [email]);
    if (rows.length === 0) 
      return res.status(404).json({ mensaje: "Usuario no encontrado." });

    const token = jwt.sign({ correo: email }, process.env.JWT_SECRET, { expiresIn: "5m" });
    const enlace = `${process.env.FRONTEND_URL}/magic-verify/${token}`;

    const transporter = mailTransporter();
    await transporter.sendMail({
      from: `Moda Sarita <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🛍️ Tu acceso directo a Moda Sarita",
      html: `
      <div style="font-family: 'Manrope', Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 16px; overflow: hidden;">
        <div style="background-color: #f8f6f7; padding: 30px; text-align: center;">
          <h1 style="color: #221019; margin: 0; font-size: 24px;">Bienvenida de nuevo a</h1>
          <h2 style="color: #ec1380; margin: 5px 0 0; font-size: 36px; font-weight: 800;">Moda Sarita</h2>
        </div>

        <div style="padding: 30px 40px; background-color: #ffffff;">
          <p style="font-size: 18px; color: #221019; margin-top: 0;">Hola,</p>
          
          <p style="font-size: 18px; color: #333; line-height: 1.6;">
            Tu acceso exclusivo está listo. Haz clic en el botón de abajo para ingresar de forma segura a tu cuenta.
          </p>
          
          <div style="text-align: center; margin: 40px 0;">
            <a href="${enlace}" 
              style="background-color: #ec1380; 
                      color: #ffffff; 
                      padding: 18px 35px; 
                      text-decoration: none; 
                      border-radius: 12px; 
                      font-weight: 700; 
                      font-size: 18px;
                      display: inline-block;">
              Iniciar sesión
            </a>
          </div>
          
          <p style="font-size: 16px; color: #555; line-height: 1.6;">
            <strong>⚠️ Importante:</strong> Este enlace es personal e intransferible.
            <br>
            Por seguridad, caduca en <strong>5 minutos</strong>.
          </p>
        </div>

        <div style="background-color: #f8f6f7; padding: 25px; border-top: 1px solid #eee;">
          <p style="font-size: 12px; color: #888; margin: 0; text-align: center;">
            Si no solicitaste este acceso, por favor ignora este mensaje.
          </p>
        </div>
      </div>
      `,
    });

    return res.json({ mensaje: "¡Enlace mágico enviado! Revisa tu correo." });
  } catch (e) {
    console.error("Error magic link:", e);
    return res.status(500).json({ mensaje: "Error al enviar el enlace mágico." });
  }
};

export const verifyMagicLink = async (req, res) => {
  const { token } = req.body;
  if (!token) 
    return res.status(400).json({ mensaje: "Token no proporcionado" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const email = decoded.correo;

    const { rows } = await pool.query(
      "SELECT id, email, tfa_enabled FROM seguridad.usuarios WHERE email = $1",
      [email.toLowerCase()]
    );

    if (rows.length === 0) 
      return res.status(404).json({ mensaje: "Usuario no encontrado." });

    const user = rows[0];

    if (user.tfa_enabled) {
      const tempToken = generateTempToken({ userId: user.id, correo: user.email });
      return res.json({ requires2FA: true, tempToken, mensaje: "Enlace verificado. Se requiere 2FA." });
    }

    const sid = crypto.randomUUID();
    const refreshToken = generateRefreshToken({ userId: user.id, sid });
    const refreshHash = hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO seguridad.user_sessions
        (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5::inet, $6)`,
      [sid, user.id, refreshHash, req.headers["user-agent"] || "Unknown", getIp(req), expiresAt]
    );

    const accessToken = generateAccessToken({ userId: user.id, correo: user.email, sid, tfa: false });

    return res.json({
      requires2FA: false,
      accessToken,
      refreshToken,
      user: { correo: user.email, tfaEnabled: false },
      mensaje: "Inicio de sesión exitoso.",
    });
  } catch (e) {
    return res.status(401).json({ mensaje: "Enlace inválido o expirado." });
  }
};

// ========================= PASSWORD RESET =========================
export const requestPasswordReset = async (req, res) => {
  const { correo } = req.body;
  if (!correo) 
    return res.status(400).json({ mensaje: "Correo requerido." });

  const generic = { mensaje: "Si el correo está registrado, recibirás un enlace de recuperación." };

  try {
    const email = correo.toLowerCase();

    const { rows } = await pool.query("SELECT id FROM seguridad.usuarios WHERE email = $1", [email]);
    if (rows.length === 0) 
      return res.json(generic);

    const token = crypto.randomBytes(32).toString("hex");
    const expireDate = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      "UPDATE seguridad.usuarios SET reset_token = $1, reset_expires = $2 WHERE email = $3",
      [token, expireDate, email]
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const transporter = mailTransporter();

    await transporter.sendMail({
      from: `Moda Sarita <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "🔑 Restablecer tu contraseña - Moda Sarita",
      html: `
      <div style="font-family: 'Manrope', Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 16px; overflow: hidden;">
        <div style="background-color: #f8f6f7; padding: 30px; text-align: center;">
          <h1 style="color: #221019; margin: 0; font-size: 24px;">Solicitud de cambio de</h1>
          <h2 style="color: #ec1380; margin: 5px 0 0; font-size: 36px; font-weight: 800;">Contraseña</h2>
        </div>

        <div style="padding: 30px 40px; background-color: #ffffff;">
          <p style="font-size: 18px; color: #221019; margin-top: 0;">Hola,</p>
          
          <p style="font-size: 18px; color: #333; line-height: 1.6;">
            Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en <strong>Moda Sarita</strong>.
            <br><br>
            Si fuiste tú, haz clic en el botón de abajo para crear una nueva contraseña segura.
          </p>
          
          <div style="text-align: center; margin: 40px 0;">
            <a href="${resetLink}" 
              style="background-color: #ec1380; 
                      color: #ffffff; 
                      padding: 18px 35px; 
                      text-decoration: none; 
                      border-radius: 12px; 
                      font-weight: 700; 
                      font-size: 18px;
                      display: inline-block;">
              Cambiar Contraseña
            </a>
          </div>
          
          <p style="font-size: 16px; color: #555; line-height: 1.6;">
            <strong>⚠️ Seguridad:</strong> Este enlace expira en <strong>1 hora</strong>.
            <br>
            Si no realizaste esta solicitud, tu cuenta sigue segura y no necesitas hacer nada.
          </p>
        </div>

        <div style="background-color: #f8f6f7; padding: 25px; border-top: 1px solid #eee;">
          <p style="font-size: 12px; color: #888; margin: 0; text-align: center;">
            Enviado automáticamente por el sistema de seguridad de Moda Sarita.
          </p>
        </div>
      </div>
      `,
    });

    return res.json(generic);
  } catch (e) {
    console.error("Error forgot password:", e);
    return res.status(500).json({ mensaje: "Error interno." });
  }
};

export const resetPassword = async (req, res) => {
  const { token, nuevaContrasena } = req.body;
  if (!token || !nuevaContrasena) return res.status(400).json({ mensaje: "Faltan datos." });

  if (!passwordRegex.test(nuevaContrasena)) {
    return res.status(400).json({ mensaje: "La contraseña no cumple con los requisitos de seguridad." });
  }

  try {
    const { rows } = await pool.query(
      "SELECT id FROM seguridad.usuarios WHERE reset_token = $1 AND reset_expires > now()",
      [token]
    );

    if (rows.length === 0) 
      return res.status(400).json({ mensaje: "Enlace inválido o expirado." });

    const userId = rows[0].id;

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(nuevaContrasena, salt);

    await pool.query(
      "UPDATE seguridad.usuarios SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2",
      [newHash, userId]
    );

    // revoca sesiones por seguridad
    await pool.query("UPDATE seguridad.user_sessions SET revoked_at = now() WHERE user_id = $1", [userId]);

    return res.json({ mensaje: "Contraseña actualizada exitosamente. Ya puedes iniciar sesión." });
  } catch (e) {
    console.error("Error reset password:", e);
    return res.status(500).json({ mensaje: "Error al actualizar contraseña." });
  }
};

// ========================= REFRESH TOKEN =========================
export const refreshSession = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) 
    return res.status(401).json({ mensaje: "Token requerido" });

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const sid = decoded.sid;
    const userId = decoded.sub;

    const refreshHash = hashToken(refreshToken);

    const { rows: sessions } = await pool.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM seguridad.user_sessions
       WHERE id = $1 AND refresh_token_hash = $2`,
      [sid, refreshHash]
    );

    if (sessions.length === 0) 
      return res.status(403).json({ mensaje: "Sesión inválida o revocada." });

    const s = sessions[0];
    if (s.revoked_at) 
      return res.status(403).json({ mensaje: "Sesión revocada." });
    if (new Date(s.expires_at) <= new Date()) 
      return res.status(403).json({ mensaje: "Sesión expirada." });

    const { rows: users } = await pool.query(
      "SELECT id, email, tfa_enabled FROM seguridad.usuarios WHERE id = $1",
      [userId]
    );
    if (users.length === 0) 
      return res.status(403).json({ mensaje: "Usuario no existe" });

    const u = users[0];
    const accessToken = generateAccessToken({
      userId: u.id,
      correo: u.email,
      sid,
      tfa: !!u.tfa_enabled,
    });

    return res.json({ accessToken });
  } catch (e) {
    return res.status(403).json({ mensaje: "Token inválido o expirado" });
  }
};

// ========================= LOGOUT =========================
export const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) 
    return res.sendStatus(204);

  try {
    const decoded = verifyRefreshToken(refreshToken);
    await pool.query("UPDATE seguridad.user_sessions SET revoked_at = now() WHERE id = $1", [decoded.sid]);
  } catch (_) {}

  return res.sendStatus(204);
};

// ========================= REVOKE ALL =========================
export const revokeAllSessions = async (req, res) => {
  const userId = req.user.id;

  try {
    await pool.query("UPDATE seguridad.user_sessions SET revoked_at = now() WHERE user_id = $1", [userId]);
    return res.json({ mensaje: "Se han cerrado todas las sesiones en todos los dispositivos." });
  } catch (e) {
    console.error("Error revoke all:", e);
    return res.status(500).json({ mensaje: "Error al revocar sesiones." });
  }
};

export const verifySession = (req, res) => {
  return res.json({ ok: true, user: req.user });
};
