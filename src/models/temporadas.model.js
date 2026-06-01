export async function listTemporadas(db, { includeInactive = false } = {}) {
  const { rows } = await db.query(
    `
    SELECT id, nombre, descripcion, activo, mes_inicio, dia_inicio, mes_fin, dia_fin, created_at
    FROM inventario.temporadas
    WHERE ($1::boolean = true) OR activo = true
    ORDER BY nombre ASC
    `,
    [includeInactive]
  );
  return rows;
}

export async function createTemporada(db, { nombre, descripcion = null, mes_inicio = null, dia_inicio = null, mes_fin = null, dia_fin = null }) {
  const { rows } = await db.query(
    `
    INSERT INTO inventario.temporadas (nombre, descripcion, mes_inicio, dia_inicio, mes_fin, dia_fin)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, nombre, descripcion, activo, mes_inicio, dia_inicio, mes_fin, dia_fin, created_at
    `,
    [nombre, descripcion, mes_inicio, dia_inicio, mes_fin, dia_fin]
  );
  return rows[0];
}

export async function updateTemporada(db, id, { nombre = null, descripcion = null, mes_inicio = null, dia_inicio = null, mes_fin = null, dia_fin = null }) {
  const { rows } = await db.query(
    `
    UPDATE inventario.temporadas
    SET
      nombre = COALESCE($2, nombre),
      descripcion = COALESCE($3, descripcion),
      mes_inicio = COALESCE($4, mes_inicio),
      dia_inicio = COALESCE($5, dia_inicio),
      mes_fin = COALESCE($6, mes_fin),
      dia_fin = COALESCE($7, dia_fin)
    WHERE id = $1
    RETURNING id, nombre, descripcion, activo, mes_inicio, dia_inicio, mes_fin, dia_fin, created_at
    `,
    [id, nombre, descripcion, mes_inicio, dia_inicio, mes_fin, dia_fin]
  );
  return rows[0] || null;
}

export async function setTemporadaStatus(db, id, activo) {
  const { rows } = await db.query(
    `
    UPDATE inventario.temporadas
    SET activo = $2
    WHERE id = $1
    RETURNING id, nombre, activo
    `,
    [id, activo]
  );
  return rows[0] || null;
}