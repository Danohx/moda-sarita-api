// src/controllers/contenido.controller.js

import {
  listPaginasAdmin,
  getPaginaAdminById,
  getPaginaAdminByClave,
  getPaginaPublica,
  createPagina,
  updatePagina,
  setPaginaStatus,
  setPaginaPublicacion,
  listVersionesPagina,
  restaurarVersionPagina,
  listFaqsAdmin,
  listFaqsPublicas,
  getFaqAdmin,
  createFaq,
  updateFaq,
  setFaqStatus,
  setFaqPublicacion,
  reorderFaqs,
} from "../models/contenido.model.js";

function handleContenidoError(res, err, fallbackMessage) {
  console.error(fallbackMessage, err);

  if (err.code === "VALIDATION") {
    return res.status(400).json({
      ok: false,
      msg: err.message,
    });
  }

  if (err.code === "NOT_FOUND") {
    return res.status(404).json({
      ok: false,
      msg: err.message,
    });
  }

  if (err.code === "23505") {
    return res.status(409).json({
      ok: false,
      msg: "Registro duplicado",
      detail: err.detail,
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

function parseIncludeInactive(value) {
  if (value === undefined) return true;
  return String(value) === "true";
}

function validateNonEmpty(value, min = 1) {
  return typeof value === "string" && value.trim().length >= min;
}

// ============================================================
// PÁGINAS ADMIN
// ============================================================

export async function getPaginasAdmin(req, res) {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const includeInactive = parseIncludeInactive(req.query.includeInactive);

    const data = await listPaginasAdmin(req.db, {
      q,
      includeInactive,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error listando páginas");
  }
}

export async function getPaginaAdminByIdController(req, res) {
  try {
    const id = String(req.params.id || "").trim();

    const data = await getPaginaAdminById(req.db, id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Página no encontrada",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error obteniendo página por id");
  }
}

export async function getPaginaAdminByClaveController(req, res) {
  try {
    const clave = String(req.params.clave || "").trim();

    if (!clave) {
      return res.status(400).json({
        ok: false,
        msg: "clave requerida",
      });
    }

    const data = await getPaginaAdminByClave(req.db, clave);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Página no encontrada",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error obteniendo página por clave");
  }
}

export async function postPagina(req, res) {
  try {
    const {
      clave,
      titulo,
      resumen = null,
      contenido_html = "",
      contenido_texto = null,
    } = req.body || {};

    if (!validateNonEmpty(clave, 3)) {
      return res.status(400).json({
        ok: false,
        msg: "clave es requerida, mínimo 3 caracteres",
      });
    }

    if (!/^[A-Za-z0-9_\s]+$/.test(String(clave))) {
      return res.status(400).json({
        ok: false,
        msg: "clave solo puede contener letras, números, guiones bajos o espacios",
      });
    }

    if (!validateNonEmpty(titulo, 3)) {
      return res.status(400).json({
        ok: false,
        msg: "titulo es requerido, mínimo 3 caracteres",
      });
    }

    const data = await createPagina(req.db, {
      clave,
      titulo,
      resumen,
      contenido_html,
      contenido_texto,
      usuarioId: req.user?.id ?? null,
    });

    return res.status(201).json({
      ok: true,
      msg: "Página creada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error creando página");
  }
}

export async function patchPagina(req, res) {
  try {
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({
        ok: false,
        msg: "id requerido",
      });
    }

    if (
      req.body?.titulo !== undefined &&
      !validateNonEmpty(req.body.titulo, 3)
    ) {
      return res.status(400).json({
        ok: false,
        msg: "titulo debe tener mínimo 3 caracteres",
      });
    }

    const data = await updatePagina(req.db, id, {
      ...req.body,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Página no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: "Página actualizada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error actualizando página");
  }
}

export async function patchPaginaStatus(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const { activo } = req.body || {};

    if (typeof activo !== "boolean") {
      return res.status(400).json({
        ok: false,
        msg: "activo debe ser boolean",
      });
    }

    const data = await setPaginaStatus(req.db, id, {
      activo,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Página no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: activo
        ? "Página activada correctamente"
        : "Página desactivada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error cambiando estado de página");
  }
}

export async function patchPaginaPublicacion(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const { publicado } = req.body || {};

    if (typeof publicado !== "boolean") {
      return res.status(400).json({
        ok: false,
        msg: "publicado debe ser boolean",
      });
    }

    const data = await setPaginaPublicacion(req.db, id, {
      publicado,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Página no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: publicado
        ? "Página publicada correctamente"
        : "Página despublicada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error cambiando publicación");
  }
}

export async function getPaginaVersiones(req, res) {
  try {
    const paginaId = String(req.params.id || "").trim();

    const pagina = await getPaginaAdminById(req.db, paginaId);

    if (!pagina) {
      return res.status(404).json({
        ok: false,
        msg: "Página no encontrada",
      });
    }

    const data = await listVersionesPagina(req.db, paginaId);

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error listando versiones");
  }
}

export async function postRestaurarPaginaVersion(req, res) {
  try {
    const paginaId = String(req.params.id || "").trim();
    const versionId = String(req.params.versionId || "").trim();

    const data = await restaurarVersionPagina(req.db, paginaId, versionId, {
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Página no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: "Versión restaurada como borrador. Publica la página para hacerla visible.",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error restaurando versión");
  }
}

// ============================================================
// PÁGINAS PÚBLICAS
// ============================================================

export async function getPaginaPublicaByClave(req, res) {
  try {
    const clave = String(req.params.clave || "").trim();

    if (!clave) {
      return res.status(400).json({
        ok: false,
        msg: "clave requerida",
      });
    }

    const data = await getPaginaPublica(req.db, clave);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Página no disponible",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error obteniendo página pública");
  }
}

// ============================================================
// FAQ ADMIN
// ============================================================

export async function getFaqsAdmin(req, res) {
  try {
    const q = req.query.q ? String(req.query.q).trim() : null;
    const includeInactive = parseIncludeInactive(req.query.includeInactive);

    const data = await listFaqsAdmin(req.db, {
      q,
      includeInactive,
    });

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error listando FAQ");
  }
}

export async function getFaqAdminById(req, res) {
  try {
    const id = String(req.params.id || "").trim();

    const data = await getFaqAdmin(req.db, id);

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Pregunta no encontrada",
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error obteniendo pregunta");
  }
}

export async function postFaq(req, res) {
  try {
    const {
      pregunta,
      respuesta_html = "",
      respuesta_texto = null,
      orden = null,
    } = req.body || {};

    if (!validateNonEmpty(pregunta, 5)) {
      return res.status(400).json({
        ok: false,
        msg: "pregunta es requerida, mínimo 5 caracteres",
      });
    }

    if (
      !validateNonEmpty(String(respuesta_html || ""), 2) &&
      !validateNonEmpty(String(respuesta_texto || ""), 2)
    ) {
      return res.status(400).json({
        ok: false,
        msg: "respuesta es requerida",
      });
    }

    if (orden !== null && orden !== undefined) {
      const ordenNum = Number(orden);

      if (!Number.isInteger(ordenNum) || ordenNum < 0) {
        return res.status(400).json({
          ok: false,
          msg: "orden debe ser entero mayor o igual a 0",
        });
      }
    }

    const data = await createFaq(req.db, {
      pregunta,
      respuesta_html,
      respuesta_texto,
      orden,
      usuarioId: req.user?.id ?? null,
    });

    return res.status(201).json({
      ok: true,
      msg: "Pregunta creada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error creando pregunta");
  }
}

export async function patchFaq(req, res) {
  try {
    const id = String(req.params.id || "").trim();

    if (
      req.body?.pregunta !== undefined &&
      !validateNonEmpty(req.body.pregunta, 5)
    ) {
      return res.status(400).json({
        ok: false,
        msg: "pregunta debe tener mínimo 5 caracteres",
      });
    }

    if (req.body?.orden !== undefined) {
      const ordenNum = Number(req.body.orden);

      if (!Number.isInteger(ordenNum) || ordenNum < 0) {
        return res.status(400).json({
          ok: false,
          msg: "orden debe ser entero mayor o igual a 0",
        });
      }
    }

    const data = await updateFaq(req.db, id, {
      ...req.body,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Pregunta no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: "Pregunta actualizada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error actualizando pregunta");
  }
}

export async function patchFaqStatus(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const { activo } = req.body || {};

    if (typeof activo !== "boolean") {
      return res.status(400).json({
        ok: false,
        msg: "activo debe ser boolean",
      });
    }

    const data = await setFaqStatus(req.db, id, {
      activo,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Pregunta no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: activo
        ? "Pregunta activada correctamente"
        : "Pregunta desactivada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error cambiando estado de FAQ");
  }
}

export async function patchFaqPublicacion(req, res) {
  try {
    const id = String(req.params.id || "").trim();
    const { publicado } = req.body || {};

    if (typeof publicado !== "boolean") {
      return res.status(400).json({
        ok: false,
        msg: "publicado debe ser boolean",
      });
    }

    const data = await setFaqPublicacion(req.db, id, {
      publicado,
      usuarioId: req.user?.id ?? null,
    });

    if (!data) {
      return res.status(404).json({
        ok: false,
        msg: "Pregunta no encontrada",
      });
    }

    return res.json({
      ok: true,
      msg: publicado
        ? "Pregunta publicada correctamente"
        : "Pregunta despublicada correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error cambiando publicación de FAQ");
  }
}

export async function patchFaqsOrden(req, res) {
  try {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        msg: "items debe ser un arreglo no vacío",
      });
    }

    for (const item of items) {
      if (!item?.id) {
        return res.status(400).json({
          ok: false,
          msg: "Cada item debe tener id",
        });
      }

      if (!Number.isInteger(Number(item.orden)) || Number(item.orden) < 0) {
        return res.status(400).json({
          ok: false,
          msg: "Cada item debe tener orden entero mayor o igual a 0",
        });
      }
    }

    const data = await reorderFaqs(req.db, {
      items,
      usuarioId: req.user?.id ?? null,
    });

    return res.json({
      ok: true,
      msg: "Orden actualizado correctamente",
      data,
    });
  } catch (err) {
    return handleContenidoError(res, err, "Error reordenando FAQ");
  }
}

// ============================================================
// FAQ PÚBLICA
// ============================================================

export async function getFaqsPublicas(req, res) {
  try {
    const data = await listFaqsPublicas(req.db);
    return res.json({ ok: true, data });
  } catch (err) {
    return handleContenidoError(res, err, "Error obteniendo FAQ pública");
  }
}
