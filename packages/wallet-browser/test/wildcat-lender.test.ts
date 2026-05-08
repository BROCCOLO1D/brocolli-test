import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createWildcatLenderConnectionPlan, runWalletBrowserCli } from '../src/index.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wildcat-lender-'));
}

describe('Wildcat lender connection plan', () => {
  it('creates a local-only redacted plan for the Wildcat testnet lender MetaMask connection flow', async () => {
    const cwd = await tempRoot();
    const plan = createWildcatLenderConnectionPlan({
      cwd,
      env: {
        SEPOLIA_WALLET_ADDRESS: '0x8161000000000000000000000000000000034b61',
        SEPOLIA_RPC_URL: 'https://sepolia.example/rpc/do-not-print-token',
        METAMASK_PASSWORD: 'do-not-print-password'
      }
    });

    expect(plan).toMatchObject({
      status: 'local-only-plan',
      target: 'wildcat-lender',
      url: 'https://testnet.wildcat.finance/lender',
      expectedChainId: 11155111,
      expectedChainIdHex: '0xaa36a7',
      expectedMaskedAccount: '0x8161…4b61',
      allowedOrigins: ['https://testnet.wildcat.finance/lender'],
      maxTransactionValueWei: '0',
      artifactDir: '.wallet-artifacts/wildcat-lender/<run-id>'
    });
    expect(plan.steps.map((step) => step.action)).toEqual([
      'open-target',
      'dismiss-common-modals',
      'click-connect-wallet',
      'select-metamask',
      'approve-metamask-connect',
      'verify-wallet-state',
      'capture-connected-proof'
    ]);
    expect(plan.diagnostics).toContain('If the live site is flaky or unavailable, preserve only the redacted manifest and local screenshots under ignored .wallet-artifacts/.');
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain('do-not-print-token');
    expect(serialized).not.toContain('do-not-print-password');
    expect(serialized).not.toContain('0x8161000000000000000000000000000000034b61');
    expect(serialized).not.toContain(cwd);
  });

  it('fails closed unless the expected Sepolia burner account is configured', async () => {
    const cwd = await tempRoot();
    expect(() => createWildcatLenderConnectionPlan({ cwd, env: {} })).toThrow(/SEPOLIA_WALLET_ADDRESS/i);
  });

  it('prints the Wildcat plan through CLI without exposing secrets or full local paths', async () => {
    const cwd = await tempRoot();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runWalletBrowserCli({
      argv: ['wildcat-lender-plan'],
      cwd,
      env: {
        SEPOLIA_WALLET_ADDRESS: '0x8161000000000000000000000000000000034b61',
        SEPOLIA_RPC_URL: 'https://sepolia.example/rpc/do-not-print-token',
        METAMASK_PASSWORD: 'do-not-print-password'
      },
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = stdout.join('');
    const plan = JSON.parse(output) as { target: string; url: string; expectedMaskedAccount: string; steps: Array<{ action: string }> };
    expect(plan.target).toBe('wildcat-lender');
    expect(plan.url).toBe('https://testnet.wildcat.finance/lender');
    expect(plan.expectedMaskedAccount).toBe('0x8161…4b61');
    expect(plan.steps.at(-1)?.action).toBe('capture-connected-proof');
    expect(output).not.toContain('do-not-print-token');
    expect(output).not.toContain('do-not-print-password');
    expect(output).not.toContain('0x8161000000000000000000000000000000034b61');
    expect(output).not.toContain(cwd);
  });
});
