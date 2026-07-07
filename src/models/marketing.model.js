// src/models/marketing.model.js

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

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildPagination({ limit, offset }) {
  return {
    limit: toSafeLimit(limit),
    offset: toSafeOffset(offset),
  };
}

const ESTADOS_SUSCRIPCION = new Set(["ACTIVO", "BAJA", "BLOQUEADO"]);
const CANALES_CUPON = new Set(["POS", "WEB", "AMBOS"]);
const APLICA_A_CUPON = new Set(["PEDIDO", "PRODUCTO", "CATEGORIA"]);
const TIPOS_PLANTILLA = new Set(["MARKETING", "TRANSACCIONAL"]);

function normalizeEnum(value, allowed, fieldName) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  if (!allowed.has(normalized)) {
    const err = new Error(`${fieldName} inválido.`);
    err.code = "VALIDATION";
    throw err;
  }

  return normalized;
}

// ============================================================
// SUSCRIPTORES
// ============================================================

export async function listarSuscripciones(
  db,
  { estado = null, q = null, limit = 25, offset = 0 } = {},
) {
  const params = [];
  const where = [];

  if (estado) {
    params.push(normalizeEnum(estado, ESTADOS_SUSCRIPCION, "estado"));
    where.push(`estado = $${params.length}`);
  }

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        email ILIKE $${params.length}
        OR nombre ILIKE $${params.length}
        OR telefono ILIKE $${params.length}
      )
    `);
  }

  const { limit: safeLimit, offset: safeOffset } = buildPagination({
    limit,
    offset,
  });

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countResult = await db.query(
    `
      SELECT count(*)::int AS total
      FROM marketing.v_suscripciones_admin
      ${whereSql}
    `,
    params,
  );

  const total = countResult.rows[0]?.total ?? 0;

  params.push(safeLimit, safeOffset);

  const { rows } = await db.query(
    `
      SELECT
        id,
        email,
        nombre,
        telefono,
        origen,
        estado,
        acepta_marketing,
        fecha_registro,
        fecha_baja,
        motivo_baja,
        ultimo_envio_en,
        notas_admin,
        metadata,
        created_at,
        updated_at
      FROM marketing.v_suscripciones_admin
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

export async function obtenerSuscripcionPorId(db, id) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM marketing.v_suscripciones_admin
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function crearSuscripcion(
  db,
  {
    email,
    nombre = null,
    telefono = null,
    origen = "ADMIN",
    estado = "ACTIVO",
    aceptaMarketing = true,
    notasAdmin = null,
    metadata = {},
  },
) {
  const estadoFinal = normalizeEnum(estado, ESTADOS_SUSCRIPCION, "estado");

  const { rows } = await db.query(
    `
      INSERT INTO marketing.suscripciones (
        email,
        nombre,
        telefono,
        origen,
        estado,
        acepta_marketing,
        notas_admin,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb
      )
      ON CONFLICT (lower(email))
      DO UPDATE SET
        nombre = EXCLUDED.nombre,
        telefono = EXCLUDED.telefono,
        origen = EXCLUDED.origen,
        estado = EXCLUDED.estado,
        acepta_marketing = EXCLUDED.acepta_marketing,
        notas_admin = EXCLUDED.notas_admin,
        metadata = EXCLUDED.metadata,
        fecha_baja = CASE
          WHEN EXCLUDED.estado = 'ACTIVO' THEN NULL
          ELSE marketing.suscripciones.fecha_baja
        END,
        motivo_baja = CASE
          WHEN EXCLUDED.estado = 'ACTIVO' THEN NULL
          ELSE marketing.suscripciones.motivo_baja
        END
      RETURNING id
    `,
    [
      normalizeEmail(email),
      toNullableText(nombre),
      toNullableText(telefono),
      String(origen || "ADMIN")
        .trim()
        .toUpperCase(),
      estadoFinal,
      Boolean(aceptaMarketing),
      toNullableText(notasAdmin),
      JSON.stringify(metadata || {}),
    ],
  );

  return obtenerSuscripcionPorId(db, rows[0].id);
}

