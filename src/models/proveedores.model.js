export async function listProveedores(
  db,
  { q = null, includeInactive = false } = {},
) {
  const sql = `
    SELECT id, empresa, nombre_contacto, telefono, email, direccion, activo
    FROM inventario.proveedores
    WHERE ($2::boolean = true OR activo = true)
      AND (
        $1::text IS NULL
        OR empresa ILIKE '%'||$1||'%'
        OR telefono ILIKE '%'||$1||'%'
        OR COALESCE(email,'') ILIKE '%'||$1||'%'
      )
    ORDER BY empresa ASC;
  `;
  const { rows } = await db.query(sql, [q, includeInactive]);
  return rows;
}

export async function createProveedor(db, payload) {
  const {
    empresa,
    nombre_contacto = null,
    telefono,
    email = null,
    direccion = null,
  } = payload;

  const sql = `
    INSERT INTO inventario.proveedores (empresa, nombre_contacto, telefono, email, direccion, activo)
    VALUES ($1,$2,$3,$4,$5,true)
    RETURNING id, empresa, nombre_contacto, telefono, email, direccion, activo;
  `;
  const { rows } = await db.query(sql, [
    empresa,
    nombre_contacto,
    telefono,
    email,
    direccion,
  ]);
  return rows[0];
}

export async function updateProveedor(db, id, payload) {
  const {
    empresa = null,
    nombre_contacto = null,
    telefono = null,
    email = null,
    direccion = null,
  } = payload;

  const sql = `
    UPDATE inventario.proveedores
    SET
      empresa = COALESCE($2, empresa),
      nombre_contacto = COALESCE($3, nombre_contacto),
      telefono = COALESCE($4, telefono),
      email = COALESCE($5, email),
      direccion = COALESCE($6, direccion)
    WHERE id = $1
    RETURNING id, empresa, nombre_contacto, telefono, email, direccion, activo;
  `;
  const { rows } = await db.query(sql, [
    id,
    empresa,
    nombre_contacto,
    telefono,
    email,
    direccion,
  ]);
  return rows[0] || null;
}

export async function setProveedorStatus(db, id, activo) {
  const sql = `
    UPDATE inventario.proveedores
    SET activo = $2
    WHERE id = $1
    RETURNING id, empresa, activo;
  `;
  const { rows } = await db.query(sql, [id, activo]);
  return rows[0] || null;
}
