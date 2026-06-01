export async function listTemporadasByProducto(db, productoId) {
  const { rows } = await db.query(
    `
    SELECT t.id, t.nombre, t.descripcion, t.activo, t.mes_inicio, t.dia_inicio, t.mes_fin, t.dia_fin
    FROM inventario.producto_temporadas pt
    JOIN inventario.temporadas t ON t.id = pt.temporada_id
    WHERE pt.producto_id = $1
    ORDER BY t.nombre ASC
    `,
    [productoId]
  );
  return rows;
}

export async function assignTemporadasToProducto(db, productoId, temporadaIds = []) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM inventario.producto_temporadas WHERE producto_id = $1`,
      [productoId]
    );

    for (const temporadaId of temporadaIds) {
      await client.query(
        `
        INSERT INTO inventario.producto_temporadas (producto_id, temporada_id)
        VALUES ($1, $2)
        ON CONFLICT (producto_id, temporada_id) DO NOTHING
        `,
        [productoId, temporadaId]
      );
    }

    await client.query("COMMIT");

    const { rows } = await db.query(
      `
      SELECT t.id, t.nombre, t.descripcion, t.activo, t.mes_inicio, t.dia_inicio, t.mes_fin, t.dia_fin
      FROM inventario.producto_temporadas pt
      JOIN inventario.temporadas t ON t.id = pt.temporada_id
      WHERE pt.producto_id = $1
      ORDER BY t.nombre ASC
      `,
      [productoId]
    );

    return rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function removeTemporadaFromProducto(db, productoId, temporadaId) {
  const { rowCount } = await db.query(
    `
    DELETE FROM inventario.producto_temporadas
    WHERE producto_id = $1 AND temporada_id = $2
    `,
    [productoId, temporadaId]
  );
  return rowCount > 0;
}