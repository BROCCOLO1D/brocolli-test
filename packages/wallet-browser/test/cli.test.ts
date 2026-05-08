import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runWalletBrowserCli } from '../src/cli.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wallet-browser-cli-'));
}

function createExtension(path: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'MetaMask' }));
}

describe('runWalletBrowserCli', () => {
  it('runs an injected MetaMask smoke screenshot capture and prints sanitized artifact metadata', async () => {
    const cwd = await tempRoot();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const calls: Array<{ cwd?: string; envKeys: string[] }> = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['smoke-metamask'],
      cwd,
      env: {
        METAMASK_EXTENSION_PATH: join(cwd, 'metamask'),
        METAMASK_PASSWORD: 'do-not-print-this-password'
      },
      runMetaMaskSmoke: async (options) => {
        calls.push({ cwd: options.cwd, envKeys: Object.keys(options.env ?? {}).sort() });
        return {
          status: 'captured',
          artifactDir: join(cwd, '.wallet-artifacts', 'metamask-smoke', 'run'),
          screenshots: [
            { label: 'browser-page', path: join(cwd, '.wallet-artifacts', 'metamask-smoke', 'run', 'browser-page.png') },
            { label: 'metamask-extension', path: join(cwd, '.wallet-artifacts', 'metamask-smoke', 'run', 'metamask-extension.png') }
          ],
          inspectionGuidePath: join(cwd, '.wallet-artifacts', 'metamask-smoke', 'run', 'INSPECTION.md'),
          manifestPath: join(cwd, '.wallet-artifacts', 'metamask-smoke', 'run', 'SMOKE-MANIFEST.json'),
          notes: ['No wallet was imported, unlocked, connected, used to sign, or used to transact.']
        };
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(calls).toEqual([{ cwd, envKeys: ['METAMASK_EXTENSION_PATH', 'METAMASK_PASSWORD'] }]);
    const output = stdout.join('');
    const result = JSON.parse(output) as { status: string; artifactDir: string; screenshots: Array<{ label: string; path: string }>; notes: string[] };
    expect(result.status).toBe('captured');
    expect(result.artifactDir).toContain('.wallet-artifacts/metamask-smoke');
    expect(result.screenshots.map((screenshot) => screenshot.label)).toEqual(['browser-page', 'metamask-extension']);
    expect(result.notes.join(' ')).toContain('No wallet was imported');
    expect(output).not.toContain('do-not-print-this-password');
  });

  it('runs an injected fixture extension smoke capture and labels it as extension-loading mechanics only', async () => {
    const cwd = await tempRoot();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const calls: Array<{ cwd?: string; envKeys: string[] }> = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['smoke-fixture-extension'],
      cwd,
      env: { METAMASK_PASSWORD: 'do-not-print-this-password' },
      runFixtureExtensionSmoke: async (options) => {
        calls.push({ cwd: options.cwd, envKeys: Object.keys(options.env ?? {}).sort() });
        return {
          status: 'captured',
          artifactDir: join(cwd, '.wallet-artifacts', 'fixture-extension-smoke', 'run'),
          screenshots: [
            { label: 'browser-page', path: join(cwd, '.wallet-artifacts', 'fixture-extension-smoke', 'run', 'browser-page.png') },
            { label: 'fixture-extension', path: join(cwd, '.wallet-artifacts', 'fixture-extension-smoke', 'run', 'fixture-extension.png') }
          ],
          inspectionGuidePath: join(cwd, '.wallet-artifacts', 'fixture-extension-smoke', 'run', 'INSPECTION.md'),
          manifestPath: join(cwd, '.wallet-artifacts', 'fixture-extension-smoke', 'run', 'SMOKE-MANIFEST.json'),
          notes: ['Fixture extension smoke proves Chromium extension-loading mechanics only; it is not MetaMask UI.']
        };
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(calls).toEqual([{ cwd, envKeys: ['METAMASK_PASSWORD'] }]);
    const output = stdout.join('');
    const result = JSON.parse(output) as { artifactDir: string; screenshots: Array<{ label: string }>; notes: string[] };
    expect(result.artifactDir).toContain('.wallet-artifacts/fixture-extension-smoke');
    expect(result.screenshots.map((screenshot) => screenshot.label)).toEqual(['browser-page', 'fixture-extension']);
    expect(result.notes.join(' ')).toContain('not MetaMask UI');
    expect(output).not.toContain('do-not-print-this-password');
  });

  it('verifies a smoke artifact manifest without launching Chromium', async () => {
    const cwd = await tempRoot();
    const artifactDir = join(cwd, '.wallet-artifacts', 'metamask-smoke', 'run');
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'browser-page.png'), 'browser image bytes');
    writeFileSync(join(artifactDir, 'INSPECTION.md'), '# Review checklist\n');
    writeFileSync(
      join(artifactDir, 'SMOKE-MANIFEST.json'),
      `${JSON.stringify(
        {
          artifactType: 'wallet-browser-smoke-screenshots',
          inspectionGuide: 'INSPECTION.md',
          screenshots: [
            {
              label: 'browser-page',
              file: 'browser-page.png',
              sizeBytes: 'browser image bytes'.length,
              sha256: createHash('sha256').update('browser image bytes').digest('hex')
            }
          ],
          notes: ['No wallet was imported, unlocked, connected, used to sign, or used to transact.']
        },
        null,
        2
      )}\n`
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['verify-smoke-artifacts', artifactDir],
      cwd,
      env: { METAMASK_PASSWORD: 'do-not-print-this-password' },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = stdout.join('');
    const result = JSON.parse(output) as { status: string; screenshots: Array<{ file: string; sha256: string }>; notes: string[] };
    expect(result.status).toBe('verified');
    expect(result.screenshots).toHaveLength(1);
    expect(result.screenshots[0].file).toBe('browser-page.png');
    expect(result.notes.join(' ')).toContain('No wallet was imported');
    expect(output).not.toContain('do-not-print-this-password');
  });

  it('prints a sanitized launch plan without launching Chromium or exposing wallet secrets', async () => {
    const cwd = await tempRoot();
    const extensionPath = join(cwd, 'metamask');
    createExtension(extensionPath);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['prepare'],
      cwd,
      env: {
        METAMASK_EXTENSION_PATH: extensionPath,
        WALLET_PROFILE_NAME: 'agent-run',
        SEPOLIA_WALLET_PRIVATE_KEY: '0xnot-a-real-secret',
        METAMASK_PASSWORD: 'not-a-real-password'
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const plan = JSON.parse(stdout.join('')) as {
      browserName: string;
      userDataDir: string;
      args: string[];
      metamaskExtensionPath: string;
      metamaskExtensionVersion: string;
      metamaskExtensionIdentity: { name: string; shortName?: string; version?: string };
      profileName: string;
      preserveProfile: boolean;
      config: { present: string[]; missing: string[] };
    };
    expect(plan.browserName).toBe('chromium');
    expect(plan.metamaskExtensionPath).toBe(extensionPath);
    expect(plan.userDataDir).toBe(join(cwd, '.wallet-profiles', 'agent-run'));
    expect(plan.args).toEqual([
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]);
    expect(plan.profileName).toBe('agent-run');
    expect(plan.preserveProfile).toBe(false);
    expect(plan.metamaskExtensionIdentity).toEqual({ name: 'MetaMask' });
    expect(plan.config.present).toEqual(['METAMASK_EXTENSION_PATH', 'WALLET_PROFILE_NAME']);
    expect(plan.config.missing).toEqual(['METAMASK_EXTENSION_DIR', 'METAMASK_EXTENSION_VERSION', 'WALLET_PROFILE_DIR', 'PRESERVE_WALLET_PROFILE']);
    expect(stdout.join('')).not.toContain('0xnot-a-real-secret');
    expect(stdout.join('')).not.toContain('not-a-real-password');
  });

  it('prints a redacted onboarding plan from injected env without requiring a MetaMask extension artifact', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const privateKey = `0x${'b'.repeat(64)}`;
    const password = 'local-only wallet password';

    const exitCode = await runWalletBrowserCli({
      argv: ['onboarding-plan'],
      cwd: await tempRoot(),
      env: {
        SEPOLIA_WALLET_ADDRESS: '0x3333333333333333333333333333333333333333',
        SEPOLIA_WALLET_PRIVATE_KEY: privateKey,
        METAMASK_PASSWORD: password,
        METAMASK_ONBOARDING_TIMEOUT_MS: '75000',
        METAMASK_ONBOARDING_DEBUG: 'true'
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = stdout.join('');
    const plan = JSON.parse(output) as {
      status: string;
      expectedAddress: string;
      privateKey: string;
      password: string;
      timeoutMs: number;
      debug: boolean;
      selectors: Record<string, string>;
    };
    expect(plan.status).toBe('pending');
    expect(plan.expectedAddress).toBe('0x3333333333333333333333333333333333333333');
    expect(plan.privateKey).toBe('0xbb…bbbb');
    expect(plan.password).toBe('[redacted:26 chars]');
    expect(plan.timeoutMs).toBe(75000);
    expect(plan.debug).toBe(true);
    expect(plan.selectors.privateKeyInput).toContain('private-key');
    expect(output).not.toContain(privateKey);
    expect(output).not.toContain(password);
  });

  it('prints a redacted Sepolia network plan without requiring a MetaMask extension artifact or exposing RPC tokens', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const rpcUrl = 'https://sepolia.infura.io/v3/super-secret-token';

    const exitCode = await runWalletBrowserCli({
      argv: ['network-plan'],
      cwd: await tempRoot(),
      env: {
        SEPOLIA_WALLET_ADDRESS: '0x3333333333333333333333333333333333333333',
        SEPOLIA_CHAIN_ID: '0xaa36a7',
        SEPOLIA_RPC_URL: rpcUrl,
        METAMASK_NETWORK_ASSERTION_TIMEOUT_MS: '45000',
        METAMASK_NETWORK_DEBUG: 'true'
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = stdout.join('');
    const plan = JSON.parse(output) as {
      status: string;
      chainId: number;
      chainIdHex: string;
      expectedAccount: string;
      rpcUrlConfigured: boolean;
      rpcUrl: string;
      timeoutMs: number;
      debug: boolean;
    };
    expect(plan.status).toBe('pending');
    expect(plan.chainId).toBe(11155111);
    expect(plan.chainIdHex).toBe('0xaa36a7');
    expect(plan.expectedAccount).toBe('0x3333333333333333333333333333333333333333');
    expect(plan.rpcUrlConfigured).toBe(true);
    expect(plan.rpcUrl).toBe('https://sepolia.infura.io/[redacted-url]');
    expect(plan.timeoutMs).toBe(45000);
    expect(plan.debug).toBe(true);
    expect(output).not.toContain('super-secret-token');
    expect(output).not.toContain(rpcUrl);
  });

  it('returns a non-zero exit code and concise error when network plan validation fails without echoing RPC tokens', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const badRpcUrl = 'not-a-real-rpc-token-url';

    const exitCode = await runWalletBrowserCli({
      argv: ['network-plan'],
      cwd: await tempRoot(),
      env: {
        SEPOLIA_WALLET_ADDRESS: '0x3333333333333333333333333333333333333333',
        SEPOLIA_RPC_URL: badRpcUrl
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('SEPOLIA_RPC_URL');
    expect(stderr.join('')).not.toContain(badRpcUrl);
  });

  it('returns a non-zero exit code and concise error when onboarding plan validation fails without echoing secrets', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const badPrivateKey = 'not-a-valid-private-key-value';

    const exitCode = await runWalletBrowserCli({
      argv: ['onboarding-plan'],
      cwd: await tempRoot(),
      env: {
        SEPOLIA_WALLET_ADDRESS: '0x3333333333333333333333333333333333333333',
        SEPOLIA_WALLET_PRIVATE_KEY: badPrivateKey,
        METAMASK_PASSWORD: 'local-only wallet password'
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('SEPOLIA_WALLET_PRIVATE_KEY');
    expect(stderr.join('')).not.toContain(badPrivateKey);
  });

  it('returns a non-zero exit code and concise error when config resolution fails', async () => {
    const cwd = await tempRoot();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['prepare'],
      cwd,
      env: {},
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('MetaMask extension path does not exist');
  });

  it('redacts injected prepare env path values from validation errors', async () => {
    const cwd = await tempRoot();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const sensitivePath = join(cwd, 'metamask-super-secret-token-path');

    const exitCode = await runWalletBrowserCli({
      argv: ['prepare'],
      cwd,
      env: { METAMASK_EXTENSION_PATH: sensitivePath },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('MetaMask extension path does not exist');
    expect(stderr.join('')).toContain('[redacted:METAMASK_EXTENSION_PATH]');
    expect(stderr.join('')).not.toContain(sensitivePath);
    expect(stderr.join('')).not.toContain('super-secret-token-path');
  });

  it('prints usage without touching wallet config for help', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWalletBrowserCli({
      argv: ['--help'],
      cwd: await tempRoot(),
      env: {},
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toContain('wallet-browser prepare');
  });
});
