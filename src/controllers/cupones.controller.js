import {
  listCupones,
  createCupon,
  updateCupon,
  setCuponStatus,
  getCuponByCodigo,
} from "../models/cupones.model.js";

export async function getCupones(req, res) {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const data = await listCupones(req.db, { includeInactive });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getCupones error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error listando cupones", detail: err.message });
  }
}

export async function postCupon(req, res) {
  try {
    const {
      codigo,
      tipo_descuento,
      valor,
      monto_minimo_compra = 0,
      fecha_inicio,
      fecha_fin,
    } = req.body || {};

    if (!codigo || String(codigo).trim().length < 3)
      return res.status(400).json({ ok: false, msg: "codigo requerido" });
    if (!tipo_descuento)
      return res
        .status(400)
        .json({ ok: false, msg: "tipo_descuento requerido" });
    if (valor === undefined || valor === null)
      return res.status(400).json({ ok: false, msg: "valor requerido" });
    if (!fecha_inicio || !fecha_fin)
      return res
        .status(400)
        .json({ ok: false, msg: "fecha_inicio y fecha_fin requeridos" });

    const created = await createCupon(req.db, {
      codigo: String(codigo).trim().toUpperCase(),
      tipo_descuento: String(tipo_descuento).trim().toUpperCase(),
      valor: Number(valor),
      monto_minimo_compra: Number(monto_minimo_compra || 0),
      fecha_inicio,
      fecha_fin,
    });

    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ ok: false, msg: "Cupón duplicado", detail: err.detail });
    console.error("postCupon error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error creando cupón", detail: err.message });
  }
}

export async function patchCupon(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, msg: "id inválido" });

    const updated = await updateCupon(req.db, id, req.body || {});
    if (!updated)
      return res.status(404).json({ ok: false, msg: "Cupón no encontrado" });

    return res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ ok: false, msg: "Cupón duplicado", detail: err.detail });
    console.error("patchCupon error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error actualizando cupón",
        detail: err.message,
      });
  }
}

export async function patchCuponStatus(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
      return res.status(400).json({ ok: false, msg: "id inválido" });

    const { activo } = req.body || {};
    if (typeof activo !== "boolean")
      return res
        .status(400)
        .json({ ok: false, msg: "activo debe ser boolean" });

    const row = await setCuponStatus(req.db, id, activo);
    if (!row)
      return res.status(404).json({ ok: false, msg: "Cupón no encontrado" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchCuponStatus error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error cambiando estatus", detail: err.message });
  }
}

export async function validarCupon(req, res) {
  try {
    const codigo = req.query.codigo ? String(req.query.codigo).trim() : null;
    const subtotal = req.query.subtotal ? Number(req.query.subtotal) : 0;

    if (!codigo)
      return res.status(400).json({ ok: false, msg: "codigo requerido" });

    const cupon = await getCuponByCodigo(req.db, codigo);
    if (!cupon || !cupon.activo)
      return res.status(404).json({ ok: false, msg: "Cupón no válido" });

    const hoy = new Date();
    const ini = new Date(cupon.fecha_inicio);
    const fin = new Date(cupon.fecha_fin);
    if (hoy < ini || hoy > fin)
      return res
        .status(400)
        .json({ ok: false, msg: "Cupón fuera de vigencia" });

    if (subtotal < Number(cupon.monto_minimo_compra || 0)) {
      return res
        .status(400)
        .json({
          ok: false,
          msg: "No cumple monto mínimo",
          minimo: cupon.monto_minimo_compra,
        });
    }

    // Descuento calculado (si tu negocio define más tipos, aquí se amplía)
    const tipo = String(cupon.tipo_descuento || "").toUpperCase();
    let descuento = 0;

    if (tipo === "PORCENTAJE")
      descuento = subtotal * (Number(cupon.valor) / 100);
    else if (tipo === "MONTO_FIJO") descuento = Number(cupon.valor);
    else if (tipo === "ENVIO_GRATIS")
      descuento = 0; // lo aplicas contra envío en checkout
    else descuento = 0;

    // clamp
    if (descuento < 0) descuento = 0;
    if (descuento > subtotal) descuento = subtotal;

    return res.json({ ok: true, cupon, descuento });
  } catch (err) {
    console.error("validarCupon error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error validando cupón", detail: err.message });
  }
}
