// src/models/contenido.model.js

function normalizeClave(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function toNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const text = String(value).trim();
  return text.length ? text : null;
}

async function withTransaction(db, callback) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function buildSet(fields, startIndex = 1) {
  const sets = [];
  const values = [];
  let index = startIndex;

  for (const [column, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${column} = $${index}`);
      values.push(value);
      index += 1;
    }
  }

  return { sets, values, nextIndex: index };
}

// ============================================================
// PÁGINAS / POLÍTICAS
// ============================================================

export async function listPaginasAdmin(
  db,
  { q = null, includeInactive = true } = {},
) {
  const params = [];
  const where = [];

  if (!includeInactive) {
    where.push("activo = true");
  }

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        clave ILIKE $${params.length}
        OR titulo ILIKE $${params.length}
        OR resumen ILIKE $${params.length}
      )
    `);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows } = await db.query(
    `
      SELECT
        id,
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        activo,
        publicado,
        version_actual,
        publicado_en,
        despublicado_en,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
      FROM contenido.paginas
      ${whereSql}
      ORDER BY updated_at DESC, titulo ASC
    `,
    params,
  );

  return rows;
}

export async function getPaginaAdminById(db, id) {
  const { rows } = await db.query(
    `
      SELECT
        id,
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        activo,
        publicado,
        version_actual,
        publicado_en,
        despublicado_en,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
      FROM contenido.paginas
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function getPaginaAdminByClave(db, clave) {
  const claveNorm = normalizeClave(clave);

  const { rows } = await db.query(
    `
      SELECT
        id,
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        activo,
        publicado,
        version_actual,
        publicado_en,
        despublicado_en,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
      FROM contenido.paginas
      WHERE clave = $1
      LIMIT 1
    `,
    [claveNorm],
  );

  return rows[0] || null;
}

export async function getPaginaPublica(db, clave) {
  const claveNorm = normalizeClave(clave);

  const { rows } = await db.query(
    `
      SELECT
        id,
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        version_actual,
        publicado_en,
        updated_at
      FROM contenido.v_paginas_publicas
      WHERE clave = $1
      LIMIT 1
    `,
    [claveNorm],
  );

  return rows[0] || null;
}

export async function createPagina(
  db,
  {
    clave,
    titulo,
    resumen = null,
    contenido_html = "",
    contenido_texto = null,
    usuarioId = null,
  },
) {
  const claveNorm = normalizeClave(clave);

  const { rows } = await db.query(
    `
      INSERT INTO contenido.paginas (
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        creado_por,
        actualizado_por
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      RETURNING
        id,
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        activo,
        publicado,
        version_actual,
        publicado_en,
        despublicado_en,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
    `,
    [
      claveNorm,
      String(titulo).trim(),
      toNullableText(resumen),
      String(contenido_html || ""),
      toNullableText(contenido_texto),
      usuarioId,
    ],
  );

  return rows[0];
}

export async function updatePagina(db, id, payload = {}) {
  const fields = {
    titulo:
      payload.titulo !== undefined
        ? String(payload.titulo || "").trim()
        : undefined,
    resumen: toNullableText(payload.resumen),
    contenido_html:
      payload.contenido_html !== undefined
        ? String(payload.contenido_html || "")
        : undefined,
    contenido_texto: toNullableText(payload.contenido_texto),
    actualizado_por: payload.usuarioId ?? null,
  };

  const { sets, values, nextIndex } = buildSet(fields, 2);

  if (!sets.length) {
    return getPaginaAdminById(db, id);
  }

  values.unshift(id);

  const { rows } = await db.query(
    `
      UPDATE contenido.paginas
      SET ${sets.join(", ")}
      WHERE id = $1::uuid
      RETURNING
        id,
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        activo,
        publicado,
        version_actual,
        publicado_en,
        despublicado_en,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
    `,
    values,
  );

  return rows[0] || null;
}

export async function setPaginaStatus(
  db,
  id,
  { activo, usuarioId = null } = {},
) {
  const { rows } = await db.query(
    `
      UPDATE contenido.paginas
      SET
        activo = $2,
        publicado = CASE WHEN $2 = false THEN false ELSE publicado END,
        despublicado_en = CASE
          WHEN $2 = false AND publicado = true THEN now()
          ELSE despublicado_en
        END,
        actualizado_por = $3
      WHERE id = $1::uuid
      RETURNING
        id,
        clave,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        activo,
        publicado,
        version_actual,
        publicado_en,
        despublicado_en,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
    `,
    [id, activo, usuarioId],
  );

  return rows[0] || null;
}

export async function setPaginaPublicacion(
  db,
  id,
  { publicado, usuarioId = null } = {},
) {
  return withTransaction(db, async (client) => {
    const { rows: pageRows } = await client.query(
      `
        SELECT *
        FROM contenido.paginas
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [id],
    );

    const page = pageRows[0];

    if (!page) {
      return null;
    }

    if (publicado && !page.activo) {
      const err = new Error("No se puede publicar una página inactiva.");
      err.code = "VALIDATION";
      throw err;
    }

    if (
      publicado &&
      !String(page.contenido_html || page.contenido_texto || "").trim()
    ) {
      const err = new Error("No se puede publicar una página sin contenido.");
      err.code = "VALIDATION";
      throw err;
    }

    const { rows: versionRows } = await client.query(
      `
        SELECT COALESCE(MAX(numero_version), 0) + 1 AS nueva_version
        FROM contenido.paginas_versiones
        WHERE pagina_id = $1::uuid
      `,
      [id],
    );

    const nuevaVersion = Number(versionRows[0].nueva_version || 1);

    await client.query(
      `
        INSERT INTO contenido.paginas_versiones (
          pagina_id,
          numero_version,
          titulo,
          resumen,
          contenido_html,
          contenido_texto,
          activo,
          publicado,
          accion,
          creado_por
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        id,
        nuevaVersion,
        page.titulo,
        page.resumen,
        page.contenido_html,
        page.contenido_texto,
        page.activo,
        publicado,
        publicado ? "PUBLICACION" : "DESPUBLICACION",
        usuarioId,
      ],
    );

    const { rows } = await client.query(
      `
        UPDATE contenido.paginas
        SET
          publicado = $2,
          version_actual = $3,
          publicado_en = CASE WHEN $2 = true THEN now() ELSE publicado_en END,
          despublicado_en = CASE WHEN $2 = false THEN now() ELSE NULL END,
          actualizado_por = $4
        WHERE id = $1::uuid
        RETURNING
          id,
          clave,
          titulo,
          resumen,
          contenido_html,
          contenido_texto,
          activo,
          publicado,
          version_actual,
          publicado_en,
          despublicado_en,
          creado_por,
          actualizado_por,
          created_at,
          updated_at
      `,
      [id, publicado, nuevaVersion, usuarioId],
    );

    return rows[0];
  });
}

export async function listVersionesPagina(db, paginaId) {
  const { rows } = await db.query(
    `
      SELECT
        id,
        pagina_id,
        numero_version,
        titulo,
        resumen,
        contenido_html,
        contenido_texto,
        activo,
        publicado,
        accion,
        creado_por,
        created_at
      FROM contenido.paginas_versiones
      WHERE pagina_id = $1::uuid
      ORDER BY numero_version DESC, created_at DESC
    `,
    [paginaId],
  );

  return rows;
}

export async function restaurarVersionPagina(
  db,
  paginaId,
  versionId,
  { usuarioId = null } = {},
) {
  return withTransaction(db, async (client) => {
    const { rows: pageRows } = await client.query(
      `
        SELECT *
        FROM contenido.paginas
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [paginaId],
    );

    if (!pageRows[0]) {
      return null;
    }

    const { rows: versionRows } = await client.query(
      `
        SELECT *
        FROM contenido.paginas_versiones
        WHERE id = $1::uuid
          AND pagina_id = $2::uuid
        LIMIT 1
      `,
      [versionId, paginaId],
    );

    const version = versionRows[0];

    if (!version) {
      const err = new Error("Versión no encontrada.");
      err.code = "NOT_FOUND";
      throw err;
    }

    const { rows: maxRows } = await client.query(
      `
        SELECT COALESCE(MAX(numero_version), 0) + 1 AS nueva_version
        FROM contenido.paginas_versiones
        WHERE pagina_id = $1::uuid
      `,
      [paginaId],
    );

    const nuevaVersion = Number(maxRows[0].nueva_version || 1);

    const { rows } = await client.query(
      `
        UPDATE contenido.paginas
        SET
          titulo = $2,
          resumen = $3,
          contenido_html = $4,
          contenido_texto = $5,
          publicado = false,
          despublicado_en = CASE WHEN publicado = true THEN now() ELSE despublicado_en END,
          version_actual = $6,
          actualizado_por = $7
        WHERE id = $1::uuid
        RETURNING
          id,
          clave,
          titulo,
          resumen,
          contenido_html,
          contenido_texto,
          activo,
          publicado,
          version_actual,
          publicado_en,
          despublicado_en,
          creado_por,
          actualizado_por,
          created_at,
          updated_at
      `,
      [
        paginaId,
        version.titulo,
        version.resumen,
        version.contenido_html,
        version.contenido_texto,
        nuevaVersion,
        usuarioId,
      ],
    );

    const restored = rows[0];

    await client.query(
      `
        INSERT INTO contenido.paginas_versiones (
          pagina_id,
          numero_version,
          titulo,
          resumen,
          contenido_html,
          contenido_texto,
          activo,
          publicado,
          accion,
          creado_por
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'RESTAURACION', $8)
      `,
      [
        paginaId,
        nuevaVersion,
        restored.titulo,
        restored.resumen,
        restored.contenido_html,
        restored.contenido_texto,
        restored.activo,
        usuarioId,
      ],
    );

    return restored;
  });
}

