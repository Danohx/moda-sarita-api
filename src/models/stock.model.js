function stockError(message, code = "VALIDATION") {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Normaliza un carrito de inventario para que una variante aparezca una sola vez.
 * También ordena por UUID para que todas las transacciones bloqueen variantes
 * en el mismo orden y reduzcan el riesgo de deadlocks.
 */
export function normalizeStockItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw stockError("items requerido");
  }

  const grouped = new Map();

  for (const item of items) {
    const varianteId = String(item?.variante_id || "").trim();
    const cantidad = Number(item?.cantidad);

    if (!varianteId || !Number.isInteger(cantidad) || cantidad <= 0) {
      throw stockError("Cada item requiere variante_id y cantidad > 0");
    }

    const current = grouped.get(varianteId) || 0;
    grouped.set(varianteId, current + cantidad);
  }

  return [...grouped.entries()]
    .map(([variante_id, cantidad]) => ({ variante_id, cantidad }))
    .sort((a, b) => a.variante_id.localeCompare(b.variante_id));
}

/**
 * Bloquea todas las variantes en orden estable. Devuelve un Map por id.
 */
export async function lockVariantesForUpdate(client, varianteIds) {
  const ids = [...new Set((varianteIds || []).map((id) => String(id).trim()))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  if (ids.length === 0) return new Map();

  const { rows } = await client.query(
    `
      SELECT
        v.id,
        v.producto_id,
        v.sku,
        v.precio_venta,
        v.precio_costo,
        v.stock_fisico,
        v.stock_apartado,
        v.stock_minimo,
        v.activo
      FROM inventario.variantes_producto v
      WHERE v.id = ANY($1::uuid[])
      ORDER BY v.id
      FOR UPDATE
    `,
    [ids],
  );

  return new Map(rows.map((row) => [String(row.id), row]));
}

export function assertStockDisponible(variante, cantidad) {
  if (!variante) {
    throw stockError("Variante no encontrada", "NOT_FOUND");
  }

  if (variante.activo !== true) {
    throw stockError(`La variante ${variante.id} está inactiva`);
  }

  const stockFisico = Number(variante.stock_fisico || 0);
  const stockApartado = Number(variante.stock_apartado || 0);
  const disponible = stockFisico - stockApartado;

  if (disponible < cantidad) {
    throw stockError(
      `Stock insuficiente en variante ${variante.id}. Disponible=${disponible}`,
      "STOCK",
    );
  }

  return disponible;
}
