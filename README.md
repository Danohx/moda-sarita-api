
# Moda Sarita Api
> API Backend oficial para el e-commerce **Moda Sarita**.

Esta API gestiona la lógica de negocio, conexión a base de datos y notificaciones por correo para la tienda en línea. Actualmente se encuentra en la versión **v0.1.0**, enfocada en la gestión de la lista de espera (Suscripciones).

![NodeJS](https://img.shields.io/badge/Node.js-18-green) ![Express](https://img.shields.io/badge/Express-4.x-lightgrey) ![TiDB](https://img.shields.io/badge/Database-TiDB%20(MySQL)-blue) ![Resend](https://img.shields.io/badge/Email-Resend-black) ![Netlify](https://img.shields.io/badge/Deploy-Netlify-00ad9f)
## Tecnologías
* **Core:** Node.js + Express
* **Base de Datos:** TiDB (MySQL Serverless)
* **Emails:** Resend API
* **Despliegue:** Netlify Functions (vía `serverless-http`)
* **Arquitectura:** MVC (Modelo-Vista-Controlador)
## Estructura del Proyecto
El proyecto sigue una arquitectura limpia y modular para facilitar la escalabilidad.

```text
moda-sarita-api/
├── functions/       # Adaptador para Netlify (Entry Point Serverless)
│   └── api.js
├── src/
│   ├── config/      # Configuraciones (Conexión BD, Cliente Resend)
│   ├── controllers/ # Lógica de negocio (Qué hacer con los datos)
│   ├── models/      # Consultas SQL directas a TiDB
│   ├── routes/      # Definición de rutas/endpoints
│   └── app.js       # Configuración de Express y Middlewares
├── index.js         # Entrada para desarrollo local (Localhost)
├── netlify.toml     # Configuración de redirecciones para Netlify
└── package.json     # Dependencias y scripts
```
## Instalación y Uso Local
Sigue estos pasos para correr la API en tu computadora:

**1. Clonar el repositorio:**

```text
git clone [https://github.com/Danohx/moda-sarita-api.git](https://github.com/Danohx/moda-sarita-api.git)
cd moda-sarita-api
```
**2. Instalar dependencias:**
```text
npm install
```
**3. Configurar Variables de Entorno:** 
Crea un archivo .env en la raíz (no lo subas a GitHub) con el siguiente contenido:

```text
PORT=3000
# Base de Datos (TiDB)
DB_HOST=host.tidbcloud.com
DB_PORT=4000
DB_USER=User_root
DB_PASSWORD=tu_contraseña
DB_NAME=moda_sarita
# Email (Resend)
RESEND_API_KEY=re_123456789...
```

**4. Iniciar en modo desarrollo:**
```text
npm run dev
```
*El servidor iniciará en http://localhost:3000.*
## Documentación de la API
**1. Suscripción (Lista de Espera)**
Registra un nuevo usuario interesado y envía automáticamente un correo de bienvenida con diseño HTML personalizado.

- **URL**: /api/suscripcion
- **Método**: POST
- **Headers**: Content-Type: application/json
- **Body** (JSON):

```text
{
  "email": "cliente@ejemplo.com"
}
```
Respuestas Posibles:
- **🟢 201 Created**:
```text
{
  "ok": true,
  "msg": "¡Gracias! Te hemos enviado un correo de confirmación."
}
```
- **🟠 400 Bad Request**: El correo ya existe en la base de datos.
- **🔴 500 Internal Server Error**: Fallo en la base de datos o en el envío del correo.
## Despliegue en Producción (Netlify)
Este proyecto está pre-configurado para desplegarse como **Serverless Functions** en Netlify.

1. Sube tus cambios a GitHub (git push).
2. En Netlify, selecciona **"Import from Git"** y elige este repositorio.
3. **IMPORTANTE**: En la configuración del sitio en Netlify (Site Settings > Environment Variables), debes agregar manualmente las mismas variables que tienes en tu .env local:

- DB_HOST
- DB_USER
- DB_PASSWORD
- DB_NAME
- DB_PORT
- RESEND_API_KEY

¡Listo! Netlify detectará el archivo netlify.toml y desplegará la API.

**URL de Producción**: https://tu-proyecto.netlify.app/api/suscripcion
## Historial de Versiones
- **v0.1.0** - Lanzamiento inicial. Endpoint de suscripción, integración con TiDB y plantillas de correo con Resend.

Desarrollado con ❤️ para Moda Sarita.
```
moda-sarita-api
├─ index.js
├─ package-lock.json
├─ package.json
├─ README.md
├─ src
│  ├─ app.js
│  ├─ config
│  │  ├─ cloudinary.js
│  │  ├─ db.js
│  │  ├─ env.js
│  │  └─ mailer.config.js
│  ├─ controllers
│  │  ├─ auth.controller.js
│  │  ├─ categorias.controller.js
│  │  ├─ clientes.controller.js
│  │  ├─ colores.controller.js
│  │  ├─ cupones.controller.js
│  │  ├─ dashboard.controller.js
│  │  ├─ inventario.controller.js
│  │  ├─ productoDetalle.controller.js
│  │  ├─ productoImagenes.controller.js
│  │  ├─ productos.controller.js
│  │  ├─ proveedores.controller.js
│  │  ├─ security.controller.js
│  │  ├─ suscripcion.controller.js
│  │  ├─ tallas.controller.js
│  │  ├─ variantes.controller.js
│  │  └─ ventas.controller.js
│  ├─ middleware
│  │  ├─ dbContext.js
│  │  ├─ rateLimit.js
│  │  ├─ seguridad.js
│  │  └─ upload.js
│  ├─ models
│  │  ├─ categorias.model.js
│  │  ├─ clientes.model.js
│  │  ├─ colores.model.js
│  │  ├─ cupones.model.js
│  │  ├─ inventario.model.js
│  │  ├─ productoDetalle.model.js
│  │  ├─ productoImagenes.model.js
│  │  ├─ productos.model.js
│  │  ├─ proveedores.model.js
│  │  ├─ suscripcion.model.js
│  │  ├─ tallas.model.js
│  │  ├─ variantes.model.js
│  │  └─ ventas.model.js
│  └─ utils
│     └─ cloudinaryUpload.js
└─ vercel.json

```