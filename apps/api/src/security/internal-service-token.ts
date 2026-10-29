const INTERNAL_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{32,512}$/;

export function isValidInternalServiceToken(token: string): boolean {
  return INTERNAL_TOKEN_PATTERN.test(token);
}
