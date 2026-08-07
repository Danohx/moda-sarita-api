WITH pedidos_validos AS (
    SELECT
        pe.id AS pedido_id,
        CASE
            WHEN pe.tipo = 'APARTADO'
                THEN COALESCE(pe.liquidado_at, pe.fecha_creacion)
            ELSE pe.fecha_creacion
        END AS fecha_venta,
        pe.subtotal,
        pe.descuento
    FROM ventas.pedidos pe
    WHERE
        (
            pe.tipo = 'PUNTO_VENTA'
            AND pe.estado = 'PAGADO'
        )
        OR (
            pe.tipo = 'WEB'
            AND pe.estado IN ('PAGADO', 'ENVIADO', 'ENTREGADO')
        )
        OR (
            pe.tipo = 'APARTADO'
            AND pe.estado = 'LIQUIDADO'
        )
),
ventas_producto_mes AS (
    SELECT
        vp.producto_id,
        date_trunc('month', pv.fecha_venta)::date AS mes,
        SUM(
            dp.importe *
            CASE
                WHEN COALESCE(pv.subtotal, 0) > 0
                    THEN GREATEST(
                        pv.subtotal - COALESCE(pv.descuento, 0),
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
    WHERE pv.fecha_venta IS NOT NULL
    GROUP BY
        vp.producto_id,
        date_trunc('month', pv.fecha_venta)::date
),
limites AS (
    SELECT
        MIN(mes) AS primer_mes_global,
        LEAST(
            MAX(mes),
            date_trunc(
                'month',
                CURRENT_DATE - interval '1 month'
            )::date
        ) AS ultimo_mes_global
    FROM ventas_producto_mes
),
productos_observados AS (
    SELECT
        p.id AS producto_id,
        p.nombre AS producto_nombre,
        COALESCE(c.nombre, 'Sin categoría') AS categoria_nombre,
        MIN(vpm.mes) AS primer_mes_venta
    FROM inventario.productos p
    JOIN ventas_producto_mes vpm
        ON vpm.producto_id = p.id
    LEFT JOIN inventario.categorias c
        ON c.id = p.categoria_id
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
        COALESCE(vpm.monto_mes, 0)::numeric(14,2) AS monto_mes
    FROM productos_observados po
    CROSS JOIN limites l
    CROSS JOIN LATERAL generate_series(
        po.primer_mes_venta::timestamp,
        l.ultimo_mes_global::timestamp,
        interval '1 month'
    ) gs
    LEFT JOIN ventas_producto_mes vpm
        ON vpm.producto_id = po.producto_id
       AND vpm.mes = gs::date
),
cortes AS (
    SELECT
        r.producto_id,
        r.producto_nombre,
        r.categoria_nombre,
        r.primer_mes_venta,
        r.mes AS fecha_corte,
        r.monto_mes AS monto_mes_actual
    FROM rejilla r
    CROSS JOIN limites l
    WHERE r.mes < l.ultimo_mes_global
),
dataset AS (
    SELECT
        c.producto_id,
        c.producto_nombre,
        c.categoria_nombre,
        c.fecha_corte,

        EXTRACT(MONTH FROM c.fecha_corte)::int AS mes_del_anio,

        EXTRACT(
            MONTH FROM (c.fecha_corte + interval '1 month')
        )::int AS mes_objetivo,

        ROUND(
            SIN(
                2 * PI()
                * EXTRACT(
                    MONTH FROM (c.fecha_corte + interval '1 month')
                )::numeric
                / 12
            )::numeric,
            6
        ) AS mes_sin,

        ROUND(
            COS(
                2 * PI()
                * EXTRACT(
                    MONTH FROM (c.fecha_corte + interval '1 month')
                )::numeric
                / 12
            )::numeric,
            6
        ) AS mes_cos,

        (
            EXTRACT(
                YEAR FROM age(c.fecha_corte, c.primer_mes_venta)
            )::int * 12
            + EXTRACT(
                MONTH FROM age(c.fecha_corte, c.primer_mes_venta)
            )::int
        ) AS antiguedad_producto_meses,

        (
            EXTRACT(
                YEAR FROM age(c.fecha_corte, c.primer_mes_venta)
            )::int * 12
            + EXTRACT(
                MONTH FROM age(c.fecha_corte, c.primer_mes_venta)
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
            / NULLIF(hist.meses_observados_calculados, 0),
            6
        ) AS porcentaje_meses_con_venta,

        CASE
            WHEN hist.ultimo_mes_con_venta IS NULL THEN NULL
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

        COALESCE(lag1.monto_mes, 0)::numeric(14,2)
            AS monto_mes_anterior,

        COALESCE(lag2.monto_mes, 0)::numeric(14,2)
            AS monto_hace_2_meses,

        COALESCE(lag3.monto_mes, 0)::numeric(14,2)
            AS monto_hace_3_meses,

        COALESCE(lag6.monto_mes, 0)::numeric(14,2)
            AS monto_hace_6_meses,

        ultimos3.promedio_monto_ultimos_3_meses,
        ultimos6.promedio_monto_ultimos_6_meses,

        ultimos3.desviacion_monto_ultimos_3_meses,
        ultimos6.desviacion_monto_ultimos_6_meses,

        ROUND(
            (
                c.monto_mes_actual
                - COALESCE(lag1.monto_mes, 0)
            )::numeric,
            2
        )::numeric(14,2)
            AS diferencia_mes_actual_anterior,

        ROUND(
            CASE
                WHEN COALESCE(lag1.monto_mes, 0) > 0
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
            COALESCE(tendencia3.pendiente, 0)::numeric,
            2
        )::numeric(14,2)
            AS tendencia_3_meses,

        ROUND(
            COALESCE(tendencia6.pendiente, 0)::numeric,
            2
        )::numeric(14,2)
            AS tendencia_6_meses,

        COALESCE(
            mismo_mes_anio_anterior.monto_mes,
            0
        )::numeric(14,2)
            AS monto_mismo_mes_anio_anterior,

        CASE
            WHEN mismo_mes_anio_anterior.producto_id IS NULL
                THEN 0
            ELSE 1
        END AS tiene_historial_anio_anterior,

        COALESCE(objetivo.monto_mes, 0)::numeric(14,2)
            AS monto_ventas_mes_siguiente

    FROM cortes c

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
           c.fecha_corte - interval '1 month'
       )::date

    LEFT JOIN rejilla lag2
        ON lag2.producto_id = c.producto_id
       AND lag2.mes = (
           c.fecha_corte - interval '2 months'
       )::date

    LEFT JOIN rejilla lag3
        ON lag3.producto_id = c.producto_id
       AND lag3.mes = (
           c.fecha_corte - interval '3 months'
       )::date

    LEFT JOIN rejilla lag6
        ON lag6.producto_id = c.producto_id
       AND lag6.mes = (
           c.fecha_corte - interval '6 months'
       )::date

    LEFT JOIN rejilla mismo_mes_anio_anterior
        ON mismo_mes_anio_anterior.producto_id = c.producto_id
       AND mismo_mes_anio_anterior.mes = (
           c.fecha_corte - interval '11 months'
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
    ) tendencia6

    LEFT JOIN rejilla objetivo
        ON objetivo.producto_id = c.producto_id
       AND objetivo.mes = (
           c.fecha_corte + interval '1 month'
       )::date
)
SELECT
    producto_id,
    producto_nombre,
    categoria_nombre,
    to_char(
        fecha_corte,
        'YYYY-MM-DD'
    ) AS fecha_corte,

    mes_del_anio,
    mes_objetivo,
    mes_sin,
    mes_cos,

    antiguedad_producto_meses,
    meses_observados,

    monto_total_historico,
    promedio_mensual_historico,
    mediana_mensual_historica,
    desviacion_mensual_historica,

    meses_con_venta,
    porcentaje_meses_con_venta,
    meses_desde_ultima_venta,

    monto_mes_actual,
    monto_mes_anterior,
    monto_hace_2_meses,
    monto_hace_3_meses,
    monto_hace_6_meses,

    promedio_monto_ultimos_3_meses,
    promedio_monto_ultimos_6_meses,

    desviacion_monto_ultimos_3_meses,
    desviacion_monto_ultimos_6_meses,

    diferencia_mes_actual_anterior,
    variacion_porcentual_mes_actual,
    variacion_porcentual_promedio_3m,

    tendencia_3_meses,
    tendencia_6_meses,

    monto_mismo_mes_anio_anterior,
    tiene_historial_anio_anterior,

    monto_ventas_mes_siguiente

FROM dataset
ORDER BY
    fecha_corte,
    producto_nombre,
    producto_id;
