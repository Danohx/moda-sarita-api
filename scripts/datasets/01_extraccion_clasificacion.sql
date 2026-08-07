/*
  Dataset de clasificacion de credito habilitado - V2.

  Cambios:
    - La observacion comienza en la fecha mas antigua entre
      fecha_registro y primera compra valida.
    - meses_observados es inclusivo.
    - Sigue sin utilizar informacion de credito como predictor.
*/
WITH
parametros AS (
  SELECT
    $1::timestamptz AS fecha_evaluacion,
    $2::uuid[] AS client_ids
),
clientes_base AS (
  SELECT
    c.id AS cliente_id,
    c.fecha_registro,
    c.tiene_credito AS credito_habilitado,
    p.fecha_evaluacion
  FROM clientes.clientes c
  CROSS JOIN parametros p
  WHERE c.id = ANY(p.client_ids)
    AND c.fecha_registro < p.fecha_evaluacion
),
pedidos_validos AS (
  SELECT
    pe.id AS pedido_id,
    pe.cliente_id,
    CASE
      WHEN pe.tipo = 'APARTADO'::public.tipo_pedido
        THEN COALESCE(pe.liquidado_at, pe.fecha_creacion)
      ELSE pe.fecha_creacion
    END AS fecha_compra,
    GREATEST(
      pe.subtotal - COALESCE(pe.descuento, 0),
      0
    )::numeric(14,2) AS gasto_mercancia
  FROM ventas.pedidos pe
  JOIN clientes_base cb
    ON cb.cliente_id = pe.cliente_id
  WHERE
    (
      (
        pe.tipo = 'PUNTO_VENTA'::public.tipo_pedido
        AND pe.estado = 'PAGADO'::public.estado_pedido
      )
      OR
      (
        pe.tipo = 'WEB'::public.tipo_pedido
        AND pe.estado IN (
          'PAGADO'::public.estado_pedido,
          'ENVIADO'::public.estado_pedido,
          'ENTREGADO'::public.estado_pedido
        )
      )
      OR
      (
        pe.tipo = 'APARTADO'::public.tipo_pedido
        AND pe.estado = 'LIQUIDADO'::public.estado_pedido
      )
    )
    AND (
      CASE
        WHEN pe.tipo = 'APARTADO'::public.tipo_pedido
          THEN COALESCE(pe.liquidado_at, pe.fecha_creacion)
        ELSE pe.fecha_creacion
      END
    ) < cb.fecha_evaluacion
),
primera_compra AS (
  SELECT
    cliente_id,
    MIN(fecha_compra) AS primera_compra
  FROM pedidos_validos
  GROUP BY cliente_id
),
clientes_objetivo AS (
  SELECT
    cb.cliente_id,
    cb.credito_habilitado,
    cb.fecha_evaluacion,
    LEAST(
      cb.fecha_registro::date,
      COALESCE(
        pc.primera_compra::date,
        cb.fecha_registro::date
      )
    ) AS fecha_inicio_observacion
  FROM clientes_base cb
  LEFT JOIN primera_compra pc
    ON pc.cliente_id = cb.cliente_id
),
clientes_metricas AS (
  SELECT
    co.*,
    GREATEST(
      0,
      (
        co.fecha_evaluacion::date
        - co.fecha_inicio_observacion
      )
    )::integer AS antiguedad_cliente_dias,
    GREATEST(
      1,
      (
        EXTRACT(
          YEAR FROM age(
            date_trunc(
              'month',
              co.fecha_evaluacion
            ),
            date_trunc(
              'month',
              co.fecha_inicio_observacion
            )
          )
        )::integer * 12
        +
        EXTRACT(
          MONTH FROM age(
            date_trunc(
              'month',
              co.fecha_evaluacion
            ),
            date_trunc(
              'month',
              co.fecha_inicio_observacion
            )
          )
        )::integer
        + 1
      )
    )::integer AS meses_observados
  FROM clientes_objetivo co
),
pedidos_con_anterior AS (
  SELECT
    pv.*,
    LAG(pv.fecha_compra) OVER (
      PARTITION BY pv.cliente_id
      ORDER BY pv.fecha_compra, pv.pedido_id
    ) AS fecha_compra_anterior
  FROM pedidos_validos pv
),
intervalos_compra AS (
  SELECT
    cliente_id,
    AVG(
      EXTRACT(
        EPOCH FROM (
          fecha_compra - fecha_compra_anterior
        )
      ) / 86400.0
    ) FILTER (
      WHERE fecha_compra_anterior IS NOT NULL
    ) AS promedio_dias_entre_compras
  FROM pedidos_con_anterior
  GROUP BY cliente_id
),
resumen_pedidos AS (
  SELECT
    cliente_id,
    COUNT(*)::integer AS total_compras_historicas,
    COALESCE(
      SUM(gasto_mercancia),
      0
    )::numeric(14,2) AS gasto_total_historico,
    COALESCE(
      AVG(gasto_mercancia),
      0
    )::numeric(14,2) AS ticket_promedio_historico,
    COUNT(
      DISTINCT date_trunc(
        'month',
        fecha_compra
      )
    )::integer AS meses_con_compra_historicos,
    MAX(fecha_compra) AS ultima_compra
  FROM pedidos_validos
  GROUP BY cliente_id
),
resumen_detalles AS (
  SELECT
    pv.cliente_id,
    COALESCE(
      SUM(dp.cantidad),
      0
    )::integer AS unidades_compradas_historicas,
    COUNT(
      DISTINCT vp.producto_id
    )::integer AS productos_distintos_historicos,
    COUNT(
      DISTINCT pr.categoria_id
    ) FILTER (
      WHERE pr.categoria_id IS NOT NULL
    )::integer AS categorias_distintas_historicas
  FROM pedidos_validos pv
  JOIN ventas.detalles_pedido dp
    ON dp.pedido_id = pv.pedido_id
  JOIN inventario.variantes_producto vp
    ON vp.id = dp.variante_id
  JOIN inventario.productos pr
    ON pr.id = vp.producto_id
  GROUP BY pv.cliente_id
),
actividad_mensual AS (
  SELECT
    cliente_id,
    date_trunc(
      'month',
      fecha_compra
    )::date AS mes,
    COUNT(*)::integer AS compras_mes,
    SUM(
      gasto_mercancia
    )::numeric(14,2) AS gasto_mes
  FROM pedidos_validos
  GROUP BY
    cliente_id,
    date_trunc(
      'month',
      fecha_compra
    )::date
),
concentracion AS (
  SELECT
    cliente_id,
    CASE
      WHEN SUM(compras_mes) > 0
        THEN MAX(compras_mes)::numeric
          / SUM(compras_mes)::numeric
      ELSE 0
    END AS concentracion_compras_mes_mayor,
    CASE
      WHEN SUM(gasto_mes) > 0
        THEN MAX(gasto_mes)::numeric
          / SUM(gasto_mes)::numeric
      ELSE 0
    END AS concentracion_gasto_mes_mayor
  FROM actividad_mensual
  GROUP BY cliente_id
)
SELECT
  cm.cliente_id,
  cm.fecha_evaluacion::date AS fecha_evaluacion,

  cm.antiguedad_cliente_dias,
  cm.meses_observados,

  COALESCE(
    rp.total_compras_historicas,
    0
  )::integer AS total_compras_historicas,

  COALESCE(
    rp.gasto_total_historico,
    0
  )::numeric(14,2) AS gasto_total_historico,

  COALESCE(
    rp.ticket_promedio_historico,
    0
  )::numeric(14,2) AS ticket_promedio_historico,

  ROUND(
    COALESCE(
      rp.total_compras_historicas,
      0
    )::numeric
    / NULLIF(cm.meses_observados, 0),
    4
  ) AS frecuencia_mensual_historica,

  ROUND(
    COALESCE(
      rp.gasto_total_historico,
      0
    )::numeric
    / NULLIF(cm.meses_observados, 0),
    2
  ) AS gasto_promedio_mensual_historico,

  COALESCE(
    rp.meses_con_compra_historicos,
    0
  )::integer AS meses_con_compra_historicos,

  ROUND(
    LEAST(
      1::numeric,
      COALESCE(
        rp.meses_con_compra_historicos,
        0
      )::numeric
      / NULLIF(cm.meses_observados, 0)
    ),
    4
  ) AS porcentaje_meses_activos,

  COALESCE(
    (
      cm.fecha_evaluacion::date
      - rp.ultima_compra::date
    ),
    cm.antiguedad_cliente_dias
  )::integer AS dias_desde_ultima_compra,

  ROUND(
    COALESCE(
      ic.promedio_dias_entre_compras,
      cm.antiguedad_cliente_dias::numeric
    ),
    2
  ) AS promedio_dias_entre_compras,

  COALESCE(
    rd.unidades_compradas_historicas,
    0
  )::integer AS unidades_compradas_historicas,

  COALESCE(
    rd.productos_distintos_historicos,
    0
  )::integer AS productos_distintos_historicos,

  COALESCE(
    rd.categorias_distintas_historicas,
    0
  )::integer AS categorias_distintas_historicas,

  ROUND(
    COALESCE(
      cn.concentracion_compras_mes_mayor,
      0
    ),
    4
  ) AS concentracion_compras_mes_mayor,

  ROUND(
    COALESCE(
      cn.concentracion_gasto_mes_mayor,
      0
    ),
    4
  ) AS concentracion_gasto_mes_mayor,

  cm.credito_habilitado

FROM clientes_metricas cm
LEFT JOIN resumen_pedidos rp
  ON rp.cliente_id = cm.cliente_id
LEFT JOIN intervalos_compra ic
  ON ic.cliente_id = cm.cliente_id
LEFT JOIN resumen_detalles rd
  ON rd.cliente_id = cm.cliente_id
LEFT JOIN concentracion cn
  ON cn.cliente_id = cm.cliente_id
ORDER BY cm.cliente_id;
