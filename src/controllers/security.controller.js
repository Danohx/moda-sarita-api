import { pool } from "../config/db.js";
import { generate2FASecret, verify2FAToken, generate2FASecret as generateSecretLib } from "../middleware/seguridad.js";

export const setup2FA = async (req, res) => {
    const email = req.user.correo || req.user.email; 
    const { base32, otpauth_url } = generateSecretLib(email); 

    try {
        const sql = "UPDATE seguridad.usuarios SET tfa_secret = $1, tfa_enabled = FALSE WHERE email = $2";
        
        await pool.query(sql, [base32, email]);
        
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
        const { rows } = await pool.query(sql, [email]);

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
            await pool.query(updateSql, [email]);
            
            res.json({ success: true, message: "2FA habilitado correctamente." });
        } else {
            res.status(401).json({ success: false, message: "Código OTP incorrecto." });
        }

    } catch (err) {
        console.error(err);
        return res.status(500).json({ mensaje: "Error al procesar 2FA." });
    }
};