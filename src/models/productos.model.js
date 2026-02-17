export async function listProductosPublic(db, { q = null, categoriaId = null, destacado = null } = {}) {
  const sql = `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.precio_venta,
      p.activo,
      p.destacado,
      p.slug,
      p.categoria_id,
      c.nombre AS categoria_nombre,
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
      AND ($1::text IS NULL OR p.nombre ILIKE '%' || $1 || '%' OR p.descripcion ILIKE '%' || $1 || '%')
      AND ($2::int IS NULL OR p.categoria_id = $2)
      AND ($3::boolean IS NULL OR p.destacado = $3)
    ORDER BY p.destacado DESC, p.fecha_creacion DESC;
  `;
  const { rows } = await db.query(sql, [q, categoriaId, destacado]);
  return rows;
}

export async function getProductoPublicById(db, id) {
  const sqlProducto = `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.precio_venta,
      p.precio_costo,
      p.slug,
      p.destacado,
      p.maneja_variantes,
      p.categoria_id,
      c.nombre AS categoria_nombre
    FROM inventario.productos p
    LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
    WHERE p.id = $1 AND p.activo = TRUE
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

  return { ...pRows[0], imagenes: imgRows };
}

export async function createProducto(db, payload) {
  const {
    nombre,
    descripcion = null,
    sku = null,
    codigo_barras = null,
    precio_costo,
    precio_venta,
    categoria_id = null,
    proveedor_id = null,
    destacado = false,
    activo = true,
    slug = null,
    maneja_variantes = true,
  } = payload;

  const sql = `
    INSERT INTO inventario.productos
      (nombre, descripcion, sku, codigo_barras, precio_costo, precio_venta,
       categoria_id, proveedor_id, destacado, activo, slug, maneja_variantes)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING id, nombre, sku, slug, activo, destacado, maneja_variantes;
  `;

  const { rows } = await db.query(sql, [
    nombre,
    descripcion,
    sku,
    codigo_barras,
    precio_costo,
    precio_venta,
    categoria_id,
    proveedor_id,
    destacado,
    activo,
    slug,
    maneja_variantes,
  ]);

  return rows[0];
}

export async function updateProducto(db, id, payload) {
  const {
    nombre = null,
    descripcion = null,
    sku = null,
    codigo_barras = null,
    precio_costo = null,
    precio_venta = null,
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
      sku = $4,
      codigo_barras = $5,
      precio_costo = COALESCE($6, precio_costo),
      precio_venta = COALESCE($7, precio_venta),
      categoria_id = $8,
      proveedor_id = $9,
      slug = $10,
      maneja_variantes = COALESCE($11, maneja_variantes)
    WHERE id = $1
    RETURNING id, nombre, sku, slug, activo, destacado, maneja_variantes;
  `;

  const { rows } = await db.query(sql, [
    id,
    nombre,
    descripcion,
    sku,
    codigo_barras,
    precio_costo,
    precio_venta,
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
    [id, activo]
  );
  return rows[0] || null;
}

export async function setProductoDestacado(db, id, destacado) {
  const { rows } = await db.query(
    `UPDATE inventario.productos
     SET destacado = $2
     WHERE id = $1
     RETURNING id, nombre, destacado`,
    [id, destacado]
  );
  return rows[0] || null;
}
