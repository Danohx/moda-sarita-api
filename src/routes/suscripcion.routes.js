import { Router } from 'express';
import { suscribirUsuario } from '../controllers/suscripcion.controller.js';

const router = Router();

// POST /api/suscripcion
router.post('/', suscribirUsuario);

export default router;