import { waitUntil } from "@vercel/functions";
import { sincronizarCreditoAlexa } from "./alexa-datastore.service.js";

export function programarSincronizacionAlexa(clienteId) {
  if (!clienteId) return;

  waitUntil(
    sincronizarCreditoAlexa(clienteId)
      .then((resultado) => {
        console.log(
          "[Alexa RT] Sincronización terminada:",
          clienteId,
          resultado,
        );
      })
      .catch((error) => {
        console.error(
          "[Alexa RT] Error sincronizando:",
          clienteId,
          error,
        );
      }),
  );
}