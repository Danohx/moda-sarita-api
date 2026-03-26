export async function listProductosPublic(
  db,
  { q = null, categoriaId = null, destacado = null } = {},
) {
  const sql = `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.activo,
      p.destacado,
      p.slug,
      p.maneja_variantes,
      p.categoria_id,
      c.nombre AS categoria_nombre,
      (
        SELECT MIN(v.precio_venta)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS precio_desde,
      (
        SELECT MAX(v.precio_venta)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS precio_hasta,
      (
        SELECT COALESCE(SUM(GREATEST(v.stock_fisico - v.stock_apartado, 0)), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS stock_disponible_total,
      (
        SELECT pi.url
        FROM inventario.producto_imagenes pi
        WHERE pi.producto_id = p.id
        ORDER BY pi.es_principal DESC, pi.orden ASC, pi.created_at ASC
        LIMIT 1
      ) AS imagen_principal
    FROM inventario.productos p
    LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
    WHERE p.activo = TRUE
      AND ($1::text IS NULL OR p.nombre ILIKE '%' || $1 || '%' OR COALESCE(p.descripcion, '') ILIKE '%' || $1 || '%')
      AND ($2::int IS NULL OR p.categoria_id = $2)
      AND ($3::boolean IS NULL OR p.destacado = $3)
    ORDER BY p.destacado DESC, p.fecha_creacion DESC;
  `;

  const { rows } = await db.query(sql, [q, categoriaId, destacado]);
  return rows;
}

export async function listProductosAdmin(
  db,
  { q = null, categoriaId = null, destacado = null, activo = null } = {},
) {
  const sql = `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.activo,
      p.destacado,
      p.slug,
      p.maneja_variantes,
      p.categoria_id,
      p.proveedor_id,
      c.nombre AS categoria_nombre,
      (
        SELECT COUNT(*)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS variantes_count,
      (
        SELECT COALESCE(SUM(v.stock_fisico), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS stock_fisico_total,
      (
        SELECT COALESCE(SUM(v.stock_apartado), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS stock_apartado_total,
      (
        SELECT COALESCE(SUM(GREATEST(v.stock_fisico - v.stock_apartado, 0)), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS stock_disponible_total,
      (
        SELECT MIN(v.precio_venta)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS precio_desde,
      (
        SELECT MAX(v.precio_venta)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS precio_hasta,
      (
        SELECT pi.url
        FROM inventario.producto_imagenes pi
        WHERE pi.producto_id = p.id
        ORDER BY pi.es_principal DESC, pi.orden ASC, pi.created_at ASC
        LIMIT 1
      ) AS imagen_principal,
      (
        SELECT v.sku
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
        ORDER BY v.created_at ASC
        LIMIT 1
      ) AS sku,
      (
        SELECT MIN(v.precio_venta)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS precio_venta,
      (
        SELECT COALESCE(SUM(GREATEST(v.stock_fisico - v.stock_apartado, 0)), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS stock_total
    FROM inventario.productos p
    LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
    WHERE ($1::text IS NULL OR p.nombre ILIKE '%' || $1 || '%' OR COALESCE(p.descripcion, '') ILIKE '%' || $1 || '%')
      AND ($2::int IS NULL OR p.categoria_id = $2)
      AND ($3::boolean IS NULL OR p.destacado = $3)
      AND ($4::boolean IS NULL OR p.activo = $4)
    ORDER BY p.fecha_creacion DESC;
  `;

  const { rows } = await db.query(sql, [q, categoriaId, destacado, activo]);
  return rows;
}

export async function getProductoPublicById(db, id) {
  const sqlProducto = `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.slug,
      p.destacado,
      p.activo,
      p.maneja_variantes,
      p.categoria_id,
      p.proveedor_id,
      c.nombre AS categoria_nombre,
      (
        SELECT MIN(v.precio_venta)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS precio_desde,
      (
        SELECT MAX(v.precio_venta)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS precio_hasta,
      (
        SELECT COUNT(*)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS variantes_activas,
      (
        SELECT COALESCE(SUM(GREATEST(v.stock_fisico - v.stock_apartado, 0)), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS stock_disponible_total
    FROM inventario.productos p
    LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
    WHERE p.id = $1
      AND p.activo = TRUE
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
      p.id,
      p.nombre,
      p.descripcion,
      p.slug,
      p.categoria_id,
      c.nombre AS categoria_nombre,
      p.proveedor_id,
      p.activo,
      p.destacado,
      p.maneja_variantes,
      (
        SELECT COALESCE(SUM(v.stock_fisico), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS stock_fisico_total,
      (
        SELECT COALESCE(SUM(v.stock_apartado), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS stock_apartado_total,
      (
        SELECT COALESCE(SUM(GREATEST(v.stock_fisico - v.stock_apartado, 0)), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
      ) AS stock_disponible_total,
      (
        SELECT COUNT(*)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS variantes_activas
    FROM inventario.productos p
    LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
    WHERE p.id = $1
    LIMIT 1;
  `;
  const varianteSql = `
    SELECT
      v.id,
      v.sku,
      v.codigo_barras,
      v.precio_costo,
      v.precio_venta,
      v.stock_fisico,
      v.stock_apartado,
      v.stock_minimo,
      v.activo
    FROM inventario.variantes_producto v
    WHERE v.producto_id = $1
    ORDER BY v.created_at ASC
    LIMIT 1;
  `;
  const variantesSql = `
    SELECT
      v.id,
      v.sku,
      v.stock_fisico,
      v.stock_apartado,
      v.activo,
      t.nombre AS talla_nombre,
      col.nombre AS color_nombre
    FROM inventario.variantes_producto v
    LEFT JOIN inventario.tallas t ON t.id = v.talla_id
    LEFT JOIN inventario.colores col ON col.id = v.color_id
    WHERE v.producto_id = $1
    ORDER BY v.created_at ASC;
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
      variante_base.stock_apartado ?? 0,
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
