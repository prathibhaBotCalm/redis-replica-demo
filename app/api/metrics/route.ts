import client from 'prom-client';

// Extend global to store our registration flag
declare global {
  // This flag ensures that metrics are registered only once
  var metricsRegistered: boolean | undefined;
}

if (!globalThis.metricsRegistered) {
  // Collect default metrics (e.g., process stats, event loop delay, etc.)
  client.collectDefaultMetrics({ eventLoopMonitoringPrecision: 5000 });
  globalThis.metricsRegistered = true;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const metrics: string = await client.register.metrics();
    return new Response(metrics, {
      status: 200,
      headers: { 'Content-Type': client.register.contentType },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(message, { status: 500 });
  }
}
