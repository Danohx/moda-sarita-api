export async function getProductoDetallePublic(db, productoId) {
  const { rows: prodRows } = await db.query(
    `
    SELECT
      p.id,
      p.nombre,
      p.descripcion,
      p.slug,
      p.destacado,
      p.activo,
      p.maneja_variantes,
      p.categoria_id,
      c.nombre AS categoria_nombre,
      p.proveedor_id,
      p.fecha_creacion,
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
        SELECT MIN(v.precio_costo)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS costo_desde,
      (
        SELECT MAX(v.precio_costo)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS costo_hasta,
      (
        SELECT COUNT(*)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS variantes_activas,
      (
        SELECT COALESCE(SUM(v.stock_fisico), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS stock_fisico_total,
      (
        SELECT COALESCE(SUM(v.stock_apartado), 0)
        FROM inventario.variantes_producto v
        WHERE v.producto_id = p.id
          AND v.activo = TRUE
      ) AS stock_apartado_total,
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
    `,
    [productoId],
  );

  if (prodRows.length === 0) return null;
  const producto = prodRows[0];

  const { rows: imagenes } = await db.query(
    `
    SELECT
      id,
      public_id,
      url,
      orden,
      es_principal,
      created_at
    FROM inventario.producto_imagenes
    WHERE producto_id = $1
    ORDER BY es_principal DESC, orden ASC, created_at ASC
    `,
    [productoId],
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
      v.precio_venta,
      v.precio_costo,
      v.stock_fisico,
      v.stock_apartado,
      v.stock_minimo,
      GREATEST(v.stock_fisico - v.stock_apartado, 0) AS stock_disponible,
      v.activo,
      v.created_at,
      v.updated_at
    FROM inventario.variantes_producto v
    JOIN inventario.productos p ON p.id = v.producto_id
    LEFT JOIN inventario.tallas t ON t.id = v.talla_id
    LEFT JOIN inventario.colores c ON c.id = v.color_id
    WHERE v.producto_id = $1
      AND v.activo = TRUE
      AND p.activo = TRUE
    ORDER BY
      t.nombre NULLS LAST,
      c.nombre NULLS LAST,
      v.created_at ASC
    `,
    [productoId],
  );

  const tallasMap = new Map();
  const coloresMap = new Map();

  for (const v of variantes) {
    if (v.talla_id) {
      tallasMap.set(v.talla_id, {
        id: v.talla_id,
        nombre: v.talla_nombre,
        tipo: v.talla_tipo,
      });
    }

    if (v.color_id) {
      coloresMap.set(v.color_id, {
        id: v.color_id,
        nombre: v.color_nombre,
        hex: v.color_hex,
      });
    }
  }

  const options = {
    tallas: Array.from(tallasMap.values()).sort((a, b) =>
      String(a.nombre).localeCompare(String(b.nombre)),
    ),
    colores: Array.from(coloresMap.values()).sort((a, b) =>
      String(a.nombre).localeCompare(String(b.nombre)),
    ),
  };

  const principal =
    imagenes.find((img) => img.es_principal) || imagenes[0] || null;

  return {
    producto,
    imagenes,
    imagen_principal: principal,
    variantes,
    options,
  };
}