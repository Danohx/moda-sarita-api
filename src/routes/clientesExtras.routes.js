// src/routes/clientesExtras.routes.js
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { useInternalDb } from '../middleware/dbContext.js';
import { requireAuth, requirePermission } from '../middleware/seguridad.js';
import {
  getHistorialComercialCliente,
  patchDireccionCliente,
  patchEstadoCliente,
} from '../controllers/clientesExtras.controller.js';

const router = Router();

function validar(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      ok: false,
      msg: 'Datos inválidos',
      errores: errors.array(),
    });
  }
  next();
}

router.use(useInternalDb, requireAuth);

router.get(
  '/:id/historial-comercial',
  requirePermission('clientes.clientes.read'),
  param('id').isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validar,
  getHistorialComercialCliente,
);

router.patch(
  '/:id/estado',
  requirePermission('clientes.clientes.status.manage'),
  param('id').isUUID(),
  body('activo').isBoolean(),
  validar,
  patchEstadoCliente,
);

router.patch(
  '/:id/direcciones/:direccionId',
  requirePermission('clientes.direcciones.update'),
  param('id').isUUID(),
  param('direccionId').isUUID(),
  body('calle').optional().isString().trim().notEmpty().isLength({ max: 200 }),
  body('numero_exterior').optional({ nullable: true }).isString().isLength({ max: 20 }),
  body('numero_interior').optional({ nullable: true }).isString().isLength({ max: 20 }),
  body('colonia').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('ciudad').optional().isString().trim().notEmpty().isLength({ max: 100 }),
  body('estado').optional().isString().trim().notEmpty().isLength({ max: 100 }),
  body('codigo_postal').optional().isString().trim().notEmpty().isLength({ max: 10 }),
  body('referencias').optional({ nullable: true }).isString(),
  body('es_principal').optional().isBoolean(),
  validar,
  patchDireccionCliente,
);

export default router;
