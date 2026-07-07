// src/controllers/marketing.controller.js

import {
  actualizarCupon,
  actualizarPlantillaEmail,
  actualizarSegmento,
  actualizarSuscripcion,
  cambiarEstadoCupon,
  cambiarEstadoSuscripcion,
  crearCupon,
  crearPlantillaEmail,
  crearSegmento,
  crearSuscripcion,
  listarCupones,
  listarPlantillasEmail,
  listarSegmentos,
  listarSuscripciones,
  obtenerCuponPorId,
  obtenerPlantillaEmailPorId,
  obtenerSegmentoPorId,
  obtenerSuscripcionPorId,
  registrarEnvioPruebaEmail,
} from "../models/marketing.model.js";

import { enviarCorreo } from "../config/mailer.config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function handleMarketingError(res, err, fallbackMessage) {
  console.error(fallbackMessage, err);

  if (err.code === "VALIDATION") {
    return res.status(400).json({
      ok: false,
      msg: err.message,
    });
  }

  if (err.code === "23505") {
    return res.status(409).json({
      ok: false,
      msg: "Ya existe un registro con esos datos.",
      detail: err.detail,
    });
  }

  if (err.code === "23514" || err.code === "22P02") {
    return res.status(400).json({
      ok: false,
      msg: "Datos inválidos.",
      detail: err.message,
    });
  }

  return res.status(500).json({
    ok: false,
    msg: fallbackMessage,
    detail: err.message,
  });
}

function paginationResponse(data) {
  return {
    data: data.items,
    pagination: {
      total: data.total,
      limit: data.limit,
      offset: data.offset,
      hasMore: data.hasMore,
    },
  };
}

// ============================================================
// SUSCRIPTORES
// ============================================================

