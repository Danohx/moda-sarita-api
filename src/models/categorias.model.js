export async function listCategoriasPublicas(db, { includeInactive = false } = {}) {
  const sql = `
    SELECT id, nombre, descripcion, parent_id, slug, activo
    FROM inventario.categorias
    WHERE ($1::boolean = true) OR (activo = true)
    ORDER BY COALESCE(parent_id, 0), nombre;
  `;
  const { rows } = await db.query(sql, [includeInactive]);
  return rows;
}

export async function getCategoriaByIdInterna(id) {
  const sql = `
    SELECT id, nombre, descripcion, parent_id, slug, activo
    FROM inventario.categorias
    WHERE id = $1;
  `;
  const { rows } = await poolInterno.query(sql, [id]);
  return rows[0] || null;
}

export async function createCategoriaInterna(db, { nombre, descripcion, parent_id, slug }) {
  const sql = `
    INSERT INTO inventario.categorias (nombre, descripcion, parent_id, slug, activo)
    VALUES ($1, $2, $3, $4, true)
    RETURNING id, nombre, descripcion, parent_id, slug, activo;
  `;
  const { rows } = await db.query(sql, [
    nombre,
    descripcion ?? null,
    parent_id ?? null,
    slug ?? null,
  ]);
  return rows[0];
}

export async function updateCategoriaInterna(db, id, { nombre, descripcion, parent_id, slug }) {
  const sql = `
    UPDATE inventario.categorias
    SET
      nombre = COALESCE($2, nombre),
      descripcion = COALESCE($3, descripcion),
      parent_id = $4,
      slug = COALESCE($5, slug)
    WHERE id = $1
    RETURNING id, nombre, descripcion, parent_id, slug, activo;
  `;
  const { rows } = await db.query(sql, [
    id,
    nombre ?? null,
    descripcion ?? null,
    parent_id ?? null,
    slug ?? null,
  ]);
  return rows[0] || null;
}

export async function setCategoriaStatusInterna(db, id, activo) {
  const sql = `
    UPDATE inventario.categorias
    SET activo = $2
    WHERE id = $1
    RETURNING id, nombre, activo;
  `;
  const { rows } = await db.query(sql, [id, activo]);
  return rows[0] || null;
}
