import {
  verify2FAToken,
  generate2FASecret as generateSecretLib,
} from "../middleware/seguridad.js";

import {
  guardarSecreto2FA,
  obtenerSecreto2FA,
  habilitar2FAUsuario,
  listarRoles,
  listarRolesConPermisos,
  crearRol,
  actualizarRol,
  listarPermisos,
  obtenerPermisosRol,
  asignarPermisosRol,
  cambiarEstadoRol,
  listarEmpleados,
  crearEmpleado,
  actualizarEmpleado,
  cambiarEstadoEmpleado,
  listarSesionesUsuario,
  revocarSesionUsuario,
  revocarOtrasSesionesUsuario,
  obtenerEstadoSeguridadUsuario,
} from "../models/security.model.js";

const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/;

// ========================= 2FA =========================

export const setup2FA = async (req, res) => {
  const email = req.user?.correo || req.user?.email;

  if (!email) {
    return res.status(400).json({
      ok: false,
      mensaje: "No se pudo identificar el correo del usuario.",
    });
  }

  const { base32, otpauth_url } = generateSecretLib(email);

  try {
    const user = await guardarSecreto2FA(req.db, {
      email,
      secret: base32,
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado.",
      });
    }

    return res.json({
      ok: true,
      otpauth_url,
    });
  } catch (err) {
    console.error("setup2FA error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error al guardar secreto 2FA.",
      detail: err.message,
    });
  }
};

export const enable2FA = async (req, res) => {
  const { token } = req.body || {};
  const email = req.user?.correo || req.user?.email;

  if (!email) {
    return res.status(400).json({
      ok: false,
      mensaje: "No se pudo identificar el correo del usuario.",
    });
  }

  if (!token) {
    return res.status(400).json({
      ok: false,
      mensaje: "El código OTP es requerido.",
    });
  }

  try {
    const user = await obtenerSecreto2FA(req.db, { email });

    if (!user) {
      return res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado.",
      });
    }

    if (!user.tfa_secret) {
      return res.status(400).json({
        ok: false,
        mensaje: "Primero debes configurar el 2FA escaneando el QR.",
      });
    }

    const verified = verify2FAToken(user.tfa_secret, token);

    if (!verified) {
      return res.status(401).json({
        ok: false,
        success: false,
        mensaje: "Código OTP incorrecto.",
      });
    }

    await habilitar2FAUsuario(req.db, { email });

    return res.json({
      ok: true,
      success: true,
      message: "2FA habilitado correctamente.",
    });
  } catch (err) {
    console.error("enable2FA error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error al procesar 2FA.",
      detail: err.message,
    });
  }
};

// ========================= ROLES =========================

export const listRoles = async (req, res) => {
  try {
    const withPermisos = req.query?.withPermisos === "true";

    const roles = withPermisos
      ? await listarRolesConPermisos(req.db)
      : await listarRoles(req.db);

    return res.json({
      ok: true,
      roles,
    });
  } catch (err) {
    console.error("listRoles error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error al listar roles.",
      detail: err.message,
    });
  }
};

export const createRole = async (req, res) => {
  try {
    const { nombre, descripcion = null, permisos = [] } = req.body || {};

    if (!nombre || String(nombre).trim().length < 2) {
      return res.status(400).json({
        ok: false,
        mensaje: "El nombre del rol es requerido.",
      });
    }

    if (!Array.isArray(permisos)) {
      return res.status(400).json({
        ok: false,
        mensaje: "permisos debe ser un arreglo de slugs.",
      });
    }

    const data = await crearRol(req.db, {
      nombre,
      descripcion,
      permisos,
      usuarioId: req.user?.id ?? null,
    });

    return res.status(201).json({
      ok: true,
      mensaje: "Rol creado correctamente.",
      data,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "Ya existe un rol con ese nombre.",
      });
    }

    if (err.code === "PERMISOS_INVALIDOS") {
      return res.status(400).json({
        ok: false,
        mensaje: err.message,
        faltantes: err.faltantes,
      });
    }

    console.error("createRole error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error creando rol.",
      detail: err.message,
    });
  }
};

export const updateRole = async (req, res) => {
  try {
    const rolId = Number(req.params.rolId);
    const { nombre, descripcion = null } = req.body || {};

    if (!Number.isInteger(rolId)) {
      return res.status(400).json({
        ok: false,
        mensaje: "rolId inválido.",
      });
    }

    if (!nombre || String(nombre).trim().length < 2) {
      return res.status(400).json({
        ok: false,
        mensaje: "El nombre del rol es requerido.",
      });
    }

    const data = await actualizarRol(req.db, rolId, {
      nombre,
      descripcion,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        mensaje: "Rol no encontrado.",
      });
    }

    return res.json({
      ok: true,
      mensaje: "Rol actualizado correctamente.",
      data,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "Ya existe un rol con ese nombre.",
      });
    }

    if (
      String(err.message || "").includes("rol administrativo base") ||
      String(err.message || "").includes("degradar")
    ) {
      return res.status(409).json({
        ok: false,
        mensaje: err.message,
      });
    }

    console.error("updateRole error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error actualizando rol.",
      detail: err.message,
    });
  }
};

