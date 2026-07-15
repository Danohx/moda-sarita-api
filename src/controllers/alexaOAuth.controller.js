// src/controllers/alexaOAuth.controller.js

import bcrypt from "bcryptjs";
import crypto from "crypto";

import {
  generateAccessToken,
  verify2FAToken,
} from "../middleware/seguridad.js";

import {
  createAlexaAuthorizationCode,
  consumeAlexaAuthorizationCode,
  createAlexaOAuthSession,
  findAlexaClientByEmail,
  isAllowedAlexaRedirectUri,
  rotateAlexaRefreshToken,
} from "../models/alexaOAuth.model.js";

const DEFAULT_SCOPE = process.env.ALEXA_OAUTH_SCOPE || "credito.read";

function getAccessExpiresSeconds() {
  const value = Number(process.env.ALEXA_OAUTH_ACCESS_EXPIRES_SECONDS || 3600);
  return Number.isInteger(value) && value >= 300 ? value : 3600;
}

function getRefreshExpiresDays() {
  const value = Number(process.env.ALEXA_OAUTH_REFRESH_DAYS || 90);
  return Number.isInteger(value) && value >= 1 ? value : 90;
}

function getRefreshExpiresAt() {
  return new Date(
    Date.now() + getRefreshExpiresDays() * 24 * 60 * 60 * 1000,
  );
}

function getIp(req) {
  const raw =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.ip ||
    "127.0.0.1";

  return String(raw)
    .split(",")[0]
    .trim()
    .replace(/^::ffff:/, "")
    .replace("::1", "127.0.0.1");
}

