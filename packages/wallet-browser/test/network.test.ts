import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NETWORK_ASSERTION_TIMEOUT_MS,
  DEFAULT_SEPOLIA_CHAIN_ID,
  assertExpectedChainAndAccount,
  createMetaMaskNetworkPageDriver,
  createSepoliaNetworkPlan,
  isAllowedWalletChainId,
  normalizeChainId,
  normalizeExpectedAccount,
  provisionSepoliaNetwork,
  resolveSepoliaNetworkConfig,
  type MetaMaskNetworkDriver
} from '../src/index.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const RPC_WITH_TOKEN = 'https://sepolia.infura.io/v3/super-secret-token';

function makeDriver(overrides: Partial<MetaMaskNetworkDriver> = {}): MetaMaskNetworkDriver {
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

describe('Sepolia network config and normalization', () => {
  it('normalizes decimal and hex chain ids and rejects unsupported chain values', () => {
    expect(normalizeChainId('0xaa36a7')).toBe(DEFAULT_SEPOLIA_CHAIN_ID);
    expect(normalizeChainId('11155111')).toBe(DEFAULT_SEPOLIA_CHAIN_ID);
    expect(normalizeChainId(DEFAULT_SEPOLIA_CHAIN_ID)).toBe(DEFAULT_SEPOLIA_CHAIN_ID);
    expect(() => normalizeChainId('0xzz')).toThrow(/chain id/i);
    expect(() => normalizeChainId('1.5')).toThrow(/chain id/i);
  });

  it('fails closed on chain ids outside JavaScript safe-integer range', () => {
    expect(() => normalizeChainId(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/i);
    expect(() => normalizeChainId('9007199254740992')).toThrow(/safe integer/i);
    expect(() => normalizeChainId('0x20000000000000')).toThrow(/safe integer/i);
  });

  it('normalizes expected accounts and validates allowed Sepolia/local chain ids', () => {
    expect(normalizeExpectedAccount(ADDRESS.toUpperCase())).toBe(ADDRESS);
    expect(() => normalizeExpectedAccount('0x1234')).toThrow(/SEPOLIA_WALLET_ADDRESS/);
    expect(isAllowedWalletChainId(DEFAULT_SEPOLIA_CHAIN_ID)).toBe(true);
    expect(isAllowedWalletChainId(31337)).toBe(true);
    expect(isAllowedWalletChainId(1337)).toBe(true);
    expect(isAllowedWalletChainId(1)).toBe(false);
  });

  it('resolves optional Sepolia RPC and assertion settings from injected env without requiring RPC', () => {
    const config = resolveSepoliaNetworkConfig({
      env: {
        SEPOLIA_WALLET_ADDRESS: ADDRESS.toUpperCase(),
        SEPOLIA_CHAIN_ID: '0xaa36a7',
        METAMASK_NETWORK_ASSERTION_TIMEOUT_MS: '12345',
        METAMASK_NETWORK_DEBUG: 'yes'
      }
    });

    expect(config).toEqual({
      chainId: DEFAULT_SEPOLIA_CHAIN_ID,
      chainIdHex: '0xaa36a7',
      expectedAccount: ADDRESS,
      rpcUrl: undefined,
      timeoutMs: 12345,
      debug: true
    });
  });

  it('fails closed on non-Sepolia chain config and invalid optional RPC URL', () => {
    expect(() => resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS, chainId: '1' })).toThrow(/SEPOLIA_CHAIN_ID.*11155111/);
    expect(() => resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS, rpcUrl: 'not a url' })).toThrow(/SEPOLIA_RPC_URL/);
  });

  it('creates a public network plan without exposing raw RPC tokens', () => {
    const config = resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS, rpcUrl: RPC_WITH_TOKEN });
    const plan = createSepoliaNetworkPlan(config);
    const serialized = JSON.stringify(plan);

    expect(plan.status).toBe('pending');
    expect(plan.chainId).toBe(DEFAULT_SEPOLIA_CHAIN_ID);
    expect(plan.chainIdHex).toBe('0xaa36a7');
    expect(plan.expectedAccount).toBe(ADDRESS);
    expect(plan.rpcUrlConfigured).toBe(true);
    expect(plan.rpcUrl).toBe('https://sepolia.infura.io/[redacted-url]');
    expect(serialized).not.toContain('super-secret-token');
  });
});

