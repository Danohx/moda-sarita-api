const ESTADOS_VENTA_VALIDOS = ["PAGADO", "ENVIADO", "ENTREGADO"];
const MODELO_NOMBRE = "Modelo Predictivo de Demanda Estacional Exponencial";

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function toNumber(value, defaultValue = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function round(value, decimals = 4) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)))
    return null;
  return Number(Number(value).toFixed(decimals));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function assertValidMonthDay(temporada) {
  const required = ["mes_inicio", "dia_inicio", "mes_fin", "dia_fin"];
  return required.every((key) => Number.isInteger(Number(temporada?.[key])));
}

function seasonCrossesYear(temporada) {
  const mi = Number(temporada.mes_inicio);
  const di = Number(temporada.dia_inicio);
  const mf = Number(temporada.mes_fin);
  const df = Number(temporada.dia_fin);

  return mf < mi || (mf === mi && df < di);
}

function buildDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function buildPeriodoFromTemporada(temporada, anio) {
  const startYear = anio;
  const endYear = seasonCrossesYear(temporada) ? anio + 1 : anio;

  return {
    anio,
    fecha_inicio: buildDate(
      startYear,
      Number(temporada.mes_inicio),
      Number(temporada.dia_inicio),
    ),
    fecha_fin: buildDate(
      endYear,
      Number(temporada.mes_fin),
      Number(temporada.dia_fin),
    ),
  };
}

function resolveDefaultTargetYear(temporada) {
  if (!assertValidMonthDay(temporada)) return new Date().getFullYear();

  const today = todayISO();
  const currentYear = new Date().getFullYear();
  const previousPeriod = buildPeriodoFromTemporada(temporada, currentYear - 1);
  const currentPeriod = buildPeriodoFromTemporada(temporada, currentYear);

  if (
    today >= previousPeriod.fecha_inicio &&
    today <= previousPeriod.fecha_fin
  ) {
    return previousPeriod.anio;
  }

  if (today <= currentPeriod.fecha_fin) {
    return currentYear;
  }

  return currentYear + 1;
}

function getPeriodoStatus(periodo) {
  const today = todayISO();
  if (today < periodo.fecha_inicio) return "FUTURA";
  if (today > periodo.fecha_fin) return "FINALIZADA";
  return "EN_CURSO";
}

