export async function getAuditLogs(req, res) {
  try {
    const { rows } = await req.db.query(`
      SELECT
        al.id,
        al.modulo,
        al.accion,
        al.descripcion,
        al.metadata,
        al.created_at,
        u.email AS usuario_email
      FROM monitoreo.audit_logs al
      LEFT JOIN seguridad.usuarios u ON u.id = al.usuario_id
      ORDER BY al.created_at DESC
      LIMIT 100
    `);

    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("getAuditLogs error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo bitácora",
    });
  }
}
