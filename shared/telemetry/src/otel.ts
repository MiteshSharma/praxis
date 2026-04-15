import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, type SpanExporter } from '@opentelemetry/sdk-trace-node';

let sdk: NodeSDK | undefined;

/**
 * Tracing modes (dev):
 *   OTEL_TRACES=off      → no exporter, no auto-instrumentation (default)
 *   OTEL_TRACES=console  → dump spans to stdout
 *   OTEL_TRACES=otlp     → export to OTEL_EXPORTER_OTLP_ENDPOINT
 * Prod default is `otlp` if OTEL_EXPORTER_OTLP_ENDPOINT is set, else `off`.
 */
function resolveMode(): 'off' | 'console' | 'otlp' {
  const raw = process.env.OTEL_TRACES?.toLowerCase();
  if (raw === 'off' || raw === 'console' || raw === 'otlp') return raw;
  if (process.env.NODE_ENV === 'development') return 'off';
  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otlp' : 'off';
}

export function initTelemetry(serviceName: string): NodeSDK | undefined {
  if (sdk) return sdk;

  const mode = resolveMode();
  if (mode === 'off') return undefined;

  let exporter: SpanExporter;
  if (mode === 'console') {
    exporter = new ConsoleSpanExporter();
  } else {
    exporter = new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });
  }

  sdk = new NodeSDK({
    serviceName,
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-pg': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
  return sdk;
}

export function getTelemetrySdk(): NodeSDK | undefined {
  return sdk;
}
