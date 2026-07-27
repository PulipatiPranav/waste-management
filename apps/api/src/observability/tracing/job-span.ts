import { context, SpanStatusCode, trace } from '@opentelemetry/api';

/**
 * Wraps a BullMQ job's processing in an OpenTelemetry span so background work shows up in traces
 * next to the HTTP requests and DB queries — the "BullMQ jobs" leg of the Phase 14 tracing brief.
 *
 * When OTel is not enabled the global tracer is a no-op, so this costs nothing in dev and tests: the
 * function simply runs `fn` and returns. When it IS enabled, a failed job records the exception and
 * an ERROR status on its span before rethrowing, so a job that keeps dead-lettering is visible as a
 * span with an error rather than only as a log line.
 */
export async function withJobSpan<T>(
  queueName: string,
  jobName: string,
  jobId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer('bullmq');
  return tracer.startActiveSpan(`job ${queueName} ${jobName}`, async (span) => {
    span.setAttribute('messaging.system', 'bullmq');
    span.setAttribute('messaging.destination.name', queueName);
    span.setAttribute('messaging.operation', 'process');
    if (jobId !== undefined) span.setAttribute('messaging.message.id', jobId);
    try {
      return await context.with(trace.setSpan(context.active(), span), fn);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