// ========================= PERMISOS =========================

export const listPermisos = async (req, res) => {
  try {
    const permisos = await listarPermisos(req.db);

    return res.json({
      ok: true,
      permisos,
    });
  } catch (err) {
    console.error("listPermisos error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error al listar permisos.",
      detail: err.message,
    });
  }
};

export const getPermisosRol = async (req, res) => {
  try {
    const rolId = Number(req.params.rolId);

    if (!Number.isInteger(rolId)) {
      return res.status(400).json({
        ok: false,
        mensaje: "rolId inválido.",
      });
    }

    const permisos = await obtenerPermisosRol(req.db, rolId);

    return res.json({
      ok: true,
      rolId,
      permisos,
    });
  } catch (err) {
    console.error("getPermisosRol error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error al consultar permisos del rol.",
      detail: err.message,
    });
  }
};

export const setPermisosRol = async (req, res) => {
  try {
    const rolId = Number(req.params.rolId);
    const { permisos } = req.body || {};

    if (!Number.isInteger(rolId)) {
      return res.status(400).json({
        ok: false,
        mensaje: "rolId inválido.",
      });
    }

    if (!Array.isArray(permisos)) {
      return res.status(400).json({
        ok: false,
        mensaje: "permisos debe ser un arreglo de slugs.",
      });
    }

    const data = await asignarPermisosRol(req.db, rolId, {
      permisos,
      usuarioId: req.user?.id ?? null,
    });

    return res.json({
      ok: true,
      mensaje: "Permisos actualizados.",
      rolId: data.rolId,
      permisos: data.permisos,
    });
  } catch (err) {
    if (err.code === "ROL_NO_ENCONTRADO") {
      return res.status(404).json({
        ok: false,
        mensaje: err.message,
      });
    }

    if (err.code === "PERMISOS_INVALIDOS") {
      return res.status(400).json({
        ok: false,
        mensaje: err.message,
        faltantes: err.faltantes,
      });
    }

    console.error("setPermisosRol error:", err);
    return res.status(500).json({
      ok: false,
      mensaje: "Error al asignar permisos al rol.",
      detail: err.message,
    });
  }
};

export const updateRoleStatus = async (req, res) => {
  try {
    const rolId = Number(req.params.rolId);
    const { activo } = req.body || {};

    if (!Number.isInteger(rolId)) {
      return res.status(400).json({
        ok: false,
        mensaje: "rolId inválido.",
      });
    }

    if (typeof activo !== "boolean") {
      return res.status(400).json({
        ok: false,
        mensaje: "activo debe ser boolean.",
      });
    }

    const data = await cambiarEstadoRol(req.db, rolId, {
      activo,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        mensaje: "Rol no encontrado.",
      });
    }

    return res.json({
      ok: true,
      mensaje: activo
        ? "Rol activado correctamente."
        : "Rol desactivado correctamente.",
      data,
    });
  } catch (err) {
    console.error("updateRoleStatus error:", err);

    if (err.code === "ROL_NO_ENCONTRADO") {
      return res.status(404).json({
        ok: false,
        mensaje: err.message,
      });
    }

    if (
      err.code === "ROL_PROTEGIDO" ||
      err.code === "ROL_CON_USUARIOS_ACTIVOS"
    ) {
      return res.status(409).json({
        ok: false,
        mensaje: err.message,
        totalUsuariosActivos: err.totalUsuariosActivos,
      });
    }

    return res.status(500).json({
      ok: false,
      mensaje: "No se pudo cambiar el estado del rol.",
      detail: err.message,
    });
  }
};

export async function getEmpleados(req, res) {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const includeInactive = req.query.includeInactive !== "false";

    const data = await listarEmpleados(req.db, {
      q,
      includeInactive,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    console.error("getEmpleados error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error listando empleados",
      detail: err.message,
    });
  }
}

export async function postEmpleado(req, res) {
  try {
    const {
      nombres,
      apellido_paterno,
      apellido_materno = null,
      email,
      rol_id,
      password_temporal,
    } = req.body || {};

    if (!nombres || String(nombres).trim().length < 2) {
      return res.status(400).json({
        ok: false,
        message: "nombres es requerido",
      });
    }

    if (!apellido_paterno || String(apellido_paterno).trim().length < 2) {
      return res.status(400).json({
        ok: false,
        message: "apellido_paterno es requerido",
      });
    }

    if (!email || !String(email).includes("@")) {
      return res.status(400).json({
        ok: false,
        message: "email inválido o requerido",
      });
    }

    if (!rol_id || !Number.isInteger(Number(rol_id))) {
      return res.status(400).json({
        ok: false,
        message: "rol_id es requerido",
      });
    }

    if (!password_temporal || !passwordRegex.test(String(password_temporal))) {
      return res.status(400).json({
        ok: false,
        message:
          "La contraseña temporal debe tener mínimo 8 caracteres, mayúscula, minúscula, número y carácter especial.",
      });
    }

    const data = await crearEmpleado(req.db, {
      nombres,
      apellido_paterno,
      apellido_materno,
      email,
      rol_id: Number(rol_id),
      password_temporal,
      actorId: req.user?.id ?? null,
    });

    return res.status(201).json({
      ok: true,
      message: "Empleado creado correctamente",
      data,
    });
  } catch (err) {
    console.error("postEmpleado error:", err);

    return res.status(err.status || 500).json({
      ok: false,
      message: err.status ? err.message : "Error creando empleado",
      code: err.code,
      detail: err.message,
    });
  }
}

