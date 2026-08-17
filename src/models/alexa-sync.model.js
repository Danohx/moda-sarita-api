// src/models/alexa-sync.model.js

export async function obtenerTargetsAlexaCliente(db, clienteId) {
  const { rows } = await db.query(
    `
      SELECT DISTINCT
        awt.alexa_user_id
      FROM seguridad.alexa_widget_targets awt

      JOIN clientes.clientes c
        ON c.usuario_id = awt.usuario_id

      WHERE c.id = $1::uuid
        AND awt.activo = true
        AND awt.alexa_user_id IS NOT NULL
        AND trim(awt.alexa_user_id) <> ''
    `,
    [clienteId],
  );

  return rows;
}

export async function registrarTargetAlexaUsuario(
  db,
  {
    usuarioId,
    alexaUserId,
    alexaDeviceId,
    packageId,
    packageInstanceId = null,
  },
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        SELECT pg_advisory_xact_lock(
          hashtextextended($1, 0)
        )
      `,
      [
        `alexa-widget:${usuarioId}:${alexaUserId}:${alexaDeviceId}:${packageId}`,
      ],
    );

    const { rows: existentes } = await client.query(
      `
        SELECT id
        FROM seguridad.alexa_widget_targets
        WHERE usuario_id = $1::uuid
          AND alexa_user_id = $2
          AND alexa_device_id IS NOT DISTINCT FROM $3
          AND package_id IS NOT DISTINCT FROM $4
        LIMIT 1
      `,
      [usuarioId, alexaUserId, alexaDeviceId, packageId],
    );

    let result;

    if (existentes[0]) {
      result = await client.query(
        `
          UPDATE seguridad.alexa_widget_targets
          SET
            package_instance_id = $2,
            activo = true,
            removed_at = NULL,
            last_seen_at = now(),
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING *
        `,
        [existentes[0].id, packageInstanceId],
      );
    } else {
      result = await client.query(
        `
          INSERT INTO seguridad.alexa_widget_targets (
            usuario_id,
            alexa_user_id,
            alexa_device_id,
            package_id,
            package_instance_id,
            activo,
            installed_at,
            last_seen_at
          )
          VALUES (
            $1::uuid,
            $2,
            $3,
            $4,
            $5,
            true,
            now(),
            now()
          )
          RETURNING *
        `,
        [usuarioId, alexaUserId, alexaDeviceId, packageId, packageInstanceId],
      );
    }

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
