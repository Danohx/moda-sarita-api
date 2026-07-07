// src/controllers/contacto.controller.js

import {
  actualizarNotasMensajeContacto,
  actualizarNotificacionAdminContacto,
  cambiarEstadoMensajeContacto,
  crearMensajeContacto,
  listarMensajesContacto,
  obtenerMensajeContactoPorId,
  responderMensajeContacto,
  obtenerResumenMensajesContacto
} from "../models/contacto.model.js";

import { enviarCorreo } from "../config/mailer.config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getIp(req) {
  const raw =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.ip ||
    "127.0.0.1";

  return String(raw).split(",")[0].trim().replace("::1", "127.0.0.1");
}

function getUserAgent(req) {
  return String(req.headers["user-agent"] || "Unknown");
}

function handleContactoError(res, err, fallbackMessage) {
  console.error(fallbackMessage, err);

  if (err.code === "VALIDATION") {
    return res.status(400).json({
      ok: false,
      msg: err.message,
    });
  }

  if (err.code === "23514" || err.code === "22P02") {
    return res.status(400).json({
      ok: false,
      msg: "Datos inválidos",
      detail: err.message,
    });
  }

  return res.status(500).json({
    ok: false,
    msg: fallbackMessage,
    detail: err.message,
  });
}

function validateContactoPayload(body = {}) {
  const nombre = String(body.nombre || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const telefono = body.telefono ? String(body.telefono).trim() : null;
  const asunto = String(body.asunto || "").trim();
  const mensaje = String(body.mensaje || "").trim();

  if (nombre.length < 2) {
    return { ok: false, msg: "El nombre debe tener al menos 2 caracteres." };
  }

  if (!EMAIL_RE.test(email)) {
    return { ok: false, msg: "El correo electrónico no es válido." };
  }

  if (asunto.length < 3) {
    return { ok: false, msg: "El asunto debe tener al menos 3 caracteres." };
  }

  if (mensaje.length < 10) {
    return { ok: false, msg: "El mensaje debe tener al menos 10 caracteres." };
  }

  if (telefono && telefono.length > 30) {
    return { ok: false, msg: "El teléfono es demasiado largo." };
  }

  return {
    ok: true,
    data: {
      nombre,
      email,
      telefono,
      asunto,
      mensaje,
    },
  };
}

async function verificarCaptchaContacto({ token, ip }) {
  const secret = process.env.CONTACTO_CAPTCHA_SECRET;
  const provider = process.env.CONTACTO_CAPTCHA_PROVIDER || "DEV";

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        provider,
        score: null,
        error: "CAPTCHA no configurado en producción.",
      };
    }

    return {
      ok: true,
      provider: "DEV",
      score: 100,
      error: null,
    };
  }

  if (!token) {
    return {
      ok: false,
      provider,
      score: null,
      error: "Token CAPTCHA requerido.",
    };
  }

  if (provider.toUpperCase() === "TURNSTILE") {
    const formData = new URLSearchParams();

    formData.set("secret", secret);
    formData.set("response", token);

    if (ip) {
      formData.set("remoteip", ip);
    }

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      },
    );

    const data = await response.json();

    return {
      ok: Boolean(data.success),
      provider: "TURNSTILE",
      score: data.success ? 100 : 0,
      error: data.success ? null : JSON.stringify(data["error-codes"] || []),
    };
  }

  return {
    ok: false,
    provider,
    score: null,
    error: "Proveedor CAPTCHA no soportado.",
  };
}

function buildAdminNotificationHtml(mensaje) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
      <h2>Nuevo mensaje de contacto</h2>

      <p><strong>Nombre:</strong> ${mensaje.nombre}</p>
      <p><strong>Correo:</strong> ${mensaje.email}</p>
      ${
        mensaje.telefono
          ? `<p><strong>Teléfono:</strong> ${mensaje.telefono}</p>`
          : ""
      }
      <p><strong>Asunto:</strong> ${mensaje.asunto}</p>

      <hr />

      <p style="white-space: pre-line;">${mensaje.mensaje}</p>

      <hr />

      <p style="font-size: 12px; color: #777;">
        Este mensaje fue enviado desde el formulario de contacto de Moda Sarita.
      </p>
    </div>
  `;
}

function buildRespuestaClienteHtml({ nombre, respuesta }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
      <h2>Respuesta de Moda Sarita</h2>

      <p>Hola ${nombre},</p>

      <p style="white-space: pre-line;">${respuesta}</p>

      <hr />

      <p style="font-size: 12px; color: #777;">
        Gracias por contactar a Moda Sarita.
      </p>
    </div>
  `;
}

// ============================================================
// PÚBLICO
// ============================================================

