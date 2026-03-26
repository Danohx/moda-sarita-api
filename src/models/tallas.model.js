export async function listTallas(
  db,
  { includeInactive = false, tipo = null } = {},
) {
  const sql = `
    SELECT id, nombre, tipo, activo
    FROM inventario.tallas
    WHERE ($1::boolean = true) OR (activo = true)
      AND ($2::text IS NULL OR tipo = $2)
    ORDER BY COALESCE(tipo, ''), nombre;
  `;
  const { rows } = await db.query(sql, [includeInactive, tipo]);
  return rows;
}

export async function listTallasAdmin(db, { tipo = null } = {}) {
  const sql = `
    SELECT id, nombre, tipo, activo
    FROM inventario.tallas
    WHERE ($1::text IS NULL OR tipo = $1)
    ORDER BY COALESCE(tipo, ''), nombre;
  `;
  const { rows } = await db.query(sql, [tipo]);
  return rows;
}

export async function createTalla(db, { nombre, tipo }) {
  const sql = `
    INSERT INTO inventario.tallas (nombre, tipo, activo)
    VALUES ($1, $2, true)
    RETURNING id, nombre, tipo, activo;
  `;
  const { rows } = await db.query(sql, [nombre, tipo ?? null]);
  return rows[0];
}

export async function updateTalla(db, id, { nombre, tipo }) {
  const sql = `
    UPDATE inventario.tallas
    SET
      nombre = COALESCE($2, nombre),
      tipo = $3
    WHERE id = $1
    RETURNING id, nombre, tipo, activo;
  `;
  const { rows } = await db.query(sql, [id, nombre ?? null, tipo ?? null]);
  return rows[0] || null;
}

export async function setTallaStatus(db, id, activo) {
  const sql = `
    UPDATE inventario.tallas
    SET activo = $2
    WHERE id = $1
    RETURNING id, nombre, activo;
  `;
  const { rows } = await db.query(sql, [id, activo]);
  return rows[0] || null;
}
