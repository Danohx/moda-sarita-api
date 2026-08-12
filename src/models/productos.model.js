export async function listProductosPublic(
  db,
  { q = null, categoriaId = null, destacado = null } = {},
) {
  const params = [];
  let i = 1;
  const where = ["activo = TRUE"];

  const term = q ? String(q).trim() : null;
  if (term) {
    params.push(`%${term}%`);
    where.push(`(nombre ILIKE $${i} OR descripcion ILIKE $${i})`);
    i++;
  }

  if (categoriaId !== null && categoriaId !== undefined) {
    params.push(categoriaId);
    where.push(`categoria_id = $${i++}`);
  }

  if (destacado !== null && destacado !== undefined) {
    params.push(destacado);
    where.push(`destacado = $${i++}`);
  }

  const sql = `
    SELECT
      id,
      nombre,
      descripcion,
      activo,
      destacado,
      slug,
      maneja_variantes,
      categoria_id,
      categoria_nombre,
      precio_desde,
      precio_hasta,
      stock_disponible_activo_total AS stock_disponible_total,
      imagen_principal
    FROM inventario.v_productos_resumen
    WHERE ${where.join(" AND ")}
    ORDER BY destacado DESC, fecha_creacion DESC;
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

export async function listProductosAdmin(
  db,
  { q = null, categoriaId = null, destacado = null, activo = null } = {},
) {
  const params = [];
  let i = 1;
  const where = [];

  const term = q ? String(q).trim() : null;
  if (term) {
    params.push(`%${term}%`);
    where.push(`(nombre ILIKE $${i} OR descripcion ILIKE $${i})`);
    i++;
  }

  if (categoriaId !== null && categoriaId !== undefined) {
    params.push(categoriaId);
    where.push(`categoria_id = $${i++}`);
  }

  if (destacado !== null && destacado !== undefined) {
    params.push(destacado);
    where.push(`destacado = $${i++}`);
  }

  if (activo !== null && activo !== undefined) {
    params.push(activo);
    where.push(`activo = $${i++}`);
  }

  const sql = `
    SELECT
      id,
      nombre,
      descripcion,
      activo,
      destacado,
      slug,
      maneja_variantes,
      categoria_id,
      proveedor_id,
      categoria_nombre,
      variantes_count,
      stock_fisico_total,
      stock_apartado_total,
      stock_disponible_total,
      precio_desde,
      precio_hasta,
      imagen_principal,
      sku,
      precio_venta,
      stock_total
    FROM inventario.v_productos_resumen
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY fecha_creacion DESC;
  `;

  const { rows } = await db.query(sql, params);
  return rows;
}

export async function getProductoPublicById(db, id) {
  const sqlProducto = `
    SELECT
      id,
      nombre,
      descripcion,
      slug,
      destacado,
      activo,
      maneja_variantes,
      categoria_id,
      proveedor_id,
      categoria_nombre,
      precio_desde,
      precio_hasta,
      variantes_activas,
      stock_disponible_activo_total AS stock_disponible_total
    FROM inventario.v_productos_resumen
    WHERE id = $1
      AND activo = TRUE
    LIMIT 1;
  `;

  const sqlImgs = `
    SELECT id, public_id, url, orden, es_principal
    FROM inventario.producto_imagenes
    WHERE producto_id = $1
    ORDER BY es_principal DESC, orden ASC, created_at ASC
  `;

  const { rows: pRows } = await db.query(sqlProducto, [id]);
  if (pRows.length === 0) return null;

  const { rows: imgRows } = await db.query(sqlImgs, [id]);

  return {
    ...pRows[0],
    imagenes: imgRows,
  };
}

export async function getProductoAdminByIdModel(db, id) {
  const sqlProducto = `
    SELECT
      id,
      nombre,
      descripcion,
      slug,
      categoria_id,
      categoria_nombre,
      proveedor_id,
      activo,
      destacado,
      maneja_variantes,
      stock_fisico_total,
      stock_apartado_total,
      stock_disponible_total,
      variantes_activas
    FROM inventario.v_productos_resumen
    WHERE id = $1
    LIMIT 1;
  `;

  const varianteSql = `
    SELECT
      id,
      sku,
      codigo_barras,
      precio_costo,
      precio_venta,
      stock_fisico,
      stock_apartado,
      stock_minimo,
      activo
    FROM inventario.v_variantes_detalle
    WHERE producto_id = $1
    ORDER BY created_at ASC
    LIMIT 1;
  `;

  const variantesSql = `
    SELECT
      id,
      sku,
      stock_fisico,
      stock_apartado,
      activo,
      talla_nombre,
      color_nombre
    FROM inventario.v_variantes_detalle
    WHERE producto_id = $1
    ORDER BY created_at ASC;
  `;

  const imagenesSql = `
    SELECT
      pi.id,
      pi.url,
      pi.orden,
      pi.es_principal
    FROM inventario.producto_imagenes pi
    WHERE pi.producto_id = $1
    ORDER BY pi.es_principal DESC, pi.orden ASC, pi.created_at ASC;
  `;

  const { rows: productoRow } = await db.query(sqlProducto, [id]);
  if (productoRow.length === 0) return null;

  const { rows: varianteRow } = await db.query(varianteSql, [id]);
  const { rows: variantesRow } = await db.query(variantesSql, [id]);
  const { rows: imagenRows } = await db.query(imagenesSql, [id]);

  return {
    producto: productoRow[0],
    variante_base: varianteRow[0] || null,
    imagenes: imagenRows ?? [],
    variantes: variantesRow ?? [],
  };
}

export async function createProductoConVarianteBase(db, payload) {
  const {
    nombre,
    descripcion = null,
    categoria_id = null,
    proveedor_id = null,
    destacado = false,
    activo = true,
    slug = null,
    maneja_variantes = true,
    variante_base,
  } = payload;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const productoSql = `
      INSERT INTO inventario.productos
        (nombre, descripcion, categoria_id, proveedor_id, destacado, activo, slug, maneja_variantes)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, nombre, descripcion, categoria_id, proveedor_id, slug, activo, destacado, maneja_variantes, fecha_creacion;
    `;

    const { rows: productoRows } = await client.query(productoSql, [
      nombre,
      descripcion,
      categoria_id,
      proveedor_id,
      destacado,
      activo,
      slug,
      maneja_variantes,
    ]);

    const producto = productoRows[0];

    const varianteSql = `
      INSERT INTO inventario.variantes_producto
        (producto_id, talla_id, color_id, sku, codigo_barras, precio_venta, precio_costo,
         stock_fisico, stock_apartado, stock_minimo, activo)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING
        id, producto_id, talla_id, color_id, sku, codigo_barras, precio_venta, precio_costo,
        stock_fisico, stock_apartado, stock_minimo, activo, created_at, updated_at;
    `;

    const { rows: varianteRows } = await client.query(varianteSql, [
      producto.id,
      variante_base.talla_id ?? null,
      variante_base.color_id ?? null,
      variante_base.sku,
      variante_base.codigo_barras ?? null,
      variante_base.precio_venta,
      variante_base.precio_costo ?? null,
      variante_base.stock_fisico ?? 0,
      0,
      variante_base.stock_minimo ?? 5,
      variante_base.activo !== false,
    ]);

    await client.query("COMMIT");

    return {
      producto,
      variante_base: varianteRows[0],
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateProducto(db, id, payload) {
  const {
    nombre = null,
    descripcion = null,
    categoria_id = null,
    proveedor_id = null,
    slug = null,
    maneja_variantes = null,
  } = payload;

  const sql = `
    UPDATE inventario.productos
    SET
      nombre = COALESCE($2, nombre),
      descripcion = COALESCE($3, descripcion),
      categoria_id = $4,
      proveedor_id = $5,
      slug = $6,
      maneja_variantes = COALESCE($7, maneja_variantes)
    WHERE id = $1
    RETURNING id, nombre, descripcion, categoria_id, proveedor_id, slug, activo, destacado, maneja_variantes, fecha_creacion;
  `;

  const { rows } = await db.query(sql, [
    id,
    nombre,
    descripcion,
    categoria_id,
    proveedor_id,
    slug,
    maneja_variantes,
  ]);

  return rows[0] || null;
}

export async function setProductoStatus(db, id, activo) {
  const { rows } = await db.query(
    `UPDATE inventario.productos
     SET activo = $2
     WHERE id = $1
     RETURNING id, nombre, activo`,
    [id, activo],
  );
  return rows[0] || null;
}

export async function setProductoDestacado(db, id, destacado) {
  const { rows } = await db.query(
    `UPDATE inventario.productos
     SET destacado = $2
     WHERE id = $1
     RETURNING id, nombre, destacado`,
    [id, destacado],
  );
  return rows[0] || null;
}