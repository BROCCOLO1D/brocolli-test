#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  process.stdout.write(`\n$ ${printable}\n`);
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      ...options
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return { stdout, stderr };
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

function firstPackedFilename(packJsonStdout, packageName) {
  const parsed = JSON.parse(packJsonStdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry?.filename) {
    throw new Error(`npm pack for ${packageName} did not report a filename.`);
  }
  return entry.filename;
}

async function main() {
  const workdir = await mkdtemp(join(tmpdir(), 'broccoli-playwright-consumer-'));
  const tarballDir = join(workdir, 'tarballs');
  const consumerDir = join(workdir, 'consumer');

  try {
    await run('npm', ['exec', 'pnpm@11.0.8', '--', '--filter', '@broccolo1d/playwright', 'build']);

    await mkdir(tarballDir, { recursive: true });
    await mkdir(consumerDir, { recursive: true });

    const walletPack = await run('npm', ['pack', '--json', '--pack-destination', tarballDir], {
      cwd: join(repoRoot, 'packages/wallet-browser')
    });
    const playwrightPack = await run('npm', ['pack', '--json', '--pack-destination', tarballDir], {
      cwd: join(repoRoot, 'packages/playwright')
    });

    const walletTarball = join(tarballDir, firstPackedFilename(walletPack.stdout, '@broccolo1d/wallet-browser'));
    const playwrightTarball = join(tarballDir, firstPackedFilename(playwrightPack.stdout, '@broccolo1d/playwright'));

    await writeFile(
      join(consumerDir, 'package.json'),
      JSON.stringify(
        {
          private: true,
          type: 'module',
          scripts: { typecheck: 'tsc -p tsconfig.json --noEmit' },
          dependencies: {
            '@broccolo1d/wallet-browser': `file:${walletTarball}`,
            '@broccolo1d/playwright': `file:${playwrightTarball}`,
            '@playwright/test': '1.59.1'
          },
          devDependencies: { typescript: '6.0.3' }
        },
        null,
        2
      ) + '\n'
    );

    await writeFile(
      join(consumerDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            skipLibCheck: true,
            noEmit: true
          },
          include: ['src/**/*.ts']
        },
        null,
        2
      ) + '\n'
    );

    await mkdir(join(consumerDir, 'src'), { recursive: true });
    await writeFile(
      join(consumerDir, 'src/index.ts'),
      `import { installWalletScenario, walletScenario } from '@broccolo1d/playwright';\n` +
        `import { createWalletContractRows, walletContractTests } from '@broccolo1d/playwright/contracts';\n\n` +
        `const scenario = walletScenario()\n` +
        `  .connected({ account: '0x1111111111111111111111111111111111111111' })\n` +
        `  .withChain(11155111)\n` +
        `  .withProviderInfo({ walletId: 'io.metamask', name: 'MetaMask' })\n` +
        `  .rejectsSignature({ code: 4001, message: 'User rejected request.' })\n` +
        `  .build();\n\n` +
        `void installWalletScenario;\n` +
        `void scenario;\n` +
        `void walletContractTests;\n` +
        `const rows = createWalletContractRows({\n` +
        `  appName: 'Consumer',\n` +
        `  baseUrl: 'http://127.0.0.1:3000',\n` +
        `  expectedChainId: 11155111,\n` +
        `  expectedAccount: '0x1111111111111111111111111111111111111111',\n` +
        `  routes: [{ name: 'home', path: '/', walletAffordance: /connect|wallet/i }]\n` +
        `});\n` +
        `if (rows[0]?.artifactBasename !== 'contract-home-disconnected') {\n` +
        `  throw new Error('Unexpected wallet contract row basename');\n` +
        `}\n`
    );

    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumerDir });
    await run('npm', ['run', 'typecheck'], { cwd: consumerDir });

    const consumerSource = await readFile(join(consumerDir, 'src/index.ts'), 'utf8');
    if (!consumerSource.includes("@broccolo1d/playwright/contracts")) {
      throw new Error('Consumer smoke did not exercise the contracts subpath.');
    }

    process.stdout.write(`\nVerified packed @broccolo1d/playwright consumer imports in ${consumerDir}\n`);
  } finally {
    if (!process.env.KEEP_BROCCOLI_CONSUMER_VERIFY_DIR) {
      await rm(workdir, { recursive: true, force: true });
    } else {
      process.stdout.write(`\nPreserved temp consumer at ${workdir}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
