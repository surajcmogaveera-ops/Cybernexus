import {
  ApiErrorResponseSchema,
  HealthResponseSchema,
  type HealthResponse,
} from '@cybernexus/shared';

export async function getApiHealth(
  fetcher: typeof fetch = fetch,
): Promise<HealthResponse> {
  const response = await fetcher('/api/health');
  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const apiError = ApiErrorResponseSchema.safeParse(body);
    throw new Error(
      apiError.success ? apiError.data.error.message : 'API request failed.',
    );
  }

  return HealthResponseSchema.parse(body);
}