export async function actualizarSuscripcion(
  db,
  id,
  {
    nombre = undefined,
    telefono = undefined,
    aceptaMarketing = undefined,
    notasAdmin = undefined,
    metadata = undefined,
  },
) {
  const sets = [];
  const params = [id];

  if (nombre !== undefined) {
    params.push(toNullableText(nombre));
    sets.push(`nombre = $${params.length}`);
  }

  if (telefono !== undefined) {
    params.push(toNullableText(telefono));
    sets.push(`telefono = $${params.length}`);
  }

  if (aceptaMarketing !== undefined) {
    params.push(Boolean(aceptaMarketing));
    sets.push(`acepta_marketing = $${params.length}`);
  }

  if (notasAdmin !== undefined) {
    params.push(toNullableText(notasAdmin));
    sets.push(`notas_admin = $${params.length}`);
  }

  if (metadata !== undefined) {
    params.push(JSON.stringify(parseJson(metadata)));
    sets.push(`metadata = $${params.length}::jsonb`);
  }

  if (!sets.length) {
    return obtenerSuscripcionPorId(db, id);
  }

  const { rows } = await db.query(
    `
      UPDATE marketing.suscripciones
      SET ${sets.join(", ")}
      WHERE id = $1::uuid
      RETURNING id
    `,
    params,
  );

  if (!rows[0]) return null;

  return obtenerSuscripcionPorId(db, id);
}

export async function cambiarEstadoSuscripcion(
  db,
  id,
  { estado, motivoBaja = null },
) {
  const estadoFinal = normalizeEnum(estado, ESTADOS_SUSCRIPCION, "estado");

  const { rows } = await db.query(
    `
      UPDATE marketing.suscripciones
      SET
        estado = $2,
        acepta_marketing = CASE
          WHEN $2 = 'ACTIVO' THEN true
          ELSE false
        END,
        fecha_baja = CASE
          WHEN $2 = 'BAJA' THEN COALESCE(fecha_baja, now())
          WHEN $2 = 'ACTIVO' THEN NULL
          ELSE fecha_baja
        END,
        motivo_baja = CASE
          WHEN $2 = 'BAJA' THEN $3
          WHEN $2 = 'ACTIVO' THEN NULL
          ELSE motivo_baja
        END
      WHERE id = $1::uuid
      RETURNING id
    `,
    [id, estadoFinal, toNullableText(motivoBaja)],
  );

  if (!rows[0]) return null;

  return obtenerSuscripcionPorId(db, id);
}

// ============================================================
// CUPONES
// ============================================================

export async function listarCupones(
  db,
  { estado = null, q = null, canal = null, limit = 25, offset = 0 } = {},
) {
  const params = [];
  const where = [`visible_admin = true`];

  if (estado) {
    params.push(String(estado).trim().toUpperCase());
    where.push(`estado_calculado = $${params.length}`);
  }

  if (canal) {
    params.push(normalizeEnum(canal, CANALES_CUPON, "canal"));
    where.push(`canal = $${params.length}`);
  }

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        codigo ILIKE $${params.length}
        OR nombre ILIKE $${params.length}
        OR descripcion ILIKE $${params.length}
      )
    `);
  }

  const { limit: safeLimit, offset: safeOffset } = buildPagination({
    limit,
    offset,
  });

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countResult = await db.query(
    `
      SELECT count(*)::int AS total
      FROM marketing.v_cupones_admin
      ${whereSql}
    `,
    params,
  );

  const total = countResult.rows[0]?.total ?? 0;

  params.push(safeLimit, safeOffset);

  const { rows } = await db.query(
    `
      SELECT *
      FROM marketing.v_cupones_admin
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

export async function obtenerCuponPorId(db, id) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM marketing.v_cupones_admin
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function crearCupon(
  db,
  {
    codigo,
    nombre = null,
    descripcion = null,
    tipoDescuento,
    valor,
    montoMinimoCompra = 0,
    fechaInicio,
    fechaFin,
    activo = true,
    canal = "AMBOS",
    aplicaA = "PEDIDO",
    usoMaximo = null,
    usoMaximoPorCliente = null,
    acumulable = false,
    soloClientesRegistrados = false,
    usuarioId = null,
    metadata = {},
  },
) {
  const canalFinal = normalizeEnum(canal, CANALES_CUPON, "canal");
  const aplicaAFinal = normalizeEnum(aplicaA, APLICA_A_CUPON, "aplica_a");

  const codigoFinal = String(codigo || "")
    .trim()
    .toUpperCase();

  const { rows } = await db.query(
    `
      INSERT INTO marketing.cupones (
        codigo,
        nombre,
        descripcion,
        tipo_descuento,
        valor,
        monto_minimo_compra,
        fecha_inicio,
        fecha_fin,
        activo,
        canal,
        aplica_a,
        uso_maximo,
        uso_maximo_por_cliente,
        acumulable,
        solo_clientes_registrados,
        creado_por,
        actualizado_por,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::date,
        $8::date,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $16,
        $17::jsonb
      )
      RETURNING id
    `,
    [
      codigoFinal,
      toNullableText(nombre) || codigoFinal,
      toNullableText(descripcion),
      String(tipoDescuento || "")
        .trim()
        .toUpperCase(),
      Number(valor),
      Number(montoMinimoCompra || 0),
      fechaInicio,
      fechaFin,
      Boolean(activo),
      canalFinal,
      aplicaAFinal,
      usoMaximo === null || usoMaximo === undefined ? null : Number(usoMaximo),
      usoMaximoPorCliente === null || usoMaximoPorCliente === undefined
        ? null
        : Number(usoMaximoPorCliente),
      Boolean(acumulable),
      Boolean(soloClientesRegistrados),
      usuarioId,
      JSON.stringify(metadata || {}),
    ],
  );

  return obtenerCuponPorId(db, rows[0].id);
}

