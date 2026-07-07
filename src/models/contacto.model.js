// src/models/contacto.model.js

function toNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const text = String(value).trim();
  return text.length ? text : null;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toSafeLimit(value, fallback = 25, max = 100) {
  const n = Number(value);

  if (!Number.isInteger(n)) return fallback;
  if (n <= 0) return fallback;
  if (n > max) return max;

  return n;
}

function toSafeOffset(value) {
  const n = Number(value);

  if (!Number.isInteger(n)) return 0;
  if (n < 0) return 0;

  return n;
}

const ESTADOS_CONTACTO = new Set(["NUEVO", "LEIDO", "RESPONDIDO", "ARCHIVADO"]);

export function normalizeEstadoContacto(value) {
  const estado = String(value || "")
    .trim()
    .toUpperCase();

  if (!ESTADOS_CONTACTO.has(estado)) {
    const err = new Error("Estado de mensaje inválido.");
    err.code = "VALIDATION";
    throw err;
  }

  return estado;
}

export async function crearMensajeContacto(
  db,
  {
    nombre,
    email,
    telefono = null,
    asunto,
    mensaje,
    estado = "NUEVO",
    ipAddress = null,
    userAgent = null,
    captchaOk = false,
    captchaProvider = null,
    captchaScore = null,
    honeypotDetected = false,
    metadata = {},
  },
) {
  const estadoFinal = normalizeEstadoContacto(estado);

  const { rows } = await db.query(
    `
      INSERT INTO contenido.mensajes_contacto (
        nombre,
        email,
        telefono,
        asunto,
        mensaje,
        estado,
        ip_address,
        user_agent,
        captcha_ok,
        captcha_provider,
        captcha_score,
        honeypot_detected,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::inet,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13::jsonb
      )
      RETURNING
        id,
        nombre,
        email,
        telefono,
        asunto,
        mensaje,
        estado,
        captcha_ok,
        captcha_provider,
        captcha_score,
        honeypot_detected,
        notificado_admin,
        notificado_admin_en,
        notificacion_error,
        created_at,
        updated_at
    `,
    [
      String(nombre).trim(),
      normalizeEmail(email),
      toNullableText(telefono),
      String(asunto).trim(),
      String(mensaje).trim(),
      estadoFinal,
      ipAddress,
      userAgent,
      Boolean(captchaOk),
      toNullableText(captchaProvider),
      captchaScore === null || captchaScore === undefined
        ? null
        : Number(captchaScore),
      Boolean(honeypotDetected),
      JSON.stringify(metadata || {}),
    ],
  );

  return rows[0];
}

export async function actualizarNotificacionAdminContacto(
  db,
  id,
  { ok, error = null },
) {
  const { rows } = await db.query(
    `
      UPDATE contenido.mensajes_contacto
      SET
        notificado_admin = $2,
        notificado_admin_en = CASE WHEN $2 = true THEN now() ELSE notificado_admin_en END,
        notificacion_error = $3
      WHERE id = $1::uuid
      RETURNING
        id,
        notificado_admin,
        notificado_admin_en,
        notificacion_error
    `,
    [id, Boolean(ok), error ? String(error) : null],
  );

  return rows[0] || null;
}

export async function listarMensajesContacto(
  db,
  {
    estado = null,
    q = null,
    includeArchived = false,
    limit = 25,
    offset = 0,
  } = {},
) {
  const params = [];
  const where = [];

  if (estado) {
    params.push(normalizeEstadoContacto(estado));
    where.push(`estado = $${params.length}`);
  }

  if (!includeArchived) {
    where.push(`estado <> 'ARCHIVADO'`);
  }

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        nombre ILIKE $${params.length}
        OR email ILIKE $${params.length}
        OR asunto ILIKE $${params.length}
        OR mensaje ILIKE $${params.length}
      )
    `);
  }

  const safeLimit = toSafeLimit(limit);
  const safeOffset = toSafeOffset(offset);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countResult = await db.query(
    `
      SELECT count(*)::int AS total
      FROM contenido.v_mensajes_contacto_admin
      ${whereSql}
    `,
    params,
  );

  const total = countResult.rows[0]?.total ?? 0;

  params.push(safeLimit);
  params.push(safeOffset);

  const { rows } = await db.query(
    `
      SELECT
        id,
        nombre,
        email,
        telefono,
        asunto,
        mensaje,
        estado,
        captcha_ok,
        captcha_provider,
        captcha_score,
        honeypot_detected,
        notificado_admin,
        notificado_admin_en,
        notificacion_error,
        leido_en,
        respondido_en,
        archivado_en,
        actualizado_por,
        actualizado_por_email,
        respondido_por,
        respondido_por_email,
        notas_admin,
        respuesta_admin,
        created_at,
        updated_at
      FROM contenido.v_mensajes_contacto_admin
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    params,
  );

  return {
    items: rows,
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + rows.length < total,
  };
}

