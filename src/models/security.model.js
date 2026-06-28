import bcrypt from "bcryptjs";

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeRoleName(nombre) {
  return String(nombre || "")
    .trim()
    .toUpperCase();
}

function uniquePermissions(permisos = []) {
  return [
    ...new Set(permisos.map((p) => String(p || "").trim()).filter(Boolean)),
  ];
}

async function setAuditUser(client, usuarioId) {
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [
    usuarioId || "",
  ]);
}

function appError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function isAdminRoleName(nombre) {
  return ["ADMIN", "ADMINISTRADOR", "SUPERADMIN"].includes(
    String(nombre || "")
      .trim()
      .toUpperCase(),
  );
}

async function insertarAuditLog(
  client,
  { modulo, accion, descripcion, usuarioId = null, metadata = {} },
) {
  await client.query(
    `
    INSERT INTO monitoreo.audit_logs
      (modulo, accion, descripcion, usuario_id, metadata)
    VALUES
      ($1, $2, $3, $4, $5::jsonb)
    `,
    [modulo, accion, descripcion, usuarioId, JSON.stringify(metadata)],
  );
}

async function obtenerEmpleadoAdminPorId(client, empleadoId) {
  const { rows } = await client.query(
    `
    SELECT
      id,
      nombres,
      apellido_paterno,
      apellido_materno,
      nombre_completo,
      email,
      rol_id,
      rol_nombre,
      activo,
      tfa_enabled,
      fecha_creacion,
      ultima_sesion
    FROM seguridad.v_usuarios_admin_resumen
    WHERE id = $1
    `,
    [empleadoId],
  );

  return rows[0] || null;
}

async function contarAdminsActivosExcluyendo(client, empleadoId) {
  const { rows } = await client.query(
    `
    SELECT COUNT(*)::integer AS total
    FROM seguridad.usuarios u
    JOIN seguridad.roles_sistema r
      ON r.id = u.rol_id
    WHERE COALESCE(u.activo, true) = true
      AND u.id <> $1
      AND UPPER(r.nombre) IN ('ADMIN', 'ADMINISTRADOR', 'SUPERADMIN')
    `,
    [empleadoId],
  );

  return Number(rows[0]?.total || 0);
}

// ========================= 2FA =========================

export async function guardarSecreto2FA(db, { email, secret }) {
  const cleanEmail = normalizeEmail(email);

  const { rows } = await db.query(
    `
    UPDATE seguridad.usuarios
    SET tfa_secret = $1,
        tfa_enabled = false
    WHERE email = $2
    RETURNING id, email
    `,
    [secret, cleanEmail],
  );

  return rows[0] || null;
}

export async function obtenerSecreto2FA(db, { email }) {
  const cleanEmail = normalizeEmail(email);

  const { rows } = await db.query(
    `
    SELECT id, email, tfa_secret, tfa_enabled
    FROM seguridad.usuarios
    WHERE email = $1
    `,
    [cleanEmail],
  );

  return rows[0] || null;
}

export async function habilitar2FAUsuario(db, { email }) {
  const cleanEmail = normalizeEmail(email);

  const { rows } = await db.query(
    `
    UPDATE seguridad.usuarios
    SET tfa_enabled = true
    WHERE email = $1
    RETURNING id, email, tfa_enabled
    `,
    [cleanEmail],
  );

  return rows[0] || null;
}

// ========================= ROLES =========================

export async function listarRoles(db) {
  const { rows } = await db.query(
    `
    SELECT
      id,
      nombre,
      descripcion,
      COALESCE(activo, true) AS activo
    FROM seguridad.roles_sistema
    ORDER BY id ASC
    `,
  );

  return rows;
}

export async function listarRolesConPermisos(db) {
  const { rows } = await db.query(
    `
    SELECT
      id,
      nombre,
      descripcion,
      activo,
      permisos,
      total_permisos,
      total_usuarios,
      usuarios_activos
    FROM seguridad.v_roles_permisos_resumen
    ORDER BY id ASC
    `,
  );

  return rows;
}