export async function postMensajeContactoPublico(req, res) {
  try {
    const validation = validateContactoPayload(req.body || {});

    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        msg: validation.msg,
      });
    }

    const ip = getIp(req);
    const userAgent = getUserAgent(req);

    const honeypotValue =
      req.body?.website ||
      req.body?.empresa ||
      req.body?.url ||
      req.body?.homepage;

    const honeypotDetected = Boolean(String(honeypotValue || "").trim());

    const captchaToken =
      req.body?.captchaToken ||
      req.body?.captcha_token ||
      req.body?.turnstileToken ||
      null;

    const captcha = await verificarCaptchaContacto({
      token: captchaToken,
      ip,
    });

    const estadoInicial = honeypotDetected ? "ARCHIVADO" : "NUEVO";

    const mensaje = await crearMensajeContacto(req.db, {
      ...validation.data,
      estado: estadoInicial,
      ipAddress: ip,
      userAgent,
      captchaOk: captcha.ok,
      captchaProvider: captcha.provider,
      captchaScore: captcha.score,
      honeypotDetected,
      metadata: {
        captchaError: captcha.error,
      },
    });

    // Si fue honeypot, respondemos éxito genérico pero no notificamos.
    if (honeypotDetected) {
      return res.status(201).json({
        ok: true,
        msg: "Mensaje recibido correctamente.",
      });
    }

    if (!captcha.ok) {
      return res.status(400).json({
        ok: false,
        msg: "No se pudo validar el CAPTCHA.",
      });
    }

    const adminEmail =
      process.env.CONTACTO_ADMIN_EMAIL ||
      process.env.EMAIL_USER ||
      null;

    if (adminEmail) {
      try {
        const sent = await enviarCorreo(
          adminEmail,
          `Nuevo mensaje de contacto: ${mensaje.asunto}`,
          buildAdminNotificationHtml(mensaje),
        );

        await actualizarNotificacionAdminContacto(req.db, mensaje.id, {
          ok: sent,
          error: sent ? null : "El proveedor de correo devolvió error.",
        });
      } catch (emailError) {
        await actualizarNotificacionAdminContacto(req.db, mensaje.id, {
          ok: false,
          error: emailError.message,
        });
      }
    }

    return res.status(201).json({
      ok: true,
      msg: "Mensaje recibido correctamente.",
      data: {
        id: mensaje.id,
      },
    });
  } catch (err) {
    return handleContactoError(res, err, "Error registrando mensaje de contacto");
  }
}

// ============================================================
// ADMIN
// ============================================================

export async function getMensajesContactoAdmin(req, res) {
  try {
    const estado = req.query.estado
      ? String(req.query.estado).trim().toUpperCase()
      : null;

    const q = req.query.q ? String(req.query.q).trim() : null;
    const includeArchived = req.query.includeArchived === "true";
    const limit = req.query.limit ? Number(req.query.limit) : 25;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const data = await listarMensajesContacto(req.db, {
      estado,
      q,
      includeArchived,
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
    return handleContactoError(res, err, "Error listando mensajes de contacto");
  }
}

export async function getMensajeContactoAdminById(req, res) {
  try {
    const id = String(req.params.id || "").trim();

    const data = await obtenerMensajeContactoPorId(req.db, id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Mensaje no encontrado",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContactoError(res, err, "Error obteniendo mensaje de contacto");
  }
}

export async function patchMensajeContactoStatus(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const estado = String(req.body?.estado || "").trim().toUpperCase();

    if (!estado) {
      return res.status(400).json({
        ok: false,
        msg: "estado es requerido",
      });
    }

    const data = await cambiarEstadoMensajeContacto(req.db, id, {
      estado,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Mensaje no encontrado",
      });
    }

    return res.json({
      ok: true,
      msg: "Estado actualizado correctamente",
      data,
    });
  } catch (err) {
    return handleContactoError(res, err, "Error actualizando estado");
  }
}

export async function patchMensajeContactoNotas(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const notasAdmin = req.body?.notas_admin ?? null;

    const data = await actualizarNotasMensajeContacto(req.db, id, {
      notasAdmin,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Mensaje no encontrado",
      });
    }

    return res.json({
      ok: true,
      msg: "Notas actualizadas correctamente",
      data,
    });
  } catch (err) {
    return handleContactoError(res, err, "Error actualizando notas");
  }
}

export async function postResponderMensajeContacto(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const respuestaAdmin = String(req.body?.respuesta_admin || "").trim();

    if (respuestaAdmin.length < 5) {
      return res.status(400).json({
        ok: false,
        msg: "La respuesta debe tener al menos 5 caracteres.",
      });
    }

    const mensajeActual = await obtenerMensajeContactoPorId(req.db, id);

    if (!mensajeActual) {
      return res.status(404).json({
        ok: false,
        msg: "Mensaje no encontrado",
      });
    }

    const data = await responderMensajeContacto(req.db, id, {
      respuestaAdmin,
      usuarioId: req.user?.id ?? null,
    });

    try {
      await enviarCorreo(
        mensajeActual.email,
        `Respuesta a tu mensaje: ${mensajeActual.asunto}`,
        buildRespuestaClienteHtml({
          nombre: mensajeActual.nombre,
          respuesta: respuestaAdmin,
        }),
      );
    } catch (emailError) {
      console.error("Error enviando respuesta al cliente:", emailError);
    }

    return res.json({
      ok: true,
      msg: "Respuesta registrada correctamente",
      data,
    });
  } catch (err) {
    return handleContactoError(res, err, "Error respondiendo mensaje");
  }
}

export async function getResumenMensajesContactoAdmin(req, res) {
  try {
    const data = await obtenerResumenMensajesContacto(req.db);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    return handleContactoError(
      res,
      err,
      "Error obteniendo resumen de mensajes de contacto",
    );
  }
}