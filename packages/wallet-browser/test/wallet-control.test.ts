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
      guardrails: { allowedOrigins: ['https://fixture.example/connect/path'] },
      logger: (event) => events.push(event),
      metadata: { rpcUrl: RPC_WITH_CREDENTIAL }
    });

    const serialized = JSON.stringify(events);
    expect(events[0].origin).toBe('https://fixture.example/connect/path');
    expect(serialized).not.toContain('sensitive-session');
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).toContain('https://sepolia.infura.io/[redacted-url]');
  });

  it('fails closed on connect from an origin outside the configured allowlist before dapp or prompt actions', async () => {
    const calls: string[] = [];
    const events: WalletControlLogEvent[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() { calls.push('dapp:connect'); },
      async getConnectedAccount() { return ADDRESS; }
    };
    const prompt: WalletPromptDriver = { async approveConnection() { calls.push('prompt:connect'); } };

    await expect(connectWallet({
      dapp,
      prompt,
      network: makeNetworkDriver(),
      expectedAccount: ADDRESS,
      expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
      origin: 'https://evil.example/connect?session=sensitive-session',
      guardrails: { allowedOrigins: ['https://fixture.example/connect'] },
      logger: (event) => events.push(event)
    })).rejects.toThrow(/dapp origin.*not allowed/i);

    expect(calls).toEqual([]);
    expect(events.map((event) => event.decision)).toEqual(['pending', 'rejected']);
    expect(events[1]).toMatchObject({ status: 'failed', origin: 'https://evil.example/connect', decision: 'rejected' });
    expect(JSON.stringify(events)).not.toContain('sensitive-session');
  });

  it('fails closed and logs sanitized connect failures when dapp account state is unexpected', async () => {
    const events: WalletControlLogEvent[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() {},
      async getConnectedAccount() {
        return OTHER_ADDRESS;
      }
    };
    const prompt: WalletPromptDriver = { async approveConnection() {} };

    await expect(
      connectWallet({
        dapp,
        prompt,
        network: makeNetworkDriver(),
        expectedAccount: ADDRESS,
        expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
        origin: 'https://fixture.example/connect?session=sensitive-session',
        logger: (event) => events.push(event),
        metadata: { rpcUrl: RPC_WITH_CREDENTIAL }
      })
    ).rejects.toThrow(/connected account/i);
    await expect(assertWalletState({ network: makeNetworkDriver({ async getChainId() { return '0x1'; } }), expectedAccount: ADDRESS, expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID })).rejects.toThrow(/not allowed|does not match/i);

    expect(events.map((event) => event.status)).toEqual(['started', 'prompt-approved', 'failed']);
    expect(events[2]).toMatchObject({
      action: 'connectWallet',
      status: 'failed',
      origin: 'https://fixture.example/connect',
      promptType: 'connect',
      account: ADDRESS
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('sensitive-session');
    expect(serialized).not.toContain(RPC_SENSITIVE_SEGMENT);
    expect(serialized).toContain('https://sepolia.infura.io/[redacted-url]');
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

  it('logs sanitized rejected network guardrail decisions when chain or account assertions fail', async () => {
    const events: WalletControlLogEvent[] = [];
    const privateKeyLike = `0x${'e'.repeat(64)}`;

    await expect(assertWalletState({
      network: makeNetworkDriver({ async getChainId() { return '0x1'; } }),
      expectedAccount: ADDRESS,
      expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
      logger: (event) => events.push(event),
      metadata: { driverError: `network assertion leaked ${privateKeyLike} and ${RPC_WITH_CREDENTIAL}` }
    })).rejects.toThrow(/not allowed|does not match/i);

    expect(events.map((event) => event.status)).toEqual(['started', 'failed']);
    expect(events.map((event) => event.decision)).toEqual(['pending', 'rejected']);
    expect(events[1]).toMatchObject({
      action: 'assertWalletState',
      status: 'failed',
      chainId: DEFAULT_SEPOLIA_CHAIN_ID,
      chainIdHex: '0xaa36a7',
      account: ADDRESS,
      decision: 'rejected'
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('e'.repeat(64));
    expect(serialized).not.toContain(RPC_SENSITIVE_SEGMENT);
    expect(serialized).toContain('[redacted:private-key]');
    expect(serialized).toContain('https://sepolia.infura.io/[redacted-url]');
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

  it('redacts private keys, passwords, seed-like text, RPC-token URLs, and env-style content from structured audit events', async () => {
    const events: WalletControlLogEvent[] = [];
    const privateKeyLike = `0x${'d'.repeat(64)}`;
    const passwordLike = ['correct', 'horse', 'wallet'].join('-');
    const seedLike = Array.from({ length: 12 }, (_, index) => `seedword${index}`).join(' ');
    const envText = [
      `SEPOLIA_WALLET_PRIVATE_KEY=${privateKeyLike}`,
      `METAMASK_PASSWORD=${passwordLike}`,
      `SEED_PHRASE=${seedLike}`,
      `SEPOLIA_RPC_URL=${RPC_WITH_CREDENTIAL}`
    ].join('\n');
    const prompt: WalletPromptDriver = {
      async approveSignature() {
        throw new Error(`driver leaked ${envText}`);
      }
    };

    await expect(approveSignature({
      prompt,
      origin: 'https://fixture.example/sign?session=sensitive-session',
      expectedAccount: ADDRESS,
      message: 'hello',
      logger: (event) => events.push(event),
      metadata: {
        driverError: envText,
        nested: { walletPassword: passwordLike, mnemonic: seedLike, rpcUrl: RPC_WITH_CREDENTIAL }
      }
    })).rejects.toThrow(/driver leaked/);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(privateKeyLike);
    expect(serialized).not.toContain(passwordLike);
    expect(serialized).not.toContain(seedLike);
    expect(serialized).not.toContain(RPC_SENSITIVE_SEGMENT);
    expect(serialized).not.toContain('SEPOLIA_WALLET_PRIVATE_KEY=');
    expect(serialized).not.toContain('METAMASK_PASSWORD=');
    expect(serialized).not.toContain('SEED_PHRASE=');
    expect(serialized).toContain('[redacted:private-key]');
    expect(serialized).toContain('[redacted:password]');
    expect(serialized).toContain('[redacted:seed-phrase]');
    expect(serialized).toContain('https://sepolia.infura.io/[redacted-url]');
  });

  it('logs sanitized failed prompt decisions without leaking lower-level driver errors', async () => {
    const events: WalletControlLogEvent[] = [];
    const privateKeyLike = `0x${'c'.repeat(64)}`;
    const prompt: WalletPromptDriver = {
      async approveSignature() {
        throw new Error(`Prompt rejected after seeing ${privateKeyLike} and ${RPC_WITH_CREDENTIAL}`);
      }
    };

    await expect(
      approveSignature({
        prompt,
        origin: 'https://fixture.example/sign?session=sensitive-session',
        expectedAccount: ADDRESS,
        message: 'hello',
        logger: (event) => events.push(event),
        metadata: { rpcUrl: RPC_WITH_CREDENTIAL }
      })
    ).rejects.toThrow(/Prompt rejected/);

    expect(events.map((event) => event.status)).toEqual(['started', 'failed']);
    expect(events[1]).toMatchObject({
      action: 'approveSignature',
      status: 'failed',
      origin: 'https://fixture.example/sign',
      promptType: 'signature',
      account: ADDRESS
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('sensitive-session');
    expect(serialized).not.toContain('c'.repeat(64));
    expect(serialized).not.toContain(RPC_SENSITIVE_SEGMENT);
    expect(serialized).toContain('[redacted:private-key]');
    expect(serialized).toContain('https://sepolia.infura.io/[redacted-url]');
  });

  it('sequences dapp signature and transaction requests before explicit prompt driver approvals', async () => {
    const calls: string[] = [];
    const events: WalletControlLogEvent[] = [];
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
    await approveTransaction({ dapp, prompt, origin: 'https://fixture.example', expectedAccount: ADDRESS, to: ADDRESS, value: '0x0', logger: (event) => events.push(event) });

    expect(calls).toEqual([
      'dapp:signature:hello',
      `prompt:signature:https://fixture.example:${ADDRESS}:hello`,
      `dapp:transaction:${ADDRESS}:0x0`,
      `prompt:transaction:https://fixture.example:${ADDRESS}:0x0`
    ]);
    expect(events.map((event) => event.decision)).toEqual(['pending', 'approved']);
    expect(events[0]).toMatchObject({ target: ADDRESS, valueWei: '0' });
  });

  it('fails closed on unsafe transaction chain before dapp or prompt approval', async () => {
    const calls: string[] = [];
    const events: WalletControlLogEvent[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() {},
      async getConnectedAccount() { return ADDRESS; },
      async requestTransaction() { calls.push('dapp:transaction'); }
    };
    const prompt: WalletPromptDriver = { async approveTransaction() { calls.push('prompt:transaction'); } };

    await expect(approveTransaction({
      dapp,
      prompt,
      network: makeNetworkDriver({ async getChainId() { return '0x1'; } }),
      expectedChainId: DEFAULT_SEPOLIA_CHAIN_ID,
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      to: ADDRESS,
      value: '0x0',
      logger: (event) => events.push(event)
    })).rejects.toThrow(/not allowed|does not match/i);

    expect(calls).toEqual([]);
    expect(events.map((event) => event.decision)).toEqual(['pending', 'rejected']);
    expect(events[0]).toMatchObject({ chainId: DEFAULT_SEPOLIA_CHAIN_ID, chainIdHex: '0xaa36a7', account: ADDRESS, target: ADDRESS, valueWei: '0' });
    expect(events[1]).toMatchObject({ status: 'failed', promptType: 'transaction', chainId: DEFAULT_SEPOLIA_CHAIN_ID, chainIdHex: '0xaa36a7', account: ADDRESS, target: ADDRESS, valueWei: '0', decision: 'rejected' });
  });

  it('fails closed on transaction value above the configured guardrail cap before dapp or prompt approval', async () => {
    const calls: string[] = [];
    const events: WalletControlLogEvent[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() {},
      async getConnectedAccount() { return ADDRESS; },
      async requestTransaction() {
        calls.push('dapp:transaction');
      }
    };
    const prompt: WalletPromptDriver = {
      async approveTransaction() {
        calls.push('prompt:transaction');
      }
    };

    await expect(
      approveTransaction({
        dapp,
        prompt,
        origin: 'https://fixture.example',
        expectedAccount: ADDRESS,
        to: ADDRESS,
        value: '0x1',
        guardrails: { maxTransactionValueWei: '0' },
        logger: (event) => events.push(event)
      })
    ).rejects.toThrow(/exceeds configured wallet transaction value cap/i);

    expect(calls).toEqual([]);
    expect(events.map((event) => event.decision)).toEqual(['pending', 'rejected']);
    expect(events[1]).toMatchObject({
      status: 'failed',
      promptType: 'transaction',
      target: ADDRESS,
      valueWei: '1',
      decision: 'rejected'
    });
  });

  it('fails closed on transaction target outside the configured allowlist before dapp or prompt approval', async () => {
    const calls: string[] = [];
    const events: WalletControlLogEvent[] = [];
    const dapp: WalletDappDriver = {
      async requestConnect() {},
      async getConnectedAccount() { return ADDRESS; },
      async requestTransaction() { calls.push('dapp:transaction'); }
    };
    const prompt: WalletPromptDriver = { async approveTransaction() { calls.push('prompt:transaction'); } };

    await expect(approveTransaction({
      dapp,
      prompt,
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      to: OTHER_ADDRESS,
      value: '0x0',
      guardrails: { allowedTargets: [ADDRESS] },
      logger: (event) => events.push(event)
    })).rejects.toThrow(/transaction target.*not allowed/i);

    expect(calls).toEqual([]);
    expect(events.map((event) => event.decision)).toEqual(['pending', 'rejected']);
    expect(events[1]).toMatchObject({ status: 'failed', target: OTHER_ADDRESS, valueWei: '0', decision: 'rejected' });
  });

  it('allows a low non-zero Sepolia fixture value only when explicitly capped above zero', async () => {
    const calls: string[] = [];
    const prompt: WalletPromptDriver = {
      async approveTransaction(input) {
        calls.push(`prompt:${input.to}:${input.value}`);
      }
    };

    await approveTransaction({
      prompt,
      origin: 'https://fixture.example',
      expectedAccount: ADDRESS,
      to: ADDRESS,
      value: '2',
      guardrails: { maxTransactionValueWei: '2' }
    });

    expect(calls).toEqual([`prompt:${ADDRESS}:2`]);
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
