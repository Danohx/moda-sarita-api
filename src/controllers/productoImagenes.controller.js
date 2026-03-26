import cloudinary from "../config/cloudinary.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";
import {
  insertProductoImagen,
  listProductoImagenes,
  setPrincipalImagen,
  reorderProductoImagenes,
  deleteProductoImagenWithFallback,
} from "../models/productoImagenes.model.js";

export async function getProductoImagenes(req, res) {
  try {
    const productoId = String(req.params.id);
    const data = await listProductoImagenes(req.db, productoId);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("getProductoImagenes error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error listando imágenes", detail: err.message });
  }
}

export async function postProductoImagen(req, res) {
  try {
    const productoId = String(req.params.id);

    if (!req.file)
      return res
        .status(400)
        .json({ ok: false, msg: "Debes enviar un archivo (field: image)" });

    const folder = process.env.CLOUDINARY_FOLDER || "moda-sarita/productos";

    const result = await uploadBufferToCloudinary(req.file.buffer, { folder });

    const url = result.secure_url;
    const publicId = result.public_id;

    const row = await insertProductoImagen(req.db, {
      productoId,
      publicId,
      url,
      esPrincipal: false,
    });

    return res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error("postProductoImagen error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error subiendo imagen", detail: err.message });
  }
}

export async function patchProductoImagenPrincipal(req, res) {
  try {
    const productoId = String(req.params.id);
    const imagenId = String(req.params.imagenId);

    const row = await setPrincipalImagen(req.db, { productoId, imagenId });
    if (!row)
      return res.status(404).json({ ok: false, msg: "Imagen no encontrada" });

    return res.json({ ok: true, data: row });
  } catch (err) {
    console.error("patchProductoImagenPrincipal error:", err);
    return res
      .status(500)
      .json({
        ok: false,
        msg: "Error marcando principal",
        detail: err.message,
      });
  }
}

export async function deleteProductoImagenById(req, res) {
  try {
    const productoId = String(req.params.id);
    const imagenId = String(req.params.imagenId);

    const deleted = await deleteProductoImagenWithFallback(req.db, {
      productoId,
      imagenId,
    });
    if (!deleted)
      return res.status(404).json({ ok: false, msg: "Imagen no encontrada" });

    if (deleted.public_id) {
      await cloudinary.uploader.destroy(deleted.public_id);
    }

    return res.json({ ok: true, msg: "Imagen eliminada", data: deleted });
  } catch (err) {
    console.error("deleteProductoImagenById error:", err);
    return res
      .status(500)
      .json({ ok: false, msg: "Error eliminando imagen", detail: err.message });
  }
}

export async function patchProductoImagenesReorder(req, res) {
  try {
    const productoId = String(req.params.id);
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ ok: false, msg: "items debe ser un arreglo no vacío" });
    }

    for (const it of items) {
      if (!it?.id)
        return res
          .status(400)
          .json({ ok: false, msg: "Cada item debe tener id" });
      if (it.orden !== undefined && !Number.isInteger(it.orden)) {
        return res
          .status(400)
          .json({ ok: false, msg: "orden debe ser entero" });
      }
      if (
        it.es_principal !== undefined &&
        typeof it.es_principal !== "boolean"
      ) {
        return res
          .status(400)
          .json({ ok: false, msg: "es_principal debe ser boolean" });
      }
    }

    const data = await reorderProductoImagenes(req.db, { productoId, items });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("patchProductoImagenesReorder error:", err);
    return res
      .status(400)
      .json({ ok: false, msg: "No se pudo reordenar", detail: err.message });
  }
}
