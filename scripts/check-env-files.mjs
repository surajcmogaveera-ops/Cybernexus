import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const unsafeEnvironmentFiles = trackedFiles.filter((file) => {
  const name = basename(file);
  return /^\.env(?:$|\.)/.test(name) && name !== '.env.example';
});

if (unsafeEnvironmentFiles.length > 0) {
  console.error(
    `Real environment files must not be tracked: ${unsafeEnvironmentFiles.join(', ')}`,
  );
  process.exitCode = 1;
} else {
  console.log('No real .env files are tracked.');
}