describe('Sepolia network assertions and mockable MetaMask driver', () => {
  it('asserts expected chain and account through a driver', async () => {
    const config = resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS });

    await expect(assertExpectedChainAndAccount(config, makeDriver())).resolves.toEqual({
      status: 'verified',
      chainId: DEFAULT_SEPOLIA_CHAIN_ID,
      chainIdHex: '0xaa36a7',
      expectedAccount: ADDRESS,
      activeAccount: ADDRESS
    });
  });

  it('fails closed on wrong chain or wrong account', async () => {
    const config = resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS });

    await expect(assertExpectedChainAndAccount(config, makeDriver({ async getChainId() { return '0x1'; } }))).rejects.toThrow(/not allowed/);
    await expect(assertExpectedChainAndAccount(config, makeDriver({ async getChainId() { return '0x7a69'; } }))).rejects.toThrow(/does not match expected Sepolia chain/);
    await expect(assertExpectedChainAndAccount(config, makeDriver({ async getAccounts() { return ['0x2222222222222222222222222222222222222222']; } }))).rejects.toThrow(/does not match expected/);
  });

  it('switches to Sepolia, adds Sepolia only when RPC is configured, and never leaks the RPC token in errors', async () => {
    const calls: string[] = [];
    const config = resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS, rpcUrl: RPC_WITH_TOKEN });
    const driver = makeDriver({
      async getChainId() {
        return calls.includes('switched') ? DEFAULT_SEPOLIA_CHAIN_ID : 31337;
      },
      async switchChain(chainIdHex) {
        calls.push(`switch:${chainIdHex}`);
        if (!calls.includes(`add:${chainIdHex}:${RPC_WITH_TOKEN}`)) {
          throw new Error(`unknown chain for ${RPC_WITH_TOKEN}`);
        }
        calls.push('switched');
      },
      async addEthereumChain(input) {
        calls.push(`add:${input.chainId}:${input.rpcUrls[0]}`);
      }
    });

    await expect(provisionSepoliaNetwork(config, driver)).resolves.toMatchObject({ status: 'verified', chainId: DEFAULT_SEPOLIA_CHAIN_ID });
    expect(calls).toEqual([`switch:0xaa36a7`, `add:0xaa36a7:${RPC_WITH_TOKEN}`, `switch:0xaa36a7`, 'switched']);

    const missingRpc = resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS });
    await expect(
      provisionSepoliaNetwork(missingRpc, makeDriver({
        async getChainId() { return 31337; },
        async switchChain() { throw new Error(`unknown chain for ${RPC_WITH_TOKEN}`); }
      }))
    ).rejects.toThrow(/SEPOLIA_RPC_URL is required/);

    try {
      await provisionSepoliaNetwork(missingRpc, makeDriver({
        async getChainId() { return 31337; },
        async switchChain() { throw new Error(`unknown chain for ${RPC_WITH_TOKEN}`); }
      }));
      throw new Error('expected provisioning to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('super-secret-token');
      expect(message).not.toContain(RPC_WITH_TOKEN);
    }
  });

  it('uses default assertion timeout and debug flags when omitted', () => {
    const config = resolveSepoliaNetworkConfig({ expectedAccount: ADDRESS });

    expect(config.timeoutMs).toBe(DEFAULT_NETWORK_ASSERTION_TIMEOUT_MS);
    expect(config.debug).toBe(false);
  });
});

describe('MetaMask EIP-1193 page network driver', () => {
  it('bridges network reads and Sepolia switch/add requests through window.ethereum.request', async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const page = {
      async evaluate(fn: (request: { method: string; params?: unknown[] }) => unknown, request: { method: string; params?: unknown[] }) {
        calls.push(request);
        if (request.method === 'eth_chainId') {
          return '0xaa36a7';
        }
        if (request.method === 'eth_accounts') {
          return [ADDRESS];
        }
        return undefined;
      }
    };
    const driver = createMetaMaskNetworkPageDriver({ page: page as never });

    await expect(driver.getChainId()).resolves.toBe('0xaa36a7');
    await expect(driver.getAccounts()).resolves.toEqual([ADDRESS]);
    await expect(driver.switchChain('0xaa36a7')).resolves.toBeUndefined();
    await expect(driver.addEthereumChain({
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      rpcUrls: [RPC_WITH_TOKEN],
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      blockExplorerUrls: ['https://sepolia.etherscan.io']
    })).resolves.toBeUndefined();

    expect(calls).toEqual([
      { method: 'eth_chainId' },
      { method: 'eth_accounts' },
      { method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] },
      {
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0xaa36a7',
          chainName: 'Sepolia',
          rpcUrls: [RPC_WITH_TOKEN],
          nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
          blockExplorerUrls: ['https://sepolia.etherscan.io']
        }]
      }
    ]);
  });

  it('fails closed when a page-backed Ethereum request exceeds the configured timeout', async () => {
    const page = {
      async evaluate() {
        return new Promise(() => undefined);
      }
    };
    const driver = createMetaMaskNetworkPageDriver({ page: page as never, timeoutMs: 1 });
    const result = await Promise.race([
      driver.getChainId().then(
        () => 'resolved unexpectedly',
        (error) => (error instanceof Error ? error.message : String(error))
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 25))
    ]);

    expect(result).toMatch(/eth_chainId.*timed out after 1ms/);
  });
});
