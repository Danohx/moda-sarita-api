export async function insertProductoImagen(
  db,
  { productoId, publicId, url, orden, esPrincipal = false },
) {
  let ordenFinal = Number.isInteger(orden) ? orden : null;

  if (ordenFinal === null) {
    const { rows } = await db.query(
      `SELECT COALESCE(MAX(orden), -1) + 1 AS next_orden
       FROM inventario.producto_imagenes
       WHERE producto_id = $1`,
      [productoId],
    );

    ordenFinal = Number(rows[0]?.next_orden ?? 0);
  }

  const { rows } = await db.query(
    `INSERT INTO inventario.producto_imagenes (producto_id, public_id, url, orden, es_principal)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, producto_id, public_id, url, orden, es_principal, created_at`,
    [productoId, publicId, url, ordenFinal, esPrincipal],
  );

  return rows[0];
}

export async function listProductoImagenes(db, productoId) {
  const { rows } = await db.query(
    `SELECT id, public_id, url, orden, es_principal, created_at
     FROM inventario.producto_imagenes
     WHERE producto_id = $1
     ORDER BY es_principal DESC, orden ASC, created_at ASC`,
    [productoId],
  );
  return rows;
}

export async function setPrincipalImagen(db, { productoId, imagenId }) {
  await db.query(
    `UPDATE inventario.producto_imagenes
     SET es_principal = FALSE
     WHERE producto_id = $1`,
    [productoId],
  );

  const { rows } = await db.query(
    `UPDATE inventario.producto_imagenes
     SET es_principal = TRUE
     WHERE id = $1 AND producto_id = $2
     RETURNING id, producto_id, es_principal`,
    [imagenId, productoId],
  );

  return rows[0] || null;
}

export async function reorderProductoImagenes(db, { productoId, items }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const ids = items.map((x) => x.id);
    const { rows: owned } = await client.query(
      `SELECT id
       FROM inventario.producto_imagenes
       WHERE producto_id = $1 AND id = ANY($2::uuid[])`,
      [productoId, ids],
    );

    if (owned.length !== ids.length) {
      throw new Error("Una o más imágenes no pertenecen a este producto");
    }

    const principalCount = items.filter((x) => x.es_principal === true).length;
    if (principalCount > 1) {
      throw new Error("Solo una imagen puede ser principal");
    }

    const valuesSql = items
      .map((_, i) => `($${i * 2 + 2}::uuid, $${i * 2 + 3}::int)`)
      .join(", ");

    const params = [productoId];
    for (const it of items) {
      params.push(it.id);
      params.push(Number.isInteger(it.orden) ? it.orden : 0);
    }

    await client.query(
      `
      UPDATE inventario.producto_imagenes pi
      SET orden = v.orden
      FROM (VALUES ${valuesSql}) AS v(id, orden)
      WHERE pi.producto_id = $1 AND pi.id = v.id
      `,
      params,
    );

    const newPrincipal = items.find((x) => x.es_principal === true);
    if (newPrincipal) {
      await client.query(
        `UPDATE inventario.producto_imagenes
         SET es_principal = FALSE
         WHERE producto_id = $1`,
        [productoId],
      );

      const { rows } = await client.query(
        `UPDATE inventario.producto_imagenes
         SET es_principal = TRUE
         WHERE producto_id = $1 AND id = $2
         RETURNING id, producto_id, es_principal`,
        [productoId, newPrincipal.id],
      );

      if (rows.length === 0) throw new Error("No se pudo asignar la principal");
    }

    await client.query("COMMIT");

    const { rows: out } = await db.query(
      `SELECT id, public_id, url, orden, es_principal, created_at
       FROM inventario.producto_imagenes
       WHERE producto_id = $1
       ORDER BY es_principal DESC, orden ASC, created_at ASC`,
      [productoId],
    );

    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteProductoImagenWithFallback(
  db,
  { productoId, imagenId },
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: imgRows } = await client.query(
      `SELECT id, public_id, es_principal
       FROM inventario.producto_imagenes
       WHERE producto_id = $1 AND id = $2`,
      [productoId, imagenId],
    );

    if (imgRows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const img = imgRows[0];

    await client.query(
      `DELETE FROM inventario.producto_imagenes
       WHERE producto_id = $1 AND id = $2`,
      [productoId, imagenId],
    );

    if (img.es_principal) {
      const { rows: nextRows } = await client.query(
        `SELECT id
         FROM inventario.producto_imagenes
         WHERE producto_id = $1
         ORDER BY orden ASC, created_at ASC
         LIMIT 1`,
        [productoId],
      );

      if (nextRows.length > 0) {
        await client.query(
          `UPDATE inventario.producto_imagenes
           SET es_principal = TRUE
           WHERE producto_id = $1 AND id = $2`,
          [productoId, nextRows[0].id],
        );
      }
    }

    await client.query("COMMIT");
    return {
      id: img.id,
      public_id: img.public_id,
      era_principal: img.es_principal,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
