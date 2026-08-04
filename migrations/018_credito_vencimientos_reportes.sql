-- Bloques 8 y 9: seguimiento de vencimientos e índices de reportería.
BEGIN;

CREATE TABLE IF NOT EXISTS clientes.credito_ejecuciones_vencimiento (
  id bigserial PRIMARY KEY,
  origen text NOT NULL,
  fecha_objetivo date NOT NULL,
  iniciado_at timestamptz NOT NULL DEFAULT now(),
  finalizado_at timestamptz,
  exitoso boolean NOT NULL DEFAULT false,
  resultado jsonb,
  error_message text,
  ejecutado_por uuid,

  CONSTRAINT chk_credito_ejecuciones_origen
    CHECK (origen IN ('MANUAL', 'CRON')),

  CONSTRAINT fk_credito_ejecuciones_usuario
    FOREIGN KEY (ejecutado_por)
    REFERENCES seguridad.usuarios(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_credito_ejecuciones_fecha
  ON clientes.credito_ejecuciones_vencimiento (iniciado_at DESC);

CREATE INDEX IF NOT EXISTS idx_creditos_reporte_fecha_estado
  ON clientes.creditos (fecha_otorgamiento DESC, estado);

CREATE INDEX IF NOT EXISTS idx_pagos_credito_concepto_fecha
  ON ventas.pagos (concepto, fecha_pago DESC)
  WHERE estado = 'CONFIRMADO'
    AND concepto IN (
      'ENGANCHE_CREDITO',
      'ABONO_CREDITO',
      'LIQUIDACION_CREDITO',
      'REEMBOLSO_CREDITO'
    );

CREATE INDEX IF NOT EXISTS idx_cuotas_vencidas_credito_saldo
  ON clientes.credito_cuotas (credito_id, fecha_vencimiento)
  WHERE estado = 'VENCIDA' AND saldo_pendiente > 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_panel_interno') THEN
    GRANT SELECT, INSERT, UPDATE
      ON clientes.credito_ejecuciones_vencimiento
      TO app_panel_interno;
    GRANT USAGE, SELECT
      ON SEQUENCE clientes.credito_ejecuciones_vencimiento_id_seq
      TO app_panel_interno;
  END IF;
END;
$$;

COMMIT;
