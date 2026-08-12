export async function listExistencias(
  db,
  { q, categoriaId, soloBajoStock, varianteId, productoId, limit, offset },
) {
  const params = [];
  let i = 1;

  const where = ["producto_activo = TRUE", "variante_activo = TRUE"];

  if (varianteId) {
    params.push(varianteId);
    where.push(`variante_id = $${i++}`);
  }

  if (productoId) {
    params.push(productoId);
    where.push(`producto_id = $${i++}`);
  }

  if (categoriaId) {
    params.push(categoriaId);
    where.push(`categoria_id = $${i++}`);
  }

  const term = q ? String(q).trim() : null;
  if (term) {
    params.push(`%${term}%`);
    where.push(`(
      producto_nombre ILIKE $${i}
      OR sku ILIKE $${i}
      OR codigo_barras ILIKE $${i}
    )`);
    i++;
  }

  if (soloBajoStock) {
    where.push("bajo_stock = TRUE");
  }

  const whereClause = where.join(" AND ");

  const countSql = `
    SELECT COUNT(*) AS total
    FROM inventario.v_existencias_detalle
    WHERE ${whereClause};
  `;
  const { rows: countRows } = await db.query(countSql, params);
  const total = Number(countRows[0].total);

  params.push(limit);
  const limitParam = i++;
  params.push(offset);
  const offsetParam = i++;

  const sql = `
    SELECT
      variante_id,
      producto_id,
      producto_nombre,
      categoria_id,
      categoria_nombre,
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
      bajo_stock,
      activo,
      updated_at
    FROM inventario.v_existencias_detalle
    WHERE ${where.join(" AND ")}
    ORDER BY producto_nombre ASC, talla_nombre NULLS LAST, color_nombre NULLS LAST
    LIMIT $${limitParam} OFFSET $${offsetParam};
  `;

  const { rows } = await db.query(sql, params);
  return {
    items: rows,
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
}

export async function getStockByVariante(db, varianteId) {
  const { rows } = await db.query(
    `
    SELECT
      variante_id,
      producto_id,
      producto_nombre,
      categoria_id,
      categoria_nombre,
      talla_id,
      talla_nombre,
      talla_tipo,
      color_id,
      color_nombre,
      color_hex,
      sku,
      codigo_barras,
      stock_fisico,
      stock_apartado,
      stock_minimo,
      stock_disponible,
      bajo_stock,
      activo,
      updated_at
    FROM inventario.v_existencias_detalle
    WHERE variante_id = $1
    LIMIT 1;
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
  const where = [`variante_id = $1`];

  if (from) {
    params.push(from);
    where.push(`fecha >= $${i++}::timestamptz`);
  }

  if (to) {
    params.push(to);
    where.push(`fecha <= $${i++}::timestamptz`);
  }

  params.push(limit);
  const limitParam = i++;
  params.push(offset);
  const offsetParam = i++;

  const sql = `
    SELECT
      id,
      fecha,
      tipo,
      cantidad,
      motivo,
      usuario_id,
      usuario_email,
      variante_id,
      producto_id,
      producto_nombre,
      sku
    FROM inventario.v_kardex_movimientos
    WHERE ${where.join(" AND ")}
    ORDER BY fecha DESC, id DESC
    LIMIT $${limitParam} OFFSET $${offsetParam};
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
  const where = [`producto_id = $1`];

  if (from) {
    params.push(from);
    where.push(`fecha >= $${i++}::timestamptz`);
  }

  if (to) {
    params.push(to);
    where.push(`fecha <= $${i++}::timestamptz`);
  }

  params.push(limit);
  const limitParam = i++;
  params.push(offset);
  const offsetParam = i++;

  const sql = `
    SELECT
      id,
      fecha,
      tipo,
      cantidad,
      motivo,
      variante_id,
      producto_id,
      sku,
      codigo_barras,
      talla_id,
      talla_nombre,
      color_id,
      color_nombre,
      usuario_id,
      usuario_email
    FROM inventario.v_kardex_movimientos
    WHERE ${where.join(" AND ")}
    ORDER BY fecha DESC, id DESC
    LIMIT $${limitParam} OFFSET $${offsetParam};
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
      SELECT
        v.id,
        v.producto_id,
        v.stock_fisico,
        v.stock_apartado,
        v.stock_minimo
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

    const stockApartado = Number(v.stock_apartado || 0);
    if (nuevoStock < stockApartado) {
      const e = new Error(
        `No puedes dejar stock_fisico en ${nuevoStock}: existen ${stockApartado} unidades apartadas.`,
      );
      e.code = "STOCK_RESERVADO";
      throw e;
    }




    await client.query(
      `
      INSERT INTO inventario.movimientos (variante_id, usuario_id, cantidad, motivo, tipo)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [varianteId, usuarioId, delta, motivo, tipo],
    );

    const uRes = await client.query(
      `
      UPDATE inventario.variantes_producto
      SET stock_fisico = stock_fisico + $2,
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

// Alertas
export async function getAlertasInventario(db, { limit = 20 } = {}) {
  const safeLimit = Number.isInteger(Number(limit))
    ? Math.min(Math.max(Number(limit), 1), 100)
    : 20;

  const [bajoStock, sinImagen, sinCategoria] = await Promise.all([
    db.query(
      `
        SELECT
          variante_id,
          producto_id,
          producto_nombre,
          categoria_nombre,
          talla_nombre,
          color_nombre,
          sku,
          codigo_barras,
          stock_fisico,
          stock_apartado,
          stock_disponible,
          stock_minimo,
          updated_at
        FROM configuracion.v_alertas_bajo_stock
        ORDER BY stock_disponible ASC, producto_nombre ASC
        LIMIT $1;
      `,
      [safeLimit],
    ),

    db.query(
      `
        SELECT
          producto_id,
          nombre,
          categoria_id,
          categoria_nombre,
          activo,
          fecha_creacion
        FROM configuracion.v_productos_sin_imagen
        ORDER BY fecha_creacion DESC
        LIMIT $1;
      `,
      [safeLimit],
    ),

    db.query(
      `
        SELECT
          *
        FROM configuracion.v_productos_sin_categoria
        ORDER BY fecha_creacion DESC
        LIMIT $1;
      `,
      [safeLimit],
    ),
  ]);

  return {
    bajo_stock: bajoStock.rows,
    productos_sin_imagen: sinImagen.rows,
    productos_sin_categoria: sinCategoria.rows,
    resumen: {
      bajo_stock: bajoStock.rows.length,
      productos_sin_imagen: sinImagen.rows.length,
      productos_sin_categoria: sinCategoria.rows.length,
      total:
        bajoStock.rows.length +
        sinImagen.rows.length +
        sinCategoria.rows.length,
    },
  };
}