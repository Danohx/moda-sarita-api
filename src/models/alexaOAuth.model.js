// src/models/alexaOAuth.model.js

import crypto from "crypto";

const AUTHORIZATION_CODE_TTL_MINUTES = 5;

function createOAuthError(message, code = "INVALID_GRANT") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeIp(value) {
  if (!value) return null;

  return String(value)
    .replace(/^::ffff:/, "")
    .replace("::1", "127.0.0.1");
}

export function hashOAuthToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
}

export function generateOpaqueToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function getAllowedAlexaRedirectUris() {
  return String(process.env.ALEXA_OAUTH_REDIRECT_URIS || "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
}

export function isAllowedAlexaRedirectUri(uri) {
  if (!uri) return false;

  return getAllowedAlexaRedirectUris().includes(String(uri).trim());
}

// ============================================================
// USUARIO QUE VINCULARÁ SU CUENTA
// ============================================================

export async function findAlexaClientByEmail(db, email) {
  const normalizedEmail = normalizeEmail(email);

  const { rows } = await db.query(
    `
      SELECT
        u.id AS usuario_id,
        u.email,
        u.password_hash,
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno,
        u.activo AS usuario_activo,
        u.tfa_enabled,

        r.nombre AS rol,

        c.id AS cliente_id,
        c.activo AS cliente_activo,
        c.tiene_credito,
        c.limite_credito,
        c.saldo_deudor

      FROM seguridad.usuarios u

      INNER JOIN seguridad.roles_sistema r
        ON r.id = u.rol_id

      INNER JOIN clientes.clientes c
        ON c.usuario_id = u.id

      WHERE lower(u.email) = $1
        AND u.activo = true
        AND c.activo = true
        AND upper(r.nombre) IN ('CLIENTE_WEB', 'CLIENTE')

      LIMIT 1
    `,
    [normalizedEmail],
  );

  return rows[0] || null;
}

export async function getAlexaClientByUserId(db, userId) {
  const { rows } = await db.query(
    `
      SELECT
        u.id AS usuario_id,
        u.email,
        u.nombres,
        u.apellido_paterno,
        u.apellido_materno,
        u.activo AS usuario_activo,
        u.tfa_enabled,

        r.nombre AS rol,

        c.id AS cliente_id,
        c.activo AS cliente_activo,
        c.tiene_credito,
        c.limite_credito,
        c.saldo_deudor

      FROM seguridad.usuarios u

      INNER JOIN seguridad.roles_sistema r
        ON r.id = u.rol_id

      INNER JOIN clientes.clientes c
        ON c.usuario_id = u.id

      WHERE u.id = $1::uuid
        AND u.activo = true
        AND c.activo = true
        AND upper(r.nombre) IN ('CLIENTE_WEB', 'CLIENTE')

      LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

// ============================================================
// AUTHORIZATION CODE
// ============================================================

export async function createAlexaAuthorizationCode(
  db,
  {
    userId,
    clientId,
    redirectUri,
    scope,
  },
) {
  const rawCode = generateOpaqueToken(32);
  const codeHash = hashOAuthToken(rawCode);

  const expiresAt = new Date(
    Date.now() +
      AUTHORIZATION_CODE_TTL_MINUTES * 60 * 1000,
  );

  await db.query(
    `
      DELETE FROM seguridad.oauth_authorization_codes
      WHERE expires_at <= now()
         OR used_at IS NOT NULL
    `,
  );

  await db.query(
    `
      INSERT INTO seguridad.oauth_authorization_codes (
        code_hash,
        usuario_id,
        client_id,
        redirect_uri,
        scope,
        expires_at
      )
      VALUES (
        $1,
        $2::uuid,
        $3,
        $4,
        $5,
        $6
      )
    `,
    [
      codeHash,
      userId,
      clientId,
      redirectUri,
      scope,
      expiresAt,
    ],
  );

  return {
    code: rawCode,
    expiresAt,
  };
}

export async function consumeAlexaAuthorizationCode(
  db,
  {
    code,
    clientId,
    redirectUri,
  },
) {
  const codeHash = hashOAuthToken(code);

  const { rows } = await db.query(
    `
      UPDATE seguridad.oauth_authorization_codes
      SET used_at = now()

      WHERE code_hash = $1
        AND client_id = $2
        AND redirect_uri = $3
        AND used_at IS NULL
        AND expires_at > now()

      RETURNING
        usuario_id,
        client_id,
        redirect_uri,
        scope,
        expires_at
    `,
    [codeHash, clientId, redirectUri],
  );

  const authorization = rows[0];

  if (!authorization) {
    throw createOAuthError(
      "El código de autorización es inválido, expiró o ya fue utilizado.",
      "INVALID_GRANT",
    );
  }

  const user = await getAlexaClientByUserId(
    db,
    authorization.usuario_id,
  );

  if (!user) {
    throw createOAuthError(
      "La cuenta vinculada ya no está disponible.",
      "INVALID_GRANT",
    );
  }

  return {
    authorization,
    user,
  };
}

// ============================================================
// REFRESH TOKEN + SESIÓN RECONOCIDA POR requireAuth
// ============================================================

export async function createAlexaOAuthSession(
  db,
  {
    userId,
    clientId,
    scope,
    refreshExpiresAt,
    userAgent = "Alexa Account Linking",
    ipAddress = null,
  },
) {
  const client = await db.connect();

  const rawRefreshToken = generateOpaqueToken(48);
  const refreshTokenHash = hashOAuthToken(rawRefreshToken);
  const sid = crypto.randomUUID();

  try {
    await client.query("BEGIN");

    /*
     * Al volver a vincular la cuenta, revocamos vínculos anteriores
     * de este mismo cliente OAuth.
     */
    await client.query(
      `
        UPDATE seguridad.user_sessions us
        SET revoked_at = now()

        WHERE us.user_id = $1::uuid
          AND us.revoked_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM seguridad.oauth_refresh_tokens ort

            WHERE ort.usuario_id = $1::uuid
              AND ort.client_id = $2
              AND ort.token_hash = us.refresh_token_hash
              AND ort.revoked_at IS NULL
          )
      `,
      [userId, clientId],
    );

    await client.query(
      `
        UPDATE seguridad.oauth_refresh_tokens
        SET revoked_at = now()

        WHERE usuario_id = $1::uuid
          AND client_id = $2
          AND revoked_at IS NULL
      `,
      [userId, clientId],
    );

    /*
     * Esta sesión hace que el access token de Alexa sea compatible
     * con el requireAuth actual.
     */
    await client.query(
      `
        INSERT INTO seguridad.user_sessions (
          id,
          user_id,
          refresh_token_hash,
          user_agent,
          ip_address,
          expires_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5::inet,
          $6
        )
      `,
      [
        sid,
        userId,
        refreshTokenHash,
        userAgent,
        normalizeIp(ipAddress),
        refreshExpiresAt,
      ],
    );

    await client.query(
      `
        INSERT INTO seguridad.oauth_refresh_tokens (
          token_hash,
          usuario_id,
          client_id,
          scope,
          expires_at
        )
        VALUES (
          $1,
          $2::uuid,
          $3,
          $4,
          $5
        )
      `,
      [
        refreshTokenHash,
        userId,
        clientId,
        scope,
        refreshExpiresAt,
      ],
    );

    await client.query("COMMIT");

    return {
      sid,
      refreshToken: rawRefreshToken,
      refreshExpiresAt,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================
// ROTACIÓN DEL REFRESH TOKEN
// ============================================================

export async function rotateAlexaRefreshToken(
  db,
  {
    refreshToken,
    clientId,
    refreshExpiresAt,
  },
) {
  const client = await db.connect();

  const oldTokenHash = hashOAuthToken(refreshToken);
  const newRawRefreshToken = generateOpaqueToken(48);
  const newTokenHash = hashOAuthToken(newRawRefreshToken);

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
        SELECT
          ort.id,
          ort.usuario_id,
          ort.client_id,
          ort.scope,
          ort.expires_at,
          us.id AS sid

        FROM seguridad.oauth_refresh_tokens ort

        INNER JOIN seguridad.user_sessions us
          ON us.user_id = ort.usuario_id
         AND us.refresh_token_hash = ort.token_hash

        WHERE ort.token_hash = $1
          AND ort.client_id = $2
          AND ort.revoked_at IS NULL
          AND ort.expires_at > now()
          AND us.revoked_at IS NULL
          AND us.expires_at > now()

        FOR UPDATE OF ort, us
      `,
      [oldTokenHash, clientId],
    );

    const storedToken = rows[0];

    if (!storedToken) {
      throw createOAuthError(
        "El refresh token es inválido, expiró o fue revocado.",
        "INVALID_GRANT",
      );
    }

    const user = await getAlexaClientByUserId(
      client,
      storedToken.usuario_id,
    );

    if (!user) {
      throw createOAuthError(
        "La cuenta vinculada ya no está disponible.",
        "INVALID_GRANT",
      );
    }

    await client.query(
      `
        UPDATE seguridad.oauth_refresh_tokens
        SET
          last_used_at = now(),
          revoked_at = now()

        WHERE id = $1::uuid
      `,
      [storedToken.id],
    );

    await client.query(
      `
        INSERT INTO seguridad.oauth_refresh_tokens (
          token_hash,
          usuario_id,
          client_id,
          scope,
          expires_at
        )
        VALUES (
          $1,
          $2::uuid,
          $3,
          $4,
          $5
        )
      `,
      [
        newTokenHash,
        storedToken.usuario_id,
        storedToken.client_id,
        storedToken.scope,
        refreshExpiresAt,
      ],
    );

    await client.query(
      `
        UPDATE seguridad.user_sessions
        SET
          refresh_token_hash = $1,
          expires_at = $2

        WHERE id = $3::uuid
          AND user_id = $4::uuid
          AND revoked_at IS NULL
      `,
      [
        newTokenHash,
        refreshExpiresAt,
        storedToken.sid,
        storedToken.usuario_id,
      ],
    );

    await client.query("COMMIT");

    return {
      sid: storedToken.sid,
      user,
      scope: storedToken.scope,
      refreshToken: newRawRefreshToken,
      refreshExpiresAt,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================
// LIMPIEZA OPCIONAL
// ============================================================

export async function cleanupExpiredAlexaOAuthData(db) {
  const result = await db.query(
    `
      WITH deleted_codes AS (
        DELETE FROM seguridad.oauth_authorization_codes
        WHERE expires_at <= now()
           OR used_at IS NOT NULL
        RETURNING id
      ),
      revoked_sessions AS (
        UPDATE seguridad.user_sessions us
        SET revoked_at = COALESCE(us.revoked_at, now())

        WHERE EXISTS (
          SELECT 1
          FROM seguridad.oauth_refresh_tokens ort

          WHERE ort.token_hash = us.refresh_token_hash
            AND (
              ort.expires_at <= now()
              OR ort.revoked_at IS NOT NULL
            )
        )

        RETURNING us.id
      ),
      deleted_refresh AS (
        DELETE FROM seguridad.oauth_refresh_tokens
        WHERE expires_at <= now()
           OR (
             revoked_at IS NOT NULL
             AND revoked_at < now() - interval '7 days'
           )
        RETURNING id
      )

      SELECT
        (SELECT count(*) FROM deleted_codes)::integer
          AS authorization_codes_deleted,

        (SELECT count(*) FROM revoked_sessions)::integer
          AS sessions_revoked,

        (SELECT count(*) FROM deleted_refresh)::integer
          AS refresh_tokens_deleted
    `,
  );

  return result.rows[0];
}