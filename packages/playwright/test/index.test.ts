import { describe, expect, it } from 'vitest';

import packageJson from '../package.json';
import { defineWalletQaConfig, installDeterministicInjectedWallet, test } from '../src/index.js';
import type { DeterministicInjectedWalletPage } from '../src/index.js';

describe('@broccolo1d/playwright exports', () => {
  it('declares a registry-safe wallet-browser dependency for plain npm publish', () => {
    expect(packageJson.dependencies['@broccolo1d/wallet-browser']).toBe('^0.2.8');
  });

  it('exports an extended Playwright test and config helper', () => {
    expect(typeof test).toBe('function');
    expect(typeof test.extend).toBe('function');
    expect(defineWalletQaConfig({ use: { walletConfig: { useRealWallet: false } } })).toMatchObject({
      use: { walletConfig: { useRealWallet: false } }
    });
  });

  it('rejects zero or invalid deterministic injected wallet accounts', async () => {
    const page = { async addInitScript() {} } as unknown as DeterministicInjectedWalletPage;

    await expect(installDeterministicInjectedWallet(page, { account: '0x0000000000000000000000000000000000000000', chainId: 1 })).rejects.toThrow(
      /non-zero ethereum address/i
    );
    await expect(installDeterministicInjectedWallet(page, { account: 'not-an-address', chainId: 1 })).rejects.toThrow(
      /non-zero ethereum address/i
    );
  });

  it('installs a deterministic injected wallet that answers account and chain requests', async () => {
    let initScript: ((args: { account: string; chainIdHex: string }) => void) | undefined;
    let initArgs: { account: string; chainIdHex: string } | undefined;
    const page = {
      async addInitScript(script: (args: { account: string; chainIdHex: string }) => void, args: { account: string; chainIdHex: string }) {
        initScript = script;
        initArgs = args;
      }
    } as unknown as DeterministicInjectedWalletPage;

    await installDeterministicInjectedWallet(page, {
      account: '0xAa000000000000000000000000000000000000Bb',
      chainId: 11155111
    });

    expect(initArgs).toEqual({
      account: '0xaa000000000000000000000000000000000000bb',
      chainIdHex: '0xaa36a7'
    });

    const listeners: Record<string, unknown> = {};
    const testGlobal = globalThis as typeof globalThis & { ethereum?: { request(input: { method: string; params?: unknown[] }): Promise<unknown>; on(event: string, listener: unknown): void } };
    const previousEthereum = testGlobal.ethereum;
    try {
      initScript?.(initArgs!);
      testGlobal.ethereum?.on('accountsChanged', (accounts: string[]) => {
        listeners.accountsChanged = accounts;
      });

      await expect(testGlobal.ethereum?.request({ method: 'eth_accounts' })).resolves.toEqual([
        '0xaa000000000000000000000000000000000000bb'
      ]);
      await expect(testGlobal.ethereum?.request({ method: 'eth_chainId' })).resolves.toBe('0xaa36a7');
      expect(listeners.accountsChanged).toEqual(['0xaa000000000000000000000000000000000000bb']);
    } finally {
      Object.defineProperty(globalThis, 'ethereum', { configurable: true, value: previousEthereum });
    }
  });
});
