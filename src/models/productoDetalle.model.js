export async function getProductoDetallePublic(db, productoId) {
  const { rows: prodRows } = await db.query(
    `
    SELECT
      id,
      nombre,
      descripcion,
      precio_venta,
      precio_costo,
      sku,
      slug,
      destacado,
      activo,
      maneja_variantes,
      categoria_id,
      fecha_creacion
    FROM inventario.productos
    WHERE id = $1 AND activo = TRUE
    `,
    [productoId]
  );

  if (prodRows.length === 0) return null;
  const producto = prodRows[0];

  const { rows: imagenes } = await db.query(
    `
    SELECT id, public_id, url, orden, es_principal, created_at
    FROM inventario.producto_imagenes
    WHERE producto_id = $1
    ORDER BY es_principal DESC, orden ASC, created_at ASC
    `,
    [productoId]
  );

  const { rows: variantes } = await db.query(
    `
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
      COALESCE(v.precio_costo, p.precio_costo) AS precio_costo,
      v.stock_fisico,
      v.stock_apartado,
      GREATEST(v.stock_fisico - v.stock_apartado, 0) AS stock_disponible,
      v.activo
    FROM inventario.variantes_producto v
    JOIN inventario.productos p ON p.id = v.producto_id
    LEFT JOIN inventario.tallas t ON t.id = v.talla_id
    LEFT JOIN inventario.colores c ON c.id = v.color_id
    WHERE v.producto_id = $1
      AND v.activo = TRUE
      AND p.activo = TRUE
    ORDER BY t.nombre NULLS LAST, c.nombre NULLS LAST
    `,
    [productoId]
  );

  const tallasMap = new Map();
  const coloresMap = new Map();

  for (const v of variantes) {
    if (v.talla_id) tallasMap.set(v.talla_id, { id: v.talla_id, nombre: v.talla_nombre, tipo: v.talla_tipo });
    if (v.color_id) coloresMap.set(v.color_id, { id: v.color_id, nombre: v.color_nombre, hex: v.color_hex });
  }

  const options = {
    tallas: Array.from(tallasMap.values()).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
    colores: Array.from(coloresMap.values()).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
  };

  return { producto, imagenes, variantes, options };
}