export async function crearRol(
  db,
  { nombre, descripcion = null, permisos = [], usuarioId = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    const nombreRol = normalizeRoleName(nombre);
    const permisosUnicos = uniquePermissions(permisos);

    const { rows } = await client.query(
      `
      INSERT INTO seguridad.roles_sistema
        (nombre, descripcion)
      VALUES
        ($1, $2)
      RETURNING
        id,
        nombre,
        descripcion
      `,
      [nombreRol, descripcion],
    );

    const rol = rows[0];

    if (permisosUnicos.length > 0) {
      const { rows: permisosExistentesRows } = await client.query(
        `
        SELECT slug
        FROM seguridad.catalogo_permisos
        WHERE slug = ANY($1::varchar[])
        `,
        [permisosUnicos],
      );

      const permisosExistentes = new Set(
        permisosExistentesRows.map((row) => row.slug),
      );

      const faltantes = permisosUnicos.filter(
        (slug) => !permisosExistentes.has(slug),
      );

      if (faltantes.length > 0) {
        const error = new Error("Hay permisos que no existen en el catálogo.");
        error.code = "PERMISOS_INVALIDOS";
        error.faltantes = faltantes;
        throw error;
      }

      for (const permisoSlug of permisosUnicos) {
        await client.query(
          `
          INSERT INTO seguridad.permisos_por_rol
            (rol_id, permiso_slug)
          VALUES
            ($1, $2)
          ON CONFLICT DO NOTHING
          `,
          [rol.id, permisoSlug],
        );
      }
    }

    await client.query("COMMIT");

    return {
      ...rol,
      permisos: permisosUnicos,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function actualizarRol(
  db,
  rolId,
  { nombre, descripcion = null, usuarioId = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    const nombreRol = normalizeRoleName(nombre);

    const { rows } = await client.query(
      `
      UPDATE seguridad.roles_sistema
      SET nombre = $1,
          descripcion = $2
      WHERE id = $3
      RETURNING
        id,
        nombre,
        descripcion
      `,
      [nombreRol, descripcion, rolId],
    );

    await client.query("COMMIT");

    return rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ========================= PERMISOS =========================

export async function listarPermisos(db) {
  const { rows } = await db.query(
    `
    SELECT
      slug,
      nombre_legible,
      descripcion
    FROM seguridad.catalogo_permisos
    ORDER BY slug ASC
    `,
  );

  return rows;
}

export async function obtenerPermisosRol(db, rolId) {
  const { rows } = await db.query(
    `
    SELECT permiso_slug
    FROM seguridad.permisos_por_rol
    WHERE rol_id = $1
    ORDER BY permiso_slug ASC
    `,
    [rolId],
  );

  return rows.map((row) => row.permiso_slug);
}

export async function asignarPermisosRol(
  db,
  rolId,
  { permisos = [], usuarioId = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    const permisosUnicos = uniquePermissions(permisos);

    const { rows: rolRows } = await client.query(
      `
      SELECT id, nombre
      FROM seguridad.roles_sistema
      WHERE id = $1
      `,
      [rolId],
    );

    if (rolRows.length === 0) {
      const error = new Error("Rol no encontrado.");
      error.code = "ROL_NO_ENCONTRADO";
      throw error;
    }

    if (permisosUnicos.length > 0) {
      const { rows: permisosExistentesRows } = await client.query(
        `
        SELECT slug
        FROM seguridad.catalogo_permisos
        WHERE slug = ANY($1::varchar[])
        `,
        [permisosUnicos],
      );

      const permisosExistentes = new Set(
        permisosExistentesRows.map((row) => row.slug),
      );

      const faltantes = permisosUnicos.filter(
        (slug) => !permisosExistentes.has(slug),
      );

      if (faltantes.length > 0) {
        const error = new Error("Hay permisos que no existen en el catálogo.");
        error.code = "PERMISOS_INVALIDOS";
        error.faltantes = faltantes;
        throw error;
      }
    }

    await client.query(
      `
      DELETE FROM seguridad.permisos_por_rol
      WHERE rol_id = $1
      `,
      [rolId],
    );

    for (const permisoSlug of permisosUnicos) {
      await client.query(
        `
        INSERT INTO seguridad.permisos_por_rol
          (rol_id, permiso_slug)
        VALUES
          ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [rolId, permisoSlug],
      );
    }

    await client.query("COMMIT");

    return {
      rolId,
      permisos: permisosUnicos,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cambiarEstadoRol(
  db,
  rolId,
  { activo, usuarioId = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(`SELECT set_config('app.user_id', $1, true)`, [
      usuarioId || "",
    ]);

    const { rows: rolRows } = await client.query(
      `
      SELECT id, nombre, activo
      FROM seguridad.roles_sistema
      WHERE id = $1
      `,
      [rolId],
    );

    if (rolRows.length === 0) {
      const error = new Error("Rol no encontrado.");
      error.code = "ROL_NO_ENCONTRADO";
      throw error;
    }

    const rol = rolRows[0];
    const nombreRol = String(rol.nombre || "")
      .trim()
      .toUpperCase();

    if (
      !activo &&
      ["ADMINISTRADOR", "ADMIN", "SUPERADMIN"].includes(nombreRol)
    ) {
      const error = new Error("No se puede desactivar un rol administrativo.");
      error.code = "ROL_PROTEGIDO";
      throw error;
    }

    if (!activo) {
      const { rows: usuariosRows } = await client.query(
        `
        SELECT COUNT(*)::integer AS total
        FROM seguridad.usuarios
        WHERE rol_id = $1
          AND COALESCE(activo, true) = true
        `,
        [rolId],
      );

      const totalUsuariosActivos = Number(usuariosRows[0]?.total || 0);

      if (totalUsuariosActivos > 0) {
        const error = new Error(
          `No se puede desactivar el rol porque tiene ${totalUsuariosActivos} usuario(s) activo(s) asignado(s).`,
        );
        error.code = "ROL_CON_USUARIOS_ACTIVOS";
        error.totalUsuariosActivos = totalUsuariosActivos;
        throw error;
      }
    }

    const { rows } = await client.query(
      `
      UPDATE seguridad.roles_sistema
      SET activo = $1
      WHERE id = $2
      RETURNING id, nombre, descripcion, activo
      `,
      [activo, rolId],
    );

    await client.query("COMMIT");

    return rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ========================= EMPLEADOS =========================

export async function listarEmpleados(
  db,
  { q = null, includeInactive = true } = {},
) {
  const params = [];
  const where = [];

  if (!includeInactive) {
    where.push("activo = true");
  }

  const search = q ? String(q).trim() : "";

  if (search) {
    params.push(`%${search}%`);
    where.push(`
      (
        nombre_completo ILIKE $${params.length}
        OR email ILIKE $${params.length}
        OR rol_nombre ILIKE $${params.length}
      )
    `);
  }

  const { rows } = await db.query(
    `
    SELECT
      id,
      nombres,
      apellido_paterno,
      apellido_materno,
      nombre_completo,
      email,
      rol_id,
      rol_nombre,
      activo,
      tfa_enabled,
      fecha_creacion,
      ultima_sesion
    FROM seguridad.v_usuarios_admin_resumen
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY activo DESC, fecha_creacion DESC
    `,
    params,
  );

  return rows;
}

export async function crearEmpleado(
  db,
  {
    nombres,
    apellido_paterno,
    apellido_materno = null,
    email,
    rol_id,
    password_temporal,
    usuarioId = null,
  },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    const cleanEmail = normalizeEmail(email);

    const { rows: rolRows } = await client.query(
      `
      SELECT id, nombre, COALESCE(activo, true) AS activo
      FROM seguridad.roles_sistema
      WHERE id = $1
      `,
      [rol_id],
    );

    if (rolRows.length === 0) {
      throw appError("Rol no encontrado.", "ROL_NO_ENCONTRADO", 404);
    }

    if (!rolRows[0].activo) {
      throw appError("No se puede asignar un rol inactivo.", "ROL_INACTIVO");
    }

    const { rows: duplicadoRows } = await client.query(
      `
      SELECT id
      FROM seguridad.usuarios
      WHERE email = $1
      `,
      [cleanEmail],
    );

    if (duplicadoRows.length > 0) {
      throw appError("El correo ya está registrado.", "EMAIL_DUPLICADO", 409);
    }

    const passwordHash = await bcrypt.hash(String(password_temporal), 10);

    const { rows } = await client.query(
      `
      INSERT INTO seguridad.usuarios
        (
          email,
          password_hash,
          nombres,
          apellido_paterno,
          apellido_materno,
          rol_id,
          activo,
          tfa_enabled
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, true, false)
      RETURNING id
      `,
      [
        cleanEmail,
        passwordHash,
        String(nombres).trim(),
        String(apellido_paterno).trim(),
        apellido_materno ? String(apellido_materno).trim() : null,
        rol_id,
      ],
    );

    const empleado = await obtenerEmpleadoAdminPorId(client, rows[0].id);

    await insertarAuditLog(client, {
      modulo: "seguridad.empleados",
      accion: "create",
      descripcion: "Se creó un empleado",
      usuarioId,
      metadata: {
        empleado_id: empleado.id,
        email: empleado.email,
        rol_id: empleado.rol_id,
        rol_nombre: empleado.rol_nombre,
      },
    });

    await client.query("COMMIT");

    return empleado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function actualizarEmpleado(
  db,
  empleadoId,
  {
    nombres,
    apellido_paterno,
    apellido_materno,
    email,
    rol_id,
    usuarioId = null,
  },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    const empleadoAntes = await obtenerEmpleadoAdminPorId(client, empleadoId);

    if (!empleadoAntes) {
      throw appError("Empleado no encontrado.", "EMPLEADO_NO_ENCONTRADO", 404);
    }

    const updates = [];
    const values = [];
    let i = 1;

    if (nombres !== undefined) {
      updates.push(`nombres = $${i++}`);
      values.push(String(nombres).trim());
    }

    if (apellido_paterno !== undefined) {
      updates.push(`apellido_paterno = $${i++}`);
      values.push(String(apellido_paterno).trim());
    }

    if (apellido_materno !== undefined) {
      updates.push(`apellido_materno = $${i++}`);
      values.push(apellido_materno ? String(apellido_materno).trim() : null);
    }

    let cambioEmail = false;

    if (email !== undefined) {
      const cleanEmail = normalizeEmail(email);

      if (cleanEmail !== empleadoAntes.email) {
        const { rows: duplicadoRows } = await client.query(
          `
          SELECT id
          FROM seguridad.usuarios
          WHERE email = $1
            AND id <> $2
          `,
          [cleanEmail, empleadoId],
        );

        if (duplicadoRows.length > 0) {
          throw appError(
            "El correo ya está registrado.",
            "EMAIL_DUPLICADO",
            409,
          );
        }

        cambioEmail = true;
      }

      updates.push(`email = $${i++}`);
      values.push(cleanEmail);
    }

    let cambioRol = false;

    if (rol_id !== undefined) {
      const { rows: nuevoRolRows } = await client.query(
        `
        SELECT id, nombre, COALESCE(activo, true) AS activo
        FROM seguridad.roles_sistema
        WHERE id = $1
        `,
        [rol_id],
      );

      if (nuevoRolRows.length === 0) {
        throw appError("Rol no encontrado.", "ROL_NO_ENCONTRADO", 404);
      }

      const nuevoRol = nuevoRolRows[0];

      if (!nuevoRol.activo) {
        throw appError("No se puede asignar un rol inactivo.", "ROL_INACTIVO");
      }

      cambioRol = Number(rol_id) !== Number(empleadoAntes.rol_id);

      const eraAdmin = isAdminRoleName(empleadoAntes.rol_nombre);
      const seguiraAdmin = isAdminRoleName(nuevoRol.nombre);

      if (cambioRol && eraAdmin && !seguiraAdmin && empleadoAntes.activo) {
        const adminsRestantes = await contarAdminsActivosExcluyendo(
          client,
          empleadoId,
        );

        if (adminsRestantes <= 0) {
          throw appError(
            "No puedes cambiar el rol del último administrador activo.",
            "ULTIMO_ADMIN",
            409,
          );
        }
      }

      updates.push(`rol_id = $${i++}`);
      values.push(rol_id);
    }

    if (updates.length === 0) {
      await client.query("COMMIT");
      return empleadoAntes;
    }

    values.push(empleadoId);

    await client.query(
      `
      UPDATE seguridad.usuarios
      SET ${updates.join(", ")}
      WHERE id = $${i}
      `,
      values,
    );

    if (cambioEmail || cambioRol) {
      await client.query(
        `
        UPDATE seguridad.user_sessions
        SET revoked_at = now()
        WHERE user_id = $1
          AND revoked_at IS NULL
        `,
        [empleadoId],
      );
    }

    const empleadoDespues = await obtenerEmpleadoAdminPorId(client, empleadoId);

    await insertarAuditLog(client, {
      modulo: "seguridad.empleados",
      accion: "update",
      descripcion: "Se actualizó un empleado",
      usuarioId,
      metadata: {
        empleado_id: empleadoId,
        before: {
          email: empleadoAntes.email,
          rol_id: empleadoAntes.rol_id,
          rol_nombre: empleadoAntes.rol_nombre,
        },
        after: {
          email: empleadoDespues.email,
          rol_id: empleadoDespues.rol_id,
          rol_nombre: empleadoDespues.rol_nombre,
        },
        sesiones_revocadas: cambioEmail || cambioRol,
      },
    });

    await client.query("COMMIT");

    return empleadoDespues;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cambiarEstadoEmpleado(
  db,
  empleadoId,
  { activo, usuarioId = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    const empleado = await obtenerEmpleadoAdminPorId(client, empleadoId);

    if (!empleado) {
      throw appError("Empleado no encontrado.", "EMPLEADO_NO_ENCONTRADO", 404);
    }

    if (!activo && usuarioId && String(usuarioId) === String(empleadoId)) {
      throw appError(
        "No puedes desactivar tu propia cuenta.",
        "AUTO_BLOQUEO",
        409,
      );
    }

    if (!activo && isAdminRoleName(empleado.rol_nombre)) {
      const adminsRestantes = await contarAdminsActivosExcluyendo(
        client,
        empleadoId,
      );

      if (adminsRestantes <= 0) {
        throw appError(
          "No puedes desactivar al último administrador activo.",
          "ULTIMO_ADMIN",
          409,
        );
      }
    }

    const { rows } = await client.query(
      `
      UPDATE seguridad.usuarios
      SET activo = $1
      WHERE id = $2
      RETURNING id
      `,
      [activo, empleadoId],
    );

    if (rows.length === 0) {
      throw appError("Empleado no encontrado.", "EMPLEADO_NO_ENCONTRADO", 404);
    }

    if (!activo) {
      await client.query(
        `
        UPDATE seguridad.user_sessions
        SET revoked_at = now()
        WHERE user_id = $1
          AND revoked_at IS NULL
        `,
        [empleadoId],
      );
    }

    const empleadoActualizado = await obtenerEmpleadoAdminPorId(
      client,
      empleadoId,
    );

    await insertarAuditLog(client, {
      modulo: "seguridad.empleados",
      accion: activo ? "activate" : "deactivate",
      descripcion: activo
        ? "Se activó un empleado"
        : "Se desactivó un empleado",
      usuarioId,
      metadata: {
        empleado_id: empleadoId,
        email: empleado.email,
        rol_id: empleado.rol_id,
        rol_nombre: empleado.rol_nombre,
        activo_anterior: empleado.activo,
        activo_nuevo: activo,
        sesiones_revocadas: !activo,
      },
    });

    await client.query("COMMIT");

    return empleadoActualizado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ========================= SESIONES DE SEGURIDAD =========================

export async function listarSesionesUsuario(
  db,
  usuarioId,
  { currentSid = null } = {},
) {
  const { rows } = await db.query(
    `
    SELECT
      id,
      user_id,
      user_agent,
      ip_address::text AS ip_address,
      created_at,
      expires_at,
      revoked_at,
      CASE
        WHEN revoked_at IS NOT NULL THEN 'REVOCADA'
        WHEN expires_at <= now() THEN 'EXPIRADA'
        ELSE 'ACTIVA'
      END AS estado,
      CASE
        WHEN id::text = $2 THEN true
        ELSE false
      END AS es_sesion_actual
    FROM seguridad.user_sessions
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [usuarioId, currentSid],
  );

  return rows;
}

export async function revocarSesionUsuario(
  db,
  sessionId,
  { usuarioId, currentSid = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    if (String(sessionId) === String(currentSid)) {
      throw appError(
        "No puedes revocar la sesión actual desde esta acción.",
        "SESION_ACTUAL_PROTEGIDA",
        409,
      );
    }

    const { rows } = await client.query(
      `
      UPDATE seguridad.user_sessions
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = $1
        AND user_id = $2
      RETURNING
        id,
        user_id,
        user_agent,
        ip_address::text AS ip_address,
        created_at,
        expires_at,
        revoked_at
      `,
      [sessionId, usuarioId],
    );

    if (rows.length === 0) {
      throw appError("Sesión no encontrada.", "SESION_NO_ENCONTRADA", 404);
    }

    await insertarAuditLog(client, {
      modulo: "seguridad.sesiones",
      accion: "revoke",
      descripcion: "Se revocó una sesión del usuario",
      usuarioId,
      metadata: {
        session_id: sessionId,
      },
    });

    await client.query("COMMIT");

    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revocarOtrasSesionesUsuario(
  db,
  { usuarioId, currentSid = null },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await setAuditUser(client, usuarioId);

    const { rowCount } = await client.query(
      `
      UPDATE seguridad.user_sessions
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > now()
        AND id::text <> $2
      `,
      [usuarioId, currentSid],
    );

    await insertarAuditLog(client, {
      modulo: "seguridad.sesiones",
      accion: "revoke_others",
      descripcion: "Se revocaron otras sesiones activas del usuario",
      usuarioId,
      metadata: {
        current_sid: currentSid,
        sesiones_revocadas: rowCount,
      },
    });

    await client.query("COMMIT");

    return {
      sesiones_revocadas: rowCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function obtenerEstadoSeguridadUsuario(db, usuarioId) {
  const { rows } = await db.query(
    `
    SELECT
      u.id,
      u.email,
      COALESCE(u.tfa_enabled, false) AS tfa_enabled,
      (
        SELECT COUNT(*)::integer
        FROM seguridad.passkey_credentials pc
        WHERE pc.user_id = u.id
      ) AS passkeys_count
    FROM seguridad.usuarios u
    WHERE u.id = $1
    `,
    [usuarioId],
  );

  return rows[0] || null;
}