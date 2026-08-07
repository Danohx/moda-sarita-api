\set ON_ERROR_STOP on

\echo '============================================================'
\echo 'VALIDACIÓN DE DATOS ANALÍTICOS LOCALES'
\echo '============================================================'

\echo ''
\echo '1. Distribución de credito_habilitado en clientes con correo de prueba'
SELECT
    c.tiene_credito AS credito_habilitado,
    COUNT(*) AS clientes,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS porcentaje
FROM clientes.clientes c
WHERE split_part(lower(c.email), '@', 2) IN (
    'gmail.test', 'outlook.test', 'hotmail.test', 'yahoo.test', 'correo.test'
)
GROUP BY c.tiene_credito
ORDER BY c.tiene_credito;

\echo ''
\echo '2. Comportamiento comercial promedio por clase'
WITH clientes_prueba AS (
    SELECT c.id, c.tiene_credito
    FROM clientes.clientes c
    WHERE split_part(lower(c.email), '@', 2) IN (
        'gmail.test', 'outlook.test', 'hotmail.test', 'yahoo.test', 'correo.test'
    )
), resumen AS (
    SELECT
        p.cliente_id,
        COUNT(*) AS compras,
        SUM(p.subtotal - p.descuento) AS gasto_total,
        COUNT(DISTINCT DATE_TRUNC('month', p.fecha_creacion)) AS meses_activos,
        MAX(p.fecha_creacion)::date AS ultima_compra
    FROM ventas.pedidos p
    JOIN clientes_prueba cp ON cp.id = p.cliente_id
    WHERE p.estado IN ('PAGADO', 'ENVIADO', 'ENTREGADO', 'LIQUIDADO')
    GROUP BY p.cliente_id
)
SELECT
    cp.tiene_credito AS credito_habilitado,
    COUNT(*) AS clientes,
    ROUND(AVG(COALESCE(r.compras, 0)), 2) AS promedio_compras,
    ROUND(AVG(COALESCE(r.gasto_total, 0)), 2) AS promedio_gasto,
    ROUND(AVG(COALESCE(r.meses_activos, 0)), 2) AS promedio_meses_activos,
    ROUND(AVG(CURRENT_DATE - r.ultima_compra), 2) AS promedio_dias_desde_ultima_compra
FROM clientes_prueba cp
LEFT JOIN resumen r ON r.cliente_id = cp.id
GROUP BY cp.tiene_credito
ORDER BY cp.tiene_credito;

\echo ''
\echo '3. Cobertura temporal y de productos para regresión'
WITH pedidos_prueba AS (
    SELECT p.id, p.fecha_creacion
    FROM ventas.pedidos p
    JOIN clientes.clientes c ON c.id = p.cliente_id
    WHERE split_part(lower(c.email), '@', 2) IN (
        'gmail.test', 'outlook.test', 'hotmail.test', 'yahoo.test', 'correo.test'
    )
      AND p.estado IN ('PAGADO', 'ENVIADO', 'ENTREGADO', 'LIQUIDADO')
)
SELECT
    MIN(pp.fecha_creacion)::date AS primera_venta,
    MAX(pp.fecha_creacion)::date AS ultima_venta,
    COUNT(DISTINCT DATE_TRUNC('month', pp.fecha_creacion)) AS meses,
    COUNT(DISTINCT vp.producto_id) AS productos
FROM pedidos_prueba pp
JOIN ventas.detalles_pedido dp ON dp.pedido_id = pp.id
JOIN inventario.variantes_producto vp ON vp.id = dp.variante_id;

\echo ''
\echo '4. Integridad de pedidos de clientes de prueba'
WITH pedidos_prueba AS (
    SELECT p.*
    FROM ventas.pedidos p
    JOIN clientes.clientes c ON c.id = p.cliente_id
    WHERE split_part(lower(c.email), '@', 2) IN (
        'gmail.test', 'outlook.test', 'hotmail.test', 'yahoo.test', 'correo.test'
    )
)
SELECT
    COUNT(*) FILTER (
        WHERE NOT EXISTS (
            SELECT 1 FROM ventas.detalles_pedido dp WHERE dp.pedido_id = p.id
        )
    ) AS pedidos_sin_detalle,
    COUNT(*) FILTER (
        WHERE NOT EXISTS (
            SELECT 1
            FROM ventas.pagos pg
            WHERE pg.pedido_id = p.id AND pg.estado = 'CONFIRMADO'
        )
    ) AS pedidos_sin_pago,
    COUNT(*) FILTER (
        WHERE p.total <> ROUND(p.subtotal - COALESCE(p.descuento, 0) + COALESCE(p.costo_envio, 0), 2)
    ) AS pedidos_total_inconsistente
FROM pedidos_prueba p;