export async function obtenerMensajeContactoPorId(db, id) {
  const { rows } = await db.query(
    `
      SELECT
        id,
        nombre,
        email,
        telefono,
        asunto,
        mensaje,
        estado,

        ip_address,
        user_agent,
        captcha_ok,
        captcha_provider,
        captcha_score,
        honeypot_detected,

        notificado_admin,
        notificado_admin_en,
        notificacion_error,

        leido_en,
        respondido_en,
        archivado_en,

        actualizado_por,
        actualizado_por_email,

        respondido_por,
        respondido_por_email,

        notas_admin,
        respuesta_admin,
        metadata,

        created_at,
        updated_at
      FROM contenido.v_mensajes_contacto_admin
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function cambiarEstadoMensajeContacto(
  db,
  id,
  { estado, usuarioId = null },
) {
  const estadoFinal = normalizeEstadoContacto(estado);
  const usuarioIdFinal = usuarioId ? String(usuarioId) : null;

  const updateResult = await db.query(
    `
      WITH input_data AS (
        SELECT
          $1::uuid AS mensaje_id,
          $2::varchar(20) AS estado_nuevo,
          $3::uuid AS usuario_id
      )
      UPDATE contenido.mensajes_contacto mc
      SET
        estado = input_data.estado_nuevo,
        actualizado_por = input_data.usuario_id,

        leido_en = CASE
          WHEN input_data.estado_nuevo IN ('LEIDO'::varchar, 'RESPONDIDO'::varchar)
            AND mc.leido_en IS NULL
            THEN now()
          ELSE mc.leido_en
        END,

        respondido_en = CASE
          WHEN input_data.estado_nuevo = 'RESPONDIDO'::varchar
            AND mc.respondido_en IS NULL
            THEN now()
          ELSE mc.respondido_en
        END,

        archivado_en = CASE
          WHEN input_data.estado_nuevo = 'ARCHIVADO'::varchar
            AND mc.archivado_en IS NULL
            THEN now()
          WHEN input_data.estado_nuevo <> 'ARCHIVADO'::varchar
            THEN NULL
          ELSE mc.archivado_en
        END
      FROM input_data
      WHERE mc.id = input_data.mensaje_id
      RETURNING mc.id
    `,
    [id, estadoFinal, usuarioIdFinal],
  );

  if (!updateResult.rows[0]) {
    return null;
  }

  return obtenerMensajeContactoPorId(db, id);
}

export async function actualizarNotasMensajeContacto(
  db,
  id,
  { notasAdmin = null, usuarioId = null },
) {
  const { rows } = await db.query(
    `
      UPDATE contenido.mensajes_contacto
      SET
        notas_admin = $2,
        actualizado_por = $3
      WHERE id = $1::uuid
      RETURNING id
    `,
    [id, toNullableText(notasAdmin), usuarioId],
  );

  if (!rows[0]) return null;

  return obtenerMensajeContactoPorId(db, id);
}

export async function responderMensajeContacto(
  db,
  id,
  { respuestaAdmin, usuarioId = null },
) {
  const { rows } = await db.query(
    `
      UPDATE contenido.mensajes_contacto
      SET
        estado = 'RESPONDIDO',
        respuesta_admin = $2,
        respondido_por = $3,
        actualizado_por = $3,
        leido_en = CASE
          WHEN leido_en IS NULL THEN now()
          ELSE leido_en
        END,
        respondido_en = now()
      WHERE id = $1::uuid
      RETURNING id
    `,
    [id, String(respuestaAdmin).trim(), usuarioId],
  );

  if (!rows[0]) return null;

  return obtenerMensajeContactoPorId(db, id);
}

export async function obtenerResumenMensajesContacto(db) {
  const { rows } = await db.query(
    `
      SELECT
        count(*) FILTER (WHERE estado = 'NUEVO')::int AS nuevos,
        count(*) FILTER (WHERE estado = 'LEIDO')::int AS leidos,
        count(*) FILTER (WHERE estado = 'RESPONDIDO')::int AS respondidos,
        count(*) FILTER (WHERE estado = 'ARCHIVADO')::int AS archivados,
        count(*)::int AS total
      FROM contenido.mensajes_contacto
    `,
  );

  return (
    rows[0] || {
      nuevos: 0,
      leidos: 0,
      respondidos: 0,
      archivados: 0,
      total: 0,
    }
  );
}
