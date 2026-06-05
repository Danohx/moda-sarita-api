export async function getVarianteById(db, id) {
  const sql = `
    SELECT
      id,
      producto_id,
      producto_nombre,
      talla_id,
      talla_nombre,
      talla_tipo,
      color_id,
      color_nombre,
      color_hex,
      sku,
      codigo_barras,
      precio_venta,
      precio_costo,
      stock_fisico,
      stock_apartado,
      stock_minimo,
      stock_disponible,
      activo,
      created_at,
      updated_at
    FROM inventario.v_variantes_detalle
    WHERE id = $1
    LIMIT 1;
  `;

  const { rows } = await db.query(sql, [id]);
  return rows[0] || null;
}

export async function adjustStockVariante(
  db,
  { varianteId, usuarioId, cantidad, motivo },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: found } = await client.query(
      `
      SELECT
        v.id,
        v.stock_fisico,
        v.stock_apartado,
        v.stock_minimo
      FROM inventario.variantes_producto v
      WHERE v.id = $1
      FOR UPDATE
      `,
      [varianteId],
    );

    if (found.length === 0) {
      const err = new Error("Variante no encontrada");
      err.code = "NOT_FOUND";
      throw err;
    }

    const actual = Number(found[0].stock_fisico);
    const nuevo = actual + Number(cantidad);

    if (nuevo < 0) {
      const err = new Error("Stock insuficiente");
      err.code = "STOCK_NEGATIVO";
      throw err;
    }

    const { rows: updatedRows } = await client.query(
      `
      UPDATE inventario.variantes_producto
      SET stock_fisico = $2,
          updated_at = now()
      WHERE id = $1
      RETURNING
        id,
        producto_id,
        stock_fisico,
        stock_apartado,
        stock_minimo,
        activo,
        updated_at
      `,
      [varianteId, nuevo],
    );

    await client.query(
      `
      INSERT INTO inventario.movimientos (variante_id, usuario_id, cantidad, motivo, tipo)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        varianteId,
        usuarioId,
        cantidad,
        motivo,
        cantidad > 0 ? "ENTRADA" : "SALIDA",
      ],
    );

    await client.query("COMMIT");
    return updatedRows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listVariantesByProductoPublic(db, productoId) {
  const sql = `
    SELECT
      id,
      producto_id,
      talla_id,
      talla_nombre,
      talla_tipo,
      color_id,
      color_nombre,
      color_hex,
      sku,
      codigo_barras,
      precio_venta,
      precio_costo,
      stock_fisico,
      stock_apartado,
      stock_minimo,
      stock_disponible,
      activo,
      created_at,
      updated_at
    FROM inventario.v_variantes_detalle
    WHERE producto_id = $1
      AND variante_activo = TRUE
      AND producto_activo = TRUE
    ORDER BY talla_nombre NULLS LAST, color_nombre NULLS LAST, created_at ASC;
  `;

  const { rows } = await db.query(sql, [productoId]);
  return rows;
}

export async function listVariantesByProductoAdmin(db, productoId) {
  const sql = `
    SELECT
      id,
      producto_id,
      talla_id,
      talla_nombre,
      talla_tipo,
      color_id,
      color_nombre,
      color_hex,
      sku,
      codigo_barras,
      precio_venta,
      precio_costo,
      stock_fisico,
      stock_apartado,
      stock_minimo,
      stock_disponible,
      activo,
      created_at,
      updated_at
    FROM inventario.v_variantes_detalle
    WHERE producto_id = $1
    ORDER BY
      CASE
        WHEN talla_id IS NULL AND color_id IS NULL THEN 0
        ELSE 1
      END,
      talla_nombre NULLS LAST,
      color_nombre NULLS LAST,
      created_at ASC
  `;

  const { rows } = await db.query(sql, [productoId]);
  return rows;
}

export async function createVariante(db, payload) {
  const {
    producto_id,
    talla_id = null,
    color_id = null,
    sku,
    codigo_barras = null,
    precio_venta,
    precio_costo = null,
    stock_fisico = 0,
    stock_apartado = 0,
    stock_minimo = 5,
    activo = true,
  } = payload;

  const sql = `
    INSERT INTO inventario.variantes_producto
      (
        producto_id,
        talla_id,
        color_id,
        sku,
        codigo_barras,
        precio_venta,
        precio_costo,
        stock_fisico,
        stock_apartado,
        stock_minimo,
        activo
      )
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING
      id,
      producto_id,
      talla_id,
      color_id,
      sku,
      codigo_barras,
      precio_venta,
      precio_costo,
      stock_fisico,
      stock_apartado,
      stock_minimo,
      activo,
      created_at,
      updated_at;
  `;

  const { rows } = await db.query(sql, [
    producto_id,
    talla_id,
    color_id,
    sku,
    codigo_barras,
    precio_venta,
    precio_costo,
    stock_fisico,
    stock_apartado,
    stock_minimo,
    activo,
  ]);

  return rows[0];
}

export async function updateVariante(db, id, payload) {
  const allowed = [
    "talla_id",
    "color_id",
    "sku",
    "codigo_barras",
    "precio_venta",
    "precio_costo",
    "stock_minimo",
  ];

  const sets = [];
  const values = [id];
  let idx = 2;

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      sets.push(`${key} = $${idx}`);
      values.push(payload[key]);
      idx++;
    }
  }

  if (sets.length === 0) {
    return await getVarianteById(db, id);
  }

  const sql = `
    UPDATE inventario.variantes_producto
    SET
      ${sets.join(", ")},
      updated_at = now()
    WHERE id = $1
    RETURNING
      id,
      producto_id,
      talla_id,
      color_id,
      sku,
      codigo_barras,
      precio_venta,
      precio_costo,
      stock_fisico,
      stock_apartado,
      stock_minimo,
      activo,
      created_at,
      updated_at;
  `;

  const { rows } = await db.query(sql, values);
  return rows[0] || null;
}

export async function setVarianteStatus(db, id, activo) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: found } = await client.query(
      `
      SELECT id, producto_id, activo
      FROM inventario.variantes_producto
      WHERE id = $1
      FOR UPDATE
      `,
      [id],
    );

    if (found.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const variante = found[0];

    if (activo === false) {
      const { rows: activeRows } = await client.query(
        `
        SELECT COUNT(*)::int AS total
        FROM inventario.variantes_producto
        WHERE producto_id = $1
          AND activo = TRUE
        `,
        [variante.producto_id],
      );

      const totalActivas = Number(activeRows[0]?.total || 0);

      if (variante.activo === true && totalActivas <= 1) {
        const err = new Error(
          "No puedes desactivar la última variante activa del producto",
        );
        err.code = "LAST_ACTIVE_VARIANT";
        throw err;
      }
    }

    const { rows } = await client.query(
      `
      UPDATE inventario.variantes_producto
      SET activo = $2,
          updated_at = now()
      WHERE id = $1
      RETURNING id, producto_id, activo, updated_at;
      `,
      [id, activo],
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