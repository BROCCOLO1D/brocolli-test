#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageDir = resolve(repoRoot, 'packages/playwright');
const registry = 'https://registry.npmjs.org/';

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      ...options
    });
    return { ok: true, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      code: error.code ?? 1
    };
  }
}

function npmOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function readIgnoredEnvToken() {
  let contents = '';
  try {
    contents = await readFile(resolve(repoRoot, '.env'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }

  for (const name of ['NPM_TOKEN', 'NODE_AUTH_TOKEN']) {
    const match = contents.match(new RegExp(`^${name}=([^\\r\\n]+)`, 'm'));
    const value = match?.[1]?.trim().replace(/^[\"']|[\"']$/g, '');
    if (value) return value;
  }
  return undefined;
}

async function createNpmUserconfig() {
  const token = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN || (await readIgnoredEnvToken());
  if (!token) {
    throw new Error('No NPM_TOKEN or NODE_AUTH_TOKEN found in the environment or ignored local .env; refusing to publish.');
  }

  const directory = await mkdtemp(join(tmpdir(), 'broccoli-npm-publish-'));
  const userconfig = join(directory, '.npmrc');
  await writeFile(userconfig, `//registry.npmjs.org/:_authToken=${token}\nregistry=${registry}\n`, { mode: 0o600 });
  return { userconfig, cleanup: async () => rm(directory, { recursive: true, force: true }) };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const packageJson = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
  const packageVersion = `${packageJson.name}@${packageJson.version}`;
  process.stdout.write(`Preparing ${dryRun ? 'dry-run ' : ''}publish for ${packageVersion}\n`);

  const existingVersion = await run('npm', ['view', packageVersion, 'version', `--registry=${registry}`]);
  if (existingVersion.ok) {
    throw new Error(`${packageVersion} is already published on npm; bump the package before publishing again.`);
  }
  const viewOutput = npmOutput(existingVersion);
  if (!/E404|404 Not Found|No match found/i.test(viewOutput)) {
    throw new Error(`Could not confirm ${packageVersion} is unpublished. npm view failed with:\n${viewOutput}`);
  }
  process.stdout.write(`✓ ${packageVersion} is not published yet.\n`);

  const npmAuth = await createNpmUserconfig();
  try {
    const whoami = await run('npm', ['whoami', `--registry=${registry}`, '--userconfig', npmAuth.userconfig]);
    if (!whoami.ok) {
      throw new Error(
        `npm registry auth is not ready for publish. Refresh a local ignored automation/granular token or use OTP-backed publish, then rerun this helper.\n${npmOutput(whoami)}`
      );
    }
    process.stdout.write(`✓ npm auth is active for ${whoami.stdout.trim()}\n`);

    const args = ['publish', '--access', 'public', `--registry=${registry}`, '--userconfig', npmAuth.userconfig];
    if (dryRun) args.push('--dry-run');
    process.stdout.write(`Running plain npm publish from packages/playwright with token-backed temporary userconfig.\n`);
    const published = await run('npm', args, { cwd: packageDir });
    if (!published.ok) {
      throw new Error(npmOutput(published));
    }
    process.stdout.write(npmOutput(published));
  } finally {
    await npmAuth.cleanup();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
