import app from "./src/app.js";
import "dotenv/config";
import "./src/config/env.js";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Error fatal al iniciar el servidor:", error);
    process.exit(1);
  }
};

startServer();