export async function actualizarCupon(
  db,
  id,
  {
    nombre = undefined,
    descripcion = undefined,
    tipoDescuento = undefined,
    valor = undefined,
    montoMinimoCompra = undefined,
    fechaInicio = undefined,
    fechaFin = undefined,
    canal = undefined,
    aplicaA = undefined,
    usoMaximo = undefined,
    usoMaximoPorCliente = undefined,
    acumulable = undefined,
    soloClientesRegistrados = undefined,
    usuarioId = null,
    metadata = undefined,
  },
) {
  const sets = [];
  const params = [id];

  const addSet = (column, value, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  if (nombre !== undefined) addSet("nombre", toNullableText(nombre));
  if (descripcion !== undefined) {
    addSet("descripcion", toNullableText(descripcion));
  }
  if (tipoDescuento !== undefined) {
    addSet("tipo_descuento", String(tipoDescuento).trim().toUpperCase());
  }
  if (valor !== undefined) addSet("valor", Number(valor));
  if (montoMinimoCompra !== undefined) {
    addSet("monto_minimo_compra", Number(montoMinimoCompra || 0));
  }
  if (fechaInicio !== undefined) addSet("fecha_inicio", fechaInicio, "::date");
  if (fechaFin !== undefined) addSet("fecha_fin", fechaFin, "::date");
  if (canal !== undefined) {
    addSet("canal", normalizeEnum(canal, CANALES_CUPON, "canal"));
  }
  if (aplicaA !== undefined) {
    addSet("aplica_a", normalizeEnum(aplicaA, APLICA_A_CUPON, "aplica_a"));
  }
  if (usoMaximo !== undefined) {
    addSet(
      "uso_maximo",
      usoMaximo === null || usoMaximo === "" ? null : Number(usoMaximo),
    );
  }
  if (usoMaximoPorCliente !== undefined) {
    addSet(
      "uso_maximo_por_cliente",
      usoMaximoPorCliente === null || usoMaximoPorCliente === ""
        ? null
        : Number(usoMaximoPorCliente),
    );
  }
  if (acumulable !== undefined) addSet("acumulable", Boolean(acumulable));
  if (soloClientesRegistrados !== undefined) {
    addSet("solo_clientes_registrados", Boolean(soloClientesRegistrados));
  }
  if (metadata !== undefined) {
    addSet("metadata", JSON.stringify(parseJson(metadata)), "::jsonb");
  }

  params.push(usuarioId);
  sets.push(`actualizado_por = $${params.length}`);

  if (!sets.length) return obtenerCuponPorId(db, id);

  const { rows } = await db.query(
    `
      UPDATE marketing.cupones
      SET ${sets.join(", ")}
      WHERE id = $1
      RETURNING id
    `,
    params,
  );

  if (!rows[0]) return null;

  return obtenerCuponPorId(db, id);
}

export async function cambiarEstadoCupon(db, id, { activo, usuarioId = null }) {
  const { rows } = await db.query(
    `
      UPDATE marketing.cupones
      SET
        activo = $2,
        actualizado_por = $3
      WHERE id = $1
      RETURNING id
    `,
    [id, Boolean(activo), usuarioId],
  );

  if (!rows[0]) return null;

  return obtenerCuponPorId(db, id);
}

// ============================================================
// SEGMENTOS
// ============================================================

export async function listarSegmentos(
  db,
  { activo = null, q = null, limit = 25, offset = 0 } = {},
) {
  const params = [];
  const where = [];

  if (activo !== null && activo !== undefined && activo !== "") {
    params.push(String(activo) === "true" || activo === true);
    where.push(`activo = $${params.length}`);
  }

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        nombre ILIKE $${params.length}
        OR descripcion ILIKE $${params.length}
      )
    `);
  }

  const { limit: safeLimit, offset: safeOffset } = buildPagination({
    limit,
    offset,
  });

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countResult = await db.query(
    `
      SELECT count(*)::int AS total
      FROM marketing.v_segmentos_admin
      ${whereSql}
    `,
    params,
  );

  const total = countResult.rows[0]?.total ?? 0;

  params.push(safeLimit, safeOffset);

  const { rows } = await db.query(
    `
      SELECT *
      FROM marketing.v_segmentos_admin
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

export async function obtenerSegmentoPorId(db, id) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM marketing.v_segmentos_admin
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function crearSegmento(
  db,
  {
    nombre,
    descripcion = null,
    criterios = {},
    activo = true,
    usuarioId = null,
    metadata = {},
  },
) {
  const { rows } = await db.query(
    `
      INSERT INTO marketing.segmentos (
        nombre,
        descripcion,
        criterios,
        activo,
        creado_por,
        actualizado_por,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3::jsonb,
        $4,
        $5,
        $5,
        $6::jsonb
      )
      RETURNING id
    `,
    [
      String(nombre).trim(),
      toNullableText(descripcion),
      JSON.stringify(parseJson(criterios)),
      Boolean(activo),
      usuarioId,
      JSON.stringify(parseJson(metadata)),
    ],
  );

  return obtenerSegmentoPorId(db, rows[0].id);
}

export async function actualizarSegmento(
  db,
  id,
  {
    nombre = undefined,
    descripcion = undefined,
    criterios = undefined,
    activo = undefined,
    usuarioId = null,
    metadata = undefined,
  },
) {
  const sets = [];
  const params = [id];

  if (nombre !== undefined) {
    params.push(String(nombre).trim());
    sets.push(`nombre = $${params.length}`);
  }

  if (descripcion !== undefined) {
    params.push(toNullableText(descripcion));
    sets.push(`descripcion = $${params.length}`);
  }

  if (criterios !== undefined) {
    params.push(JSON.stringify(parseJson(criterios)));
    sets.push(`criterios = $${params.length}::jsonb`);
  }

  if (activo !== undefined) {
    params.push(Boolean(activo));
    sets.push(`activo = $${params.length}`);
  }

  if (metadata !== undefined) {
    params.push(JSON.stringify(parseJson(metadata)));
    sets.push(`metadata = $${params.length}::jsonb`);
  }

  params.push(usuarioId);
  sets.push(`actualizado_por = $${params.length}`);

  const { rows } = await db.query(
    `
      UPDATE marketing.segmentos
      SET ${sets.join(", ")}
      WHERE id = $1::uuid
      RETURNING id
    `,
    params,
  );

  if (!rows[0]) return null;

  return obtenerSegmentoPorId(db, id);
}

// ============================================================
// PLANTILLAS
// ============================================================

export async function listarPlantillasEmail(
  db,
  { tipo = null, activo = null, q = null, limit = 25, offset = 0 } = {},
) {
  const params = [];
  const where = [];

  if (tipo) {
    params.push(normalizeEnum(tipo, TIPOS_PLANTILLA, "tipo"));
    where.push(`tipo = $${params.length}`);
  }

  if (activo !== null && activo !== undefined && activo !== "") {
    params.push(String(activo) === "true" || activo === true);
    where.push(`activo = $${params.length}`);
  }

  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`
      (
        clave ILIKE $${params.length}
        OR nombre ILIKE $${params.length}
        OR asunto ILIKE $${params.length}
      )
    `);
  }

  const { limit: safeLimit, offset: safeOffset } = buildPagination({
    limit,
    offset,
  });

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countResult = await db.query(
    `
      SELECT count(*)::int AS total
      FROM marketing.v_plantillas_email_admin
      ${whereSql}
    `,
    params,
  );

  const total = countResult.rows[0]?.total ?? 0;

  params.push(safeLimit, safeOffset);

  const { rows } = await db.query(
    `
      SELECT *
      FROM marketing.v_plantillas_email_admin
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

export async function obtenerPlantillaEmailPorId(db, id) {
  const { rows } = await db.query(
    `
      SELECT *
      FROM marketing.v_plantillas_email_admin
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

export async function crearPlantillaEmail(
  db,
  {
    clave,
    nombre,
    descripcion = null,
    tipo = "MARKETING",
    asunto,
    preheader = null,
    cuerpoHtml = "",
    cuerpoTexto = null,
    activo = true,
    usuarioId = null,
    metadata = {},
  },
) {
  const tipoFinal = normalizeEnum(tipo, TIPOS_PLANTILLA, "tipo");

  const { rows } = await db.query(
    `
      INSERT INTO marketing.plantillas_email (
        clave,
        nombre,
        descripcion,
        tipo,
        asunto,
        preheader,
        cuerpo_html,
        cuerpo_texto,
        activo,
        creado_por,
        actualizado_por,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $10,
        $11::jsonb
      )
      RETURNING id
    `,
    [
      String(clave).trim().toUpperCase(),
      String(nombre).trim(),
      toNullableText(descripcion),
      tipoFinal,
      String(asunto).trim(),
      toNullableText(preheader),
      String(cuerpoHtml || ""),
      toNullableText(cuerpoTexto),
      Boolean(activo),
      usuarioId,
      JSON.stringify(parseJson(metadata)),
    ],
  );

  return obtenerPlantillaEmailPorId(db, rows[0].id);
}

export async function actualizarPlantillaEmail(
  db,
  id,
  {
    nombre = undefined,
    descripcion = undefined,
    tipo = undefined,
    asunto = undefined,
    preheader = undefined,
    cuerpoHtml = undefined,
    cuerpoTexto = undefined,
    activo = undefined,
    usuarioId = null,
    metadata = undefined,
  },
) {
  const sets = [];
  const params = [id];

  if (nombre !== undefined) {
    params.push(String(nombre).trim());
    sets.push(`nombre = $${params.length}`);
  }

  if (descripcion !== undefined) {
    params.push(toNullableText(descripcion));
    sets.push(`descripcion = $${params.length}`);
  }

  if (tipo !== undefined) {
    params.push(normalizeEnum(tipo, TIPOS_PLANTILLA, "tipo"));
    sets.push(`tipo = $${params.length}`);
  }

  if (asunto !== undefined) {
    params.push(String(asunto).trim());
    sets.push(`asunto = $${params.length}`);
  }

  if (preheader !== undefined) {
    params.push(toNullableText(preheader));
    sets.push(`preheader = $${params.length}`);
  }

  if (cuerpoHtml !== undefined) {
    params.push(String(cuerpoHtml || ""));
    sets.push(`cuerpo_html = $${params.length}`);
  }

  if (cuerpoTexto !== undefined) {
    params.push(toNullableText(cuerpoTexto));
    sets.push(`cuerpo_texto = $${params.length}`);
  }

  if (activo !== undefined) {
    params.push(Boolean(activo));
    sets.push(`activo = $${params.length}`);
  }

  if (metadata !== undefined) {
    params.push(JSON.stringify(parseJson(metadata)));
    sets.push(`metadata = $${params.length}::jsonb`);
  }

  params.push(usuarioId);
  sets.push(`actualizado_por = $${params.length}`);

  const { rows } = await db.query(
    `
      UPDATE marketing.plantillas_email
      SET ${sets.join(", ")}
      WHERE id = $1::uuid
      RETURNING id
    `,
    params,
  );

  if (!rows[0]) return null;

  return obtenerPlantillaEmailPorId(db, id);
}

export async function registrarEnvioPruebaEmail(
  db,
  {
    plantillaId,
    emailDestino,
    asuntoEnviado,
    estado = "PENDIENTE",
    proveedor = "RESEND",
    proveedorMessageId = null,
    error = null,
    usuarioId = null,
    metadata = {},
  },
) {
  const { rows } = await db.query(
    `
      WITH input_data AS (
        SELECT
          $1::uuid AS plantilla_id,
          $2::varchar(180) AS email_destino,
          $3::varchar(180) AS asunto_enviado,
          $4::varchar(20) AS estado_envio,
          $5::varchar(40) AS proveedor,
          $6::text AS proveedor_message_id,
          $7::text AS error,
          $8::uuid AS enviado_por,
          $9::jsonb AS metadata
      )
      INSERT INTO marketing.envios_prueba_email (
        plantilla_id,
        email_destino,
        asunto_enviado,
        estado,
        proveedor,
        proveedor_message_id,
        error,
        enviado_por,
        metadata,
        enviado_en
      )
      SELECT
        plantilla_id,
        email_destino,
        asunto_enviado,
        estado_envio,
        proveedor,
        proveedor_message_id,
        error,
        enviado_por,
        metadata,
        CASE
          WHEN estado_envio = 'ENVIADO'::varchar THEN now()
          ELSE NULL
        END
      FROM input_data
      RETURNING *
    `,
    [
      plantillaId,
      normalizeEmail(emailDestino),
      String(asuntoEnviado).trim(),
      estado,
      proveedor,
      toNullableText(proveedorMessageId),
      toNullableText(error),
      usuarioId,
      JSON.stringify(parseJson(metadata)),
    ],
  );

  return rows[0];
}