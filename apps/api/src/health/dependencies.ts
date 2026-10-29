import type { PrismaClient } from '@prisma/client';
import {
  DependencyHealthResponseSchema,
  type AIServiceReadinessResponse,
  type DependencyHealthResponse,
} from '@cybernexus/shared';
import {
  AIServiceNotConfigured,
  type AIServiceReadinessClient,
} from '../analysis/service-client.js';

const DATABASE_CHECK_TIMEOUT_MS = 1_500;

export async function getDependencyHealth(
  database: PrismaClient,
  aiService: AIServiceReadinessClient,
): Promise<DependencyHealthResponse> {
  const [databaseStatus, aiServiceResult] = await Promise.all([
    checkDatabase(database),
    checkAIService(aiService),
  ]);

  const aiProvider =
    aiServiceResult.status === 'healthy'
      ? providerStatus(aiServiceResult.readiness)
      : {
          analysisMode: 'unknown' as const,
          geminiConfiguration: 'unknown' as const,
          geminiConnectivity: 'unverified' as const,
          verified: false as const,
        };

  return DependencyHealthResponseSchema.parse({
    checkedAt: new Date().toISOString(),
    api: { status: 'healthy', verified: true },
    database: databaseStatus,
    aiService: aiServiceStatus(aiServiceResult),
    aiProvider,
  });
}

async function checkDatabase(
  database: PrismaClient,
): Promise<DependencyHealthResponse['database']> {
  try {
    await withTimeout(database.$queryRaw`SELECT 1`, DATABASE_CHECK_TIMEOUT_MS);
    return { status: 'healthy', verified: true };
  } catch {
    return { status: 'unavailable', verified: false };
  }
}

type AIServiceCheck =
  | { status: 'healthy'; readiness: AIServiceReadinessResponse }
  | { status: 'unavailable' | 'not_configured' };

async function checkAIService(
  aiService: AIServiceReadinessClient,
): Promise<AIServiceCheck> {
  try {
    return { status: 'healthy', readiness: await aiService.check() };
  } catch (error) {
    return {
      status:
        error instanceof AIServiceNotConfigured
          ? 'not_configured'
          : 'unavailable',
    };
  }
}

function aiServiceStatus(
  check: AIServiceCheck,
): DependencyHealthResponse['aiService'] {
  return check.status === 'healthy'
    ? { status: 'healthy', verified: true }
    : { status: check.status, verified: false };
}

function providerStatus(
  readiness: AIServiceReadinessResponse,
): DependencyHealthResponse['aiProvider'] {
  return {
    analysisMode: readiness.analysisMode,
    geminiConfiguration: readiness.geminiConfiguration,
    geminiConnectivity: readiness.geminiConnectivity,
    verified: false,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Health check timeout.')),
          timeoutMs,
        );
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
