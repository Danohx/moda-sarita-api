import { SuscripcionModel } from '#models/suscripcion.model';
import { enviarCorreo } from '#config/mailer.config';

export const suscribirUsuario = async (req, res) => {
  const { email } = req.body;

  try {
    const existe = await SuscripcionModel.findByEmail(email);
    if (existe) {
      return res.status(400).json({ 
        ok: false, 
        msg: 'Este correo ya está registrado en nuestra lista.' 
      });
    }

    await SuscripcionModel.create(email);

    const htmlBienvenida = `
      <div style="font-family: 'Manrope', Arial, sans-serif; max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 16px; overflow: hidden;">
        
        <div style="background-color: #f8f6f7; padding: 40px 30px; text-align: center;">
          <h1 style="color: #221019; margin: 0; font-size: 24px; font-weight: 600;">¡Ya eres parte de</h1>
          <h2 style="color: #ec1380; margin: 10px 0 0; font-size: 38px; font-weight: 800; letter-spacing: -1px;">Moda Sarita! 💎</h2>
        </div>

        <div style="padding: 40px 40px; background-color: #ffffff;">
          <p style="font-size: 18px; color: #221019; margin-top: 0; font-weight: 600;">¡Hola!</p>
          
          <p style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 30px;">
            Muchas gracias por unirte a nuestra <strong>Lista de Espera Exclusiva</strong>. 
            <br><br>
            Nos encanta saber que estás interesado/a en nuestro proyecto. Estamos trabajando duro para preparar la mejor colección de ropa para ti.
          </p>
          
          <div style="background-color: #fff0f7; border-left: 4px solid #ec1380; padding: 15px; margin: 30px 0;">
            <p style="margin: 0; color: #221019; font-size: 15px;">
              <strong>🔔 ¿Qué sigue?</strong><br>
              No tienes que hacer nada más. En cuanto la tienda abra sus puertas, recibirás un correo nuestro para que seas de los primeros en estrenar.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 40px;">
            <a href="https://moda-sarita.com" 
               style="background-color: #221019; 
                      color: #ffffff; 
                      padding: 16px 30px; 
                      text-decoration: none; 
                      border-radius: 12px; 
                      font-weight: 700; 
                      font-size: 16px;
                      display: inline-block;">
              Visitar el sitio web
            </a>
          </div>
        </div>

        <div style="background-color: #f8f6f7; padding: 25px; border-top: 1px solid #eee; text-align: center;">
          <p style="font-size: 12px; color: #888; margin: 0;">
            Enviado con ❤️ por el equipo de Moda Sarita.
            <br>
            Si no te suscribiste tú, por favor ignora este mensaje.
          </p>
        </div>
      </div>
    `;
    
    await enviarCorreo(email, '¡Bienvenido a la familia! 💎', htmlBienvenida);

    res.status(201).json({ 
      ok: true, 
      msg: '¡Gracias! Te hemos enviado un correo de confirmación.' 
    });

  } catch (error) {
    console.error('Error en suscripción:', error);
    res.status(500).json({ 
      ok: false, 
      msg: 'Hubo un error al procesar tu solicitud.' 
    });
  }
};