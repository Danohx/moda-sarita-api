export async function getDatabaseSummary(req, res) {
  try {
    const db = req.db;

    const sizeResult = await db.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size
    `);

    const connectionsResult = await db.query(`
      SELECT count(*)::int AS total
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND backend_type = 'client backend'
    `);

    return res.json({
      ok: true,
      data: {
        status: "Activa",
        size: sizeResult.rows[0].size,
        connections: connectionsResult.rows[0].total,
      },
    });
  } catch (err) {
    console.error("monitoring summary error:", err);
    return res.status(500).json({ ok: false });
  }
}

export async function getDatabaseTables(req, res) {
  try {
    const db = req.db;

    const result = await db.query(`
      SELECT
        schemaname,
        relname,
        pg_size_pretty(pg_total_relation_size(relid)) AS size
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `);

    return res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false });
  }
}

export async function getDatabaseVacuum(req, res) {
  try {
    const db = req.db;

    const result = await db.query(`
      SELECT
        schemaname,
        relname,
        n_live_tup,
        n_dead_tup,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables
      ORDER BY n_dead_tup DESC, schemaname ASC, relname ASC
      LIMIT 50
    `);

    return res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false });
  }
}

export async function getDatabaseConnections(req, res) {
  try {
    const db = req.db;

    const result = await db.query(`
      SELECT count(*) AS total
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    return res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false });
  }
}