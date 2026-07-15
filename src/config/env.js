const required = [
  "DATABASE_URL_INTERNA",
  "DATABASE_URL_PUBLICA",
  "JWT_SECRET",
  "REFRESH_SECRET",
  "FRONTEND_URL",
  "EMAIL_USER",
  "EMAIL_PASS",
  "ADMIN_SECRET_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_FOLDER",
  "CRON_SECRET",
  // OAuth Alexa
  "ALEXA_OAUTH_CLIENT_ID",
  "ALEXA_OAUTH_CLIENT_SECRET",
  "ALEXA_OAUTH_SCOPE",
  "ALEXA_OAUTH_REDIRECT_URIS",
];

for (const k of required) {
  if (!process.env[k]) {
    throw new Error(`Falta variable de entorno: ${k}`);
  }
}
