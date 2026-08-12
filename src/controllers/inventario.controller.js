import {
  listExistencias,
  getStockByVariante,
  listMovimientosByVariante,
  listMovimientosByProducto,
  createMovimientoAndApply,
  getAlertasInventario,
} from "../models/inventario.model.js";

function toInt(v, def) {
  const n = Number(v);
  return Number.isInteger(n) ? n : def;
}

export async function getExistencias(req, res) {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const categoriaId = req.query.categoriaId
      ? Number(req.query.categoriaId)
      : null;
    const varianteId = req.query.varianteId
      ? String(req.query.varianteId)
      : null;
    const productoId = req.query.productoId
      ? String(req.query.productoId)
      : null;
    const soloBajoStock = String(req.query.soloBajoStock || "false") === "true";
    const limit = toInt(req.query.limit, 50);
    const offset = toInt(req.query.offset, 0);

    if (categoriaId !== null && !Number.isInteger(categoriaId)) {
      return res.status(400).json({ ok: false, msg: "categoriaId inválido" });
    }

    if (limit <= 0 || limit > 200) {
      return res.status(400).json({ ok: false, msg: "limit inválido (1-200)" });
    }

    if (offset < 0) {
      return res.status(400).json({ ok: false, msg: "offset inválido" });
    }

    const data = await listExistencias(req.db, {
      q,
      categoriaId,
      varianteId,
      productoId,
      soloBajoStock,
      limit,
      offset,
    });

    return res.json({
      ok: true,
      data: data.items,
      pagination: {
        total: data.total,
        limit: data.limit,
        offset: data.offset,
        hasMore: data.hasMore,
      },
    });
  } catch (err) {
    console.error("getExistencias error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error listando existencias",
      detail: err.message,
    });
  }
}

export async function getStockVariante(req, res) {
  try {
    const varianteId = String(req.params.id);
    const data = await getStockByVariante(req.db, varianteId);

    if (!data) {
      return res.status(404).json({ ok: false, msg: "Variante no encontrada" });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getStockVariante error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error consultando stock", detail: err.message });
  }
}

export async function getKardexVariante(req, res) {
  try {
    const varianteId = String(req.params.id);
    const { from, to } = req.query;
    const limit = toInt(req.query.limit, 100);
    const offset = toInt(req.query.offset, 0);

    if (limit <= 0 || limit > 500) {
      return res.status(400).json({ ok: false, msg: "limit inválido (1-500)" });
    }

    if (offset < 0) {
      return res.status(400).json({ ok: false, msg: "offset inválido" });
    }

    const data = await listMovimientosByVariante(req.db, {
      varianteId,
      from,
      to,
      limit,
      offset,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getKardexVariante error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error listando movimientos",
      detail: err.message,
    });
  }
}

export async function getKardexProducto(req, res) {
  try {
    const productoId = String(req.params.id);
    const { from, to } = req.query;
    const limit = toInt(req.query.limit, 100);
    const offset = toInt(req.query.offset, 0);

    if (limit <= 0 || limit > 500) {
      return res.status(400).json({ ok: false, msg: "limit inválido (1-500)" });
    }

    if (offset < 0) {
      return res.status(400).json({ ok: false, msg: "offset inválido" });
    }

    const data = await listMovimientosByProducto(req.db, {
      productoId,
      from,
      to,
      limit,
      offset,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getKardexProducto error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error listando movimientos",
      detail: err.message,
    });
  }
}

export async function postMovimientoInventario(req, res) {
  try {
    const { accion, variante_id, cantidad, stock_fisico, motivo } =
      req.body || {};

    const a = accion ? String(accion).trim().toUpperCase() : null;
    const varianteId = variante_id ? String(variante_id) : null;

    if (!a || !["ENTRADA", "SALIDA", "AJUSTE", "SET_STOCK"].includes(a)) {
      return res.status(400).json({
        ok: false,
        msg: "accion inválida (ENTRADA|SALIDA|AJUSTE|SET_STOCK)",
      });
    }

    if (!varianteId) {
      return res
        .status(400)
        .json({ ok: false, msg: "variante_id es requerido" });
    }

    const mot = motivo ? String(motivo).trim() : "";
    if (mot.length < 3) {
      return res
        .status(400)
        .json({ ok: false, msg: "motivo requerido (mín 3 caracteres)" });
    }

    let cantidadNum = null;
    let stockNum = null;

    if (a === "SET_STOCK") {
      const s = Number(stock_fisico);
      if (!Number.isInteger(s) || s < 0) {
        return res
          .status(400)
          .json({ ok: false, msg: "stock_fisico debe ser entero >= 0" });
      }
      stockNum = s;
    } else {
      const c = Number(cantidad);
      if (!Number.isInteger(c) || c === 0) {
        return res
          .status(400)
          .json({ ok: false, msg: "cantidad debe ser entero distinto de 0" });
      }

      if (a === "ENTRADA") {
        if (c < 0) {
          return res
            .status(400)
            .json({ ok: false, msg: "ENTRADA requiere cantidad positiva" });
        }
        cantidadNum = c;
      } else if (a === "SALIDA") {
        if (c < 0) {
          return res.status(400).json({
            ok: false,
            msg: "SALIDA requiere cantidad positiva (el sistema la descuenta)",
          });
        }
        cantidadNum = -Math.abs(c);
      } else {
        cantidadNum = c;
      }
    }

    const result = await createMovimientoAndApply(req.db, {
      accion: a,
      varianteId,
      usuarioId: req.user?.id,
      motivo: mot,
      cantidad: cantidadNum,
      stockFisico: stockNum,
    });

    return res.status(201).json({ ok: true, data: result });
  } catch (err) {
    console.error("postMovimientoInventario error:", err);

    if (["STOCK_NEGATIVO", "STOCK_RESERVADO"].includes(err?.code)) {
      return res.status(409).json({ ok: false, msg: err.message });
    }

    if (err?.code === "NOT_FOUND") {
      return res.status(404).json({ ok: false, msg: err.message });
    }

    if (err?.code === "VALIDATION") {
      return res.status(400).json({ ok: false, msg: err.message });
    }

    return res.status(500).json({
      ok: false,
      msg: "Error aplicando movimiento",
      detail: err.message,
    });
  }
}

export async function getAlertasInventarioController(req, res) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const data = await getAlertasInventario(req.db, { limit });

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    console.error("getAlertasInventarioController error:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo alertas de inventario",
      detail: err.message,
    });
  }
}
