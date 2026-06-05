export async function getProductoDetallePublic(db, productoId) {
  const { rows: prodRows } = await db.query(
    `
    SELECT
      id,
      nombre,
      descripcion,
      slug,
      destacado,
      activo,
      maneja_variantes,
      categoria_id,
      categoria_nombre,
      proveedor_id,
      fecha_creacion,
      precio_desde,
      precio_hasta,
      costo_desde,
      costo_hasta,
      variantes_activas,
      stock_fisico_activo_total AS stock_fisico_total,
      stock_apartado_activo_total AS stock_apartado_total,
      stock_disponible_activo_total AS stock_disponible_total
    FROM inventario.v_productos_resumen
    WHERE id = $1
      AND activo = TRUE
    LIMIT 1;
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
    ORDER BY
      talla_nombre NULLS LAST,
      color_nombre NULLS LAST,
      created_at ASC
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