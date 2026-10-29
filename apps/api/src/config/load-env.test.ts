import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const { config } = vi.hoisted(() => ({ config: vi.fn() }));

vi.mock('dotenv', () => ({ default: { config } }));

import dotenv from 'dotenv';
import { resolveRepositoryEnvPath } from './load-env.js';

describe('API environment loading', () => {
  it('resolves the repository root env file from the loader module location', () => {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const apiPackageRoot = resolve(moduleDirectory, '../..');
    const repositoryRoot = resolve(apiPackageRoot, '../..');
    const expectedRootPath = resolve(repositoryRoot, '.env');

    expect(resolveRepositoryEnvPath()).toBe(expectedRootPath);
    expect(process.cwd()).toBe(apiPackageRoot);
  });

  it('loads the working-directory env first and then root env without overriding existing values', () => {
    expect(dotenv.config).toHaveBeenNthCalledWith(1);
    expect(dotenv.config).toHaveBeenNthCalledWith(2, {
      path: resolveRepositoryEnvPath(),
      override: false,
    });
  });
});
