import type { Page } from 'playwright';

import type { WalletBrowserEnv } from './config.js';
import { validateEthereumAddress } from './onboarding.js';

export const DEFAULT_SEPOLIA_CHAIN_ID = 11_155_111;
export const DEFAULT_NETWORK_ASSERTION_TIMEOUT_MS = 30_000;
export const DEFAULT_ALLOWED_WALLET_CHAIN_IDS = [DEFAULT_SEPOLIA_CHAIN_ID, 31_337, 1_337] as const;

export interface SepoliaNetworkEnv extends WalletBrowserEnv {
  SEPOLIA_CHAIN_ID?: string;
  SEPOLIA_RPC_URL?: string;
  SEPOLIA_WALLET_ADDRESS?: string;
  METAMASK_NETWORK_ASSERTION_TIMEOUT_MS?: string;
  METAMASK_NETWORK_DEBUG?: string;
}

export interface ResolveSepoliaNetworkConfigOptions {
  env?: SepoliaNetworkEnv;
  chainId?: string | number;
  rpcUrl?: string;
  expectedAccount?: string;
  timeoutMs?: number;
  debug?: boolean;
}

export interface SepoliaNetworkConfig {
  chainId: number;
  chainIdHex: string;
  expectedAccount: string;
  rpcUrl?: string;
  timeoutMs: number;
  debug: boolean;
}

export interface RedactedSepoliaNetworkPlan {
  status: 'pending';
  chainId: number;
  chainIdHex: string;
  expectedAccount: string;
  rpcUrlConfigured: boolean;
  rpcUrl?: string;
  timeoutMs: number;
  debug: boolean;
}

export interface SepoliaNetworkAssertionResult {
  status: 'verified';
  chainId: number;
  chainIdHex: string;
  expectedAccount: string;
  activeAccount: string;
}

export interface AddEthereumChainInput {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrls: string[];
}

export interface MetaMaskNetworkDriver {
  getChainId(): Promise<string | number>;
  getAccounts(): Promise<string[]>;
  switchChain(chainIdHex: string): Promise<void>;
  addEthereumChain(input: AddEthereumChainInput): Promise<void>;
}

export interface MetaMaskNetworkPageDriverOptions {
  page: Page;
  timeoutMs?: number;
}

export function normalizeChainId(value: string | number | undefined): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('Chain id must be a positive integer.');
    }
    return validateSafeChainId(value);
  }

  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error('Chain id is required.');
  }

  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    return validateSafeChainId(Number.parseInt(trimmed, 16));
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return validateSafeChainId(Number.parseInt(trimmed, 10));
  }

  throw new Error('Chain id must be a decimal integer or 0x-prefixed hexadecimal value.');
}

export function chainIdToHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function validateSafeChainId(chainId: number): number {
  if (!Number.isSafeInteger(chainId)) {
    throw new Error('Chain id must be within JavaScript safe integer range.');
  }
  return chainId;
}

export function normalizeExpectedAccount(value: string | undefined): string {
  return validateEthereumAddress(value);
}

export function isAllowedWalletChainId(value: string | number): boolean {
  const chainId = normalizeChainId(value);
  return DEFAULT_ALLOWED_WALLET_CHAIN_IDS.includes(chainId as (typeof DEFAULT_ALLOWED_WALLET_CHAIN_IDS)[number]);
}

export function resolveSepoliaNetworkConfig(options: ResolveSepoliaNetworkConfigOptions = {}): SepoliaNetworkConfig {
  const env = options.env ?? process.env;
  const chainId = normalizeChainId(options.chainId ?? env.SEPOLIA_CHAIN_ID ?? DEFAULT_SEPOLIA_CHAIN_ID);
  if (chainId !== DEFAULT_SEPOLIA_CHAIN_ID) {
    throw new Error(`SEPOLIA_CHAIN_ID must be ${DEFAULT_SEPOLIA_CHAIN_ID} for Sepolia provisioning.`);
  }

  return {
    chainId,
    chainIdHex: chainIdToHex(chainId),
    expectedAccount: normalizeExpectedAccount(options.expectedAccount ?? env.SEPOLIA_WALLET_ADDRESS),
    rpcUrl: validateOptionalRpcUrl(options.rpcUrl ?? env.SEPOLIA_RPC_URL),
    timeoutMs: resolveNetworkTimeoutMs(options.timeoutMs, env.METAMASK_NETWORK_ASSERTION_TIMEOUT_MS),
    debug: options.debug ?? parseBoolean(env.METAMASK_NETWORK_DEBUG)
  };
}

export function validateOptionalRpcUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('SEPOLIA_RPC_URL must be a valid http(s) URL when provided.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('SEPOLIA_RPC_URL must use http or https when provided.');
  }

  return trimmed;
}

export function createSepoliaNetworkPlan(config: SepoliaNetworkConfig): RedactedSepoliaNetworkPlan {
  return {
    status: 'pending',
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
    expectedAccount: config.expectedAccount,
    rpcUrlConfigured: config.rpcUrl !== undefined,
    rpcUrl: config.rpcUrl ? redactRpcUrl(config.rpcUrl) : undefined,
    timeoutMs: config.timeoutMs,
    debug: config.debug
  };
}

