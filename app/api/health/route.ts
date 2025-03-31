import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';

// Health check response type
interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  uptime: number;
  environment: string;
  canary?: boolean;
  canaryWeight?: number;
  redisStatus: 'connected' | 'disconnected';
  checks: {
    [key: string]: {
      status: 'ok' | 'failed';
      responseTime?: number;
      error?: string;
    };
  };
}

// Redis connection config from environment variables
const redisConfig = {
  sentinels:
    process.env.IS_DEV === 'true'
      ? process.env.REDIS_SENTINELS_DEV?.split(',').map((item) => {
          const [host, port] = item.split(':');
          return { host, port: parseInt(port) };
        })
      : process.env.REDIS_SENTINELS_PROD?.split(',').map((item) => {
          const [host, port] = item.split(':');
          return { host, port: parseInt(port) };
        }),
  name: process.env.REDIS_MASTER_NAME || 'mymaster',
  password: process.env.REDIS_PASSWORD,
  sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
  enableAutoPipelining: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
};

// Get Redis connection status
async function checkRedisConnection(): Promise<{
  status: 'connected' | 'disconnected';
  responseTime?: number;
  error?: string;
}> {
  const redis = new Redis(redisConfig);
  const startTime = Date.now();

  try {
    await redis.ping();
    const endTime = Date.now();
    await redis.quit();
    return {
      status: 'connected' as 'connected' | 'disconnected',
      responseTime: endTime - startTime,
    };
  } catch (error) {
    await redis.quit();
    return {
      status: 'disconnected' as 'connected' | 'disconnected',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Get application start time for uptime calculation
const appStartTime = Date.now();

// Route handler for GET requests
export async function GET(
  request: NextRequest
): Promise<NextResponse<HealthResponse>> {
  const startTime = Date.now();

  // Check Redis connection
  const redisStatus = await checkRedisConnection();

  // Perform other health checks
  const checks = {
    redis: {
      status: redisStatus.status === 'connected' ? 'ok' : 'failed' as 'ok' | 'failed',
      responseTime: redisStatus.responseTime,
      error: redisStatus.error,
    },
    // Add more service checks here as needed
  };

  // Determine overall status
  let overallStatus: 'ok' | 'degraded' | 'unhealthy' = 'ok';

  // If any critical service is down, mark as unhealthy
  if (checks.redis.status === 'failed') {
    overallStatus = 'unhealthy';
  }
  // If any non-critical service is down, mark as degraded
  else if (Object.values(checks).some((check) => check.status === 'failed')) {
    overallStatus = 'degraded';
  }

  // Build response
  const healthResponse: HealthResponse = {
    status: overallStatus,
    version: process.env.BUILD_VERSION || 'unknown',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - appStartTime) / 1000), // in seconds
    environment: process.env.IS_DEV === 'true' ? 'development' : 'production',
    redisStatus: redisStatus.status,
    checks,
  };

  // Add canary information if this is a canary deployment
  if (process.env.CANARY_DEPLOYMENT === 'true') {
    healthResponse.canary = true;
    healthResponse.canaryWeight = parseInt(process.env.CANARY_WEIGHT || '0');
  }

  // Create response
  const response = NextResponse.json(healthResponse, {
    status:
      overallStatus === 'ok' ? 200 : overallStatus === 'degraded' ? 200 : 503,
  });

  // Add response time header
  response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);

  return response;
}

// Optional: Add HEAD method for lightweight health checks
export async function HEAD(request: NextRequest): Promise<NextResponse> {
  const redisStatus = await checkRedisConnection();
  const isHealthy = redisStatus.status === 'connected';

  return new NextResponse(null, {
    status: isHealthy ? 200 : 503,
    headers: {
      'X-Health-Status': isHealthy ? 'ok' : 'unhealthy',
    },
  });
}

// Set revalidation options for the health endpoint
export const dynamic = 'force-dynamic'; // Ensures the route is not cached
export const revalidate = 0; // Disables data caching
