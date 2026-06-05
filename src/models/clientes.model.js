export async function listClientes(
  db,
  { q = null, includeInactive = false } = {},
) {
  const params = [];
  let i = 1;
  const where = [];

  if (!includeInactive) {
    where.push("activo = TRUE");
  }

  const term = q ? String(q).trim() : null;
  if (term) {
    params.push(`%${term}%`);
    where.push(`(
      nombre_completo ILIKE $${i}
      OR telefono ILIKE $${i}
      OR email ILIKE $${i}
    )`);
    i++;
  }

  const sql = `
    SELECT
      id, usuario_id, nombres, apellido_paterno, apellido_materno,
      telefono, email, tiene_credito, limite_credito, saldo_deudor,
      fecha_registro, activo
    FROM clientes.v_clientes_busqueda
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY fecha_registro DESC
    LIMIT 200;
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

export async function getClienteById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM clientes.clientes WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

export async function listDirecciones(db, clienteId) {
  const { rows } = await db.query(
    `SELECT * FROM clientes.direcciones WHERE cliente_id = $1 ORDER BY es_principal DESC, id ASC`,
    [clienteId],
  );
  return rows;
}

export async function createCliente(db, payload) {
  const {
    usuario_id = null,
    nombres,
    apellido_paterno,
    apellido_materno = null,
    telefono = null,
    email = null,
  } = payload;

  const sql = `
    INSERT INTO clientes.clientes
      (usuario_id, nombres, apellido_paterno, apellido_materno, telefono, email)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *;
  `;
  const { rows } = await db.query(sql, [
    usuario_id,
    nombres,
    apellido_paterno,
    apellido_materno,
    telefono,
    email,
  ]);
  return rows[0];
}

export async function updateCliente(db, id, payload) {
  const {
    nombres = null,
    apellido_paterno = null,
    apellido_materno = null,
    telefono = null,
    email = null,
  } = payload;

  const sql = `
    UPDATE clientes.clientes
    SET
      nombres = COALESCE($2, nombres),
      apellido_paterno = COALESCE($3, apellido_paterno),
      apellido_materno = $4,
      telefono = $5,
      email = $6
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await db.query(sql, [
    id,
    nombres,
    apellido_paterno,
    apellido_materno,
    telefono,
    email,
  ]);
  return rows[0] || null;
}

export async function setCreditoCliente(
  db,
  id,
  { tiene_credito, limite_credito },
) {
  const sql = `
    UPDATE clientes.clientes
    SET
      tiene_credito = $2,
      limite_credito = $3
    WHERE id = $1
    RETURNING id, tiene_credito, limite_credito, saldo_deudor;
  `;
  const { rows } = await db.query(sql, [
    id,
    !!tiene_credito,
    Number(limite_credito || 0),
  ]);
  return rows[0] || null;
}

export async function getMovimientosCredito(db, clienteId) {
  const query = `
    SELECT
      id,
      fecha,
      tipo,
      descripcion,
      monto,
      "saldoResultante",
      metodo_pago
    FROM clientes.v_movimientos_credito
    WHERE cliente_id = $1
    ORDER BY fecha DESC, id DESC;
  `;
  const { rows } = await db.query(query, [clienteId]);
  return rows;
}

export async function abonarCreditoCliente(
  db,
  id,
  { monto, metodo_pago, referencia_externa = null, observaciones = null },
) {
  const m = Number(monto);

  if (!Number.isFinite(m) || m <= 0) {
    const e = new Error("El monto a abonar debe ser mayor a 0");
    e.code = "VALIDATION";
    throw e;
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: clienteRows } = await client.query(
      `
      SELECT id, saldo_deudor, limite_credito, tiene_credito
      FROM clientes.clientes
      WHERE id = $1
      FOR UPDATE
      `,
      [id],
    );

    if (clienteRows.length === 0) {
      const e = new Error("Cliente no encontrado");
      e.code = "NOT_FOUND";
      throw e;
    }

    const cliente = clienteRows[0];

    if (!cliente.tiene_credito) {
      const e = new Error("El cliente no tiene crédito habilitado");
      e.code = "VALIDATION";
      throw e;
    }

    const saldoAnterior = Number(cliente.saldo_deudor ?? 0);
    const saldoResultante = Math.max(saldoAnterior - m, 0);
    const montoAplicado = Math.min(m, saldoAnterior);

    if (montoAplicado <= 0) {
      const e = new Error("El cliente no tiene saldo pendiente por abonar");
      e.code = "VALIDATION";
      throw e;
    }

    const { rows: updatedRows } = await client.query(
      `
      UPDATE clientes.clientes
      SET saldo_deudor = $2
      WHERE id = $1
      RETURNING id, saldo_deudor, limite_credito, tiene_credito
      `,
      [id, saldoResultante],
    );

    await client.query(
      `
      INSERT INTO clientes.movimientos_credito (
        cliente_id,
        tipo,
        descripcion,
        monto,
        saldo_anterior,
        saldo_resultante,
        metodo_pago,
        referencia_externa,
        observaciones
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        id,
        "ABONO",
        "Abono a crédito",
        -montoAplicado,
        saldoAnterior,
        saldoResultante,
        metodo_pago,
        referencia_externa,
        observaciones,
      ],
    );

    await client.query("COMMIT");

    return updatedRows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createDireccion(db, clienteId, payload) {
  const {
    calle,
    numero_exterior = null,
    numero_interior = null,
    colonia = null,
    ciudad,
    estado,
    codigo_postal,
    referencias = null,
    es_principal = false,
  } = payload;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    if (es_principal) {
      await client.query(
        `UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1`,
        [clienteId],
      );
    }

    const { rows } = await client.query(
      `INSERT INTO clientes.direcciones
        (cliente_id, calle, numero_exterior, numero_interior, colonia, ciudad, estado, codigo_postal, referencias, es_principal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        clienteId,
        calle,
        numero_exterior,
        numero_interior,
        colonia,
        ciudad,
        estado,
        codigo_postal,
        referencias,
        !!es_principal,
      ],
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setDireccionPrincipal(db, clienteId, direccionId) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1`,
      [clienteId],
    );

    const { rows } = await client.query(
      `UPDATE clientes.direcciones
       SET es_principal = true
       WHERE id = $1 AND cliente_id = $2
       RETURNING *`,
      [direccionId, clienteId],
    );

    await client.query("COMMIT");
    return rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteDireccion(db, clienteId, direccionId) {
  const { rows } = await db.query(
    `DELETE FROM clientes.direcciones WHERE id = $1 AND cliente_id = $2 RETURNING id`,
    [direccionId, clienteId],
  );
  return rows[0] || null;
}