export async function adjustStockVariante(db, { varianteId, usuarioId, cantidad, motivo }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO inventario.movimientos (variante_id, usuario_id, cantidad, motivo)
       VALUES ($1, $2, $3, $4)`,
      [varianteId, usuarioId, cantidad, motivo]
    );

    const { rows } = await client.query(
      `UPDATE inventario.variantes_producto
      SET stock_fisico = stock_fisico + $2,
          updated_at = now()
      WHERE id = $1
        AND (stock_fisico + $2) >= 0
      RETURNING id, stock_fisico`,
      [varianteId, cantidad]
    );

    if (rows.length === 0) {
      throw new Error("Variante no encontrada o stock insuficiente");
    }

    await client.query("COMMIT");
    return rows[0];
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
      v.id,
      v.producto_id,
      v.talla_id,
      t.nombre AS talla_nombre,
      t.tipo AS talla_tipo,
      v.color_id,
      c.nombre AS color_nombre,
      c.hex AS color_hex,
      v.sku,
      v.codigo_barras,
      COALESCE(v.precio_venta, p.precio_venta) AS precio_venta,
      v.activo,
      v.stock_fisico,
      v.stock_apartado
    FROM inventario.variantes_producto v
    JOIN inventario.productos p ON p.id = v.producto_id
    LEFT JOIN inventario.tallas t ON t.id = v.talla_id
    LEFT JOIN inventario.colores c ON c.id = v.color_id
    WHERE v.producto_id = $1
      AND v.activo = TRUE
      AND p.activo = TRUE
    ORDER BY t.nombre NULLS LAST, c.nombre NULLS LAST;
  `;
  const { rows } = await db.query(sql, [productoId]);
  return rows;
}

export async function createVariante(db, payload) {
  const {
    producto_id,
    talla_id = null,
    color_id = null,
    sku = null,
    codigo_barras = null,
    precio_venta = null,
    precio_costo = null,
    stock_fisico = 0,
    stock_apartado = 0,
    activo = true,
  } = payload;

  const sql = `
    INSERT INTO inventario.variantes_producto
      (producto_id, talla_id, color_id, sku, codigo_barras, precio_venta, precio_costo,
       stock_fisico, stock_apartado, activo)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING
      id, producto_id, talla_id, color_id, sku, codigo_barras, precio_venta, precio_costo,
      stock_fisico, stock_apartado, activo, created_at, updated_at;
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
    const { rows } = await db.query(
      `SELECT id, producto_id, talla_id, color_id, sku, codigo_barras, precio_venta, precio_costo, activo, updated_at
       FROM inventario.variantes_producto
       WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  const sql = `
    UPDATE inventario.variantes_producto
    SET
      ${sets.join(", ")},
      updated_at = now()
    WHERE id = $1
    RETURNING id, producto_id, talla_id, color_id, sku, codigo_barras, precio_venta, precio_costo, activo, updated_at;
  `;

  const { rows } = await db.query(sql, values);
  return rows[0] || null;
}

export async function setVarianteStatus(db, id, activo) {
  const sql = `
    UPDATE inventario.variantes_producto
    SET activo = $2, updated_at = now()
    WHERE id = $1
    RETURNING id, producto_id, activo;
  `;
  const { rows } = await db.query(sql, [id, activo]);
  return rows[0] || null;
}
