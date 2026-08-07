const SQL_CREDITO = `
WITH
parametros AS (
  SELECT
    CURRENT_TIMESTAMP AS fecha_evaluacion
),
clientes_base AS (
  SELECT
    c.id AS cliente_id,
    c.nombres,
    c.apellido_paterno,
    c.apellido_materno,
    c.fecha_registro,
    c.tiene_credito,
    p.fecha_evaluacion
  FROM clientes.clientes c
  CROSS JOIN parametros p
  WHERE c.id = $1::uuid
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
    cb.nombres,
    cb.apellido_paterno,
    cb.apellido_materno,
    cb.tiene_credito,
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
  CONCAT_WS(
    ' ',
    cm.nombres,
    cm.apellido_paterno,
    cm.apellido_materno
  ) AS cliente_nombre,
  cm.tiene_credito,
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
  ) AS concentracion_gasto_mes_mayor

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
`;

const SQL_VENTAS = `
WITH
parametros AS (
  SELECT
    $1::uuid AS producto_id,
    date_trunc(
      'month',
      CURRENT_DATE - interval '1 month'
    )::date AS fecha_corte
),
pedidos_validos AS (
  SELECT
    pe.id AS pedido_id,
    CASE
      WHEN pe.tipo = 'APARTADO'
        THEN COALESCE(
          pe.liquidado_at,
          pe.fecha_creacion
        )
      ELSE pe.fecha_creacion
    END AS fecha_venta,
    pe.subtotal,
    pe.descuento
  FROM ventas.pedidos pe
  WHERE
    (
      (pe.tipo = 'PUNTO_VENTA' AND pe.estado = 'PAGADO')
      OR
      (
        pe.tipo = 'WEB'
        AND pe.estado IN (
          'PAGADO',
          'ENVIADO',
          'ENTREGADO'
        )
      )
      OR
      (
        pe.tipo = 'APARTADO'
        AND pe.estado = 'LIQUIDADO'
      )
    )
    AND (
      CASE
        WHEN pe.tipo = 'APARTADO'
          THEN COALESCE(
            pe.liquidado_at,
            pe.fecha_creacion
          )
        ELSE pe.fecha_creacion
      END
    ) < date_trunc('month', CURRENT_DATE)
),
ventas_producto_mes AS (
  SELECT
    vp.producto_id,
    date_trunc(
      'month',
      pv.fecha_venta
    )::date AS mes,

    SUM(
      dp.importe
      *
      CASE
        WHEN COALESCE(
          pv.subtotal,
          0
        ) > 0
          THEN GREATEST(
            pv.subtotal
            - COALESCE(
              pv.descuento,
              0
            ),
            0
          ) / pv.subtotal
        ELSE 1
      END
    )::numeric(14,2) AS monto_mes

  FROM pedidos_validos pv
  JOIN ventas.detalles_pedido dp
    ON dp.pedido_id = pv.pedido_id
  JOIN inventario.variantes_producto vp
    ON vp.id = dp.variante_id
  GROUP BY
    vp.producto_id,
    date_trunc(
      'month',
      pv.fecha_venta
    )::date
),
producto_objetivo AS (
  SELECT
    p.id AS producto_id,
    p.nombre AS producto_nombre,
    COALESCE(
      c.nombre,
      'Sin categoría'
    ) AS categoria_nombre,
    MIN(vpm.mes) AS primer_mes_venta
  FROM inventario.productos p
  CROSS JOIN parametros par
  LEFT JOIN inventario.categorias c
    ON c.id = p.categoria_id
  LEFT JOIN ventas_producto_mes vpm
    ON vpm.producto_id = p.id
  WHERE p.id = par.producto_id
  GROUP BY
    p.id,
    p.nombre,
    c.nombre
),
rejilla AS (
  SELECT
    po.producto_id,
    po.producto_nombre,
    po.categoria_nombre,
    po.primer_mes_venta,
    gs::date AS mes,
    COALESCE(
      vpm.monto_mes,
      0
    )::numeric(14,2) AS monto_mes
  FROM producto_objetivo po
  CROSS JOIN parametros par
  CROSS JOIN LATERAL generate_series(
    po.primer_mes_venta::timestamp,
    par.fecha_corte::timestamp,
    interval '1 month'
  ) gs
  LEFT JOIN ventas_producto_mes vpm
    ON vpm.producto_id = po.producto_id
   AND vpm.mes = gs::date
),
corte AS (
  SELECT
    po.producto_id,
    po.producto_nombre,
    po.categoria_nombre,
    po.primer_mes_venta,
    par.fecha_corte,
    COALESCE(
      r.monto_mes,
      0
    )::numeric(14,2) AS monto_mes_actual
  FROM producto_objetivo po
  CROSS JOIN parametros par
  LEFT JOIN rejilla r
    ON r.producto_id = po.producto_id
   AND r.mes = par.fecha_corte
  WHERE po.primer_mes_venta IS NOT NULL
)
SELECT
  c.producto_id,
  c.producto_nombre,
  c.categoria_nombre,
  c.fecha_corte,

  (
    c.fecha_corte
    + interval '1 month'
  )::date AS mes_objetivo_fecha,

  EXTRACT(
    MONTH FROM c.fecha_corte
  )::int AS mes_del_anio,

  EXTRACT(
    MONTH FROM (
      c.fecha_corte
      + interval '1 month'
    )
  )::int AS mes_objetivo,

  ROUND(
    SIN(
      2 * PI()
      * EXTRACT(
        MONTH FROM (
          c.fecha_corte
          + interval '1 month'
        )
      )::numeric
      / 12
    )::numeric,
    6
  ) AS mes_sin,

  ROUND(
    COS(
      2 * PI()
      * EXTRACT(
        MONTH FROM (
          c.fecha_corte
          + interval '1 month'
        )
      )::numeric
      / 12
    )::numeric,
    6
  ) AS mes_cos,

  (
    EXTRACT(
      YEAR FROM age(
        c.fecha_corte,
        c.primer_mes_venta
      )
    )::int * 12
    + EXTRACT(
      MONTH FROM age(
        c.fecha_corte,
        c.primer_mes_venta
      )
    )::int
  ) AS antiguedad_producto_meses,

  (
    EXTRACT(
      YEAR FROM age(
        c.fecha_corte,
        c.primer_mes_venta
      )
    )::int * 12
    + EXTRACT(
      MONTH FROM age(
        c.fecha_corte,
        c.primer_mes_venta
      )
    )::int
    + 1
  ) AS meses_observados,

  hist.monto_total_historico,
  hist.promedio_mensual_historico,
  hist.mediana_mensual_historica,
  hist.desviacion_mensual_historica,
  hist.meses_con_venta,

  ROUND(
    hist.meses_con_venta::numeric
    / NULLIF(
      hist.meses_observados_calculados,
      0
    ),
    6
  ) AS porcentaje_meses_con_venta,

  CASE
    WHEN hist.ultimo_mes_con_venta IS NULL
      THEN NULL
    ELSE (
      EXTRACT(
        YEAR FROM age(
          c.fecha_corte,
          hist.ultimo_mes_con_venta
        )
      )::int * 12
      + EXTRACT(
        MONTH FROM age(
          c.fecha_corte,
          hist.ultimo_mes_con_venta
        )
      )::int
    )
  END AS meses_desde_ultima_venta,

  c.monto_mes_actual,

  COALESCE(
    lag1.monto_mes,
    0
  )::numeric(14,2) AS monto_mes_anterior,

  COALESCE(
    lag2.monto_mes,
    0
  )::numeric(14,2) AS monto_hace_2_meses,

  COALESCE(
    lag3.monto_mes,
    0
  )::numeric(14,2) AS monto_hace_3_meses,

  COALESCE(
    lag6.monto_mes,
    0
  )::numeric(14,2) AS monto_hace_6_meses,

  ultimos3.promedio_monto_ultimos_3_meses,
  ultimos6.promedio_monto_ultimos_6_meses,

  ultimos3.desviacion_monto_ultimos_3_meses,
  ultimos6.desviacion_monto_ultimos_6_meses,

  ROUND(
    (
      c.monto_mes_actual
      - COALESCE(
        lag1.monto_mes,
        0
      )
    )::numeric,
    2
  )::numeric(14,2)
    AS diferencia_mes_actual_anterior,

  ROUND(
    CASE
      WHEN COALESCE(
        lag1.monto_mes,
        0
      ) > 0
        THEN (
          (
            c.monto_mes_actual
            - lag1.monto_mes
          )
          / lag1.monto_mes
        )::numeric
      ELSE 0
    END,
    6
  ) AS variacion_porcentual_mes_actual,

  ROUND(
    CASE
      WHEN COALESCE(
        ultimos3.promedio_monto_ultimos_3_meses,
        0
      ) > 0
        THEN (
          (
            c.monto_mes_actual
            - ultimos3.promedio_monto_ultimos_3_meses
          )
          / ultimos3.promedio_monto_ultimos_3_meses
        )::numeric
      ELSE 0
    END,
    6
  ) AS variacion_porcentual_promedio_3m,

  ROUND(
    COALESCE(
      tendencia3.pendiente,
      0
    )::numeric,
    2
  )::numeric(14,2) AS tendencia_3_meses,

  ROUND(
    COALESCE(
      tendencia6.pendiente,
      0
    )::numeric,
    2
  )::numeric(14,2) AS tendencia_6_meses,

  COALESCE(
    mismo_mes_anio_anterior.monto_mes,
    0
  )::numeric(14,2)
    AS monto_mismo_mes_anio_anterior,

  CASE
    WHEN mismo_mes_anio_anterior.producto_id IS NULL
      THEN 0
    ELSE 1
  END AS tiene_historial_anio_anterior

FROM corte c

CROSS JOIN LATERAL (
  SELECT
    ROUND(
      SUM(r.monto_mes),
      2
    )::numeric(14,2)
      AS monto_total_historico,

    ROUND(
      AVG(r.monto_mes),
      2
    )::numeric(14,2)
      AS promedio_mensual_historico,

    ROUND(
      percentile_cont(0.5)
      WITHIN GROUP (
        ORDER BY r.monto_mes
      )::numeric,
      2
    )::numeric(14,2)
      AS mediana_mensual_historica,

    ROUND(
      COALESCE(
        stddev_pop(r.monto_mes),
        0
      ),
      2
    )::numeric(14,2)
      AS desviacion_mensual_historica,

    COUNT(*) FILTER (
      WHERE r.monto_mes > 0
    )::int AS meses_con_venta,

    COUNT(*)::int
      AS meses_observados_calculados,

    MAX(r.mes) FILTER (
      WHERE r.monto_mes > 0
    ) AS ultimo_mes_con_venta

  FROM rejilla r
  WHERE r.producto_id = c.producto_id
    AND r.mes <= c.fecha_corte
) hist

CROSS JOIN LATERAL (
  SELECT
    ROUND(
      AVG(r.monto_mes),
      2
    )::numeric(14,2)
      AS promedio_monto_ultimos_3_meses,

    ROUND(
      COALESCE(
        stddev_pop(r.monto_mes),
        0
      ),
      2
    )::numeric(14,2)
      AS desviacion_monto_ultimos_3_meses

  FROM rejilla r
  WHERE r.producto_id = c.producto_id
    AND r.mes BETWEEN
      (
        c.fecha_corte
        - interval '2 months'
      )::date
      AND c.fecha_corte
) ultimos3

CROSS JOIN LATERAL (
  SELECT
    ROUND(
      AVG(r.monto_mes),
      2
    )::numeric(14,2)
      AS promedio_monto_ultimos_6_meses,

    ROUND(
      COALESCE(
        stddev_pop(r.monto_mes),
        0
      ),
      2
    )::numeric(14,2)
      AS desviacion_monto_ultimos_6_meses

  FROM rejilla r
  WHERE r.producto_id = c.producto_id
    AND r.mes BETWEEN
      (
        c.fecha_corte
        - interval '5 months'
      )::date
      AND c.fecha_corte
) ultimos6

LEFT JOIN rejilla lag1
  ON lag1.producto_id = c.producto_id
 AND lag1.mes = (
   c.fecha_corte
   - interval '1 month'
 )::date

LEFT JOIN rejilla lag2
  ON lag2.producto_id = c.producto_id
 AND lag2.mes = (
   c.fecha_corte
   - interval '2 months'
 )::date

LEFT JOIN rejilla lag3
  ON lag3.producto_id = c.producto_id
 AND lag3.mes = (
   c.fecha_corte
   - interval '3 months'
 )::date

LEFT JOIN rejilla lag6
  ON lag6.producto_id = c.producto_id
 AND lag6.mes = (
   c.fecha_corte
   - interval '6 months'
 )::date

LEFT JOIN rejilla mismo_mes_anio_anterior
  ON mismo_mes_anio_anterior.producto_id = c.producto_id
 AND mismo_mes_anio_anterior.mes = (
   c.fecha_corte
   - interval '11 months'
 )::date

CROSS JOIN LATERAL (
  SELECT
    regr_slope(
      s.monto_mes,
      s.indice_mes
    ) AS pendiente
  FROM (
    SELECT
      r.monto_mes::double precision
        AS monto_mes,
      row_number() OVER (
        ORDER BY r.mes
      )::double precision
        AS indice_mes
    FROM rejilla r
    WHERE r.producto_id = c.producto_id
      AND r.mes BETWEEN
        (
          c.fecha_corte
          - interval '2 months'
        )::date
        AND c.fecha_corte
  ) s
) tendencia3

CROSS JOIN LATERAL (
  SELECT
    regr_slope(
      s.monto_mes,
      s.indice_mes
    ) AS pendiente
  FROM (
    SELECT
      r.monto_mes::double precision
        AS monto_mes,
      row_number() OVER (
        ORDER BY r.mes
      )::double precision
        AS indice_mes
    FROM rejilla r
    WHERE r.producto_id = c.producto_id
      AND r.mes BETWEEN
        (
          c.fecha_corte
          - interval '5 months'
        )::date
        AND c.fecha_corte
  ) s
) tendencia6;
`;

export async function obtenerFeaturesCredito(
  db,
  clienteId,
) {
  const { rows } = await db.query(
    SQL_CREDITO,
    [clienteId],
  );

  return rows[0] ?? null;
}

export async function obtenerFeaturesVentas(
  db,
  productoId,
) {
  const { rows } = await db.query(
    SQL_VENTAS,
    [productoId],
  );

  return rows[0] ?? null;
}
