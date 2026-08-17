// src/workers/alexa-credit-sync.worker.js

import {
  poolInterno,
} from "../config/db.js";

import {
  sincronizarCreditoAlexa,
} from "../services/alexa-datastore.service.js";


async function iniciarWorker() {
  const client =
    await poolInterno.connect();


  client.on(
    "notification",
    async (msg) => {

      if (
        msg.channel !==
        "alexa_credit_sync"
      ) {
        return;
      }


      const clienteId =
        String(
          msg.payload || "",
        ).trim();


      if (!clienteId) {
        return;
      }


      console.log(
        "[Alexa RT] Evento PostgreSQL:",
        clienteId,
      );


      try {
        const resultado =
          await sincronizarCreditoAlexa(
            clienteId,
          );


        console.log(
          "[Alexa RT] Resultado:",
          resultado,
        );
      } catch (error) {
        console.error(
          "[Alexa RT] Error:",
          clienteId,
          error,
        );
      }
    },
  );


  client.on(
    "error",
    (error) => {
      console.error(
        "[Alexa RT] PostgreSQL perdió conexión:",
        error,
      );
    },
  );


  await client.query(
    "LISTEN alexa_credit_sync",
  );


  console.log(
    "✅ Alexa Credit Sync escuchando PostgreSQL",
  );
}


iniciarWorker().catch(
  (error) => {
    console.error(
      "❌ No se pudo iniciar Alexa Credit Sync:",
      error,
    );

    process.exit(1);
  },
);