function normalizeMargin(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function buildError(message, code = "VALIDATION") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function interpretarK(k) {
  if (Math.abs(k) < 0.0001) return "ESTABLE";
  return k > 0 ? "CRECIMIENTO" : "DECRECIMIENTO";
}

async function getTemporadaById(db, temporadaId) {
  const { rows } = await db.query(
    `
    SELECT id, nombre, descripcion, activo, mes_inicio, dia_inicio, mes_fin, dia_fin
    FROM inventario.temporadas
    WHERE id = $1
      AND activo = TRUE
    LIMIT 1
    `,
    [temporadaId],
  );

  return rows[0] || null;
}

async function getTemporadaDefaultByProducto(db, productoId) {
  const { rows } = await db.query(
    `
    SELECT t.id, t.nombre, t.descripcion, t.activo, t.mes_inicio, t.dia_inicio, t.mes_fin, t.dia_fin
    FROM inventario.producto_temporadas pt
    INNER JOIN inventario.temporadas t ON t.id = pt.temporada_id
    WHERE pt.producto_id = $1
      AND t.activo = TRUE
    ORDER BY t.id ASC
    LIMIT 1
    `,
    [productoId],
  );

  return rows[0] || null;
}

async function getProductoDimension(db, { productoId, varianteId = null }) {
  if (varianteId) {
    const { rows } = await db.query(
      `
      SELECT
        p.id AS producto_id,
        p.nombre AS producto_nombre,
        p.categoria_id,
        c.nombre AS categoria_nombre,
        v.id AS variante_id,
        v.sku,
        v.talla_id,
        t.nombre AS talla_nombre,
        v.color_id,
        col.nombre AS color_nombre,
        v.stock_fisico,
        v.stock_apartado,
        GREATEST(v.stock_fisico - v.stock_apartado, 0) AS stock_disponible,
        v.stock_minimo
      FROM inventario.productos p
      INNER JOIN inventario.variantes_producto v ON v.producto_id = p.id
      LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
      LEFT JOIN inventario.tallas t ON t.id = v.talla_id
      LEFT JOIN inventario.colores col ON col.id = v.color_id
      WHERE p.id = $1
        AND v.id = $2
      LIMIT 1
      `,
      [productoId, varianteId],
    );

    return rows[0] || null;
  }

  const { rows } = await db.query(
    `
    SELECT
      p.id AS producto_id,
      p.nombre AS producto_nombre,
      p.categoria_id,
      c.nombre AS categoria_nombre,
      NULL::uuid AS variante_id,
      NULL::text AS sku,
      NULL::integer AS talla_id,
      NULL::text AS talla_nombre,
      NULL::integer AS color_id,
      NULL::text AS color_nombre,
      COALESCE(SUM(v.stock_fisico), 0)::int AS stock_fisico,
      COALESCE(SUM(v.stock_apartado), 0)::int AS stock_apartado,
      COALESCE(SUM(GREATEST(v.stock_fisico - v.stock_apartado, 0)), 0)::int AS stock_disponible,
      COALESCE(MIN(v.stock_minimo), 0)::int AS stock_minimo
    FROM inventario.productos p
    LEFT JOIN inventario.categorias c ON c.id = p.categoria_id
    LEFT JOIN inventario.variantes_producto v ON v.producto_id = p.id AND v.activo = TRUE
    WHERE p.id = $1
    GROUP BY p.id, p.nombre, p.categoria_id, c.nombre
    LIMIT 1
    `,
    [productoId],
  );

  return rows[0] || null;
}

async function getPeriodosConfigurados(
  db,
  { temporadaId, targetYear, fromYear = null },
) {
  const { rows } = await db.query(
    `
    SELECT anio, fecha_inicio, fecha_fin
    FROM inventario.temporada_periodos
    WHERE temporada_id = $1
      AND activo = TRUE
      AND anio < $2
      AND ($3::int IS NULL OR anio >= $3)
    ORDER BY anio ASC
    `,
    [temporadaId, targetYear, fromYear],
  );

  return rows.map((row) => ({
    anio: Number(row.anio),
    fecha_inicio: dateOnly(row.fecha_inicio),
    fecha_fin: dateOnly(row.fecha_fin),
  }));
}

function getPeriodosGenerados({
  temporada,
  targetYear,
  fromYear = null,
  historyYears = 5,
}) {
  if (!assertValidMonthDay(temporada)) {
    return [];
  }

  const startYear = fromYear ?? targetYear - historyYears;
  const periodos = [];

  for (let year = startYear; year < targetYear; year += 1) {
    periodos.push(buildPeriodoFromTemporada(temporada, year));
  }

  return periodos;
}

async function getPeriodosHistoricos(
  db,
  { temporada, targetYear, fromYear = null, historyYears = 5 },
) {
  
  const LOOKBACK_YEARS = 20;
  const startYear = fromYear ?? targetYear - LOOKBACK_YEARS;

  const configured = await getPeriodosConfigurados(db, {
    temporadaId: temporada.id,
    targetYear,
    fromYear: startYear,
  });

  const configuredMap = new Map(
    configured.map((periodo) => [Number(periodo.anio), periodo]),
  );

  let periodosBase = [];

  if (assertValidMonthDay(temporada)) {
    const generated = getPeriodosGenerados({
      temporada,
      targetYear,
      fromYear: startYear,
      historyYears: LOOKBACK_YEARS,
    });

    periodosBase = generated.map((periodo) => {
      return configuredMap.get(Number(periodo.anio)) ?? periodo;
    });
  } else {
    periodosBase = configured;
  }

  const periodosHistoricosFinalizados = periodosBase.filter((periodo) => {
    return (
      Number(periodo.anio) < Number(targetYear) &&
      getPeriodoStatus(periodo) === "FINALIZADA"
    );
  });

  const periodos = fromYear
    ? periodosHistoricosFinalizados
    : periodosHistoricosFinalizados.slice(-historyYears);

  return {
    periodos,
    fuente:
      configured.length > 0
        ? "temporada_periodos+temporadas.mes_dia"
        : "temporadas.mes_dia",
  };
}

async function getPeriodoObjetivo(db, { temporada, targetYear }) {
  if (!temporada || !temporada.id) return null;

  const year = Number(targetYear);

  if (!Number.isInteger(year)) return null;

  const { rows } = await db.query(
    `
    SELECT anio, fecha_inicio, fecha_fin
    FROM inventario.temporada_periodos
    WHERE temporada_id = $1
      AND activo = TRUE
      AND anio = $2
    LIMIT 1
    `,
    [temporada.id, year],
  );

  if (rows.length > 0) {
    return {
      anio: Number(rows[0].anio),
      fecha_inicio: dateOnly(rows[0].fecha_inicio),
      fecha_fin: dateOnly(rows[0].fecha_fin),
      fuente: "temporada_periodos",
    };
  }

  if (!assertValidMonthDay(temporada)) {
    return null;
  }

  return {
    ...buildPeriodoFromTemporada(temporada, year),
    fuente: "temporadas.mes_dia",
  };
}

async function getVentasPorPeriodos(
  db,
  { periodos, productoId, varianteId = null },
) {
  if (!periodos.length) return [];

  const params = [productoId, varianteId, ESTADOS_VENTA_VALIDOS];
  const valuesSql = periodos
    .map((periodo) => {
      params.push(periodo.anio, periodo.fecha_inicio, periodo.fecha_fin);
      const base = params.length - 2;
      return `($${base}::int, $${base + 1}::date, $${base + 2}::date)`;
    })
    .join(",\n      ");

  const { rows } = await db.query(
    `
    WITH periodos(anio, fecha_inicio, fecha_fin) AS (
      VALUES
      ${valuesSql}
    )
    SELECT
      per.anio,
      per.fecha_inicio,
      per.fecha_fin,
      COALESCE(v.ventas, 0)::int AS ventas
    FROM periodos per
    LEFT JOIN LATERAL (
      SELECT SUM(dp.cantidad)::int AS ventas
      FROM ventas.pedidos p
      INNER JOIN ventas.detalles_pedido dp ON dp.pedido_id = p.id
      INNER JOIN inventario.variantes_producto vp ON vp.id = dp.variante_id
      WHERE p.fecha_creacion::date BETWEEN per.fecha_inicio AND per.fecha_fin
        AND p.estado::text = ANY($3::text[])
        AND vp.producto_id = $1::uuid
        AND ($2::uuid IS NULL OR vp.id = $2::uuid)
    ) v ON TRUE
    ORDER BY per.anio ASC
    `,
    params,
  );

  return rows.map((row) => ({
    anio: Number(row.anio),
    fecha_inicio: dateOnly(row.fecha_inicio),
    fecha_fin: dateOnly(row.fecha_fin),
    ventas: Number(row.ventas || 0),
  }));
}

function calcularModeloExponencial({ historial, targetYear }) {
  const historialCalculable = historial.filter(
    (item) => Number(item.ventas) > 0,
  );

  if (historialCalculable.length < 2) {
    return {
      ok: false,
      message:
        "Se necesitan al menos dos temporadas históricas con ventas mayores a cero para aplicar el modelo exponencial.",
    };
  }

  const first = historialCalculable[0];
  const last = historialCalculable[historialCalculable.length - 1];
  const V0 = Number(first.ventas);
  const Vf = Number(last.ventas);
  const t = Number(last.anio - first.anio);
  const targetT = Number(targetYear - first.anio);

  if (V0 <= 0 || Vf <= 0 || t <= 0 || targetT <= 0) {
    return {
      ok: false,
      message:
        "Los datos históricos no permiten calcular una tasa k válida para el modelo exponencial.",
    };
  }

  const k = Math.log(Vf / V0) / t;
  const demandaEstimada = V0 * Math.exp(k * targetT);

  return {
    ok: true,
    first,
    last,
    V0,
    Vf,
    t,
    targetT,
    k,
    demandaEstimada,
  };
}

function buildProyeccionesIntermedias({ temporada, targetYear, calculo }) {
  if (!assertValidMonthDay(temporada)) return [];

  const proyecciones = [];

  for (let year = calculo.last.anio + 1; year < targetYear; year += 1) {
    const periodo = buildPeriodoFromTemporada(temporada, year);
    const tRelativo = year - calculo.first.anio;
    const demanda = calculo.V0 * Math.exp(calculo.k * tRelativo);

    proyecciones.push({
      anio: year,
      fecha_inicio: periodo.fecha_inicio,
      fecha_fin: periodo.fecha_fin,
      t_relativo: tRelativo,
      demanda_estimada: round(demanda, 4),
      demanda_estimada_redondeada: Math.ceil(demanda),
      tipo: "INTERMEDIA",
    });
  }

  return proyecciones;
}

export async function getPredictionByProducto(
  db,
  {
    productoId,
    varianteId = null,
    temporadaId = null,
    targetYear = null,
    fromYear = null,
    historyYears = 5,
    safetyMargin = 0,
  } = {},
) {
  if (!db) {
    throw buildError("DB context no configurado (req.db)", "CONFIG");
  }

  if (!isUuid(productoId)) {
    throw buildError("productoId inválido");
  }

  const safeVarianteId = varianteId ? String(varianteId) : null;
  if (safeVarianteId && !isUuid(safeVarianteId)) {
    throw buildError("variante_id inválido");
  }

  const dimension = await getProductoDimension(db, {
    productoId,
    varianteId: safeVarianteId,
  });
  if (!dimension) {
    throw buildError(
      safeVarianteId
        ? "Producto o variante no encontrada, o la variante no pertenece al producto indicado."
        : "Producto no encontrado.",
      "NOT_FOUND",
    );
  }

  const safeTemporadaId = toIntOrNull(temporadaId);
  let temporada = null;
  let modoTemporada = "DIRIGIDA";

  if (safeTemporadaId) {
    temporada = await getTemporadaById(db, safeTemporadaId);
  } else {
    temporada = await getTemporadaDefaultByProducto(db, productoId);
    modoTemporada = "AUTOMATICA_ETIQUETA_PRODUCTO";
  }

  if (!temporada) {
    throw buildError(
      "No se encontró una temporada activa. Envía temporada_id para una predicción dirigida o asigna una temporada al producto para usarla como valor por defecto.",
    );
  }

  const safeTargetYear =
    toIntOrNull(targetYear) ?? resolveDefaultTargetYear(temporada);
  const safeFromYear = toIntOrNull(fromYear);
  const safeHistoryYears = Math.min(
    Math.max(toIntOrNull(historyYears) ?? 5, 2),
    20,
  );
  const safeSafetyMargin = normalizeMargin(safetyMargin);

  const periodoObjetivo = await getPeriodoObjetivo(db, {
    temporada,
    targetYear: safeTargetYear,
  });

  if (!periodoObjetivo) {
    throw buildError(
      "La temporada no tiene fechas configuradas. Agrega mes_inicio, dia_inicio, mes_fin y dia_fin, o registra sus periodos en inventario.temporada_periodos.",
    );
  }

  const { periodos, fuente } = await getPeriodosHistoricos(db, {
    temporada,
    targetYear: safeTargetYear,
    fromYear: safeFromYear,
    historyYears: safeHistoryYears,
  });

  if (periodos.length < 2) {
    return {
      producto: {
        id: dimension.producto_id,
        nombre: dimension.producto_nombre,
        categoria_id: dimension.categoria_id,
        categoria_nombre: dimension.categoria_nombre,
      },
      variante: safeVarianteId
        ? {
            id: dimension.variante_id,
            sku: dimension.sku,
            talla_id: dimension.talla_id,
            talla_nombre: dimension.talla_nombre,
            color_id: dimension.color_id,
            color_nombre: dimension.color_nombre,
          }
        : null,
      temporada: {
        id: temporada.id,
        nombre: temporada.nombre,
        modo: modoTemporada,
      },
      parametros: {
        anio_objetivo: safeTargetYear,
        from_year: safeFromYear,
        history_years: safeHistoryYears,
        fuente_periodos: fuente,
        margen_seguridad: safeSafetyMargin,
      },
      historial: [],
      proyecciones_intermedias: [],
      modelo: null,
      prediccion: null,
      inventario: null,
      message:
        "No hay suficientes periodos históricos para calcular la predicción.",
    };
  }

  const historial = await getVentasPorPeriodos(db, {
    periodos,
    productoId,
    varianteId: safeVarianteId,
  });

  const calculo = calcularModeloExponencial({
    historial,
    targetYear: safeTargetYear,
  });

  if (!calculo.ok) {
    return {
      producto: {
        id: dimension.producto_id,
        nombre: dimension.producto_nombre,
        categoria_id: dimension.categoria_id,
        categoria_nombre: dimension.categoria_nombre,
      },
      variante: safeVarianteId
        ? {
            id: dimension.variante_id,
            sku: dimension.sku,
            talla_id: dimension.talla_id,
            talla_nombre: dimension.talla_nombre,
            color_id: dimension.color_id,
            color_nombre: dimension.color_nombre,
          }
        : null,
      temporada: {
        id: temporada.id,
        nombre: temporada.nombre,
        modo: modoTemporada,
      },
      parametros: {
        anio_objetivo: safeTargetYear,
        from_year: safeFromYear,
        history_years: safeHistoryYears,
        fuente_periodos: fuente,
        margen_seguridad: safeSafetyMargin,
      },
      historial,
      proyecciones_intermedias: [],
      modelo: null,
      prediccion: null,
      inventario: null,
      message: calculo.message,
    };
  }

  const proyeccionesIntermedias = buildProyeccionesIntermedias({
    temporada,
    targetYear: safeTargetYear,
    calculo,
  });

  const [targetSales] = await getVentasPorPeriodos(db, {
    periodos: [periodoObjetivo],
    productoId,
    varianteId: safeVarianteId,
  });

  const estadoTemporada = getPeriodoStatus(periodoObjetivo);
  const demandaEstimada = round(calculo.demandaEstimada, 4);
  const demandaEstimadaRedondeada = Math.ceil(calculo.demandaEstimada);
  const ventasRealesObjetivo = Number(targetSales?.ventas || 0);

  const demandaRestanteEstimada =
    estadoTemporada === "FINALIZADA"
      ? 0
      : Math.max(demandaEstimadaRedondeada - ventasRealesObjetivo, 0);

  const errorAbsoluto =
    estadoTemporada === "FINALIZADA"
      ? Math.abs(ventasRealesObjetivo - demandaEstimadaRedondeada)
      : null;

  const errorPorcentual =
    estadoTemporada === "FINALIZADA" && demandaEstimadaRedondeada > 0
      ? round((errorAbsoluto / demandaEstimadaRedondeada) * 100, 2)
      : null;

  const stockFisico = Number(dimension.stock_fisico || 0);
  const stockApartado = Number(dimension.stock_apartado || 0);
  const stockDisponible = Number(dimension.stock_disponible || 0);
  const baseReposicion =
    estadoTemporada === "FINALIZADA" ? 0 : demandaRestanteEstimada;
  const stockNecesarioConMargen = Math.ceil(
    baseReposicion * (1 + safeSafetyMargin),
  );
  const unidadesAPreparar = Math.max(
    stockNecesarioConMargen - stockDisponible,
    0,
  );

  return {
    producto: {
      id: dimension.producto_id,
      nombre: dimension.producto_nombre,
      categoria_id: dimension.categoria_id,
      categoria_nombre: dimension.categoria_nombre,
    },
    variante: safeVarianteId
      ? {
          id: dimension.variante_id,
          sku: dimension.sku,
          talla_id: dimension.talla_id,
          talla_nombre: dimension.talla_nombre,
          color_id: dimension.color_id,
          color_nombre: dimension.color_nombre,
        }
      : null,
    temporada: {
      id: temporada.id,
      nombre: temporada.nombre,
      modo: modoTemporada,
      periodo_objetivo: {
        anio: periodoObjetivo.anio,
        fecha_inicio: periodoObjetivo.fecha_inicio,
        fecha_fin: periodoObjetivo.fecha_fin,
        estado: estadoTemporada,
        fuente: periodoObjetivo.fuente,
      },
    },
    parametros: {
      anio_objetivo: safeTargetYear,
      from_year: safeFromYear,
      history_years: safeHistoryYears,
      fuente_periodos: fuente,
      margen_seguridad: safeSafetyMargin,
      estados_venta_considerados: ESTADOS_VENTA_VALIDOS,
    },
    historial,
    proyecciones_intermedias: proyeccionesIntermedias,
    historial_calculado: historial
      .filter((item) => item.ventas > 0)
      .map((item) => ({
        ...item,
        t_relativo: item.anio - calculo.first.anio,
      })),
    modelo: {
      nombre: MODELO_NOMBRE,
      ecuacion_base: "dV/dt = kV",
      ecuacion_final: "V(t) = V0 * e^(k * t)",
      ecuacion_aplicada: `V(t) = ${calculo.V0} * e^(${round(calculo.k, 4)} * t)`,
      V0: calculo.V0,
      Vf: calculo.Vf,
      anio_inicial: calculo.first.anio,
      anio_final_historico: calculo.last.anio,
      t: calculo.t,
      t_objetivo: calculo.targetT,
      k: round(calculo.k, 6),
      interpretacion: interpretarK(calculo.k),
    },
    prediccion: {
      anio: safeTargetYear,
      fecha_inicio: periodoObjetivo.fecha_inicio,
      fecha_fin: periodoObjetivo.fecha_fin,
      estado_temporada: estadoTemporada,
      demanda_estimada: demandaEstimada,
      demanda_estimada_redondeada: demandaEstimadaRedondeada,
      ventas_reales_objetivo: ventasRealesObjetivo,
      demanda_restante_estimada: demandaRestanteEstimada,
      error_absoluto: errorAbsoluto,
      error_porcentual: errorPorcentual,
    },
    inventario: {
      stock_fisico: stockFisico,
      stock_apartado: stockApartado,
      stock_disponible: stockDisponible,
      margen_seguridad: safeSafetyMargin,
      stock_necesario_con_margen: stockNecesarioConMargen,
      unidades_a_preparar: unidadesAPreparar,
      recomendacion:
        unidadesAPreparar > 0
          ? `Preparar ${unidadesAPreparar} unidad(es) adicional(es).`
          : "El stock disponible cubre la demanda estimada.",
    },
    message: null,
  };
}
