export async function listColores(db, { includeInactive = false } = {}) {
  const sql = `
    SELECT id, nombre, hex, activo
    FROM inventario.colores
    WHERE ($1::boolean = true) OR (activo = true)
    ORDER BY nombre;
  `;
  const { rows } = await db.query(sql, [includeInactive]);
  return rows;
}

export async function createColor(db, { nombre, hex }) {
  const sql = `
    INSERT INTO inventario.colores (nombre, hex, activo)
    VALUES ($1, $2, true)
    RETURNING id, nombre, hex, activo;
  `;
  const { rows } = await db.query(sql, [nombre, hex ?? null]);
  return rows[0];
}

export async function updateColor(db, id, { nombre, hex }) {
  const sql = `
    UPDATE inventario.colores
    SET
      nombre = COALESCE($2, nombre),
      hex = $3
    WHERE id = $1
    RETURNING id, nombre, hex, activo;
  `;
  const { rows } = await db.query(sql, [id, nombre ?? null, hex ?? null]);
  return rows[0] || null;
}

export async function setColorStatus(db, id, activo) {
  const sql = `
    UPDATE inventario.colores
    SET activo = $2
    WHERE id = $1
    RETURNING id, nombre, activo;
  `;
  const { rows } = await db.query(sql, [id, activo]);
  return rows[0] || null;
}
