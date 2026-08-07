import { Router } from "express";

import {
  useInternalDb,
} from "../middleware/dbContext.js";

import {
  requireAuth,
  requireRole,
} from "../middleware/seguridad.js";

import {
  getAnaliticaHealth,
  postEvaluarCreditoCliente,
  postPredecirVentasProducto,
} from "../controllers/analitica.controller.js";

const router = Router();

function requireAnyPermission(
  ...permissions
) {
  return (req, res, next) => {
    const available =
      new Set(
        req.user?.permisos || [],
      );

    if (
      permissions.some(
        (permission) =>
          available.has(permission),
      )
    ) {
      return next();
    }

    return res.status(403).json({
      ok: false,
      message:
        "No autorizado (permiso)",
      requiredAny: permissions,
      rol: req.user?.rol || null,
    });
  };
}

router.use(
  useInternalDb,
  requireAuth,
  requireRole(
    "ADMIN",
    "EMPLEADO",
  ),
);

router.get(
  "/health",
  requireAnyPermission(
    "clientes.clientes.credito.manage",
    "credito.view",
    "reportes.productos.view",
    "inventario.productos.read",
  ),
  getAnaliticaHealth,
);

router.post(
  "/clientes/:clienteId/credito",
  requireAnyPermission(
    "clientes.clientes.credito.manage",
    "credito.view",
  ),
  postEvaluarCreditoCliente,
);

router.post(
  "/productos/:productoId/ventas",
  requireAnyPermission(
    "reportes.productos.view",
    "inventario.productos.read",
  ),
  postPredecirVentasProducto,
);

export default router;