export async function assertExpectedChainAndAccount(
  config: SepoliaNetworkConfig,
  driver: MetaMaskNetworkDriver
): Promise<SepoliaNetworkAssertionResult> {
  const activeChainId = await runRedactedNetworkStep(config, 'read active wallet chain', () => driver.getChainId());
  const normalizedChainId = normalizeChainId(activeChainId);
  if (!isAllowedWalletChainId(normalizedChainId)) {
    throw new Error(`Wallet chain ${chainIdToHex(normalizedChainId)} is not allowed for this harness.`);
  }

  if (normalizedChainId !== config.chainId) {
    throw new Error(
      `Wallet chain ${chainIdToHex(normalizedChainId)} does not match expected Sepolia chain ${config.chainIdHex}.`
    );
  }

  const accounts = await runRedactedNetworkStep(config, 'read active wallet accounts', () => driver.getAccounts());
  const activeAccount = normalizeExpectedAccount(accounts[0]);
  if (activeAccount !== config.expectedAccount) {
    throw new Error(`Wallet active account ${activeAccount} does not match expected ${config.expectedAccount}.`);
  }

  return {
    status: 'verified',
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
    expectedAccount: config.expectedAccount,
    activeAccount
  };
}

export async function provisionSepoliaNetwork(
  config: SepoliaNetworkConfig,
  driver: MetaMaskNetworkDriver
): Promise<SepoliaNetworkAssertionResult> {
  const activeChainId = normalizeChainId(
    await runRedactedNetworkStep(config, 'read active wallet chain', () => driver.getChainId())
  );

  if (!isAllowedWalletChainId(activeChainId)) {
    throw new Error(`Wallet chain ${chainIdToHex(activeChainId)} is not allowed for this harness.`);
  }

  if (activeChainId !== config.chainId) {
    try {
      await runRedactedNetworkStep(config, 'switch MetaMask to Sepolia', () => driver.switchChain(config.chainIdHex));
    } catch (error) {
      if (!config.rpcUrl) {
        throw new Error(
          `SEPOLIA_RPC_URL is required to add Sepolia after MetaMask switch failed: ${redactNetworkErrorMessage(config, error)}`
        );
      }

      await runRedactedNetworkStep(config, 'add Sepolia to MetaMask', () => driver.addEthereumChain(createSepoliaAddChainInput(config)));
      await runRedactedNetworkStep(config, 'switch MetaMask to Sepolia after adding network', () => driver.switchChain(config.chainIdHex));
    }
  }

  return assertExpectedChainAndAccount(config, driver);
}

export function createSepoliaAddChainInput(config: SepoliaNetworkConfig): AddEthereumChainInput {
  if (!config.rpcUrl) {
    throw new Error('SEPOLIA_RPC_URL is required to add Sepolia to MetaMask.');
  }

  return {
    chainId: config.chainIdHex,
    chainName: 'Sepolia',
    rpcUrls: [config.rpcUrl],
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorerUrls: ['https://sepolia.etherscan.io']
  };
}

interface EthereumRequestInput {
  method: string;
  params?: unknown[];
}

interface Eip1193Provider {
  request(input: EthereumRequestInput): Promise<unknown>;
}

export function createMetaMaskNetworkPageDriver(options: MetaMaskNetworkPageDriverOptions): MetaMaskNetworkDriver {
  const timeoutMs = resolvePageDriverTimeoutMs(options.timeoutMs);
  return {
    async getChainId() {
      const result = await requestEthereum(options.page, { method: 'eth_chainId' }, timeoutMs);
      if (typeof result !== 'string' && typeof result !== 'number') {
        throw new Error('MetaMask returned an invalid eth_chainId response.');
      }
      return result;
    },
    async getAccounts() {
      const result = await requestEthereum(options.page, { method: 'eth_accounts' }, timeoutMs);
      if (!Array.isArray(result) || !result.every((value) => typeof value === 'string')) {
        throw new Error('MetaMask returned an invalid eth_accounts response.');
      }
      return result;
    },
    async switchChain(chainIdHex) {
      await requestEthereum(options.page, { method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] }, timeoutMs);
    },
    async addEthereumChain(input) {
      await requestEthereum(options.page, { method: 'wallet_addEthereumChain', params: [input] }, timeoutMs);
    }
  };
}

async function requestEthereum(page: Page, request: EthereumRequestInput, timeoutMs: number): Promise<unknown> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page.evaluate(async (input) => {
        const maybeProvider = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
        if (!maybeProvider?.request) {
          throw new Error('window.ethereum.request is not available on the selected MetaMask page.');
        }
        return maybeProvider.request(input);
      }, request),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`MetaMask EIP-1193 request ${request.method} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function resolvePageDriverTimeoutMs(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? DEFAULT_NETWORK_ASSERTION_TIMEOUT_MS;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error('MetaMask page network driver timeoutMs must be a positive integer.');
  }
  return resolved;
}

function resolveNetworkTimeoutMs(explicit: number | undefined, envValue: string | undefined): number {
  const raw = explicit ?? (envValue ? Number(envValue) : DEFAULT_NETWORK_ASSERTION_TIMEOUT_MS);
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error('METAMASK_NETWORK_ASSERTION_TIMEOUT_MS must be a positive integer.');
  }

  return raw;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

async function runRedactedNetworkStep<T>(config: SepoliaNetworkConfig, label: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw new Error(`${label} failed: ${redactNetworkErrorMessage(config, error)}`);
  }
}

function redactNetworkErrorMessage(config: SepoliaNetworkConfig, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutConfiguredRpc = config.rpcUrl ? raw.split(config.rpcUrl).join(redactRpcUrl(config.rpcUrl)) : raw;
  return withoutConfiguredRpc.replace(/https?:\/\/[^\s)]+/gi, (match) => redactRpcUrl(match));
}

export function redactRpcUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}/[redacted-url]`;
  } catch {
    return '[redacted-rpc-url]';
  }
}
