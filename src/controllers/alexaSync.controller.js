import {
  registrarTargetAlexaUsuario,
} from "../models/alexa-sync.model.js";

export async function postAlexaWidgetTarget(req, res) {
  try {
    const {
      alexa_user_id,
      alexa_device_id,
      package_id,
      package_instance_id,
    } = req.body || {};

    if (!req.user?.id) {
      return res.status(401).json({
        ok: false,
        msg: "Usuario no autenticado",
      });
    }

    if (
      !alexa_user_id ||
      !alexa_device_id ||
      !package_id
    ) {
      return res.status(400).json({
        ok: false,
        msg: "Faltan datos del dispositivo Alexa",
      });
    }

    const data =
      await registrarTargetAlexaUsuario(
        req.db,
        {
          usuarioId: req.user.id,
          alexaUserId: String(alexa_user_id),
          alexaDeviceId: String(alexa_device_id),
          packageId: String(package_id),
          packageInstanceId:
            package_instance_id
              ? String(package_instance_id)
              : null,
        },
      );

    return res.status(201).json({
      ok: true,
      data,
    });
  } catch (error) {
    console.error(
      "postAlexaWidgetTarget error:",
      error,
    );

    return res.status(500).json({
      ok: false,
      msg: "No se pudo registrar el dispositivo Alexa",
      detail: error.message,
    });
  }
}