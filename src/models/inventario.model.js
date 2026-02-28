export async function listExistencias(
  db,
  { q, categoriaId, soloBajoStock, limit, offset },
) {
  const params = [];
  let i = 1;

  let where = `p.activo = TRUE AND v.activo = TRUE`;

  if (categoriaId) {
    params.push(categoriaId);
    where += ` AND p.categoria_id = $${i++}`;
  }

  if (q) {
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    where += ` AND (
      p.nombre ILIKE $${i++}
      OR COALESCE(v.sku, p.sku) ILIKE $${i++}
      OR COALESCE(v.codigo_barras, p.codigo_barras) ILIKE $${i++}
    )`;
  }

  if (soloBajoStock) {
    where += ` AND (GREATEST(v.stock_fisico - v.stock_apartado, 0) <= COALESCE(p.stock_minimo, 0))`;
  }

  params.push(limit);
  params.push(offset);

  const sql = `
    SELECT
      v.id AS variante_id,
      p.id AS producto_id,
      p.nombre AS producto_nombre,
      p.categoria_id,
      v.talla_id,
      t.nombre AS talla_nombre,
      v.color_id,
      c.nombre AS color_nombre,
      c.hex AS color_hex,
      COALESCE(v.sku, p.sku) AS sku,
      COALESCE(v.codigo_barras, p.codigo_barras) AS codigo_barras,
      v.stock_fisico,
      v.stock_apartado,
      GREATEST(v.stock_fisico - v.stock_apartado, 0) AS stock_disponible,
      COALESCE(p.stock_minimo, 0) AS stock_minimo,
      (GREATEST(v.stock_fisico - v.stock_apartado, 0) <= COALESCE(p.stock_minimo, 0)) AS bajo_stock
    FROM inventario.variantes_producto v
    JOIN inventario.productos p ON p.id = v.producto_id
    LEFT JOIN inventario.tallas t ON t.id = v.talla_id
    LEFT JOIN inventario.colores c ON c.id = v.color_id
    WHERE ${where}
    ORDER BY p.nombre ASC, t.nombre NULLS LAST, c.nombre NULLS LAST
    LIMIT $${i++} OFFSET $${i++};
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

export async function getStockByVariante(db, varianteId) {
  const { rows } = await db.query(
    `
    SELECT
      v.id AS variante_id,
      v.producto_id,
      p.nombre AS producto_nombre,
      v.talla_id,
      t.nombre AS talla_nombre,
      v.color_id,
      c.nombre AS color_nombre,
      c.hex AS color_hex,
      v.stock_fisico,
      v.stock_apartado,
      GREATEST(v.stock_fisico - v.stock_apartado, 0) AS stock_disponible,
      v.activo
    FROM inventario.variantes_producto v
    JOIN inventario.productos p ON p.id = v.producto_id
    LEFT JOIN inventario.tallas t ON t.id = v.talla_id
    LEFT JOIN inventario.colores c ON c.id = v.color_id
    WHERE v.id = $1
    `,
    [varianteId],
  );
  return rows[0] || null;
}

export async function listMovimientosByVariante(
  db,
  { varianteId, from, to, limit = 100, offset = 0 },
) {
  const params = [varianteId];
  let i = 2;
  let where = `m.variante_id = $1`;

  if (from) {
    params.push(from);
    where += ` AND m.fecha >= $${i++}::timestamptz`;
  }
  if (to) {
    params.push(to);
    where += ` AND m.fecha <= $${i++}::timestamptz`;
  }

  params.push(limit, offset);

  const sql = `
    SELECT
      m.id,
      m.fecha,
      m.tipo,
      m.cantidad,
      m.motivo,
      m.usuario_id,
      u.email AS usuario_email
    FROM inventario.movimientos m
    LEFT JOIN seguridad.usuarios u ON u.id = m.usuario_id
    WHERE ${where}
    ORDER BY m.fecha DESC
    LIMIT $${i++} OFFSET $${i++};
  `;
  const { rows } = await db.query(sql, params);
  return rows;
}

export async function listMovimientosByProducto(
  db,
  { productoId, from, to, limit = 100, offset = 0 },
) {
  const params = [productoId];
  let i = 2;
  let where = `m.producto_id = $1`;

  if (from) {
    params.push(from);
    where += ` AND m.fecha >= $${i++}::timestamptz`;
  }
  if (to) {
    params.push(to);
    where += ` AND m.fecha <= $${i++}::timestamptz`;
  }

  params.push(limit, offset);

  const sql = `
    SELECT
      m.id,
      m.fecha,
      m.tipo,
      m.cantidad,
      m.motivo,
      m.variante_id,
      m.usuario_id,
      u.email AS usuario_email
    FROM inventario.movimientos m
    LEFT JOIN seguridad.usuarios u ON u.id = m.usuario_id
    WHERE ${where}
    ORDER BY m.fecha DESC
    LIMIT $${i++} OFFSET $${i++};
  `;
  const { rows } = await db.query(sql, params);
  return rows;
}

export async function createMovimientoAndApply(
  db,
  { accion, varianteId, usuarioId, motivo, cantidad, stockFisico },
) {
  if (!usuarioId) {
    const e = new Error("No autenticado");
    e.code = "VALIDATION";
    throw e;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const vRes = await client.query(
      `
      SELECT v.id, v.producto_id, v.stock_fisico, v.stock_apartado
      FROM inventario.variantes_producto v
      WHERE v.id = $1
      FOR UPDATE
      `,
      [varianteId],
    );

    if (vRes.rows.length === 0) {
      const e = new Error("Variante no encontrada");
      e.code = "NOT_FOUND";
      throw e;
    }

    const v = vRes.rows[0];
    const productoId = v.producto_id;

    let delta = 0;
    let tipo = accion;

    if (accion === "SET_STOCK") {
      delta = Number(stockFisico) - Number(v.stock_fisico);
      tipo = "AJUSTE";
    } else {
      delta = Number(cantidad);
    }

    const nuevoStock = Number(v.stock_fisico) + delta;

    if (nuevoStock < 0) {
      const e = new Error(
        `Stock insuficiente. Intentas dejar stock_fisico en ${nuevoStock}.`,
      );
      e.code = "STOCK_NEGATIVO";
      throw e;
    }

    await client.query(
      `
      INSERT INTO inventario.movimientos (producto_id, variante_id, usuario_id, cantidad, motivo, tipo)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [productoId, varianteId, usuarioId, delta, motivo, tipo],
    );

    const uRes = await client.query(
      `
      UPDATE inventario.variantes_producto
      SET stock_fisico = stock_fisico + $2,
          updated_at = now()
      WHERE id = $1
      RETURNING id, producto_id, stock_fisico, stock_apartado
      `,
      [varianteId, delta],
    );

    await client.query("COMMIT");
    return uRes.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
