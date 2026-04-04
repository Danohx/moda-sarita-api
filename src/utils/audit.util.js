export async function createAuditLog(
  db,
  {
    modulo,
    accion,
    descripcion = null,
    usuarioId = null,
    metadata = null,
  },
) {
  await db.query(
    `
      INSERT INTO monitoreo.audit_logs
        (modulo, accion, descripcion, usuario_id, metadata)
      VALUES
        ($1, $2, $3, $4, $5)
    `,
    [modulo, accion, descripcion, usuarioId, metadata],
  );
}
