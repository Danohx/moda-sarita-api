\set ON_ERROR_STOP on

\echo '1. Tabla de ejecuciones de vencimientos'
SELECT to_regclass('clientes.credito_ejecuciones_vencimiento') AS tabla;

\echo '2. Última ejecución de vencimientos'
SELECT id, origen, fecha_objetivo, iniciado_at, finalizado_at, exitoso, resultado, error_message
FROM clientes.credito_ejecuciones_vencimiento
ORDER BY iniciado_at DESC, id DESC
LIMIT 5;

\echo '3. No debe haber pagos confirmados con CREDITO_TIENDA'
SELECT id, pedido_id, monto, metodo, concepto, estado, fecha_pago
FROM ventas.pagos
WHERE metodo = 'CREDITO_TIENDA'
  AND estado = 'CONFIRMADO';

\echo '4. Pagos de crédito sin aplicación o movimiento conciliador'
SELECT *
FROM clientes.v_pagos_credito_sin_aplicar;

\echo '5. Diferencias entre saldo global y créditos'
SELECT *
FROM clientes.v_conciliacion_saldos_credito
WHERE conciliado = false;

\echo '6. Resumen actual de cartera'
SELECT
  estado,
  count(*) AS creditos,
  sum(monto_financiado)::numeric(14,2) AS financiado,
  sum(saldo_pendiente)::numeric(14,2) AS saldo
FROM clientes.creditos
GROUP BY estado
ORDER BY estado;

\echo '7. Cuotas vencidas y créditos legacy'
SELECT
  count(*) FILTER (WHERE cc.estado = 'VENCIDA') AS cuotas_vencidas,
  count(DISTINCT c.id) FILTER (WHERE c.datos_calendario_completos = false) AS creditos_legacy,
  count(cc.id) FILTER (
    WHERE c.datos_calendario_completos = false
  ) AS cuotas_en_legacy_debe_ser_cero
FROM clientes.creditos c
LEFT JOIN clientes.credito_cuotas cc ON cc.credito_id = c.id;

\echo '8. Separación ventas / cobros / financiamiento del mes actual'
WITH rango AS (
  SELECT date_trunc('month', CURRENT_DATE)::date AS desde,
         CURRENT_DATE AS hasta
)
SELECT
  (
    SELECT COALESCE(sum(p.total), 0)
    FROM ventas.pedidos p, rango r
    WHERE p.tipo <> 'APARTADO'
      AND p.estado IN ('PAGADO', 'ENVIADO', 'ENTREGADO', 'LIQUIDADO')
      AND p.fecha_creacion >= r.desde
      AND p.fecha_creacion < r.hasta + interval '1 day'
  )::numeric(14,2) AS ventas_realizadas,
  (
    SELECT COALESCE(sum(pg.monto), 0)
    FROM ventas.pagos pg, rango r
    WHERE pg.estado = 'CONFIRMADO'
      AND pg.fecha_pago >= r.desde
      AND pg.fecha_pago < r.hasta + interval '1 day'
  )::numeric(14,2) AS dinero_cobrado,
  (
    SELECT COALESCE(sum(c.monto_financiado), 0)
    FROM clientes.creditos c, rango r
    WHERE c.estado <> 'CANCELADO'
      AND c.fecha_otorgamiento >= r.desde
      AND c.fecha_otorgamiento < r.hasta + interval '1 day'
  )::numeric(14,2) AS monto_financiado;