export async function patchEmpleado(req, res) {
  try {
    const usuarioId = String(req.params.usuarioId || "").trim();

    if (!usuarioId) {
      return res.status(400).json({
        ok: false,
        message: "usuarioId requerido",
      });
    }

    const payload = {};

    if (req.body?.nombres !== undefined) {
      payload.nombres = req.body.nombres;
    }

    if (req.body?.apellido_paterno !== undefined) {
      payload.apellido_paterno = req.body.apellido_paterno;
    }

    if (req.body?.apellido_materno !== undefined) {
      payload.apellido_materno = req.body.apellido_materno;
    }

    if (req.body?.email !== undefined) {
      payload.email = req.body.email;
    }

    if (req.body?.rol_id !== undefined) {
      payload.rol_id = Number(req.body.rol_id);
    }

    const data = await actualizarEmpleado(req.db, usuarioId, payload, {
      actorId: req.user?.id ?? null,
    });

    return res.json({
      ok: true,
      message: "Empleado actualizado correctamente",
      data,
    });
  } catch (err) {
    console.error("patchEmpleado error:", err);

    return res.status(err.status || 500).json({
      ok: false,
      message: err.status ? err.message : "Error actualizando empleado",
      code: err.code,
      detail: err.message,
    });
  }
}

export async function patchEmpleadoStatus(req, res) {
  try {
    const usuarioId = String(req.params.usuarioId || "").trim();
    const { activo } = req.body || {};

    if (!usuarioId) {
      return res.status(400).json({
        ok: false,
        message: "usuarioId requerido",
      });
    }

    if (typeof activo !== "boolean") {
      return res.status(400).json({
        ok: false,
        message: "activo debe ser boolean",
      });
    }

    const data = await cambiarEstadoEmpleado(req.db, usuarioId, {
      activo,
      usuarioId: req.user?.id ?? null,
    });

    return res.json({
      ok: true,
      message: activo
        ? "Empleado activado correctamente"
        : "Empleado desactivado correctamente",
      data,
    });
  } catch (err) {
    console.error("patchEmpleadoStatus error:", err);

    return res.status(err.status || 500).json({
      ok: false,
      message: err.status ? err.message : "Error cambiando estado del empleado",
      code: err.code,
      detail: err.message,
    });
  }
}

// ========================= SESIONES DE SEGURIDAD =========================

export async function getMisSesiones(req, res) {
  try {
    const usuarioId = req.user?.id;
    const currentSid = req.user?.sid ?? null;

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        message: "Usuario no autenticado",
      });
    }

    const data = await listarSesionesUsuario(req.db, usuarioId, {
      currentSid,
    });

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getMisSesiones error:", error);

    return res.status(500).json({
      ok: false,
      message: "Error obteniendo sesiones",
      detail: error.message,
    });
  }
}

export async function patchRevocarSesion(req, res) {
  try {
    const usuarioId = req.user?.id;
    const currentSid = req.user?.sid ?? null;
    const sessionId = String(req.params.sessionId || "").trim();

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        message: "Usuario no autenticado",
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        message: "sessionId requerido",
      });
    }

    const data = await revocarSesionUsuario(req.db, sessionId, {
      usuarioId,
      currentSid,
    });

    return res.json({
      ok: true,
      message: "Sesión revocada correctamente",
      data,
    });
  } catch (error) {
    console.error("patchRevocarSesion error:", error);

    return res.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Error revocando sesión",
      code: error.code,
      detail: error.message,
    });
  }
}

export async function patchRevocarOtrasSesiones(req, res) {
  try {
    const usuarioId = req.user?.id;
    const currentSid = req.user?.sid ?? null;

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        message: "Usuario no autenticado",
      });
    }

    const data = await revocarOtrasSesionesUsuario(req.db, {
      usuarioId,
      currentSid,
    });

    return res.json({
      ok: true,
      message: "Sesiones revocadas correctamente",
      data,
    });
  } catch (error) {
    console.error("patchRevocarOtrasSesiones error:", error);

    return res.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Error revocando sesiones",
      code: error.code,
      detail: error.message,
    });
  }
}

export async function getEstadoSeguridad(req, res) {
  try {
    const usuarioId = req.user?.id;

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        message: "Usuario no autenticado",
      });
    }

    const data = await obtenerEstadoSeguridadUsuario(req.db, usuarioId);

    if (!data) {
      return res.status(404).json({
        ok: false,
        message: "Usuario no encontrado",
      });
    }

    return res.json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error("getEstadoSeguridad error:", error);

    return res.status(500).json({
      ok: false,
      message: "Error obteniendo estado de seguridad",
      detail: error.message,
    });
  }
}