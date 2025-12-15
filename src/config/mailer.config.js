import { Resend } from 'resend';
import 'dotenv/config';

const resend = new Resend(process.env.ModaSaritaAPI);

export const enviarCorreo = async (destinatario, asunto, html) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Moda Sarita <comunicados@moda-sarita.com>',
      to: [destinatario],
      subject: asunto,
      html: html,
    });

    if (error) {
      console.error('Error enviando correo:', error);
      return false;
    }

    console.log('Correo enviado con ID:', data.id);
    return true;
  } catch (err) {
    console.error('Error inesperado:', err);
    return false;
  }
};