export type QpiAIOptConfiguration =
  | { status: 'ready'; baseUrl: URL; token: string }
  | { status: 'missing' | 'invalid' };

/** Reads server-only settings and deliberately never includes token contents in diagnostics. */
export function loadQpiAIOptConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): QpiAIOptConfiguration {
  const rawBaseUrl = environment.QPIAI_OPT_BASE_URL?.trim();
  const token = environment.QPIAI_OPT_API_TOKEN?.trim();
  if (!rawBaseUrl || !token) return { status: 'missing' };
  if (token.length < 16 || token.length > 4096) return { status: 'invalid' };
  try {
    const baseUrl = new URL(rawBaseUrl);
    if (
      baseUrl.protocol !== 'https:' ||
      baseUrl.hostname !== 'opt-server.qpiai.tech' ||
      baseUrl.pathname.replace(/\/$/, '') !== '/api' ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      return { status: 'invalid' };
    }
    return { status: 'ready', baseUrl, token };
  } catch {
    return { status: 'invalid' };
  }
}
