import { createAuditLog } from "../utils/audit.util.js";

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function getMaintainableTables(db) {
  const { rows } = await db.query(`
    SELECT
      schemaname,
      relname
    FROM pg_stat_user_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY schemaname ASC, relname ASC
  `);

  return rows.map((row) => ({
    schemaname: row.schemaname,
    relname: row.relname,
    fullName: `${row.schemaname}.${row.relname}`,
  }));
}

export async function getMaintenanceHistory(req, res) {
  try {
    const { rows } = await req.db.query(`
      SELECT
        mj.id,
        mj.tipo,
        mj.estado,
        mj.detalle,
        mj.iniciado_en,
        mj.finalizado_en,
        mj.created_at,
        u.email AS ejecutado_por_email
      FROM monitoreo.maintenance_jobs mj
      LEFT JOIN seguridad.usuarios u ON u.id = mj.ejecutado_por
      ORDER BY mj.created_at DESC
      LIMIT 50
    `);

    return res.json({ ok: true, data: rows });
  } catch (error) {
    console.error("getMaintenanceHistory error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo historial de mantenimiento",
    });
  }
}

export async function getMaintenanceTables(req, res) {
  try {
    const tables = await getMaintainableTables(req.db);

    return res.json({
      ok: true,
      data: tables.map((table) => table.fullName),
    });
  } catch (error) {
    console.error("getMaintenanceTables error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo tablas para mantenimiento",
    });
  }
}

export async function runMaintenance(req, res) {
  const usuarioId = req.user?.id ?? null;

  try {
    const availableTables = await getMaintainableTables(req.db);
    const availableMap = new Map(
      availableTables.map((table) => [table.fullName, table]),
    );

    const requestedTables = Array.isArray(req.body?.tables)
      ? req.body.tables.filter((table) => typeof table === "string")
      : [];

    const tablesToProcess =
      requestedTables.length > 0
        ? requestedTables
            .map((table) => availableMap.get(table))
            .filter(Boolean)
        : availableTables;

    if (tablesToProcess.length === 0) {
      return res.status(400).json({
        ok: false,
        msg: "No hay tablas válidas para mantenimiento.",
      });
    }

    const { rows: jobRows } = await req.db.query(
      `
        INSERT INTO monitoreo.maintenance_jobs
          (tipo, estado, detalle, iniciado_en, ejecutado_por)
        VALUES
          ($1, 'running', $2, now(), $3)
        RETURNING id
      `,
      [
        "VACUUM ANALYZE",
        `Mantenimiento iniciado para ${tablesToProcess.length} tabla(s)`,
        usuarioId,
      ],
    );

    const jobId = jobRows[0].id;
    const processedTables = [];

    for (const table of tablesToProcess) {
      const sql = `VACUUM ANALYZE ${quoteIdentifier(table.schemaname)}.${quoteIdentifier(table.relname)}`;
      await req.db.query(sql);
      processedTables.push(table.fullName);
    }

    await req.db.query(
      `
        UPDATE monitoreo.maintenance_jobs
        SET estado = 'completed',
            detalle = $2,
            finalizado_en = now()
        WHERE id = $1
      `,
      [
        jobId,
        `VACUUM ANALYZE ejecutado correctamente en ${processedTables.length} tabla(s)`,
      ],
    );

    await createAuditLog(req.db, {
      modulo: "maintenance",
      accion: "run",
      descripcion: "Se ejecutó mantenimiento manual",
      usuarioId,
      metadata: { jobId, tables: processedTables },
    });

    return res.json({
      ok: true,
      msg: "Mantenimiento ejecutado correctamente",
      data: {
        jobId,
        tables: processedTables,
      },
    });
  } catch (error) {
    console.error("runMaintenance error:", error);

    try {
      await req.db.query(
        `
          INSERT INTO monitoreo.maintenance_jobs
            (tipo, estado, detalle, iniciado_en, finalizado_en, ejecutado_por)
          VALUES
            ($1, 'failed', $2, now(), now(), $3)
        `,
        ["VACUUM ANALYZE", error.message, usuarioId],
      );

      await createAuditLog(req.db, {
        modulo: "maintenance",
        accion: "run_failed",
        descripcion: "Falló la ejecución de mantenimiento",
        usuarioId,
        metadata: { error: error.message },
      });
    } catch {}

    return res.status(500).json({
      ok: false,
      msg: "Error ejecutando mantenimiento",
      detail: error.message,
    });
  }
}