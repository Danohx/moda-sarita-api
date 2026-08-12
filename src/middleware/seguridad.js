import jwt from "jsonwebtoken";
import crypto from "crypto";
import speakeasy from "speakeasy";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateAccessToken(payload) {
  const expiresIn =
    Number.isInteger(payload.expiresInSeconds) &&
    payload.expiresInSeconds >= 300
      ? payload.expiresInSeconds
      : "15m";

  return jwt.sign(
    {
      sub: payload.userId,
      correo: payload.correo,
      sid: payload.sid,
      tfa: !!payload.tfa,
    },
    process.env.JWT_SECRET,
    { expiresIn },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

export function generateRefreshToken({ userId, sid }) {
  return jwt.sign({ sub: userId, sid }, process.env.REFRESH_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.REFRESH_SECRET);
}

export function generateTempToken({ userId, correo }) {
  return jwt.sign(
    { sub: userId, correo, tfa_pending: true },
    process.env.JWT_SECRET,
    { expiresIn: "5m" },
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

export async function requireAuth(req, res, next) {
  if (!req.db)
    return res
      .status(500)
      .json({ message: "DB context no configurado (req.db)" });

  try {
    const token =
      req.cookies?.access_token ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);

    if (!token) return res.status(401).json({ message: "No autenticado" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const userId = payload.sub;
    const sid = payload.sid;

    if (!userId)
      return res.status(401).json({ message: "Token inválido (sin sub)" });

    if (!sid)
      return res.status(401).json({ message: "Sesión inválida (sin sid)" });

    const sRes = await req.db.query(
      `SELECT id, expires_at, revoked_at
      FROM seguridad.user_sessions
      WHERE id = $1 AND user_id = $2`,
      [sid, userId],
    );

    if (sRes.rows.length === 0)
      return res.status(401).json({ message: "Sesión no existe" });

    const s = sRes.rows[0];
    if (s.revoked_at)
      return res.status(401).json({ message: "Sesión revocada" });

    if (new Date(s.expires_at) <= new Date())
      return res.status(401).json({ message: "Sesión expirada" });

    const { rows } = await req.db.query(
      `
      SELECT
        u.id as user_id,
        u.email,
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno,
        r.nombre as rol,
        array_remove(array_agg(ppr.permiso_slug), null) AS permisos
      FROM seguridad.usuarios u
      LEFT JOIN seguridad.roles_sistema r ON r.id = u.rol_id
      LEFT JOIN seguridad.permisos_por_rol ppr ON ppr.rol_id = r.id
      WHERE u.id = $1 AND u.activo = TRUE
      GROUP BY u.id, u.email, u.nombres, u.apellido_paterno, u.apellido_materno, r.nombre
      `,
      [userId],
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Usuario no existe o inactivo" });
    }

    const u = rows[0];
    req.user = {
      id: u.user_id,
      email: u.email,
      nombre: `${u.nombres} ${u.apellido_paterno}${u.apellido_materno ? " " + u.apellido_materno : ""}`,
      rol: u.rol || "SIN_ROL",
      permisos: u.permisos || [],
      sid,
      tfa: !!payload.tfa,
    };

    return next();
  } catch (err) {
    return res
      .status(401)
      .json({ message: "No autenticado", detail: err?.message });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "No autenticado" });
    if (!roles.includes(req.user.rol))
      return res.status(403).json({ message: "No autorizado (rol)" });
    next();
  };
}

export function requirePermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "No autenticado" });

    const userPerms = new Set(req.user.permisos || []);
    const ok = perms.every((p) => userPerms.has(p));

    if (!ok) {
      return res.status(403).json({
        message: "No autorizado (permiso)",
        required: perms,
        rol: req.user.rol,
      });
    }
    next();
  };
}

export function requireAnyPermission(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "No autenticado" });

    const userPerms = new Set(req.user.permisos || []);
    const ok = perms.some((p) => userPerms.has(p));

    if (!ok) {
      return res.status(403).json({
        message: "No autorizado (permiso)",
        requiredAny: perms,
        rol: req.user.rol,
      });
    }
    next();
  };
}


