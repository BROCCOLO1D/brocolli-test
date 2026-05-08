import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEPOLIA_CHAIN_ID,
  runFixtureConnectionProof,
  verifyFixtureConnectionProofManifest,
  type MetaMaskNetworkDriver,
  type WalletDappDriver,
  type WalletPromptDriver
} from '../src/index.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';

async function tempArtifactDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fixture-harness-'));
  return join(root, '.wallet-artifacts', 'fixture-connection-proof', 'run');
}

function makeNetworkDriver(overrides: Partial<MetaMaskNetworkDriver> = {}): MetaMaskNetworkDriver {
  return {
    async getChainId() {
      return DEFAULT_SEPOLIA_CHAIN_ID;
    },
    async getAccounts() {
      return [ADDRESS];
    },
    async switchChain() {},
    async addEthereumChain() {},
    ...overrides
  };
}

function makeDapp(calls: string[], connectedAccount = ADDRESS): WalletDappDriver {
  return {
    async requestConnect() {
      calls.push('dapp:requestConnect');
    },
    async getConnectedAccount() {
      calls.push('dapp:getConnectedAccount');
      return connectedAccount;
    }
  };
}

function makePrompt(calls: string[]): WalletPromptDriver {
  return {
    async approveConnection(input) {
      calls.push(`prompt:approveConnection:${input.origin}:${input.expectedChainIdHex}`);
    }
  };
}

describe('fixture connection proof harness', () => {
  it('connects the fixture through wallet-control, captures proof only after verification, and writes a verifiable redacted manifest', async () => {
    const calls: string[] = [];
    const artifactDir = await tempArtifactDir();

    const result = await runFixtureConnectionProof({
      artifactDir,
      dapp: makeDapp(calls),
      prompt: makePrompt(calls),
      network: makeNetworkDriver(),
      origin: 'http://127.0.0.1:5173/?session=do-not-log',
      expectedAccount: ADDRESS,
      expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
      captureScreenshot: async ({ path, evidence }) => {
        calls.push(`screenshot:${evidence.connectionState}:${evidence.maskedAccount}`);
        await import('node:fs/promises').then(({ writeFile }) => writeFile(path, 'connected fixture screenshot bytes'));
      }
    });

    expect(calls).toEqual([
      'dapp:requestConnect',
      'prompt:approveConnection:http://127.0.0.1:5173/?session=do-not-log:0xaa36a7',
      'dapp:getConnectedAccount',
      'screenshot:connected:0x1111…1111'
    ]);
    expect(result.status).toBe('verified');
    expect(result.evidence).toMatchObject({
      connectionState: 'connected',
      maskedAccount: '0x1111…1111',
      chainId: DEFAULT_SEPOLIA_CHAIN_ID,
      origin: 'http://127.0.0.1:5173'
    });
    expect(existsSync(join(artifactDir, 'fixture-connected.png'))).toBe(true);
    expect(verifyFixtureConnectionProofManifest(artifactDir).status).toBe('verified');

    const manifestText = readFileSync(join(artifactDir, 'FIXTURE-PROOF-MANIFEST.json'), 'utf8');
    expect(manifestText).not.toContain(ADDRESS);
    expect(manifestText).not.toContain('do-not-log');
    expect(manifestText).not.toContain(artifactDir);
  });

  it('fails closed before screenshot capture when the fixture connects the wrong account', async () => {
    const calls: string[] = [];
    const artifactDir = await tempArtifactDir();

    await expect(
      runFixtureConnectionProof({
        artifactDir,
        dapp: makeDapp(calls, OTHER_ADDRESS),
        prompt: makePrompt(calls),
        network: makeNetworkDriver(),
        origin: 'http://127.0.0.1:5173',
        expectedAccount: ADDRESS,
        expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
        captureScreenshot: async () => {
          calls.push('screenshot');
        }
      })
    ).rejects.toThrow(/connected account/i);

    expect(calls).toEqual([
      'dapp:requestConnect',
      'prompt:approveConnection:http://127.0.0.1:5173:0xaa36a7',
      'dapp:getConnectedAccount'
    ]);
    expect(existsSync(join(artifactDir, 'fixture-connected.png'))).toBe(false);
  });

  it('fails closed before dapp or prompt actions when the origin is outside the allowlist', async () => {
    const calls: string[] = [];

    await expect(
      runFixtureConnectionProof({
        artifactDir: await tempArtifactDir(),
        dapp: makeDapp(calls),
        prompt: makePrompt(calls),
        network: makeNetworkDriver(),
        origin: 'https://evil.example/connect?session=do-not-log',
        expectedAccount: ADDRESS,
        expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
        allowedOrigins: ['http://127.0.0.1:5173'],
        captureScreenshot: async () => {
          calls.push('screenshot');
        }
      })
    ).rejects.toThrow(/origin.*not allowed/i);

    expect(calls).toEqual([]);
  });

  it('fails closed before screenshot capture when wallet state is on the wrong chain', async () => {
    const calls: string[] = [];

    await expect(
      runFixtureConnectionProof({
        artifactDir: await tempArtifactDir(),
        dapp: makeDapp(calls),
        prompt: makePrompt(calls),
        network: makeNetworkDriver({ async getChainId() { return '0x1'; } }),
        origin: 'http://127.0.0.1:5173',
        expectedAccount: ADDRESS,
        expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
        captureScreenshot: async () => {
          calls.push('screenshot');
        }
      })
    ).rejects.toThrow(/not allowed|does not match/i);

    expect(calls).not.toContain('screenshot');
  });
});
