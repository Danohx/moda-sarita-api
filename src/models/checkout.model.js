function checkoutError(message, status = 400, code = "VALIDATION") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw checkoutError("El pedido debe contener al menos un producto.");
  }

  const grouped = new Map();

  for (const item of items) {
    const varianteId = String(item.variante_id || item.varianteId || "").trim();
    const cantidad = Number(item.cantidad);

    if (!varianteId || !Number.isInteger(cantidad) || cantidad <= 0) {
      throw checkoutError("Cada producto requiere variante_id y cantidad mayor a cero.");
    }

    grouped.set(varianteId, (grouped.get(varianteId) || 0) + cantidad);
  }

  return [...grouped.entries()].map(([variante_id, cantidad]) => ({
    variante_id,
    cantidad,
  }));
}

async function getClienteForUpdate(client, usuarioId) {
  const { rows } = await client.query(
    `
      SELECT
        c.*,
        CONCAT_WS(' ', c.nombres, c.apellido_paterno, c.apellido_materno)
          AS nombre_completo
      FROM clientes.clientes c
      WHERE c.usuario_id = $1::uuid
        AND c.activo = true
      FOR UPDATE
    `,
    [usuarioId],
  );

  return rows[0] || null;
}

async function getMetodoPagoWeb(client, metodo) {
  const { rows } = await client.query(
    `
      SELECT
        codigo,
        nombre,
        activo_web,
        requiere_referencia,
        requiere_confirmacion_manual,
        es_credito
      FROM configuracion.metodos_pago
      WHERE codigo = $1
      LIMIT 1
    `,
    [metodo],
  );

  return rows[0] || null;
}

async function calcularCupon(client, codigo, subtotal) {
  if (!codigo) return { cupon_id: null, descuento: 0 };

  const { rows } = await client.query(
    `
      SELECT
        id,
        codigo,
        tipo_descuento,
        valor,
        monto_minimo_compra,
        fecha_inicio,
        fecha_fin,
        activo
      FROM marketing.cupones
      WHERE UPPER(codigo) = UPPER($1)
      LIMIT 1
    `,
    [String(codigo).trim()],
  );

  const cupon = rows[0];
  if (!cupon || cupon.activo !== true) {
    throw checkoutError("El cupón no existe o está inactivo.", 400, "INVALID_COUPON");
  }

  const today = new Date().toISOString().slice(0, 10);
  if (today < String(cupon.fecha_inicio) || today > String(cupon.fecha_fin)) {
    throw checkoutError("El cupón está fuera de vigencia.", 400, "INVALID_COUPON");
  }

  if (subtotal < Number(cupon.monto_minimo_compra || 0)) {
    throw checkoutError(
      `El cupón requiere una compra mínima de $${Number(cupon.monto_minimo_compra).toFixed(2)}.`,
      400,
      "INVALID_COUPON",
    );
  }

  const tipo = String(cupon.tipo_descuento || "").toUpperCase();
  let descuento = 0;

  if (["PORCENTAJE", "PERCENT", "PORCENTUAL"].includes(tipo)) {
    descuento = subtotal * (Number(cupon.valor || 0) / 100);
  } else if (["MONTO_FIJO", "FIJO", "MONTO"].includes(tipo)) {
    descuento = Number(cupon.valor || 0);
  } else {
    throw checkoutError(
      "El tipo de descuento del cupón todavía no es compatible con checkout.",
      400,
      "UNSUPPORTED_COUPON",
    );
  }

  return {
    cupon_id: cupon.id,
    descuento: Math.min(money(descuento), subtotal),
  };
}

