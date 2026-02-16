const required = [
  "DATABASE_URL_INTERNA",
  "DATABASE_URL_PUBLICA",
  "JWT_SECRET",
  "REFRESH_SECRET",
  "FRONTEND_URL",
  "EMAIL_USER",
  "EMAIL_PASS",
  "ADMIN_SECRET_KEY",
];

for (const k of required) {
  if (!process.env[k]) {
    throw new Error(`Falta variable de entorno: ${k}`);
  }
}
