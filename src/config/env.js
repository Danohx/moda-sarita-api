const required = [
  "DATABASE_URL",
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
