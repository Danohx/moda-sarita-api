import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";
import pg from "pg";
import { createAuditLog } from "../utils/audit.util.js";

const { Client } = pg;
const backupDir = path.resolve("backups");

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

async function getDatabaseStats(connectionString) {
  const client = new Client({ connectionString });

  try {
    await client.connect();

    const tablesQuery = await client.query(`
      SELECT count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        AND table_type = 'BASE TABLE'
    `);

    const recordsQuery = await client.query(`
      SELECT COALESCE(sum(n_live_tup), 0)::bigint AS count
      FROM pg_stat_user_tables
    `);

    return {
      tables: tablesQuery.rows[0]?.count ?? 0,
      records: Number(recordsQuery.rows[0]?.count ?? 0),
    };
  } finally {
    await client.end();
  }
}

async function runBackupProcess({ usuarioId = null, db }) {
  const DATABASE_URL = process.env.DATABASE_URL_INTERNA;

  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL_INTERNA no definida");
  }

  const dbStats = await getDatabaseStats(DATABASE_URL);
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;

  const fileName = `moda-sarita_${timestamp}.backup.gz`;
  const filePath = path.join(backupDir, fileName);

  const dump = spawn(
    "pg_dump",
    ["--dbname=" + DATABASE_URL, "--no-owner", "--no-privileges"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (!dump.stdout) {
    throw new Error("stdout de pg_dump no disponible");
  }

  const gzip = createGzip();
  const writeStream = fs.createWriteStream(filePath);

  await pipeline(dump.stdout, gzip, writeStream);

  const stats = fs.statSync(filePath);

  const backupInfo = {
    id: Buffer.from(fileName).toString("base64"),
    filename: fileName,
    size: stats.size,
    status: "completed",
    createdAt: now.toISOString(),
    tables: dbStats.tables,
    records: dbStats.records,
    createdBy: "Sistema",
  };

  await createAuditLog(db, {
    modulo: "backups",
    accion: "create",
    descripcion: "Se creó un respaldo manual",
    usuarioId,
    metadata: backupInfo,
  });

  return backupInfo;
}

export async function getBackups(req, res) {
  try {
    const files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".gz"));

    const backups = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        const createdAt = stats.birthtime.toISOString();

        return {
          id: Buffer.from(file).toString("base64"),
          filename: file,
          size: stats.size,
          status: "completed",
          createdAt,
          tables: stats.tables,
          records: stats.records,
          createdBy: "Sistema",
        };
      }),
    );

    backups.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return res.json({ ok: true, data: backups });
  } catch (error) {
    console.error("getBackups error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo respaldos",
    });
  }
}

export async function createBackup(req, res) {
  try {
    const backup = await runBackupProcess({
      usuarioId: req.user?.id ?? null,
      db: req.db,
    });

    return res.status(201).json({
      ok: true,
      data: backup,
    });
  } catch (error) {
    console.error("createBackup error:", error);

    try {
      await createAuditLog(req.db, {
        modulo: "backups",
        accion: "create_failed",
        descripcion: "Falló la creación del respaldo",
        usuarioId: req.user?.id ?? null,
        metadata: { error: error.message },
      });
    } catch {}

    return res.status(500).json({
      ok: false,
      msg: "Error creando respaldo",
      detail: error.message,
    });
  }
}

export async function downloadBackup(req, res) {
  try {
    const file = Buffer.from(req.params.id, "base64").toString("ascii");
    const filePath = path.join(backupDir, file);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, msg: "Respaldo no encontrado" });
    }

    await createAuditLog(req.db, {
      modulo: "backups",
      accion: "download",
      descripcion: "Se descargó un respaldo",
      usuarioId: req.user?.id ?? null,
      metadata: { backupId: req.params.id, filename: file },
    });

    return res.download(filePath, file);
  } catch (error) {
    console.error("downloadBackup error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error descargando respaldo",
    });
  }
}

export async function deleteBackup(req, res) {
  try {
    const file = Buffer.from(req.params.id, "base64").toString("ascii");
    const filePath = path.join(backupDir, file);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, msg: "Respaldo no encontrado" });
    }

    fs.unlinkSync(filePath);

    await createAuditLog(req.db, {
      modulo: "backups",
      accion: "delete",
      descripcion: "Se eliminó un respaldo",
      usuarioId: req.user?.id ?? null,
      metadata: { backupId: req.params.id, filename: file },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("deleteBackup error:", error);
    return res.status(500).json({
      ok: false,
      msg: "Error eliminando respaldo",
    });
  }
}
