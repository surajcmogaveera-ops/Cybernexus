export function rewriteApiProxyPath(path: string): string {
  return path.replace(/^\/api\/health(?=\/|$)/, '/health');
}
