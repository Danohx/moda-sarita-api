import app from './src/app.js';
import { SuscripcionModel } from '#models/suscripcion.model';
import 'dotenv/config';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // 1. Primero aseguramos la Base de Datos
    await SuscripcionModel.init();
    console.log('✅ Base de Datos conectada y lista');

    // 2. Ahora sí, giramos la llave
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });

  } catch (error) {
    console.error('❌ Error fatal al iniciar el servidor:', error);
  }
};

startServer();