export async function listCupones(db, { includeInactive = false } = {}) {
  const sql = `
    SELECT id, codigo, tipo_descuento, valor, monto_minimo_compra, fecha_inicio, fecha_fin, activo
    FROM marketing.cupones
    WHERE ($1::boolean = true) OR (activo = true)
    ORDER BY id DESC;
  `;
  const { rows } = await db.query(sql, [includeInactive]);
  return rows;
}

export async function createCupon(db, payload) {
  const {
    codigo,
    tipo_descuento,
    valor,
    monto_minimo_compra = 0,
    fecha_inicio,
    fecha_fin,
  } = payload;

  const sql = `
    INSERT INTO marketing.cupones
      (codigo, tipo_descuento, valor, monto_minimo_compra, fecha_inicio, fecha_fin, activo)
    VALUES ($1,$2,$3,$4,$5,$6,true)
    RETURNING *;
  `;
  const { rows } = await db.query(sql, [
    codigo,
    tipo_descuento,
    valor,
    monto_minimo_compra,
    fecha_inicio,
    fecha_fin,
  ]);
  return rows[0];
}

export async function updateCupon(db, id, payload) {
  const {
    codigo = null,
    tipo_descuento = null,
    valor = null,
    monto_minimo_compra = null,
    fecha_inicio = null,
    fecha_fin = null,
  } = payload;

  const sql = `
    UPDATE marketing.cupones
    SET
      codigo = COALESCE($2, codigo),
      tipo_descuento = COALESCE($3, tipo_descuento),
      valor = COALESCE($4, valor),
      monto_minimo_compra = COALESCE($5, monto_minimo_compra),
      fecha_inicio = COALESCE($6, fecha_inicio),
      fecha_fin = COALESCE($7, fecha_fin)
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await db.query(sql, [
    id,
    codigo,
    tipo_descuento,
    valor,
    monto_minimo_compra,
    fecha_inicio,
    fecha_fin,
  ]);
  return rows[0] || null;
}

export async function setCuponStatus(db, id, activo) {
  const { rows } = await db.query(
    `UPDATE marketing.cupones SET activo = $2 WHERE id = $1 RETURNING id, codigo, activo`,
    [id, activo],
  );
  return rows[0] || null;
}

export async function getCuponByCodigo(db, codigo) {
  const { rows } = await db.query(
    `SELECT * FROM marketing.cupones WHERE UPPER(codigo) = UPPER($1) LIMIT 1`,
    [codigo],
  );
  return rows[0] || null;
}
