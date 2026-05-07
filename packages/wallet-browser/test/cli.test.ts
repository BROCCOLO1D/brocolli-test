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
      profileName: string;
      preserveProfile: boolean;
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
    expect(stdout.join('')).not.toContain('0xnot-a-real-secret');
    expect(stdout.join('')).not.toContain('not-a-real-password');
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