function timingSafeTextEqual(received, expected) {
  const receivedBuffer = Buffer.from(String(received || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function parseBasicCredentials(req) {
  const header = String(req.headers.authorization || "");

  if (!header.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) return null;

    return {
      clientId: decoded.slice(0, separatorIndex),
      clientSecret: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function getOAuthClientCredentials(req) {
  const basic = parseBasicCredentials(req);

  if (basic) return basic;

  return {
    clientId: req.body?.client_id,
    clientSecret: req.body?.client_secret,
  };
}

function validateOAuthClient(req) {
  const credentials = getOAuthClientCredentials(req);

  const expectedClientId = process.env.ALEXA_OAUTH_CLIENT_ID;
  const expectedSecret = process.env.ALEXA_OAUTH_CLIENT_SECRET;

  return (
    credentials &&
    timingSafeTextEqual(credentials.clientId, expectedClientId) &&
    timingSafeTextEqual(credentials.clientSecret, expectedSecret)
  );
}

function setNoStore(res) {
  res.set({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
}

function sendOAuthError(
  res,
  status,
  error,
  description,
) {
  setNoStore(res);

  return res.status(status).json({
    error,
    error_description: description,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderLoginPage(
  {
    clientId,
    redirectUri,
    responseType,
    scope,
    state,
    errorMessage = "",
    email = "",
  },
) {
  const errorHtml = errorMessage
    ? `<div class="alert" role="alert">${escapeHtml(errorMessage)}</div>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, viewport-fit=cover"
  />
  <meta name="color-scheme" content="light" />
  <title>Vincular Mi Crédito Sarita</title>

  <style>
    :root {
      --background: #f8f6f7;
      --surface: #ffffff;
      --text: #5c4b57;
      --text-dark: #221019;
      --primary: #ec1380;
      --primary-hover: #c2185b;
      --primary-soft: #f7d5e9;
      --border: rgba(92, 75, 87, 0.14);
      --danger: #b91c1c;
      --danger-bg: rgba(220, 38, 38, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      padding: 22px;
      display: grid;
      place-items: center;
      font-family:
        Manrope, Inter, ui-sans-serif, system-ui, -apple-system,
        BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top, rgba(236, 19, 128, 0.12), transparent 42%),
        var(--background);
    }

    .card {
      width: min(100%, 460px);
      padding: 30px;
      border: 1px solid var(--border);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 18px 46px rgba(92, 75, 87, 0.13);
    }

    .brand {
      margin: 0;
      color: var(--primary);
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
    }

    h1 {
      margin: 10px 0 8px;
      color: var(--text-dark);
      font-size: clamp(25px, 7vw, 34px);
      line-height: 1.15;
      text-align: center;
    }

    .subtitle {
      margin: 0 0 24px;
      text-align: center;
      line-height: 1.6;
    }

    .alert {
      margin-bottom: 18px;
      padding: 12px 14px;
      border: 1px solid rgba(220, 38, 38, 0.18);
      border-radius: 12px;
      color: var(--danger);
      background: var(--danger-bg);
      font-size: 14px;
      font-weight: 700;
    }

    label {
      display: block;
      margin-bottom: 7px;
      color: var(--text-dark);
      font-size: 14px;
      font-weight: 800;
    }

    input {
      width: 100%;
      min-height: 48px;
      margin-bottom: 17px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-dark);
      background: #fff;
      font: inherit;
    }

    input:focus {
      border-color: var(--primary);
      outline: 3px solid rgba(236, 19, 128, 0.12);
    }

    button {
      width: 100%;
      min-height: 50px;
      border: 0;
      border-radius: 13px;
      color: #fff;
      background: linear-gradient(135deg, #ec1380, #ff4fa3);
      box-shadow: 0 10px 24px rgba(236, 19, 128, 0.24);
      cursor: pointer;
      font: inherit;
      font-weight: 800;
    }

    button:hover { background: var(--primary-hover); }

    .security {
      margin: 18px 0 0;
      padding: 13px;
      border-radius: 12px;
      color: var(--text);
      background: rgba(247, 213, 233, 0.38);
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
    }
  </style>
</head>

<body>
  <main class="card">
    <p class="brand">Moda Sarita</p>
    <h1>Vincula tu crédito con Alexa</h1>
    <p class="subtitle">
      Inicia sesión para permitir que Mi Crédito Sarita consulte
      tu saldo, crédito disponible y movimientos.
    </p>

    ${errorHtml}

    <form method="post" action="/api/alexa/oauth/authorize" autocomplete="on">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="response_type" value="${escapeHtml(responseType)}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
      <input type="hidden" name="state" value="${escapeHtml(state)}" />

      <label for="correo">Correo de Moda Sarita</label>
      <input
        id="correo"
        name="correo"
        type="email"
        value="${escapeHtml(email)}"
        autocomplete="username"
        required
      />

      <label for="contrasena">Contraseña</label>
      <input
        id="contrasena"
        name="contrasena"
        type="password"
        autocomplete="current-password"
        required
      />

      <label for="otp_code">Código 2FA, cuando esté habilitado</label>
      <input
        id="otp_code"
        name="otp_code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="8"
        placeholder="Opcional"
      />

      <button type="submit">Vincular cuenta</button>
    </form>

    <p class="security">
      Alexa tendrá acceso de solo lectura a la información de crédito.
      No podrá registrar pagos ni modificar tu límite.
    </p>
  </main>
</body>
</html>`;
}

function validateAuthorizeRequest(input) {
  const clientId = String(input.client_id || "");
  const redirectUri = String(input.redirect_uri || "");
  const responseType = String(input.response_type || "");
  const scope = String(input.scope || DEFAULT_SCOPE);
  const state = String(input.state || "");

  if (clientId !== process.env.ALEXA_OAUTH_CLIENT_ID) {
    return { ok: false, message: "Cliente OAuth no reconocido." };
  }

  if (!isAllowedAlexaRedirectUri(redirectUri)) {
    return { ok: false, message: "URL de retorno no permitida." };
  }

  if (responseType !== "code") {
    return { ok: false, message: "response_type debe ser code." };
  }

  const requestedScopes = scope.split(/\s+/).filter(Boolean);

  if (
    requestedScopes.length !== 1 ||
    requestedScopes[0] !== DEFAULT_SCOPE
  ) {
    return { ok: false, message: "Scope no permitido." };
  }

  if (!state) {
    return { ok: false, message: "Falta el parámetro state." };
  }

  return {
    ok: true,
    data: {
      clientId,
      redirectUri,
      responseType,
      scope: DEFAULT_SCOPE,
      state,
    },
  };
}

export async function getAlexaAuthorize(req, res) {
  const validation = validateAuthorizeRequest(req.query || {});

  if (!validation.ok) {
    return res.status(400).type("html").send(
      renderLoginPage({
        clientId: req.query?.client_id,
        redirectUri: req.query?.redirect_uri,
        responseType: req.query?.response_type,
        scope: req.query?.scope,
        state: req.query?.state,
        errorMessage: validation.message,
      }),
    );
  }

  setNoStore(res);

  return res.type("html").send(
    renderLoginPage(validation.data),
  );
}

export async function postAlexaAuthorize(req, res) {
  const validation = validateAuthorizeRequest(req.body || {});

  if (!validation.ok) {
    return res.status(400).type("html").send(
      renderLoginPage({
        clientId: req.body?.client_id,
        redirectUri: req.body?.redirect_uri,
        responseType: req.body?.response_type,
        scope: req.body?.scope,
        state: req.body?.state,
        email: req.body?.correo,
        errorMessage: validation.message,
      }),
    );
  }

  const {
    clientId,
    redirectUri,
    responseType,
    scope,
    state,
  } = validation.data;

  const correo = String(req.body?.correo || "").trim().toLowerCase();
  const contrasena = String(req.body?.contrasena || "");
  const otpCode = String(req.body?.otp_code || "").trim();

  const renderError = (status, message) =>
    res.status(status).type("html").send(
      renderLoginPage({
        clientId,
        redirectUri,
        responseType,
        scope,
        state,
        email: correo,
        errorMessage: message,
      }),
    );

  try {
    const user = await findAlexaClientByEmail(req.db, correo);

    if (!user) {
      return renderError(
        401,
        "Correo o contraseña incorrectos, o la cuenta no es de cliente.",
      );
    }

    const passwordOk = await bcrypt.compare(
      contrasena,
      user.password_hash,
    );

    if (!passwordOk) {
      return renderError(401, "Correo o contraseña incorrectos.");
    }

    if (user.tfa_enabled) {
      if (!otpCode) {
        return renderError(
          401,
          "Esta cuenta usa 2FA. Ingresa el código de tu aplicación autenticadora.",
        );
      }

      const validOtp = verify2FAToken(user.tfa_secret, otpCode);

      if (!validOtp) {
        return renderError(401, "El código 2FA no es válido.");
      }
    }

    const authorization = await createAlexaAuthorizationCode(req.db, {
      userId: user.usuario_id,
      clientId,
      redirectUri,
      scope,
    });

    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set("state", state);
    callbackUrl.searchParams.set("code", authorization.code);

    setNoStore(res);

    return res.redirect(302, callbackUrl.toString());
  } catch (error) {
    console.error("Error autorizando Alexa:", error);

    return renderError(
      500,
      "No fue posible vincular la cuenta. Intenta nuevamente.",
    );
  }
}

export async function postAlexaToken(req, res) {
  setNoStore(res);

  if (!validateOAuthClient(req)) {
    res.set("WWW-Authenticate", 'Basic realm="Moda Sarita Alexa OAuth"');

    return sendOAuthError(
      res,
      401,
      "invalid_client",
      "Client ID o Client Secret inválidos.",
    );
  }

  const grantType = String(req.body?.grant_type || "");

  try {
    if (grantType === "authorization_code") {
      const code = String(req.body?.code || "");
      const redirectUri = String(req.body?.redirect_uri || "");
      const clientId = process.env.ALEXA_OAUTH_CLIENT_ID;

      if (!code || !redirectUri) {
        return sendOAuthError(
          res,
          400,
          "invalid_request",
          "code y redirect_uri son requeridos.",
        );
      }

      if (!isAllowedAlexaRedirectUri(redirectUri)) {
        return sendOAuthError(
          res,
          400,
          "invalid_grant",
          "redirect_uri no permitida.",
        );
      }

      const { authorization, user } =
        await consumeAlexaAuthorizationCode(req.db, {
          code,
          clientId,
          redirectUri,
        });

      const refreshExpiresAt = getRefreshExpiresAt();

      const session = await createAlexaOAuthSession(req.db, {
        userId: user.usuario_id,
        clientId,
        scope: authorization.scope,
        refreshExpiresAt,
        userAgent: req.headers["user-agent"] || "Alexa Account Linking",
        ipAddress: getIp(req),
      });

      const expiresIn = getAccessExpiresSeconds();

      const accessToken = generateAccessToken({
        userId: user.usuario_id,
        correo: user.email,
        sid: session.sid,
        tfa: Boolean(user.tfa_enabled),
        expiresInSeconds: expiresIn,
      });

      return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        refresh_token: session.refreshToken,
        scope: authorization.scope,
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = String(req.body?.refresh_token || "");

      if (!refreshToken) {
        return sendOAuthError(
          res,
          400,
          "invalid_request",
          "refresh_token es requerido.",
        );
      }

      const clientId = process.env.ALEXA_OAUTH_CLIENT_ID;
      const refreshExpiresAt = getRefreshExpiresAt();

      const rotated = await rotateAlexaRefreshToken(req.db, {
        refreshToken,
        clientId,
        refreshExpiresAt,
      });

      const expiresIn = getAccessExpiresSeconds();

      const accessToken = generateAccessToken({
        userId: rotated.user.usuario_id,
        correo: rotated.user.email,
        sid: rotated.sid,
        tfa: Boolean(rotated.user.tfa_enabled),
        expiresInSeconds: expiresIn,
      });

      return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        refresh_token: rotated.refreshToken,
        scope: rotated.scope,
      });
    }

    return sendOAuthError(
      res,
      400,
      "unsupported_grant_type",
      "grant_type no soportado.",
    );
  } catch (error) {
    console.error("Error entregando token OAuth de Alexa:", error);

    const oauthCode = String(error.code || "").toUpperCase();

    if (oauthCode === "INVALID_GRANT") {
      return sendOAuthError(
        res,
        400,
        "invalid_grant",
        error.message,
      );
    }

    return sendOAuthError(
      res,
      500,
      "server_error",
      "No fue posible completar la solicitud.",
    );
  }
}