export async function crearPedidoWeb(
  db,
  usuarioId,
  {
    items,
    direccion_id,
    metodo_pago,
    referencia_externa = null,
    cupon_codigo = null,
    observaciones = null,
  },
) {
  const normalizedItems = normalizeItems(items);
  const metodo = String(metodo_pago || "").trim().toUpperCase();

  if (!direccion_id) throw checkoutError("direccion_id es requerido.");
  if (!metodo) throw checkoutError("metodo_pago es requerido.");

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [usuarioId]);

    const cliente = await getClienteForUpdate(client, usuarioId);
    if (!cliente) {
      throw checkoutError(
        "La cuenta no tiene un perfil de cliente activo.",
        404,
        "CLIENT_PROFILE_NOT_FOUND",
      );
    }

    const addressResult = await client.query(
      `
        SELECT *
        FROM clientes.direcciones
        WHERE id = $1::uuid AND cliente_id = $2::uuid
        LIMIT 1
      `,
      [direccion_id, cliente.id],
    );

    const direccion = addressResult.rows[0];
    if (!direccion) {
      throw checkoutError("La dirección no pertenece a la cuenta.", 404, "ADDRESS_NOT_FOUND");
    }

    const paymentConfig = await getMetodoPagoWeb(client, metodo);
    if (!paymentConfig || paymentConfig.activo_web !== true) {
      throw checkoutError("El método de pago no está disponible en la tienda web.");
    }

    if (
      paymentConfig.requiere_referencia === true &&
      !String(referencia_externa || "").trim()
    ) {
      throw checkoutError("El método de pago requiere una referencia.");
    }

    const orderItems = [];

    for (const item of normalizedItems) {
      const { rows } = await client.query(
        `
          SELECT
            v.id,
            v.producto_id,
            v.precio_venta,
            v.stock_fisico,
            v.stock_apartado,
            v.activo AS variante_activa,
            p.activo AS producto_activo,
            p.nombre AS producto_nombre
          FROM inventario.variantes_producto v
          JOIN inventario.productos p ON p.id = v.producto_id
          WHERE v.id = $1::uuid
          FOR UPDATE OF v
        `,
        [item.variante_id],
      );

      const variante = rows[0];
      if (!variante) {
        throw checkoutError(
          `No se encontró la variante ${item.variante_id}.`,
          404,
          "VARIANT_NOT_FOUND",
        );
      }

      if (variante.variante_activa !== true || variante.producto_activo !== true) {
        throw checkoutError(`${variante.producto_nombre} ya no está disponible.`);
      }

      const disponible =
        Number(variante.stock_fisico || 0) - Number(variante.stock_apartado || 0);

      if (disponible < item.cantidad) {
        throw checkoutError(
          `Stock insuficiente para ${variante.producto_nombre}. Disponible: ${disponible}.`,
          409,
          "STOCK",
        );
      }

      const precio = money(variante.precio_venta);
      if (precio <= 0) {
        throw checkoutError(`${variante.producto_nombre} no tiene un precio válido.`);
      }

      orderItems.push({
        ...item,
        precio_unitario: precio,
        producto_nombre: variante.producto_nombre,
      });
    }

    const subtotal = money(
      orderItems.reduce(
        (sum, item) => sum + item.precio_unitario * item.cantidad,
        0,
      ),
    );

    const coupon = await calcularCupon(client, cupon_codigo, subtotal);
    const costoEnvio = 0;
    const total = money(subtotal - coupon.descuento + costoEnvio);

    const esCredito = paymentConfig.es_credito === true || metodo === "CREDITO_TIENDA";

    if (esCredito) {
      if (cliente.tiene_credito !== true) {
        throw checkoutError("La cuenta no tiene crédito de tienda habilitado.");
      }

      const disponible = money(
        Number(cliente.limite_credito || 0) - Number(cliente.saldo_deudor || 0),
      );

      if (total > disponible) {
        throw checkoutError(
          `Crédito insuficiente. Disponible: $${disponible.toFixed(2)}.`,
          409,
          "INSUFFICIENT_CREDIT",
        );
      }
    }

    const pedidoResult = await client.query(
      `
        INSERT INTO ventas.pedidos (
          cliente_id,
          vendedor_id,
          tipo,
          estado,
          subtotal,
          descuento,
          costo_envio,
          total,
          cupon_id,
          observaciones
        )
        VALUES ($1, NULL, 'WEB', 'PENDIENTE', $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        cliente.id,
        subtotal,
        coupon.descuento,
        costoEnvio,
        total,
        coupon.cupon_id,
        observaciones ? String(observaciones).trim() : null,
      ],
    );

    const pedido = pedidoResult.rows[0];

    await client.query(
      `
        INSERT INTO ventas.direcciones_pedido (
          pedido_id,
          nombre_destinatario,
          telefono,
          calle,
          numero_exterior,
          numero_interior,
          colonia,
          ciudad,
          estado,
          codigo_postal,
          referencias
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        pedido.id,
        cliente.nombre_completo,
        cliente.telefono,
        direccion.calle,
        direccion.numero_exterior,
        direccion.numero_interior,
        direccion.colonia,
        direccion.ciudad,
        direccion.estado,
        direccion.codigo_postal,
        direccion.referencias,
      ],
    );

    for (const item of orderItems) {
      await client.query(
        `
          INSERT INTO ventas.detalles_pedido (
            pedido_id,
            variante_id,
            cantidad,
            precio_unitario
          )
          VALUES ($1,$2,$3,$4)
        `,
        [pedido.id, item.variante_id, item.cantidad, item.precio_unitario],
      );

      if (esCredito) {
        await client.query(
          `
            UPDATE inventario.variantes_producto
            SET stock_fisico = stock_fisico - $2, updated_at = now()
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
            -Math.abs(item.cantidad),
            `Pedido web pagado con crédito, folio ${pedido.folio}`,
          ],
        );
      } else {
        // Reserva temporal para un pedido pendiente de confirmación.
        await client.query(
          `
            UPDATE inventario.variantes_producto
            SET stock_apartado = stock_apartado + $2, updated_at = now()
            WHERE id = $1::uuid
          `,
          [item.variante_id, item.cantidad],
        );
      }
    }

    const pagoEstado = esCredito ? "CONFIRMADO" : "PENDIENTE";
    const pagoResult = await client.query(
      `
        INSERT INTO ventas.pagos (
          pedido_id,
          monto,
          metodo,
          referencia_externa,
          concepto,
          estado,
          usuario_id
        )
        VALUES ($1,$2,$3,$4,'PAGO_TOTAL',$5,$6)
        RETURNING *
      `,
      [
        pedido.id,
        total,
        metodo,
        referencia_externa ? String(referencia_externa).trim() : null,
        pagoEstado,
        esCredito ? usuarioId : null,
      ],
    );

    if (esCredito) {
      const saldoAnterior = money(cliente.saldo_deudor || 0);
      const saldoResultante = money(saldoAnterior + total);

      await client.query(
        `
          UPDATE clientes.clientes
          SET saldo_deudor = $2, fecha_actualizacion_credito = now()
          WHERE id = $1::uuid
        `,
        [cliente.id, saldoResultante],
      );

      await client.query(
        `
          INSERT INTO clientes.movimientos_credito (
            cliente_id,
            usuario_id,
            pedido_id,
            pago_id,
            tipo,
            descripcion,
            monto,
            saldo_anterior,
            saldo_resultante,
            metodo_pago,
            referencia_externa
          )
          VALUES ($1,$2,$3,$4,'COMPRA',$5,$6,$7,$8,$9,$10)
        `,
        [
          cliente.id,
          usuarioId,
          pedido.id,
          pagoResult.rows[0].id,
          `Compra web folio ${pedido.folio}`,
          total,
          saldoAnterior,
          saldoResultante,
          metodo,
          referencia_externa,
        ],
      );

      await client.query(
        `UPDATE ventas.pedidos SET estado = 'PAGADO', liquidado_at = now() WHERE id = $1`,
        [pedido.id],
      );
    }

    await client.query("COMMIT");

    return {
      pedido_id: pedido.id,
      folio: pedido.folio,
      estado: esCredito ? "PAGADO" : "PENDIENTE",
      subtotal,
      descuento: coupon.descuento,
      costo_envio: costoEnvio,
      total,
      metodo_pago: metodo,
      pago_estado: pagoEstado,
      items: orderItems,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
