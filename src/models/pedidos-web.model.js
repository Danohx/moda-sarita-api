function actionError(message, status = 400, code = "VALIDATION") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function getPedidoWebForUpdate(client, pedidoId) {
  const { rows } = await client.query(
    `
      SELECT id, folio, tipo, estado, total
      FROM ventas.pedidos
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [pedidoId],
  );

  const pedido = rows[0];
  if (!pedido) throw actionError("Pedido no encontrado.", 404, "NOT_FOUND");
  if (pedido.tipo !== "WEB") throw actionError("El pedido no es de tipo WEB.");
  return pedido;
}

async function getReservedItems(client, pedidoId) {
  const { rows } = await client.query(
    `
      SELECT variante_id, SUM(cantidad)::int AS cantidad
      FROM ventas.detalles_pedido
      WHERE pedido_id = $1::uuid
      GROUP BY variante_id
    `,
    [pedidoId],
  );

  return rows;
}

export async function confirmarPagoPedidoWeb(
  db,
  pedidoId,
  { usuarioId, referencia_externa = undefined } = {},
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [usuarioId || ""]);

    const pedido = await getPedidoWebForUpdate(client, pedidoId);
    if (pedido.estado !== "PENDIENTE") {
      throw actionError(
        `Solo se puede confirmar un pedido pendiente. Estado actual: ${pedido.estado}.`,
        409,
      );
    }

    const items = await getReservedItems(client, pedidoId);
    if (items.length === 0) throw actionError("El pedido no tiene productos.", 409);

    for (const item of items) {
      const variantResult = await client.query(
        `
          SELECT id, stock_fisico, stock_apartado
          FROM inventario.variantes_producto
          WHERE id = $1::uuid
          FOR UPDATE
        `,
        [item.variante_id],
      );

      const variant = variantResult.rows[0];
      if (!variant) throw actionError("Una variante del pedido ya no existe.", 409);
      if (Number(variant.stock_apartado) < Number(item.cantidad)) {
        throw actionError("La reserva de stock del pedido es inconsistente.", 409);
      }
      if (Number(variant.stock_fisico) < Number(item.cantidad)) {
        throw actionError("El stock físico es insuficiente para confirmar el pedido.", 409);
      }
    }

    for (const item of items) {
      await client.query(
        `
          UPDATE inventario.variantes_producto
          SET
            stock_fisico = stock_fisico - $2,
            stock_apartado = stock_apartado - $2,
            updated_at = now()
          WHERE id = $1::uuid
        `,
        [item.variante_id, item.cantidad],
      );

      await client.query(
        `
          INSERT INTO inventario.movimientos (
            variante_id,
            usuario_id,
            cantidad,
            motivo,
            tipo
          )
          VALUES ($1,$2,$3,$4,'SALIDA')
        `,
        [
          item.variante_id,
          usuarioId,
          -Math.abs(Number(item.cantidad)),
          `Confirmación de pedido web folio ${pedido.folio}`,
        ],
      );
    }

    const paymentResult = await client.query(
      `
        UPDATE ventas.pagos
        SET
          estado = 'CONFIRMADO',
          usuario_id = $2,
          referencia_externa = CASE
            WHEN $3::text IS NULL THEN referencia_externa
            ELSE $3
          END,
          fecha_pago = now()
        WHERE id = (
          SELECT id
          FROM ventas.pagos
          WHERE pedido_id = $1::uuid AND estado = 'PENDIENTE'
          ORDER BY fecha_pago ASC
          LIMIT 1
        )
        RETURNING *
      `,
      [pedidoId, usuarioId, referencia_externa ?? null],
    );

    if (!paymentResult.rows[0]) {
      throw actionError("No existe un pago pendiente para confirmar.", 409);
    }

    const { rows } = await client.query(
      `
        UPDATE ventas.pedidos
        SET estado = 'PAGADO', liquidado_at = now()
        WHERE id = $1::uuid
        RETURNING *
      `,
      [pedidoId],
    );

    await client.query("COMMIT");
    return { pedido: rows[0], pago: paymentResult.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelarPedidoWebPendiente(
  db,
  pedidoId,
  { usuarioId, motivo_cancelacion } = {},
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [usuarioId || ""]);

    const pedido = await getPedidoWebForUpdate(client, pedidoId);
    if (pedido.estado !== "PENDIENTE") {
      throw actionError(
        `Solo se puede cancelar directamente un pedido pendiente. Estado actual: ${pedido.estado}.`,
        409,
      );
    }

    const items = await getReservedItems(client, pedidoId);

    for (const item of items) {
      const { rows } = await client.query(
        `
          UPDATE inventario.variantes_producto
          SET
            stock_apartado = stock_apartado - $2,
            updated_at = now()
          WHERE id = $1::uuid
            AND stock_apartado >= $2
          RETURNING id
        `,
        [item.variante_id, item.cantidad],
      );

      if (!rows[0]) {
        throw actionError("No se pudo liberar la reserva de stock.", 409);
      }
    }

    await client.query(
      `
        UPDATE ventas.pagos
        SET estado = 'CANCELADO', usuario_id = COALESCE(usuario_id, $2)
        WHERE pedido_id = $1::uuid AND estado = 'PENDIENTE'
      `,
      [pedidoId, usuarioId],
    );

    const { rows } = await client.query(
      `
        UPDATE ventas.pedidos
        SET
          estado = 'CANCELADO',
          motivo_cancelacion = $2,
          fecha_cancelacion = now()
        WHERE id = $1::uuid
        RETURNING *
      `,
      [pedidoId, String(motivo_cancelacion).trim()],
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