export async function getSuscripcionesAdmin(req, res) {
  try {
    const data = await listarSuscripciones(req.db, {
      estado: req.query.estado || null,
      q: req.query.q || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json({
      ok: true,
      ...paginationResponse(data),
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error listando suscriptores");
  }
}

export async function getSuscripcionAdminById(req, res) {
  try {
    const data = await obtenerSuscripcionPorId(req.db, req.params.id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Suscriptor no encontrado",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleMarketingError(res, err, "Error obteniendo suscriptor");
  }
}

export async function postSuscripcionAdmin(req, res) {
  try {
    const email = String(req.body?.email || "").trim();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({
        ok: false,
        msg: "El correo electrónico no es válido.",
      });
    }

    const data = await crearSuscripcion(req.db, {
      email,
      nombre: req.body?.nombre,
      telefono: req.body?.telefono,
      origen: req.body?.origen || "ADMIN",
      estado: req.body?.estado || "ACTIVO",
      aceptaMarketing: req.body?.acepta_marketing ?? true,
      notasAdmin: req.body?.notas_admin,
      metadata: req.body?.metadata || {},
    });

    return res.status(201).json({
      ok: true,
      msg: "Suscriptor guardado correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error creando suscriptor");
  }
}

export async function patchSuscripcionAdmin(req, res) {
  try {
    const data = await actualizarSuscripcion(req.db, req.params.id, {
      nombre: req.body?.nombre,
      telefono: req.body?.telefono,
      aceptaMarketing: req.body?.acepta_marketing,
      notasAdmin: req.body?.notas_admin,
      metadata: req.body?.metadata,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Suscriptor no encontrado",
      });
    }

    return res.json({
      ok: true,
      msg: "Suscriptor actualizado correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error actualizando suscriptor");
  }
}

export async function patchSuscripcionStatusAdmin(req, res) {
  try {
    const data = await cambiarEstadoSuscripcion(req.db, req.params.id, {
      estado: req.body?.estado,
      motivoBaja: req.body?.motivo_baja,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Suscriptor no encontrado",
      });
    }

    return res.json({
      ok: true,
      msg: "Estado de suscriptor actualizado",
      data,
    });
  } catch (err) {
    return handleMarketingError(
      res,
      err,
      "Error actualizando estado de suscriptor",
    );
  }
}

// ============================================================
// CUPONES
// ============================================================

export async function getCuponesAdmin(req, res) {
  try {
    const data = await listarCupones(req.db, {
      estado: req.query.estado || null,
      canal: req.query.canal || null,
      q: req.query.q || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json({
      ok: true,
      ...paginationResponse(data),
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error listando cupones");
  }
}

export async function getCuponAdminById(req, res) {
  try {
    const data = await obtenerCuponPorId(req.db, req.params.id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Cupón no encontrado",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleMarketingError(res, err, "Error obteniendo cupón");
  }
}

export async function postCuponAdmin(req, res) {
  try {
    const data = await crearCupon(req.db, {
      codigo: req.body?.codigo,
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      tipoDescuento: req.body?.tipo_descuento,
      valor: req.body?.valor,
      montoMinimoCompra: req.body?.monto_minimo_compra,
      fechaInicio: req.body?.fecha_inicio,
      fechaFin: req.body?.fecha_fin,
      activo: req.body?.activo ?? true,
      canal: req.body?.canal || "AMBOS",
      aplicaA: req.body?.aplica_a || "PEDIDO",
      usoMaximo: req.body?.uso_maximo,
      usoMaximoPorCliente: req.body?.uso_maximo_por_cliente,
      acumulable: req.body?.acumulable ?? false,
      soloClientesRegistrados: req.body?.solo_clientes_registrados ?? false,
      usuarioId: req.user?.id ?? null,
      metadata: req.body?.metadata || {},
    });

    return res.status(201).json({
      ok: true,
      msg: "Cupón creado correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error creando cupón");
  }
}

export async function patchCuponAdmin(req, res) {
  try {
    const data = await actualizarCupon(req.db, req.params.id, {
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      tipoDescuento: req.body?.tipo_descuento,
      valor: req.body?.valor,
      montoMinimoCompra: req.body?.monto_minimo_compra,
      fechaInicio: req.body?.fecha_inicio,
      fechaFin: req.body?.fecha_fin,
      canal: req.body?.canal,
      aplicaA: req.body?.aplica_a,
      usoMaximo: req.body?.uso_maximo,
      usoMaximoPorCliente: req.body?.uso_maximo_por_cliente,
      acumulable: req.body?.acumulable,
      soloClientesRegistrados: req.body?.solo_clientes_registrados,
      usuarioId: req.user?.id ?? null,
      metadata: req.body?.metadata,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Cupón no encontrado",
      });
    }

    return res.json({
      ok: true,
      msg: "Cupón actualizado correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error actualizando cupón");
  }
}

export async function patchCuponStatusAdmin(req, res) {
  try {
    const data = await cambiarEstadoCupon(req.db, req.params.id, {
      activo: req.body?.activo,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Cupón no encontrado",
      });
    }

    return res.json({
      ok: true,
      msg: "Estado de cupón actualizado",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error actualizando cupón");
  }
}

// ============================================================
// SEGMENTOS
// ============================================================

export async function getSegmentosAdmin(req, res) {
  try {
    const data = await listarSegmentos(req.db, {
      activo: req.query.activo ?? null,
      q: req.query.q || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json({
      ok: true,
      ...paginationResponse(data),
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error listando segmentos");
  }
}

export async function getSegmentoAdminById(req, res) {
  try {
    const data = await obtenerSegmentoPorId(req.db, req.params.id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Segmento no encontrado",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleMarketingError(res, err, "Error obteniendo segmento");
  }
}

export async function postSegmentoAdmin(req, res) {
  try {
    const data = await crearSegmento(req.db, {
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      criterios: req.body?.criterios || {},
      activo: req.body?.activo ?? true,
      usuarioId: req.user?.id ?? null,
      metadata: req.body?.metadata || {},
    });

    return res.status(201).json({
      ok: true,
      msg: "Segmento creado correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error creando segmento");
  }
}

export async function patchSegmentoAdmin(req, res) {
  try {
    const data = await actualizarSegmento(req.db, req.params.id, {
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      criterios: req.body?.criterios,
      activo: req.body?.activo,
      usuarioId: req.user?.id ?? null,
      metadata: req.body?.metadata,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Segmento no encontrado",
      });
    }

    return res.json({
      ok: true,
      msg: "Segmento actualizado correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error actualizando segmento");
  }
}

// ============================================================
// PLANTILLAS
// ============================================================

export async function getPlantillasEmailAdmin(req, res) {
  try {
    const data = await listarPlantillasEmail(req.db, {
      tipo: req.query.tipo || null,
      activo: req.query.activo ?? null,
      q: req.query.q || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    return res.json({
      ok: true,
      ...paginationResponse(data),
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error listando plantillas");
  }
}

export async function getPlantillaEmailAdminById(req, res) {
  try {
    const data = await obtenerPlantillaEmailPorId(req.db, req.params.id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Plantilla no encontrada",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleMarketingError(res, err, "Error obteniendo plantilla");
  }
}

export async function postPlantillaEmailAdmin(req, res) {
  try {
    const data = await crearPlantillaEmail(req.db, {
      clave: req.body?.clave,
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      tipo: req.body?.tipo || "MARKETING",
      asunto: req.body?.asunto,
      preheader: req.body?.preheader,
      cuerpoHtml: req.body?.cuerpo_html || "",
      cuerpoTexto: req.body?.cuerpo_texto,
      activo: req.body?.activo ?? true,
      usuarioId: req.user?.id ?? null,
      metadata: req.body?.metadata || {},
    });

    return res.status(201).json({
      ok: true,
      msg: "Plantilla creada correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error creando plantilla");
  }
}

export async function patchPlantillaEmailAdmin(req, res) {
  try {
    const data = await actualizarPlantillaEmail(req.db, req.params.id, {
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      tipo: req.body?.tipo,
      asunto: req.body?.asunto,
      preheader: req.body?.preheader,
      cuerpoHtml: req.body?.cuerpo_html,
      cuerpoTexto: req.body?.cuerpo_texto,
      activo: req.body?.activo,
      usuarioId: req.user?.id ?? null,
      metadata: req.body?.metadata,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Plantilla no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: "Plantilla actualizada correctamente",
      data,
    });
  } catch (err) {
    return handleMarketingError(res, err, "Error actualizando plantilla");
  }
}

export async function postPlantillaEmailTestSendAdmin(req, res) {
  try {
    const emailDestino = String(req.body?.email_destino || "").trim();

    if (!EMAIL_RE.test(emailDestino)) {
      return res.status(400).json({
        ok: false,
        msg: "Correo destino inválido.",
      });
    }

    const plantilla = await obtenerPlantillaEmailPorId(req.db, req.params.id);

    if (!plantilla) {
      return res.status(404).json({
        ok: false,
        msg: "Plantilla no encontrada",
      });
    }

    if (!plantilla.activo) {
      return res.status(409).json({
        ok: false,
        msg: "No se puede enviar una plantilla inactiva.",
      });
    }

    let envio;

    try {
      await enviarCorreo(
        emailDestino,
        plantilla.asunto,
        plantilla.cuerpo_html || plantilla.cuerpo_texto || "",
      );

      envio = await registrarEnvioPruebaEmail(req.db, {
        plantillaId: plantilla.id,
        emailDestino,
        asuntoEnviado: plantilla.asunto,
        estado: "ENVIADO",
        proveedor: "RESEND",
        usuarioId: req.user?.id ?? null,
      });
    } catch (emailError) {
      envio = await registrarEnvioPruebaEmail(req.db, {
        plantillaId: plantilla.id,
        emailDestino,
        asuntoEnviado: plantilla.asunto,
        estado: "ERROR",
        proveedor: "RESEND",
        error: emailError.message,
        usuarioId: req.user?.id ?? null,
      });

      return res.status(502).json({
        ok: false,
        msg: "No se pudo enviar el correo de prueba.",
        data: envio,
      });
    }

    return res.json({
      ok: true,
      msg: "Correo de prueba enviado correctamente",
      data: envio,
    });
  } catch (err) {
    return handleMarketingError(
      res,
      err,
      "Error enviando prueba de plantilla",
    );
  }
}