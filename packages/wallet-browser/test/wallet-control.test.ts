import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEPOLIA_CHAIN_ID,
  approveSignature,
  approveTransaction,
  assertWalletState,
  connectWallet,
  createWalletDappPageDriver,
  resetProfile,
  switchNetwork,
  type MetaMaskNetworkDriver,
  type WalletControlLogEvent,
  type WalletDappDriver,
  type WalletPromptDriver
} from '../src/index.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';
const RPC_SENSITIVE_SEGMENT = ['super', 'sensitive', 'value'].join('-');
const RPC_WITH_CREDENTIAL = `https://sepolia.infura.io/v3/${RPC_SENSITIVE_SEGMENT}`;

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

describe('wallet-control helpers', () => {
  it('sequences connect prompt approval, wallet state assertion, and redacted structured logs', async () => {
    const calls: string[] = [];
    const events: WalletControlLogEvent[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() {
        calls.push('dapp:requestConnect');
      },
      async getConnectedAccount() {
        calls.push('dapp:getConnectedAccount');
        return ADDRESS;
      }
    };
    const prompt: WalletPromptDriver = {
      async approveConnection(input) {
        calls.push(`prompt:approveConnection:${input.origin}`);
      }
    };

    const result = await connectWallet({
      dapp,
      prompt,
      network: makeNetworkDriver(),
      expectedAccount: ADDRESS,
      expectedChainId: '0xaa36a7',
      origin: 'https://fixture.example',
      logger: (event) => events.push(event),
      metadata: {
        privateKey: `0x${'a'.repeat(64)}`,
        rpcUrl: RPC_WITH_CREDENTIAL
      }
    });

    expect(result).toEqual({ status: 'connected', chainId: DEFAULT_SEPOLIA_CHAIN_ID, chainIdHex: '0xaa36a7', expectedAccount: ADDRESS, activeAccount: ADDRESS });
    expect(calls).toEqual([
      'dapp:requestConnect',
      'prompt:approveConnection:https://fixture.example',
      'dapp:getConnectedAccount'
    ]);
    expect(events.map((event) => event.action)).toEqual(['connectWallet', 'connectWallet', 'connectWallet']);
    expect(events.map((event) => event.status)).toEqual(['started', 'prompt-approved', 'verified']);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(serialized).toContain('[redacted:private-key]');
    expect(serialized).toContain('https://sepolia.infura.io/[redacted-url]');
  });

  it('preserves safe dapp origin context in logs while removing sensitive URL query data', async () => {
    const events: WalletControlLogEvent[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() {},
      async getConnectedAccount() {
        return ADDRESS;
      }
    };
    const prompt: WalletPromptDriver = { async approveConnection() {} };

    await connectWallet({
      dapp,
      prompt,
      network: makeNetworkDriver(),
      expectedAccount: ADDRESS,
      expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
      origin: 'https://fixture.example/connect/path?session=sensitive-session#fragment',
      logger: (event) => events.push(event),
      metadata: { rpcUrl: RPC_WITH_CREDENTIAL }
    });

    const serialized = JSON.stringify(events);
    expect(events[0].origin).toBe('https://fixture.example/connect/path');
    expect(serialized).not.toContain('sensitive-session');
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).toContain('https://sepolia.infura.io/[redacted-url]');
  });

  it('fails closed when connected dapp account or active wallet state is unexpected', async () => {
    const dapp: WalletDappDriver = {
      async requestConnect() {},
      async getConnectedAccount() {
        return OTHER_ADDRESS;
      }
    };
    const prompt: WalletPromptDriver = { async approveConnection() {} };

    await expect(connectWallet({ dapp, prompt, network: makeNetworkDriver(), expectedAccount: ADDRESS, expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID })).rejects.toThrow(/connected account/i);
    await expect(assertWalletState({ network: makeNetworkDriver({ async getChainId() { return '0x1'; } }), expectedAccount: ADDRESS, expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID })).rejects.toThrow(/not allowed|does not match/i);
  });

  it('switches network through the existing Sepolia provisioning driver', async () => {
    const calls: string[] = [];
    const network = makeNetworkDriver({
      async getChainId() {
        return calls.includes('switched') ? DEFAULT_SEPOLIA_CHAIN_ID : 31337;
      },
      async switchChain(chainIdHex) {
        calls.push(`switch:${chainIdHex}`);
        calls.push('switched');
      }
    });

    await expect(switchNetwork({ network, expectedAccount: ADDRESS, expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID })).resolves.toMatchObject({ status: 'verified' });
    expect(calls).toEqual(['switch:0xaa36a7', 'switched']);
  });

  it('fails closed for signature and transaction prompts until prompt driver approval is explicitly implemented', async () => {
    await expect(approveSignature({ prompt: {}, origin: 'https://fixture.example', expectedAccount: ADDRESS, message: 'hello' })).rejects.toThrow(/not implemented|fail closed/i);
    await expect(approveTransaction({ prompt: {}, origin: 'https://fixture.example', expectedAccount: ADDRESS, to: ADDRESS, value: '0x0' })).rejects.toThrow(/not implemented|fail closed/i);
  });

  it('creates a page-backed dapp driver from stable selectors', async () => {
    const calls: string[] = [];
    const texts = new Map([['[data-testid="connected-account"]', ADDRESS]]);
    const page = {
      locator(selector: string) {
        return {
          async click() {
            calls.push(`click:${selector}`);
          },
          async textContent() {
            calls.push(`text:${selector}`);
            return texts.get(selector) ?? null;
          }
        };
      }
    };

    const dapp = createWalletDappPageDriver({
      page,
      selectors: {
        connectButton: '[data-testid="connect-wallet-button"]',
        connectedAccount: '[data-testid="connected-account"]',
        signMessageButton: '[data-testid="sign-message-button"]',
        sendTransactionButton: '[data-testid="send-transaction-button"]'
      }
    });

    await dapp.requestConnect();
    await expect(dapp.getConnectedAccount()).resolves.toBe(ADDRESS);
    await dapp.requestSignature?.({ expectedAccount: ADDRESS, message: 'hello' });
    await dapp.requestTransaction?.({ expectedAccount: ADDRESS, to: ADDRESS, value: '0x0' });

    expect(calls).toEqual([
      'click:[data-testid="connect-wallet-button"]',
      'text:[data-testid="connected-account"]',
      'click:[data-testid="sign-message-button"]',
      'click:[data-testid="send-transaction-button"]'
    ]);
  });

  it('sequences dapp signature and transaction requests before explicit prompt driver approvals', async () => {
    const calls: string[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() {},
      async getConnectedAccount() { return ADDRESS; },
      async requestSignature(input) {
        calls.push(`dapp:signature:${input.message}`);
      },
      async requestTransaction(input) {
        calls.push(`dapp:transaction:${input.to}:${input.value}`);
      }
    };
    const prompt: WalletPromptDriver = {
      async approveSignature(input) {
        calls.push(`prompt:signature:${input.origin}:${input.expectedAccount}:${input.message}`);
      },
      async approveTransaction(input) {
        calls.push(`prompt:transaction:${input.origin}:${input.to}:${input.value}`);
      }
    };

    await approveSignature({ dapp, prompt, origin: 'https://fixture.example', expectedAccount: ADDRESS, message: 'hello' });
    await approveTransaction({ dapp, prompt, origin: 'https://fixture.example', expectedAccount: ADDRESS, to: ADDRESS, value: '0x0' });

    expect(calls).toEqual([
      'dapp:signature:hello',
      `prompt:signature:https://fixture.example:${ADDRESS}:hello`,
      `dapp:transaction:${ADDRESS}:0x0`,
      `prompt:transaction:https://fixture.example:${ADDRESS}:0x0`
    ]);
  });
});

describe('resetProfile', () => {
  it('removes only profile directories under the configured wallet profile root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abw-profiles-'));
    const profileDir = join(root, 'profile-a');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'state.txt'), 'sensitive profile state');

    const result = await resetProfile({ profileDir, allowedProfileRoot: root });

    expect(result).toEqual({ status: 'deleted', profileDir: resolve(profileDir), allowedProfileRoot: resolve(root) });
    expect(existsSync(profileDir)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  it('fails closed instead of deleting outside the allowed wallet profile root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abw-profiles-'));
    const outside = mkdtempSync(join(tmpdir(), 'abw-outside-'));
    await writeFile(join(outside, 'keep.txt'), 'must remain');

    await expect(resetProfile({ profileDir: outside, allowedProfileRoot: root })).rejects.toThrow(/outside allowed wallet profile root/i);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
});