// ============================================================
// FAQ
// ============================================================

export async function listFaqsAdmin(
  db,
  { q = null, includeInactive = true } = {},
) {
  const params = [];
  const where = [];

  if (!includeInactive) {
    where.push("activo = true");
  }

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        pregunta ILIKE $${params.length}
        OR respuesta_texto ILIKE $${params.length}
        OR respuesta_html ILIKE $${params.length}
      )
    `);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows } = await db.query(
    `
      SELECT
        id,
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        activo,
        publicado,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
      FROM contenido.faqs
      ${whereSql}
      ORDER BY orden ASC, created_at ASC
    `,
    params,
  );

  return rows;
}

export async function listFaqsPublicas(db) {
  const { rows } = await db.query(
    `
      SELECT
        id,
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        updated_at
      FROM contenido.v_faqs_publicas
      ORDER BY orden ASC, updated_at DESC
    `,
  );

  return rows;
}

export async function getFaqAdmin(db, id) {
  const { rows } = await db.query(
    `
      SELECT
        id,
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        activo,
        publicado,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
      FROM contenido.faqs
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function createFaq(
  db,
  {
    pregunta,
    respuesta_html = "",
    respuesta_texto = null,
    orden = null,
    usuarioId = null,
  },
) {
  let ordenFinal = orden;

  if (ordenFinal === null || ordenFinal === undefined) {
    const { rows } = await db.query(
      `
        SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente_orden
        FROM contenido.faqs
      `,
    );

    ordenFinal = Number(rows[0].siguiente_orden || 0);
  }

  const { rows } = await db.query(
    `
      INSERT INTO contenido.faqs (
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        creado_por,
        actualizado_por
      )
      VALUES ($1, $2, $3, $4, $5, $5)
      RETURNING
        id,
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        activo,
        publicado,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
    `,
    [
      String(pregunta).trim(),
      String(respuesta_html || ""),
      toNullableText(respuesta_texto),
      Number(ordenFinal),
      usuarioId,
    ],
  );

  return rows[0];
}

