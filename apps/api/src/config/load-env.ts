import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

export function resolveRepositoryEnvPath(moduleUrl = import.meta.url): string {
  return fileURLToPath(new URL('../../../../.env', moduleUrl));
}

dotenv.config();
dotenv.config({
  path: resolveRepositoryEnvPath(),
  override: false,
});
