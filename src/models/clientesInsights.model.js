// src/models/clientesInsights.model.js

function toLimit(value, fallback = 50) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 100);
}

export async function getClienteHistorialComercial(db, clienteId, { limit = 50 } = {}) {
  const safeLimit = toLimit(limit);

  const { rows: clienteRows } = await db.query(
    `
      SELECT
        id,
        nombres,
        apellido_paterno,
        apellido_materno,
        telefono,
        email,
        activo,
        tiene_credito,
        limite_credito,
        saldo_deudor,
        puede_apartar,
        fecha_registro
      FROM clientes.clientes
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [clienteId],
  );

  const cliente = clienteRows[0];
  if (!cliente) return null;

  const [{ rows: resumenRows }, { rows: pedidosRows }, { rows: creditoRows }] =
    await Promise.all([
      db.query(
        `
          SELECT
            COUNT(*)::int AS operaciones,
            COUNT(*) FILTER (WHERE tipo = 'PUNTO_VENTA')::int AS ventas_pos,
            COUNT(*) FILTER (WHERE tipo = 'WEB')::int AS pedidos_web,
            COUNT(*) FILTER (WHERE tipo = 'APARTADO')::int AS apartados,
            COUNT(*) FILTER (WHERE tipo = 'APARTADO' AND estado = 'ACTIVO')::int AS apartados_activos,
            COALESCE(
              SUM(total) FILTER (
                WHERE estado IN ('PAGADO', 'ENTREGADO', 'LIQUIDADO')
              ),
              0
            )::numeric(12,2) AS total_comprado,
            MAX(fecha_creacion) AS ultima_operacion
          FROM ventas.pedidos
          WHERE cliente_id = $1::uuid
        `,
        [clienteId],
      ),
      db.query(
        `
          SELECT
            p.id,
            p.folio,
            p.tipo::text AS tipo,
            p.estado::text AS estado,
            p.subtotal,
            p.descuento,
            p.costo_envio,
            p.total,
            p.fecha_creacion,
            p.fecha_limite_apartado,
            p.fecha_cancelacion,
            p.motivo_cancelacion,
            COALESCE((
              SELECT SUM(dp.cantidad)
              FROM ventas.detalles_pedido dp
              WHERE dp.pedido_id = p.id
            ), 0)::int AS unidades,
            COALESCE((
              SELECT SUM(
                CASE
                  WHEN pg.estado::text = 'CONFIRMADO' AND pg.concepto::text LIKE 'REEMBOLSO%' THEN -ABS(pg.monto)
                  WHEN pg.estado::text = 'CONFIRMADO' THEN pg.monto
                  ELSE 0
                END
              )
              FROM ventas.pagos pg
              WHERE pg.pedido_id = p.id
            ), 0)::numeric(12,2) AS pagado_neto
          FROM ventas.pedidos p
          WHERE p.cliente_id = $1::uuid
          ORDER BY p.fecha_creacion DESC, p.folio DESC
          LIMIT $2::int
        `,
        [clienteId, safeLimit],
      ),
      db.query(
        `
          SELECT
            id,
            fecha,
            tipo,
            descripcion,
            monto,
            saldo_anterior,
            saldo_resultante,
            metodo_pago,
            referencia_externa
          FROM clientes.movimientos_credito
          WHERE cliente_id = $1::uuid
          ORDER BY fecha DESC, id DESC
          LIMIT 30
        `,
        [clienteId],
      ),
    ]);

  return {
    cliente,
    resumen: resumenRows[0] || {
      operaciones: 0,
      ventas_pos: 0,
      pedidos_web: 0,
      apartados: 0,
      apartados_activos: 0,
      total_comprado: 0,
      ultima_operacion: null,
    },
    pedidos: pedidosRows,
    movimientos_credito: creditoRows,
  };
}

export async function setClienteActivoSeguro(db, clienteId, activo, usuarioId = null) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    if (usuarioId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(usuarioId)]);
    }

    const { rows } = await client.query(
      `
        SELECT id, activo, saldo_deudor
        FROM clientes.clientes
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [clienteId],
    );

    const cliente = rows[0];
    if (!cliente) {
      const error = new Error('Cliente no encontrado');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (!activo) {
      const saldo = Number(cliente.saldo_deudor || 0);
      if (saldo > 0) {
        const error = new Error('No se puede desactivar un cliente con saldo deudor pendiente.');
        error.code = 'CLIENTE_CON_DEUDA';
        throw error;
      }

      const { rows: pendientesRows } = await client.query(
        `
          SELECT COUNT(*)::int AS total
          FROM ventas.pedidos
          WHERE cliente_id = $1::uuid
            AND (
              (tipo = 'APARTADO' AND estado = 'ACTIVO')
              OR estado = 'PENDIENTE'
            )
        `,
        [clienteId],
      );

      if (Number(pendientesRows[0]?.total || 0) > 0) {
        const error = new Error('No se puede desactivar un cliente con pedidos o apartados activos.');
        error.code = 'CLIENTE_CON_OPERACIONES_ACTIVAS';
        throw error;
      }
    }

    const { rows: updatedRows } = await client.query(
      `
        UPDATE clientes.clientes
        SET activo = $2
        WHERE id = $1::uuid
        RETURNING *
      `,
      [clienteId, Boolean(activo)],
    );

    await client.query('COMMIT');
    return updatedRows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateDireccionCliente(db, clienteId, direccionId, payload = {}) {
  const allowed = {
    calle: payload.calle,
    numero_exterior: payload.numero_exterior,
    numero_interior: payload.numero_interior,
    colonia: payload.colonia,
    ciudad: payload.ciudad,
    estado: payload.estado,
    codigo_postal: payload.codigo_postal,
    referencias: payload.referencias,
  };

  const entries = Object.entries(allowed).filter(([, value]) => value !== undefined);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows: foundRows } = await client.query(
      `
        SELECT id, es_principal
        FROM clientes.direcciones
        WHERE id = $1::uuid AND cliente_id = $2::uuid
        FOR UPDATE
      `,
      [direccionId, clienteId],
    );

    if (!foundRows[0]) {
      const error = new Error('Dirección no encontrada');
      error.code = 'NOT_FOUND';
      throw error;
    }

    if (entries.length > 0) {
      const values = [direccionId, clienteId];
      const sets = entries.map(([key, value]) => {
        values.push(value === '' ? null : value);
        return `${key} = $${values.length}`;
      });

      await client.query(
        `
          UPDATE clientes.direcciones
          SET ${sets.join(', ')}
          WHERE id = $1::uuid AND cliente_id = $2::uuid
        `,
        values,
      );
    }

    if (payload.es_principal === true) {
      await client.query(
        `UPDATE clientes.direcciones SET es_principal = false WHERE cliente_id = $1::uuid`,
        [clienteId],
      );
      await client.query(
        `UPDATE clientes.direcciones SET es_principal = true WHERE id = $1::uuid AND cliente_id = $2::uuid`,
        [direccionId, clienteId],
      );
    }

    const { rows: updatedRows } = await client.query(
      `SELECT * FROM clientes.direcciones WHERE id = $1::uuid AND cliente_id = $2::uuid`,
      [direccionId, clienteId],
    );

    await client.query('COMMIT');
    return updatedRows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