export async function updateFaq(db, id, payload = {}) {
  const fields = {
    pregunta:
      payload.pregunta !== undefined
        ? String(payload.pregunta || "").trim()
        : undefined,
    respuesta_html:
      payload.respuesta_html !== undefined
        ? String(payload.respuesta_html || "")
        : undefined,
    respuesta_texto: toNullableText(payload.respuesta_texto),
    orden:
      payload.orden !== undefined && payload.orden !== null
        ? Number(payload.orden)
        : undefined,
    actualizado_por: payload.usuarioId ?? null,
  };

  const { sets, values } = buildSet(fields, 2);

  if (!sets.length) {
    return getFaqAdmin(db, id);
  }

  values.unshift(id);

  const { rows } = await db.query(
    `
      UPDATE contenido.faqs
      SET ${sets.join(", ")}
      WHERE id = $1::uuid
      RETURNING
        id,
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        activo,
        publicado,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
    `,
    values,
  );

  return rows[0] || null;
}

export async function setFaqStatus(db, id, { activo, usuarioId = null } = {}) {
  const { rows } = await db.query(
    `
      UPDATE contenido.faqs
      SET
        activo = $2,
        publicado = CASE WHEN $2 = false THEN false ELSE publicado END,
        actualizado_por = $3
      WHERE id = $1::uuid
      RETURNING
        id,
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        activo,
        publicado,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
    `,
    [id, activo, usuarioId],
  );

  return rows[0] || null;
}

export async function setFaqPublicacion(
  db,
  id,
  { publicado, usuarioId = null } = {},
) {
  const actual = await getFaqAdmin(db, id);

  if (!actual) {
    return null;
  }

  if (publicado && !actual.activo) {
    const err = new Error("No se puede publicar una FAQ inactiva.");
    err.code = "VALIDATION";
    throw err;
  }

  if (
    publicado &&
    !String(actual.respuesta_html || actual.respuesta_texto || "").trim()
  ) {
    const err = new Error("No se puede publicar una FAQ sin respuesta.");
    err.code = "VALIDATION";
    throw err;
  }

  const { rows } = await db.query(
    `
      UPDATE contenido.faqs
      SET
        publicado = $2,
        actualizado_por = $3
      WHERE id = $1::uuid
      RETURNING
        id,
        pregunta,
        respuesta_html,
        respuesta_texto,
        orden,
        activo,
        publicado,
        creado_por,
        actualizado_por,
        created_at,
        updated_at
    `,
    [id, publicado, usuarioId],
  );

  return rows[0] || null;
}

export async function reorderFaqs(db, { items = [], usuarioId = null } = {}) {
  return withTransaction(db, async (client) => {
    for (const item of items) {
      await client.query(
        `
          UPDATE contenido.faqs
          SET
            orden = $2,
            actualizado_por = $3
          WHERE id = $1::uuid
        `,
        [item.id, Number(item.orden), usuarioId],
      );
    }

    return listFaqsAdmin(client);
  });
}
