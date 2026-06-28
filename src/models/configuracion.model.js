function normalizeModulo(modulo) {
  if (!modulo) return null;
  return String(modulo).trim().toUpperCase();
}

function normalizeMetodo(codigo) {
  if (!codigo) return null;
  return String(codigo).trim().toUpperCase();
}

async function withTransaction(db, fn, usuarioId = null) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query("SELECT set_config('app.user_id', $1, true)", [
      usuarioId || "",
    ]);

    const result = await fn(client);

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listParametrosAdmin(db, { modulo = null } = {}) {
  const params = [];
  const where = [];

  const mod = normalizeModulo(modulo);

  if (mod) {
    params.push(mod);
    where.push(
      `modulo = $${params.length}::configuracion.modulo_configuracion`,
    );
  }

  const sql = `
    SELECT
      clave,
      modulo,
      nombre,
      valor,
      tipo,
      descripcion,
      editable,
      visible_admin,
      publico,
      sensible,
      validacion,
      orden,
      actualizado_por,
      creado_at,
      actualizado_at
    FROM configuracion.v_parametros_sistema_admin
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY modulo, orden, clave;
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

export async function listParametrosPublicos(db) {
  const { rows } = await db.query(`
    SELECT
      clave,
      modulo,
      nombre,
      valor,
      tipo,
      descripcion,
      orden,
      actualizado_at
    FROM configuracion.v_parametros_sistema_publicos
    ORDER BY modulo, orden, clave;
  `);

  return rows;
}

export async function getParametrosPorModulo(db) {
  const { rows } = await db.query(`
    SELECT modulo, parametros
    FROM configuracion.v_parametros_por_modulo
    ORDER BY modulo;
  `);

  return rows;
}

export async function updateParametroSistema(db, clave, { valor, usuarioId }) {
  const safeClave = String(clave || "").trim();

  if (!safeClave) {
    const err = new Error("clave requerida");
    err.code = "VALIDATION";
    throw err;
  }

  if (valor === undefined) {
    const err = new Error("valor es requerido");
    err.code = "VALIDATION";
    throw err;
  }

  return withTransaction(
    db,
    async (client) => {
      const { rows } = await client.query(
        `
          UPDATE configuracion.parametros_sistema
          SET
            valor = $2::jsonb,
            actualizado_por = $3
          WHERE clave = $1
            AND editable = true
          RETURNING clave;
        `,
        [safeClave, JSON.stringify(valor), usuarioId || null],
      );

      if (rows.length === 0) return null;

      const refreshed = await client.query(
        `
          SELECT
            clave,
            modulo,
            nombre,
            valor,
            tipo,
            descripcion,
            editable,
            visible_admin,
            publico,
            sensible,
            validacion,
            orden,
            actualizado_por,
            creado_at,
            actualizado_at
          FROM configuracion.v_parametros_sistema_admin
          WHERE clave = $1;
        `,
        [safeClave],
      );

      return refreshed.rows[0] || null;
    },
    usuarioId,
  );
}

export async function listMetodosPagoAdmin(db) {
  const { rows } = await db.query(`
    SELECT
      codigo,
      nombre,
      descripcion,
      activo_pos,
      activo_web,
      activo_admin,
      requiere_referencia,
      permite_cambio,
      requiere_confirmacion_manual,
      es_credito,
      orden,
      instrucciones_pos,
      instrucciones_web,
      config_publica,
      actualizado_por,
      creado_at,
      actualizado_at
    FROM configuracion.metodos_pago
    ORDER BY orden, nombre;
  `);

  return rows;
}

export async function listMetodosPagoPOS(db) {
  const { rows } = await db.query(`
    SELECT *
    FROM configuracion.v_metodos_pago_pos_activos;
  `);

  return rows;
}

export async function listMetodosPagoWeb(db) {
  const { rows } = await db.query(`
    SELECT *
    FROM configuracion.v_metodos_pago_web_activos;
  `);

  return rows;
}

export async function updateMetodoPago(db, codigo, payload, usuarioId = null) {
  const safeCodigo = normalizeMetodo(codigo);

  if (!safeCodigo) {
    const err = new Error("codigo requerido");
    err.code = "VALIDATION";
    throw err;
  }

  const allowed = [
    "nombre",
    "descripcion",
    "activo_pos",
    "activo_web",
    "activo_admin",
    "requiere_referencia",
    "permite_cambio",
    "requiere_confirmacion_manual",
    "es_credito",
    "orden",
    "instrucciones_pos",
    "instrucciones_web",
    "config_publica",
  ];

  const sets = [];
  const values = [safeCodigo];
  let idx = 2;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      if (key === "config_publica") {
        sets.push(`${key} = $${idx}::jsonb`);
        values.push(JSON.stringify(payload[key] ?? {}));
      } else {
        sets.push(`${key} = $${idx}`);
        values.push(payload[key]);
      }

      idx++;
    }
  }

  if (sets.length === 0) {
    const { rows } = await db.query(
      `
        SELECT *
        FROM configuracion.metodos_pago
        WHERE codigo = $1::public.metodo_pago_enum;
      `,
      [safeCodigo],
    );

    return rows[0] || null;
  }

  values.push(usuarioId || null);

  return withTransaction(
    db,
    async (client) => {
      const { rows } = await client.query(
        `
          UPDATE configuracion.metodos_pago
          SET
            ${sets.join(", ")},
            actualizado_por = $${idx}
          WHERE codigo = $1::public.metodo_pago_enum
          RETURNING
            codigo,
            nombre,
            descripcion,
            activo_pos,
            activo_web,
            activo_admin,
            requiere_referencia,
            permite_cambio,
            requiere_confirmacion_manual,
            es_credito,
            orden,
            instrucciones_pos,
            instrucciones_web,
            config_publica,
            actualizado_por,
            creado_at,
            actualizado_at;
        `,
        values,
      );

      return rows[0] || null;
    },
    usuarioId,
  );
}
