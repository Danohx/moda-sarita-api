import { generate2FASecret, verify2FAToken, generate2FASecret as generateSecretLib } from "../middleware/seguridad.js";

export const setup2FA = async (req, res) => {
    const email = req.user.correo || req.user.email; 
    const { base32, otpauth_url } = generateSecretLib(email); 

    try {
        const sql = "UPDATE seguridad.usuarios SET tfa_secret = $1, tfa_enabled = FALSE WHERE email = $2";
        
        await req.db.pool(sql, [base32, email]);
        
        res.json({ otpauth_url });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ mensaje: "Error al guardar secreto en DB" });
    }
};

export const enable2FA = async (req, res) => {
    const { token } = req.body;
    const email = req.user.correo || req.user.email;

    try {
        const sql = "SELECT tfa_secret FROM seguridad.usuarios WHERE email = $1";
        const { rows } = await req.db.pool(sql, [email]);

        if (rows.length === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        const { tfa_secret } = rows[0];

        if (!tfa_secret) {
            return res.status(400).json({ mensaje: "Primero debes configurar el 2FA (Escanea el QR)." });
        }

        const verified = verify2FAToken(tfa_secret, token);

        if (verified) {
            const updateSql = "UPDATE seguridad.usuarios SET tfa_enabled = TRUE WHERE email = $1";
            await req.db.pool(updateSql, [email]);
            
            res.json({ success: true, message: "2FA habilitado correctamente." });
        } else {
            res.status(401).json({ success: false, message: "Código OTP incorrecto." });
        }

    } catch (err) {
        console.error(err);
        return res.status(500).json({ mensaje: "Error al procesar 2FA." });
    }
};

export const listRoles = async (_req, res) => {
  try {
    const { rows } = await req.db.pool(
      `select id, nombre, descripcion
       from seguridad.roles_sistema
       order by id asc`
    );
    return res.json({ ok: true, roles: rows });
  } catch (err) {
    console.error("listRoles error:", err);
    return res.status(500).json({ ok: false, mensaje: "Error al listar roles." });
  }
};

export const listPermisos = async (_req, res) => {
  try {
    const { rows } = await req.db.pool(
      `select slug, nombre_legible, descripcion
       from seguridad.catalogo_permisos
       order by slug asc`
    );
    return res.json({ ok: true, permisos: rows });
  } catch (err) {
    console.error("listPermisos error:", err);
    return res.status(500).json({ ok: false, mensaje: "Error al listar permisos." });
  }
};

export const getPermisosRol = async (req, res) => {
  const { rolId } = req.params;

  try {
    const { rows } = await req.db.pool(
      `select ppr.permiso_slug
       from seguridad.permisos_por_rol ppr
       where ppr.rol_id = $1
       order by ppr.permiso_slug asc`,
      [rolId]
    );

    return res.json({ ok: true, rolId, permisos: rows.map(r => r.permiso_slug) });
  } catch (err) {
    console.error("getPermisosRol error:", err);
    return res.status(500).json({ ok: false, mensaje: "Error al consultar permisos del rol." });
  }
};

export const setPermisosRol = async (req, res) => {
  const { rolId } = req.params;
  const { permisos } = req.body;

  if (!Array.isArray(permisos)) {
    return res.status(400).json({ ok: false, mensaje: "permisos debe ser un arreglo de slugs." });
  }

  const uniquePerms = [...new Set(permisos.map(p => String(p).trim()).filter(Boolean))];

  const client = await pool.connect();
  try {
    await client.query("begin");

    const rolRes = await client.query(
      `select id, nombre from seguridad.roles_sistema where id = $1`,
      [rolId]
    );
    if (rolRes.rows.length === 0) {
      await client.query("rollback");
      return res.status(404).json({ ok: false, mensaje: "Rol no encontrado." });
    }

    if (uniquePerms.length > 0) {
      const catRes = await client.query(
        `select slug from seguridad.catalogo_permisos where slug = any($1::varchar[])`,
        [uniquePerms]
      );
      const existentes = new Set(catRes.rows.map(r => r.slug));
      const faltantes = uniquePerms.filter(p => !existentes.has(p));

      if (faltantes.length > 0) {
        await client.query("rollback");
        return res.status(400).json({
          ok: false,
          mensaje: "Hay permisos que no existen en el catálogo.",
          faltantes,
        });
      }
    }

    await client.query(
      `delete from seguridad.permisos_por_rol where rol_id = $1`,
      [rolId]
    );

    for (const slug of uniquePerms) {
      await client.query(
        `insert into seguridad.permisos_por_rol (rol_id, permiso_slug)
         values ($1, $2)
         on conflict do nothing`,
        [rolId, slug]
      );
    }

    await client.query("commit");

    return res.json({
      ok: true,
      mensaje: "Permisos actualizados.",
      rolId,
      permisos: uniquePerms,
    });
  } catch (err) {
    await client.query("rollback");
    console.error("setPermisosRol error:", err);
    return res.status(500).json({ ok: false, mensaje: "Error al asignar permisos al rol." });
  } finally {
    client.release();
  }
};
