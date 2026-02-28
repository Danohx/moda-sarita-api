export async function getDashboardResumen(req, res) {
  try {
    const { rows: ventasHoy } = await req.db.query(
      `SELECT COALESCE(SUM(total),0) as total
       FROM ventas.pedidos
       WHERE fecha_creacion >= date_trunc('day', now())`,
    );

    const { rows: pend } = await req.db.query(
      `SELECT COUNT(*)::int as count
       FROM ventas.pedidos
       WHERE estado = 'PENDIENTE'`,
    );

    const { rows: bajo } = await req.db.query(
      `SELECT COUNT(*)::int as count
       FROM inventario.variantes_producto v
       JOIN inventario.productos p ON p.id = v.producto_id
       WHERE v.activo = true AND p.activo = true
         AND (GREATEST(v.stock_fisico - v.stock_apartado, 0) <= COALESCE(p.stock_minimo,0))`,
    );

    return res.json({
      ok: true,
      data: {
        ventas_hoy: Number(ventasHoy[0].total || 0),
        pedidos_pendientes: Number(pend[0].count || 0),
        bajo_stock: Number(bajo[0].count || 0),
      },
    });
  } catch (err) {
    console.error("getDashboardResumen error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error cargando dashboard",
        detail: err.message,
      });
  }
}
