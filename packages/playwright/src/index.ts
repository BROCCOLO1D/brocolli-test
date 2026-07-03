import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile, copyFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { defineConfig, expect, test as base, type BrowserContext, type Page, type PlaywrightTestConfig, type TestInfo } from '@playwright/test';
import {
  approveSignature,
  approveTransaction,
  assertWalletState,
  connectWallet,
  createWalletDappPageDriver,
  launchWalletBrowser,
  maskEthereumAddress,
  switchNetwork,
  type ConnectWalletResult,
  type MetaMaskNetworkDriver,
  type SepoliaNetworkAssertionResult,
  type WalletBrowserConfig,
  type WalletBrowserLaunchResult,
  type WalletDappDriver,
  type WalletDappPageDriverSelectors,
  type WalletGuardrailConfig,
  type WalletPromptDriver,
  type WalletSignatureKind,
  type WalletSignaturePromptInput
} from '@broccolo1d/wallet-browser';

export { expect };
export type { BrowserContext, Page } from '@playwright/test';
export type {
  ConnectWalletResult,
  MetaMaskNetworkDriver,
  SepoliaNetworkAssertionResult,
  WalletBrowserConfig,
  WalletDappDriver,
  WalletDappPageDriverSelectors,
  WalletGuardrailConfig,
  WalletPromptDriver
} from '@broccolo1d/wallet-browser';

export interface WalletQaConfig {
  /** Launch a persistent Chromium profile with MetaMask. Default is false to avoid wallet side effects. */
  useRealWallet?: boolean;
  /** Directory for screenshots and manifests created by walletArtifacts. */
  artifactDir?: string;
  /** Expected account used by wallet.connect/assertState when not supplied per-call. */
  expectedAccount?: string;
  /** Expected chain id used by wallet.connect/assertState when not supplied per-call. */
  expectedChainId?: string | number;
  /** Expected dapp origin used by wallet.connect when not supplied per-call. */
  origin?: string;
  /** Browser/extension/profile options passed to @broccolo1d/wallet-browser when useRealWallet is true. */
  browser?: Parameters<typeof launchWalletBrowser>[0];
  /** Dapp selectors used to build a simple page driver. */
  dappSelectors?: WalletDappPageDriverSelectors;
  /** Explicit dapp driver; overrides dappSelectors. */
  dapp?: WalletDappDriver;
  /** Explicit wallet prompt driver. Required for real prompt approval; otherwise actions fail closed. */
  prompt?: WalletPromptDriver;
  /** Explicit network driver. Required for chain/account assertions. */
  network?: MetaMaskNetworkDriver;
  /** Default guardrails applied by wallet actions. */
  guardrails?: WalletGuardrailConfig;
}

export interface WalletConnectOptions {
  /** Preferred developer-first dapp action: click the app's connect button/modal trigger. */
  click?: () => Promise<void>;
  /** Backwards-compatible alias for click. */
  requestConnection?: () => Promise<void>;
  expectedAccount?: string;
  expectedChainId?: string | number;
  origin?: string;
  guardrails?: WalletGuardrailConfig;
}

export interface FailClosedWalletPromptDriverOptions {
  /** Required dapp origin. Prompt approvals fail closed without an explicit expected origin. */
  origin: string;
  expectedAccount: string;
  expectedChainIdHex: string;
  /** Explicit prompt automation. Missing handlers reject instead of approving. */
  delegate?: WalletPromptDriver;
}

export interface DeterministicInjectedWalletOptions {
  /** Public test wallet account exposed by the injected EIP-1193 provider. Must be a non-zero 0x address. */
  account: string;
  /** Chain id exposed by eth_chainId/net_version. */
  chainId: number | string;
}

export type WalletScenarioConnectionState = 'disconnected' | 'connected';

export interface WalletScenarioProviderInfo {
  walletId?: string;
  name?: string;
  icon?: string;
  rdns?: string;
}

export interface WalletScenarioTokenBalance {
  symbol: string;
  amount: string;
}

export interface WalletScenarioPendingTransaction {
  hash: string;
  label?: string;
}

export interface WalletScenarioMethodError {
  code?: number;
  message: string;
}

export interface WalletScenarioMethodOutcome {
  method: string;
  type: 'resolve' | 'reject';
  value?: unknown;
  error?: WalletScenarioMethodError;
}

export interface WalletScenarioState {
  connectionState: WalletScenarioConnectionState;
  account?: string;
  chainIdHex: string;
  providerInfo?: WalletScenarioProviderInfo;
  tokenBalances: WalletScenarioTokenBalance[];
  pendingTransactions: WalletScenarioPendingTransaction[];
  methodOutcomes: WalletScenarioMethodOutcome[];
}

export interface WalletScenarioBuilder {
  disconnected(): WalletScenarioBuilder;
  connected(options: { account: string }): WalletScenarioBuilder;
  withChain(chainId: string | number): WalletScenarioBuilder;
  withProviderInfo(info: WalletScenarioProviderInfo): WalletScenarioBuilder;
  withTokenBalance(balance: WalletScenarioTokenBalance): WalletScenarioBuilder;
  withPendingTransaction(transaction: WalletScenarioPendingTransaction): WalletScenarioBuilder;
  resolvesMethod(method: string, value: unknown): WalletScenarioBuilder;
  rejectsMethod(method: string, error: WalletScenarioMethodError): WalletScenarioBuilder;
  rejectsSignature(error?: WalletScenarioMethodError): WalletScenarioBuilder;
  rejectsTransaction(error?: WalletScenarioMethodError): WalletScenarioBuilder;
  build(): WalletScenarioState;
}

export type DeterministicInjectedWalletPage = Pick<Page, 'addInitScript'>;

export interface WalletAssertStateOptions {
  expectedAccount?: string;
  expectedChainId?: string | number;
}

export interface WalletSignatureOptions extends WalletAssertStateOptions {
  /** Message text or canonical typed-data JSON expected in the dapp and MetaMask prompt. */
  message: string;
  /** Expected dapp origin. Defaults to walletConfig.origin; missing origin fails closed. */
  origin?: string;
  /** Developer-first dapp action: click/request the signature in the app. */
  click?: () => Promise<void>;
  /** Backwards-compatible explicit dapp signature action alias. */
  requestSignature?: () => Promise<void>;
  guardrails?: WalletGuardrailConfig;
}

export interface WalletTransactionOptions extends WalletAssertStateOptions {
  /** Developer-first dapp action: click/request the transaction in the app. */
  click?: () => Promise<void>;
  /** Backwards-compatible explicit dapp transaction action alias. */
  requestTransaction?: () => Promise<void>;
  /** Expected dapp origin. Defaults to walletConfig.origin; missing origin fails closed. */
  origin?: string;
  /** Optional transaction target. When supplied it is normalized and checked against guardrails. */
  to?: string;
  /** Optional transaction value in wei. Defaults to 0 in the lower-level policy helper. */
  value?: string;
  guardrails?: WalletGuardrailConfig;
}

export type WalletSwitchChainOptions = WalletAssertStateOptions;

export interface WalletQa {
  connect(options?: WalletConnectOptions): Promise<ConnectWalletResult>;
  assertState(options?: WalletAssertStateOptions): Promise<SepoliaNetworkAssertionResult>;
  expectConnected(options?: WalletAssertStateOptions): Promise<SepoliaNetworkAssertionResult>;
  expectChain(options?: Pick<WalletAssertStateOptions, 'expectedChainId' | 'expectedAccount'>): Promise<SepoliaNetworkAssertionResult>;
  switchChain(options?: WalletSwitchChainOptions): Promise<SepoliaNetworkAssertionResult>;
  signMessage(options: WalletSignatureOptions): Promise<void>;
  signTypedData(options: WalletSignatureOptions): Promise<void>;
  approveTransaction(options: WalletTransactionOptions): Promise<void>;
  maskAddress(address: string): string;
}

export interface WalletArtifacts {
  artifactDir: string;
  screenshot(name: string, options?: Parameters<Page['screenshot']>[0]): Promise<string>;
  writeManifest(name: string, data: Record<string, unknown>): Promise<string>;
  writeProofManifest(options: Omit<WalletQaProofManifestOptions, 'artifactDir'>): Promise<string>;
  writeArtifactIndex(options: Omit<WalletQaArtifactIndexOptions, 'artifactDir'>): Promise<string>;
  connectedProof(name: string, options: Omit<WalletQaProofManifestOptions, 'artifactDir' | 'manifestName' | 'status' | 'failure'>): Promise<string>;
  writeFailureManifest(name: string, error: unknown, data?: Record<string, unknown>): Promise<string>;
}

export type WalletQaProofStatus = 'connected' | 'failed';

export interface WalletQaProofAttachment {
  label: string;
  /** Local file to hash. The manifest stores only a safe basename. */
  path: string;
  /** Optional public basename override. Absolute paths and nested paths are rejected. */
  publicFile?: string;
  contentType?: string;
}

export interface WalletQaProofArtifact {
  label: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  contentType?: string;
}

export interface WalletQaProofManifest {
  /** Schema v1 is required for verifier acceptance to prevent downgraded public proof artifacts. */
  schemaVersion: 1;
  artifactType: 'wallet-qa-proof';
  createdAt: string;
  runId: string;
  provenance: WalletQaProofProvenance;
  test?: WalletQaProofTestMetadata;
  status: WalletQaProofStatus;
  origin?: string;
  maskedAccount?: string;
  chainId?: number | string;
  artifacts: WalletQaProofArtifact[];
  failure?: string;
  notes?: string[];
  decisions?: WalletQaProofDecisionRecord[];
  summary?: WalletQaProofSummary;
  checksums?: WalletQaProofChecksums;
}

export type WalletQaProofDecisionKind = 'prompt' | 'action';

export type WalletQaProofDecision = 'approved' | 'rejected' | 'skipped' | 'observed';

export interface WalletQaProofDecisionRecord {
  /** Whether the record describes a wallet prompt decision or a surrounding QA action. */
  kind: WalletQaProofDecisionKind;
  /** Short public-safe action label, for example connect, switch-chain, or artifact-review. */
  action: string;
  /** Public-safe decision outcome. */
  decision: WalletQaProofDecision;
  /** Optional prompt classifier kind, for example connect, sign, transaction, or unknown. */
  promptKind?: string;
  /** Optional dapp origin associated with the decision. */
  origin?: string;
  /** Optional public note. Full addresses, local paths, and secret-like values are redacted. */
  reason?: string;
}

export interface WalletQaProofProvenance {
  packageName: '@broccolo1d/playwright';
  packageVersion: string;
  framework: 'playwright';
  tool: string;
  runtime: WalletQaProofRuntimeMetadata;
}

export interface WalletQaProofRuntimeMetadata {
  node: string;
  platform: string;
  arch: string;
}

export interface WalletQaProofTestMetadata {
  project?: string;
  title?: string;
}

export interface WalletQaProofSummary {
  status: WalletQaProofStatus;
  origin?: string;
  maskedAccount?: string;
  chainId?: number | string;
  artifactCount: number;
  decisionCount?: number;
  failure?: string;
}

export interface WalletQaProofChecksums {
  artifactSha256: string[];
}

export interface WalletQaProofManifestOptions {
  artifactDir: string;
  manifestName?: string;
  status: WalletQaProofStatus;
  origin?: string;
  account?: string;
  chainId?: number | string;
  attachments?: WalletQaProofAttachment[];
  failure?: unknown;
  notes?: string[];
  decisions?: WalletQaProofDecisionRecord[];
  runId?: string;
  createdAt?: string;
  tool?: string;
  test?: WalletQaProofTestMetadata;
}

export type WalletQaArtifactAnnotationKind = 'proof-manifest' | 'artifact-index' | 'screenshot' | 'trace' | 'report';

export interface WalletQaArtifactAnnotationOptions {
  kind: WalletQaArtifactAnnotationKind;
  /** Safe basename for the public/reviewed artifact; nested or absolute paths are rejected. */
  file: string;
  status?: WalletQaProofStatus;
  chainId?: string | number;
  /** Already-masked account, for example 0x1234…abcd. Full wallet addresses are redacted before annotation. */
  maskedAccount?: string;
  /** Optional short note. Full addresses, local paths, and secret-like values are redacted. */
  note?: string;
}

export interface WalletQaPlaywrightAnnotation {
  type: `wallet-qa:${WalletQaArtifactAnnotationKind}`;
  description: string;
}

export interface WalletQaAnnotationTarget {
  annotations: Array<{ type: string; description?: string }>;
}

export interface WalletQaProofVerificationResult {
  status: 'verified';
  artifactDir: string;
  manifestPath: string;
  manifestSha256: string;
  schemaVersion: 1;
  createdAt: string;
  runId: string;
  provenance: WalletQaProofProvenance;
  manifest: WalletQaProofManifest;
}

export interface WalletQaArtifactIndexEntry {
  file: string;
  sha256: string;
  status: WalletQaProofStatus;
  origin?: string;
  maskedAccount?: string;
  chainId?: number | string;
  artifactCount: number;
  artifacts: WalletQaProofArtifact[];
}

export interface WalletQaArtifactIndexSummary {
  manifestCount: number;
  connectedCount: number;
  failedCount: number;
  artifactCount: number;
}

export interface WalletQaArtifactIndex {
  schemaVersion: 1;
  artifactType: 'wallet-qa-artifact-index';
  createdAt: string;
  runId: string;
  provenance: WalletQaProofProvenance;
  summary: WalletQaArtifactIndexSummary;
  manifests: WalletQaArtifactIndexEntry[];
}

export interface WalletQaArtifactIndexOptions {
  artifactDir: string;
  manifestNames: string[];
  indexName?: string;
  runId?: string;
  createdAt?: string;
  tool?: string;
}

export interface WalletQaFixtures {
  walletConfig: WalletQaConfig;
  walletContext: BrowserContext;
  walletPage: Page;
  wallet: WalletQa;
  walletArtifacts: WalletArtifacts;
}

export interface WalletQaWorkerFixtures {}

type WalletQaPlaywrightConfig = PlaywrightTestConfig<WalletQaFixtures, WalletQaWorkerFixtures>;

const DEFAULT_WALLET_CONFIG: WalletQaConfig = {
  useRealWallet: false,
  artifactDir: '.wallet-artifacts/playwright'
};
const PLAYWRIGHT_PACKAGE_VERSION = '0.2.10';
const ETHEREUM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ETHEREUM_ADDRESS = '0x0000000000000000000000000000000000000000';

function normalizeNonZeroEthereumAddress(account: string): string {
  const normalized = account.toLowerCase();
  if (!ETHEREUM_ADDRESS_PATTERN.test(normalized) || normalized === ZERO_ETHEREUM_ADDRESS) {
    throw new Error('Deterministic injected wallet account must be a non-zero Ethereum address.');
  }
  return normalized;
}

function normalizeChainIdHex(chainId: string | number): string {
  if (typeof chainId === 'number') {
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error('Deterministic injected wallet chainId must be a positive integer or 0x-prefixed hex string.');
    }
    return `0x${chainId.toString(16)}`;
  }

  if (/^0x[0-9a-fA-F]+$/.test(chainId)) {
    const parsed = Number.parseInt(chainId, 16);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('Deterministic injected wallet chainId must be a positive integer or 0x-prefixed hex string.');
    }
    return `0x${parsed.toString(16)}`;
  }
  if (/^[0-9]+$/.test(chainId)) {
    return normalizeChainIdHex(Number.parseInt(chainId, 10));
  }
  throw new Error('Deterministic injected wallet chainId must be a positive integer or 0x-prefixed hex string.');
}

const DEFAULT_SIGNATURE_REJECTION: WalletScenarioMethodError = { code: 4001, message: 'User rejected signature request.' };
const DEFAULT_TRANSACTION_REJECTION: WalletScenarioMethodError = { code: 4001, message: 'User rejected transaction request.' };

class WalletScenarioBuilderImpl implements WalletScenarioBuilder {
  constructor(private readonly state: WalletScenarioState) {}

  disconnected(): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, connectionState: 'disconnected', account: undefined });
  }

  connected(options: { account: string }): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, connectionState: 'connected', account: normalizeNonZeroEthereumAddress(options.account) });
  }

  withChain(chainId: string | number): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, chainIdHex: normalizeChainIdHex(chainId) });
  }

  withProviderInfo(info: WalletScenarioProviderInfo): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, providerInfo: { ...info } });
  }

  withTokenBalance(balance: WalletScenarioTokenBalance): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, tokenBalances: [...this.state.tokenBalances, { ...balance }] });
  }

  withPendingTransaction(transaction: WalletScenarioPendingTransaction): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, pendingTransactions: [...this.state.pendingTransactions, { ...transaction }] });
  }

  resolvesMethod(method: string, value: unknown): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, methodOutcomes: [...this.state.methodOutcomes, { method, type: 'resolve', value }] });
  }

  rejectsMethod(method: string, error: WalletScenarioMethodError): WalletScenarioBuilder {
    return new WalletScenarioBuilderImpl({ ...this.state, methodOutcomes: [...this.state.methodOutcomes, { method, type: 'reject', error: { ...error } }] });
  }

  rejectsSignature(error: WalletScenarioMethodError = DEFAULT_SIGNATURE_REJECTION): WalletScenarioBuilder {
    return this.rejectsMethod('personal_sign', error).rejectsMethod('eth_signTypedData_v4', error);
  }

  rejectsTransaction(error: WalletScenarioMethodError = DEFAULT_TRANSACTION_REJECTION): WalletScenarioBuilder {
    return this.rejectsMethod('eth_sendTransaction', error);
  }

  build(): WalletScenarioState {
    return {
      ...this.state,
      providerInfo: this.state.providerInfo ? { ...this.state.providerInfo } : undefined,
      tokenBalances: this.state.tokenBalances.map((balance) => ({ ...balance })),
      pendingTransactions: this.state.pendingTransactions.map((transaction) => ({ ...transaction })),
      methodOutcomes: this.state.methodOutcomes.map((outcome) => ({ ...outcome, error: outcome.error ? { ...outcome.error } : undefined }))
    };
  }
}

export function walletScenario(): WalletScenarioBuilder {
  return new WalletScenarioBuilderImpl({
    connectionState: 'disconnected',
    chainIdHex: '0x1',
    tokenBalances: [],
    pendingTransactions: [],
    methodOutcomes: []
  });
}

function runtimeMetadata(): WalletQaProofRuntimeMetadata {
  return { node: process.version, platform: process.platform, arch: process.arch };
}

export function defineWalletQaConfig(config: WalletQaPlaywrightConfig): WalletQaPlaywrightConfig {
  return defineConfig(config) as WalletQaPlaywrightConfig;
}

export async function installWalletScenario(page: DeterministicInjectedWalletPage, scenario: WalletScenarioState): Promise<void> {
  const normalizedScenario: WalletScenarioState = {
    ...scenario,
    account: scenario.account ? normalizeNonZeroEthereumAddress(scenario.account) : undefined,
    chainIdHex: normalizeChainIdHex(scenario.chainIdHex),
    providerInfo: scenario.providerInfo ? { ...scenario.providerInfo } : undefined,
    tokenBalances: scenario.tokenBalances.map((balance) => ({ ...balance })),
    pendingTransactions: scenario.pendingTransactions.map((transaction) => ({ ...transaction })),
    methodOutcomes: scenario.methodOutcomes.map((outcome) => ({ ...outcome, error: outcome.error ? { ...outcome.error } : undefined }))
  };

  if (normalizedScenario.connectionState === 'connected' && !normalizedScenario.account) {
    throw new Error('Connected wallet scenarios require a non-zero Ethereum address.');
  }

  await page.addInitScript((injectedScenario: WalletScenarioState) => {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const emit = (event: string, payload: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    };
    const supportedChainIdHex = injectedScenario.chainIdHex;
    const networkVersion = Number.parseInt(supportedChainIdHex, 16).toString();
    const connectedAccount = injectedScenario.connectionState === 'connected' ? injectedScenario.account : undefined;
    const methodOutcomes = new Map(injectedScenario.methodOutcomes.map((outcome) => [outcome.method, outcome]));
    const provider = {
      isMetaMask: true,
      selectedAddress: connectedAccount ?? null,
      chainId: supportedChainIdHex,
      networkVersion,
      async request({ method, params }: { method: string; params?: Array<{ chainId?: string }> }) {
        const scriptedOutcome = methodOutcomes.get(method);
        if (scriptedOutcome?.type === 'resolve') return scriptedOutcome.value;
        if (scriptedOutcome?.type === 'reject') {
          const error = new Error(scriptedOutcome.error?.message ?? `Deterministic wallet scenario rejected ${method}.`);
          (error as Error & { code?: number }).code = scriptedOutcome.error?.code;
          throw error;
        }

        switch (method) {
          case 'eth_accounts':
            if (!connectedAccount) return [];
            provider.selectedAddress = connectedAccount;
            emit('accountsChanged', [connectedAccount]);
            return [connectedAccount];
          case 'eth_requestAccounts':
            if (!connectedAccount) return [];
            provider.selectedAddress = connectedAccount;
            emit('accountsChanged', [connectedAccount]);
            return [connectedAccount];
          case 'eth_chainId':
            return supportedChainIdHex;
          case 'net_version':
            return networkVersion;
          case 'wallet_switchEthereumChain': {
            const requestedChainId = params?.[0]?.chainId?.toLowerCase();
            if (requestedChainId && requestedChainId !== supportedChainIdHex) {
              const error = new Error(`Deterministic wallet scenario only supports chain ${supportedChainIdHex}.`);
              (error as Error & { code?: number }).code = 4902;
              throw error;
            }
            provider.chainId = supportedChainIdHex;
            emit('chainChanged', supportedChainIdHex);
            return null;
          }
          case 'wallet_addEthereumChain':
            return null;
          default:
            throw new Error(`Unsupported deterministic wallet scenario method: ${method}`);
        }
      },
      on(event: string, listener: (payload: unknown) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)?.add(listener);
      },
      removeListener(event: string, listener: (payload: unknown) => void) {
        listeners.get(event)?.delete(listener);
      }
    };

    Object.defineProperty(globalThis, 'ethereum', {
      configurable: true,
      value: provider
    });

    const eip6963Global = globalThis as typeof globalThis & {
      addEventListener?: (event: string, listener: () => void) => void;
      dispatchEvent?: (event: unknown) => boolean;
      CustomEvent?: new (type: string, init?: { detail?: unknown }) => unknown;
    };
    if (injectedScenario.providerInfo && eip6963Global.addEventListener && eip6963Global.dispatchEvent && eip6963Global.CustomEvent) {
      const info = { walletId: 'io.metamask', name: 'MetaMask', ...injectedScenario.providerInfo };
      eip6963Global.addEventListener('eip6963:requestProvider', () => {
        eip6963Global.dispatchEvent?.(new eip6963Global.CustomEvent!('eip6963:announceProvider', { detail: { info, provider } }));
      });
    }
  }, normalizedScenario);
}

export async function installDeterministicInjectedWallet(
  page: DeterministicInjectedWalletPage,
  options: DeterministicInjectedWalletOptions
): Promise<void> {
  return installWalletScenario(
    page,
    walletScenario()
      .connected({ account: options.account })
      .withChain(options.chainId)
      .withProviderInfo({ walletId: 'io.metamask', name: 'MetaMask' })
      .build()
  );
}

export const test = base.extend<WalletQaFixtures, WalletQaWorkerFixtures>({
  walletConfig: [DEFAULT_WALLET_CONFIG, { option: true }],

  context: async ({ context, walletConfig }, use) => {
    if (!walletConfig.useRealWallet) {
      await use(context);
      return;
    }

    const launchResult = await launchWalletBrowser(walletConfig.browser ?? {});
    try {
      await use(launchResult.context as unknown as BrowserContext);
    } finally {
      await launchResult.context.close();
    }
  },

  walletContext: async ({ context }, use) => {
    await use(context);
  },

  walletPage: async ({ page }, use) => {
    await use(page);
  },

  walletArtifacts: async ({ page, walletConfig }, use, testInfo) => {
    await use(createWalletArtifacts(page, walletConfig, testInfo));
  },

  wallet: async ({ page, walletConfig }, use) => {
    await use(createWalletQa(page, walletConfig));
  }
});

export function createWalletQa(page: Page, config: WalletQaConfig): WalletQa {
  async function assertStateForHelper(helperName: string, options: WalletAssertStateOptions = {}): Promise<SepoliaNetworkAssertionResult> {
    const expectedAccount = options.expectedAccount ?? config.expectedAccount;
    const expectedChainId = options.expectedChainId ?? config.expectedChainId;
    if (!expectedAccount || expectedChainId === undefined) {
      throw new Error(`${helperName} requires expectedAccount and expectedChainId in options or walletConfig.`);
    }

    const network = requireConfigured(config.network, `${helperName} requires walletConfig.network to read wallet state; fail closed.`);
    return assertWalletState({ network, expectedAccount, expectedChainId });
  }

  async function signWithKind(helperName: string, signatureKind: WalletSignatureKind, options: WalletSignatureOptions): Promise<void> {
    const expectedAccount = options.expectedAccount ?? config.expectedAccount;
    const expectedChainId = options.expectedChainId ?? config.expectedChainId;
    if (!expectedAccount || expectedChainId === undefined) {
      throw new Error(`${helperName} requires expectedAccount and expectedChainId in options or walletConfig.`);
    }

    const origin = options.origin ?? config.origin;
    if (!origin) {
      throw new Error(`${helperName} requires origin in options or walletConfig.origin before approving a wallet prompt; fail closed.`);
    }
    if (!options.message) {
      throw new Error(`${helperName} requires an expected message before approving a wallet prompt; fail closed.`);
    }

    const prompt = requireConfigured(config.prompt, `${helperName} requires walletConfig.prompt to approve a real wallet prompt; fail closed.`);
    const network = requireConfigured(config.network, `${helperName} requires walletConfig.network to verify chain/account before signing; fail closed.`);
    const dapp = createSignatureDappDriver(page, config, options.click ?? options.requestSignature);
    return approveSignature({
      dapp,
      prompt,
      network,
      origin,
      expectedAccount,
      expectedChainId,
      message: options.message,
      signatureKind,
      guardrails: options.guardrails ?? config.guardrails
    });
  }

  return {
    async connect(options = {}) {
      const expectedAccount = options.expectedAccount ?? config.expectedAccount;
      const expectedChainId = options.expectedChainId ?? config.expectedChainId;
      if (!expectedAccount || expectedChainId === undefined) {
        throw new Error('wallet.connect requires expectedAccount and expectedChainId in options or walletConfig.');
      }

      const origin = options.origin ?? config.origin;
      if (!origin) {
        throw new Error('wallet.connect requires origin in options or walletConfig.origin before approving a wallet prompt; fail closed.');
      }

      const dapp = createDappDriver(page, config, options.click ?? options.requestConnection);
      const prompt = requireConfigured(config.prompt, 'wallet.connect requires walletConfig.prompt to approve a real wallet prompt; fail closed.');
      const network = requireConfigured(config.network, 'wallet.connect requires walletConfig.network to verify chain/account; fail closed.');
      return connectWallet({
        dapp,
        prompt,
        network,
        expectedAccount,
        expectedChainId,
        origin,
        guardrails: options.guardrails ?? config.guardrails
      });
    },

    async assertState(options = {}) {
      return assertStateForHelper('wallet.assertState', options);
    },

    async expectConnected(options = {}) {
      return assertStateForHelper('wallet.expectConnected', options);
    },

    async expectChain(options = {}) {
      if (options.expectedChainId === undefined && config.expectedChainId === undefined) {
        throw new Error('wallet.expectChain requires expectedChainId in options or walletConfig.');
      }
      return assertStateForHelper('wallet.expectChain', options);
    },

    async switchChain(options = {}) {
      const expectedAccount = options.expectedAccount ?? config.expectedAccount;
      const expectedChainId = options.expectedChainId ?? config.expectedChainId;
      if (!expectedAccount || expectedChainId === undefined) {
        throw new Error('wallet.switchChain requires expectedAccount and expectedChainId in options or walletConfig.');
      }

      const network = requireConfigured(config.network, 'wallet.switchChain requires walletConfig.network to switch and verify chain/account; fail closed.');
      return switchNetwork({ network, expectedAccount, expectedChainId });
    },

    async signMessage(options) {
      return signWithKind('wallet.signMessage', 'personal_sign', options);
    },

    async signTypedData(options) {
      return signWithKind('wallet.signTypedData', 'typed_data', options);
    },

    async approveTransaction(options) {
      const expectedAccount = options.expectedAccount ?? config.expectedAccount;
      if (!expectedAccount) {
        throw new Error('wallet.approveTransaction requires expectedAccount in options or walletConfig.');
      }

      const origin = options.origin ?? config.origin;
      if (!origin) {
        throw new Error('wallet.approveTransaction requires origin in options or walletConfig.origin before approving a wallet prompt; fail closed.');
      }

      const prompt = requireConfigured(config.prompt, 'wallet.approveTransaction requires walletConfig.prompt to approve a real wallet prompt; fail closed.');
      const dapp = createTransactionDappDriver(page, config, options.click ?? options.requestTransaction);
      const expectedChainId = options.expectedChainId ?? config.expectedChainId;
      const network = expectedChainId === undefined
        ? undefined
        : requireConfigured(config.network, 'wallet.approveTransaction requires walletConfig.network when expectedChainId is configured; fail closed.');

      return approveTransaction({
        dapp,
        prompt,
        network,
        origin,
        expectedAccount,
        expectedChainId,
        to: options.to,
        value: options.value,
        guardrails: options.guardrails ?? config.guardrails
      });
    },

    maskAddress(address: string) {
      return maskEthereumAddress(address);
    }
  };
}

function createDappDriver(page: Page, config: WalletQaConfig, requestConnection?: () => Promise<void>): WalletDappDriver {
  const configured = config.dapp ?? (config.dappSelectors ? createWalletDappPageDriver({ page, selectors: config.dappSelectors }) : undefined);
  if (requestConnection) {
    return {
      async requestConnect() {
        await requestConnection();
      },
      async getConnectedAccount() {
        return configured?.getConnectedAccount();
      },
      requestSignature: configured?.requestSignature?.bind(configured),
      requestTransaction: configured?.requestTransaction?.bind(configured)
    };
  }

  return requireConfigured(configured, 'wallet.connect requires click, requestConnection, walletConfig.dapp, or walletConfig.dappSelectors to trigger the dapp connection action; fail closed.');
}

function createSignatureDappDriver(page: Page, config: WalletQaConfig, requestSignature?: () => Promise<void>): Pick<WalletDappDriver, 'requestSignature'> {
  const configured = config.dapp;
  if (requestSignature) {
    return {
      async requestSignature() {
        await requestSignature();
      }
    };
  }
  if (configured?.requestSignature) {
    return { requestSignature: configured.requestSignature.bind(configured) };
  }
  if (config.dappSelectors) {
    return { requestSignature: createWalletDappPageDriver({ page, selectors: config.dappSelectors }).requestSignature };
  }
  throw new Error('wallet signature helpers require click, requestSignature, or walletConfig.dapp.requestSignature to trigger the dapp signature action; fail closed.');
}

function createTransactionDappDriver(page: Page, config: WalletQaConfig, requestTransaction?: () => Promise<void>): Pick<WalletDappDriver, 'requestTransaction'> {
  const configured = config.dapp;
  if (requestTransaction) {
    return {
      async requestTransaction() {
        await requestTransaction();
      }
    };
  }
  if (configured?.requestTransaction) {
    return { requestTransaction: configured.requestTransaction.bind(configured) };
  }
  if (config.dappSelectors) {
    return { requestTransaction: createWalletDappPageDriver({ page, selectors: config.dappSelectors }).requestTransaction };
  }
  throw new Error('wallet transaction helpers require click, requestTransaction, or walletConfig.dapp.requestTransaction to trigger the dapp transaction action; fail closed.');
}

export function createWalletArtifacts(page: Page, config: WalletQaConfig, testInfo: TestInfo): WalletArtifacts {
  const artifactDir = resolve(config.artifactDir ?? DEFAULT_WALLET_CONFIG.artifactDir!);
  const runDir = join(artifactDir, sanitizePathPart(testInfo.project.name || 'default'), sanitizePathPart(testInfo.title));
  return {
    artifactDir: runDir,
    async screenshot(name, options = {}) {
      const filePath = join(runDir, `${sanitizePathPart(name)}.png`);
      await mkdir(dirname(filePath), { recursive: true });
      await page.screenshot({ ...options, path: filePath });
      return filePath;
    },
    async writeManifest(name, data) {
      const filePath = join(runDir, `${sanitizePathPart(name)}.json`);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      return filePath;
    },
    async writeProofManifest(options) {
      return writeWalletQaProofManifest({ ...options, artifactDir: runDir, test: testMetadataFromInfo(testInfo) });
    },
    async writeArtifactIndex(options) {
      return writeWalletQaArtifactIndex({ ...options, artifactDir: runDir, tool: options.tool ?? 'walletArtifacts.writeArtifactIndex' });
    },
    async connectedProof(name, options) {
      const manifestName = `${sanitizePathPart(name)}.json`;
      const attachments = await Promise.all((options.attachments ?? []).map(async (attachment) => {
        const file = attachment.publicFile ?? basename(attachment.path);
        assertSafeArtifactBasename(file, 'attachment file');
        const target = join(runDir, file);
        await mkdir(dirname(target), { recursive: true });
        if (resolve(attachment.path) !== resolve(target)) {
          await copyFile(attachment.path, target);
        }
        return { ...attachment, publicFile: file };
      }));
      return writeWalletQaProofManifest({
        ...options,
        attachments,
        status: 'connected',
        manifestName,
        artifactDir: runDir,
        tool: 'walletArtifacts.connectedProof',
        test: testMetadataFromInfo(testInfo),
        notes: [...(options.notes ?? []), `proof manifest: ${manifestName}`]
      });
    },
    async writeFailureManifest(name, error, data = {}) {
      return this.writeManifest(name, { ...data, failure: formatWalletQaFailure(error) });
    }
  };
}

export function createFailClosedWalletPromptDriver(options: FailClosedWalletPromptDriverOptions): Required<WalletPromptDriver> {
  if (!options.origin) {
    throw new Error('Wallet prompt origin is required; fail closed.');
  }
  const expectedAccount = normalizeAddressForComparison(options.expectedAccount);
  const expectedChainIdHex = options.expectedChainIdHex.toLowerCase();
  return {
    async approveConnection(input) {
      assertPromptOrigin(input.origin, options.origin);
      assertPromptAccount(input.expectedAccount, expectedAccount);
      if (input.expectedChainIdHex.toLowerCase() !== expectedChainIdHex) {
        throw new Error(`Wallet connection prompt chain ${input.expectedChainIdHex} does not match expected ${expectedChainIdHex}; fail closed.`);
      }
      if (!options.delegate?.approveConnection) {
        throw new Error('Wallet connection prompt approval is not configured; fail closed.');
      }
      await options.delegate.approveConnection(input);
    },
    async approveSignature(input) {
      assertPromptOrigin(input.origin, options.origin);
      assertPromptAccount(input.expectedAccount, expectedAccount);
      assertPromptSignatureSafety(input);
      if (input.expectedChainIdHex.toLowerCase() !== expectedChainIdHex) {
        throw new Error(`Wallet signature prompt chain ${input.expectedChainIdHex} does not match expected ${expectedChainIdHex}; fail closed.`);
      }
      if (!options.delegate?.approveSignature) {
        throw new Error('Unexpected signature prompt; fail closed.');
      }
      await options.delegate.approveSignature(input);
    },
    async approveTransaction(input) {
      assertPromptOrigin(input.origin, options.origin);
      assertPromptAccount(input.expectedAccount, expectedAccount);
      if (!options.delegate?.approveTransaction) {
        throw new Error('Unexpected transaction prompt; fail closed.');
      }
      await options.delegate.approveTransaction(input);
    }
  };
}

export async function writeWalletQaProofManifest(options: WalletQaProofManifestOptions): Promise<string> {
  const artifactDir = resolve(options.artifactDir);
  const manifestName = options.manifestName ?? 'wallet-qa-proof.json';
  assertSafeArtifactBasename(manifestName, 'manifest name');
  await mkdir(artifactDir, { recursive: true });

  const artifacts = await Promise.all((options.attachments ?? []).map((attachment) => createProofArtifact(artifactDir, attachment)));
  const decisions = options.decisions?.map(sanitizeDecisionRecord);
  const maskedAccount = options.account ? maskEthereumAddress(options.account) : undefined;
  const failure = options.failure !== undefined ? formatWalletQaFailure(options.failure) : undefined;
  const summary: WalletQaProofSummary = {
    status: options.status,
    ...(options.origin ? { origin: assertSafeOrigin(options.origin) } : {}),
    ...(maskedAccount ? { maskedAccount } : {}),
    ...(options.chainId !== undefined ? { chainId: options.chainId } : {}),
    artifactCount: artifacts.length,
    ...(decisions ? { decisionCount: decisions.length } : {}),
    ...(failure ? { failure } : {})
  };
  const manifest: WalletQaProofManifest = {
    schemaVersion: 1,
    artifactType: 'wallet-qa-proof',
    createdAt: options.createdAt ?? new Date().toISOString(),
    runId: options.runId ?? randomUUID(),
    provenance: {
      packageName: '@broccolo1d/playwright',
      packageVersion: PLAYWRIGHT_PACKAGE_VERSION,
      framework: 'playwright',
      tool: sanitizeProvenanceTool(options.tool ?? 'writeWalletQaProofManifest'),
      runtime: runtimeMetadata()
    },
    ...(options.test ? { test: sanitizeTestMetadata(options.test) } : {}),
    status: options.status,
    ...(options.origin ? { origin: assertSafeOrigin(options.origin) } : {}),
    ...(maskedAccount ? { maskedAccount } : {}),
    ...(options.chainId !== undefined ? { chainId: options.chainId } : {}),
    artifacts,
    ...(failure !== undefined ? { failure } : {}),
    ...(options.notes ? { notes: options.notes.map((note) => redactWalletQaValue(note)) } : {}),
    ...(decisions ? { decisions } : {}),
    summary,
    checksums: { artifactSha256: artifacts.map((artifact) => artifact.sha256) }
  };

  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  assertPublicManifestIsSafe(text, artifactDir);
  const manifestPath = join(artifactDir, manifestName);
  await writeFile(manifestPath, text, 'utf8');
  return manifestPath;
}

export async function verifyWalletQaProofManifest(artifactDir: string, manifestName = 'wallet-qa-proof.json'): Promise<WalletQaProofVerificationResult> {
  const resolvedArtifactDir = resolve(artifactDir);
  assertSafeArtifactBasename(manifestName, 'manifest name');
  const manifestPath = join(resolvedArtifactDir, manifestName);
  const text = await readFile(manifestPath, 'utf8');
  assertPublicManifestIsSafe(text, resolvedArtifactDir);
  const manifestSha256 = createHash('sha256').update(text).digest('hex');
  const manifest = JSON.parse(text) as WalletQaProofManifest;
  if (manifest.artifactType !== 'wallet-qa-proof') {
    throw new Error('Wallet QA proof manifest has an unexpected artifact type.');
  }
  if (manifest.status !== 'connected' && manifest.status !== 'failed') {
    throw new Error('Wallet QA proof manifest has an unexpected status.');
  }
  if (manifest.origin !== undefined) {
    assertSafeOrigin(manifest.origin);
  }
  if (manifest.maskedAccount !== undefined && !isSafeMaskedAccount(manifest.maskedAccount)) {
    throw new Error('Wallet QA proof manifest masked account must be shortened and must not contain a full wallet address.');
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error('Wallet QA proof manifest artifacts must be an array.');
  }
  for (const artifact of manifest.artifacts) {
    await verifyProofArtifact(resolvedArtifactDir, artifact);
  }
  if (manifest.schemaVersion === undefined) {
    throw new Error('Wallet QA proof manifest schemaVersion is required for verification.');
  }
  verifyWalletQaProofProvenance(manifest);
  return {
    status: 'verified',
    artifactDir: resolvedArtifactDir,
    manifestPath,
    manifestSha256,
    schemaVersion: manifest.schemaVersion,
    createdAt: manifest.createdAt,
    runId: manifest.runId,
    provenance: manifest.provenance,
    manifest
  };
}

export async function writeWalletQaArtifactIndex(options: WalletQaArtifactIndexOptions): Promise<string> {
  const artifactDir = resolve(options.artifactDir);
  const indexName = options.indexName ?? 'wallet-qa-artifact-index.json';
  assertSafeArtifactBasename(indexName, 'artifact index name');
  await mkdir(artifactDir, { recursive: true });

  const manifests = await Promise.all(options.manifestNames.map(async (manifestName): Promise<WalletQaArtifactIndexEntry> => {
    assertSafeArtifactBasename(manifestName, 'manifest name');
    const verified = await verifyWalletQaProofManifest(artifactDir, manifestName);
    const manifest = verified.manifest;
    return {
      file: manifestName,
      sha256: verified.manifestSha256,
      status: manifest.status,
      ...(manifest.origin ? { origin: manifest.origin } : {}),
      ...(manifest.maskedAccount ? { maskedAccount: manifest.maskedAccount } : {}),
      ...(manifest.chainId !== undefined ? { chainId: manifest.chainId } : {}),
      artifactCount: manifest.artifacts.length,
      artifacts: manifest.artifacts
    };
  }));

  const summary: WalletQaArtifactIndexSummary = {
    manifestCount: manifests.length,
    connectedCount: manifests.filter((manifest) => manifest.status === 'connected').length,
    failedCount: manifests.filter((manifest) => manifest.status === 'failed').length,
    artifactCount: manifests.reduce((count, manifest) => count + manifest.artifactCount, 0)
  };
  const index: WalletQaArtifactIndex = {
    schemaVersion: 1,
    artifactType: 'wallet-qa-artifact-index',
    createdAt: options.createdAt ?? new Date().toISOString(),
    runId: options.runId ?? randomUUID(),
    provenance: {
      packageName: '@broccolo1d/playwright',
      packageVersion: PLAYWRIGHT_PACKAGE_VERSION,
      framework: 'playwright',
      tool: sanitizeProvenanceTool(options.tool ?? 'writeWalletQaArtifactIndex'),
      runtime: runtimeMetadata()
    },
    summary,
    manifests
  };

  const text = `${JSON.stringify(index, null, 2)}\n`;
  assertPublicManifestIsSafe(text, artifactDir);
  const indexPath = join(artifactDir, indexName);
  await writeFile(indexPath, text, 'utf8');
  return indexPath;
}

export function createWalletQaArtifactAnnotation(options: WalletQaArtifactAnnotationOptions): WalletQaPlaywrightAnnotation {
  assertSafeArtifactBasename(options.file, 'annotation artifact file');
  const fields = [
    `file=${options.file}`,
    ...(options.status ? [`status=${options.status}`] : []),
    ...(options.chainId !== undefined ? [`chainId=${String(options.chainId)}`] : []),
    ...(options.maskedAccount ? [`account=${redactWalletQaValue(options.maskedAccount)}`] : []),
    ...(options.note ? [`note=${redactWalletQaValue(options.note)}`] : [])
  ];
  return {
    type: `wallet-qa:${options.kind}`,
    description: fields.join(' ')
  };
}

export function annotateWalletQaArtifact(testInfo: WalletQaAnnotationTarget, options: WalletQaArtifactAnnotationOptions): WalletQaPlaywrightAnnotation {
  const annotation = createWalletQaArtifactAnnotation(options);
  testInfo.annotations.push(annotation);
  return annotation;
}

export function formatWalletQaFailure(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactWalletQaValue(message);
}

function sanitizeDecisionRecord(record: WalletQaProofDecisionRecord): WalletQaProofDecisionRecord {
  if (record.kind !== 'prompt' && record.kind !== 'action') {
    throw new Error('Wallet QA proof decision kind must be prompt or action.');
  }
  if (record.decision !== 'approved' && record.decision !== 'rejected' && record.decision !== 'skipped' && record.decision !== 'observed') {
    throw new Error('Wallet QA proof decision must be approved, rejected, skipped, or observed.');
  }
  return {
    kind: record.kind,
    action: sanitizePathPart(record.action),
    decision: record.decision,
    ...(record.promptKind ? { promptKind: sanitizePathPart(record.promptKind) } : {}),
    ...(record.origin ? { origin: assertSafeOrigin(record.origin) } : {}),
    ...(record.reason ? { reason: redactWalletQaValue(record.reason) } : {})
  };
}

export function redactWalletQaValue(value: unknown): string {
  return redactPaths(redactFullAddresses(redactSecrets(typeof value === 'string' ? value : JSON.stringify(value, null, 2))));
}

async function createProofArtifact(artifactDir: string, attachment: WalletQaProofAttachment): Promise<WalletQaProofArtifact> {
  const file = attachment.publicFile ?? basename(attachment.path);
  assertSafeArtifactBasename(file, 'attachment file');
  if (!existsSync(attachment.path)) {
    throw new Error(`Wallet QA proof attachment is missing: ${file}`);
  }
  const bytes = await readFile(attachment.path);
  const fileStat = await stat(attachment.path);
  const artifact: WalletQaProofArtifact = {
    label: sanitizeLabel(attachment.label),
    file,
    sizeBytes: fileStat.size,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
  if (attachment.contentType) {
    artifact.contentType = attachment.contentType;
  }
  return artifact;
}

async function verifyProofArtifact(artifactDir: string, artifact: WalletQaProofArtifact): Promise<void> {
  assertSafeArtifactBasename(artifact.file, 'artifact file');
  if (!/^[0-9a-f]{64}$/.test(artifact.sha256)) {
    throw new Error(`Wallet QA proof artifact hash is invalid for ${artifact.file}.`);
  }
  const artifactPath = join(artifactDir, artifact.file);
  if (!existsSync(artifactPath)) {
    throw new Error(`Wallet QA proof artifact is missing: ${artifact.file}`);
  }
  const bytes = await readFile(artifactPath);
  const fileStat = await stat(artifactPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (artifact.sizeBytes !== fileStat.size) {
    throw new Error(`Wallet QA proof artifact size mismatch for ${artifact.file}.`);
  }
  if (artifact.sha256 !== sha256) {
    throw new Error(`Wallet QA proof artifact hash mismatch for ${artifact.file}.`);
  }
}

function assertPromptOrigin(actual: string | undefined, expected: string | undefined): void {
  if (expected !== undefined && actual !== expected) {
    throw new Error(`Wallet prompt origin ${actual ?? '<missing>'} does not match expected ${expected}; fail closed.`);
  }
}

function assertPromptAccount(actual: string, expected: string): void {
  if (normalizeAddressForComparison(actual) !== expected) {
    throw new Error(`Wallet prompt account ${maskEthereumAddress(actual)} does not match expected ${maskEthereumAddress(expected)}; fail closed.`);
  }
}

function normalizeAddressForComparison(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Wallet prompt account must be a full 0x-prefixed address; fail closed.');
  }
  return address.toLowerCase();
}

function assertPublicManifestIsSafe(text: string, artifactDir: string): void {
  if (text.includes(artifactDir)) {
    throw new Error('Wallet QA proof manifest must not contain the full artifact directory path.');
  }
  if (/0x[0-9a-fA-F]{40}/.test(text)) {
    throw new Error('Wallet QA proof manifest must not contain full wallet addresses.');
  }
  if (containsLocalPathLeak(text)) {
    throw new Error('Wallet QA proof manifest must not contain local path leaks.');
  }
  if (containsSecretLeak(text)) {
    throw new Error('Wallet QA proof manifest must not contain raw secrets or tokens.');
  }
}

function containsLocalPathLeak(text: string): boolean {
  try {
    return publicManifestValueContainsLocalPath(JSON.parse(text));
  } catch {
    return hasLocalPath(text);
  }
}

function publicManifestValueContainsLocalPath(value: unknown): boolean {
  if (typeof value === 'string') {
    return hasLocalPath(value);
  }
  if (Array.isArray(value)) {
    return value.some(publicManifestValueContainsLocalPath);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(publicManifestValueContainsLocalPath);
  }
  return false;
}

function hasLocalPath(value: string): boolean {
  return /file:\/\/\//i.test(value)
    || /(?:^|[\s"'`([{<])(?:[A-Za-z]:\\|\\\\)[^\s"'`)\]}>]+/.test(value)
    || /(?:^|[\s"'`([{<])\/(?!\/)(?:[^/\s"'`)\]}>]+\/)+[^/\s"'`)\]}>]*/.test(value);
}

function containsSecretLeak(text: string): boolean {
  return /\bnpm_[A-Za-z0-9_-]{20,}\b/.test(text)
    || /\b0x[0-9a-fA-F]{64}\b/.test(text)
    || /\b(?:private[_-]?key|seed(?:[ _-]?phrase)?|mnemonic|password|passphrase|secret|token|rpc(?:[_-]?url)?)\b\s*(?::|=|is|was)?\s+(?:[A-Za-z][A-Za-z0-9_-]{5,}|[0-9a-fA-F]{64}|https?:\/\/\S+)/i.test(text)
    || /https?:\/\/[^\s"'`]*\/(?:[^\s"'`]*[A-Za-z0-9_-]{20,}[^\s"'`]*)/i.test(text)
    || /https?:\/\/[^\s"'`]+[?&](?:api[_-]?key|token|key|auth|access[_-]?token)=[^\s"'`&]+/i.test(text)
    || /https?:\/\/[^\s"'`]+:[^\s"'`@]+@[^\s"'`]+/i.test(text);
}

function assertSafeArtifactBasename(fileName: string, label: string): void {
  if (isAbsolute(fileName) || fileName !== basename(fileName) || fileName.includes('..') || fileName.length === 0) {
    throw new Error(`Wallet QA proof ${label} must be a safe basename.`);
  }
}

function assertSafeOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.pathname === '/' && parsed.search === '' && parsed.hash === '') {
      return parsed.origin;
    }
  } catch {
    // handled below
  }
  throw new Error('Wallet QA proof origin must be an http(s) origin without nested paths, query strings, or hashes.');
}

function sanitizeLabel(value: string): string {
  return sanitizePathPart(value);
}

function testMetadataFromInfo(testInfo: TestInfo): WalletQaProofTestMetadata {
  return sanitizeTestMetadata({
    ...(testInfo.project?.name ? { project: testInfo.project.name } : {}),
    ...(testInfo.title ? { title: testInfo.title } : {})
  });
}

function sanitizeTestMetadata(metadata: WalletQaProofTestMetadata): WalletQaProofTestMetadata {
  return {
    ...(metadata.project ? { project: sanitizePathPart(metadata.project) } : {}),
    ...(metadata.title ? { title: redactWalletQaValue(metadata.title) } : {})
  };
}

function sanitizeProvenanceTool(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'writeWalletQaProofManifest';
}

function verifyWalletQaProofProvenance(manifest: WalletQaProofManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error('Wallet QA proof manifest schemaVersion is unsupported.');
  }
  if (!manifest.createdAt || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('Wallet QA proof manifest createdAt provenance is required.');
  }
  if (!manifest.runId || typeof manifest.runId !== 'string') {
    throw new Error('Wallet QA proof manifest runId provenance is required.');
  }
  if (manifest.provenance?.packageName !== '@broccolo1d/playwright' || manifest.provenance.framework !== 'playwright' || !manifest.provenance.tool) {
    throw new Error('Wallet QA proof manifest provenance is incomplete.');
  }
  if (manifest.provenance.packageVersion !== PLAYWRIGHT_PACKAGE_VERSION) {
    throw new Error('Wallet QA proof manifest package version provenance is inconsistent.');
  }
  const runtime = manifest.provenance.runtime;
  const expectedRuntime = runtimeMetadata();
  if (!runtime || runtime.node !== expectedRuntime.node || runtime.platform !== expectedRuntime.platform || runtime.arch !== expectedRuntime.arch) {
    throw new Error('Wallet QA proof manifest runtime provenance is inconsistent.');
  }
  if (manifest.status === 'connected' && (!manifest.origin || !manifest.maskedAccount || manifest.chainId === undefined || manifest.artifacts.length === 0)) {
    throw new Error('Wallet QA connected proof manifest requires origin, masked account, chain, and at least one evidence artifact.');
  }
  const expectedSummary: WalletQaProofSummary = {
    status: manifest.status,
    ...(manifest.origin ? { origin: manifest.origin } : {}),
    ...(manifest.maskedAccount ? { maskedAccount: manifest.maskedAccount } : {}),
    ...(manifest.chainId !== undefined ? { chainId: manifest.chainId } : {}),
    artifactCount: manifest.artifacts.length,
    ...(manifest.decisions ? { decisionCount: manifest.decisions.length } : {}),
    ...(manifest.failure ? { failure: manifest.failure } : {})
  };
  if (JSON.stringify(manifest.summary) !== JSON.stringify(expectedSummary)) {
    throw new Error('Wallet QA proof manifest summary does not match verified manifest fields.');
  }
  const expectedChecksums = manifest.artifacts.map((artifact) => artifact.sha256);
  if (JSON.stringify(manifest.checksums?.artifactSha256) !== JSON.stringify(expectedChecksums)) {
    throw new Error('Wallet QA proof manifest checksums do not match verified artifacts.');
  }
}

function redactFullAddresses(value: string): string {
  return value.replace(/0x[0-9a-fA-F]{40}/g, (address) => maskEthereumAddress(address));
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bnpm_[A-Za-z0-9_-]{20,}\b/g, '[redacted:npm-token]')
    .replace(/https?:\/\/[^\s"'`]+:[^\s"'`@]+@[^\s"'`]+/gi, '[redacted:rpc-url]')
    .replace(/https?:\/\/[^\s"'`]*\/(?:[^\s"'`]*[A-Za-z0-9_-]{20,}[^\s"'`]*)/gi, '[redacted:rpc-url]')
    .replace(/https?:\/\/[^\s"'`]+[?&](?:api[_-]?key|token|key|auth|access[_-]?token)=[^\s"'`&]+/gi, '[redacted:rpc-url]')
    .replace(/\b(?:private[_-]?key|seed(?:[ _-]?phrase)?|mnemonic|password|passphrase|secret|token|rpc(?:[_-]?url)?)\b\s*(?::|=|is|was)?\s+[^\n\r]*/gi, (match) => redactLabeledSecret(match))
    .replace(/\b(?:0x)?[0-9a-fA-F]{64}\b/g, '[redacted:secret]');
}

function redactLabeledSecret(value: string): string {
  const label = value.match(/private[_-]?key|seed(?:[ _-]?phrase)?|mnemonic|password|passphrase|secret|token|rpc(?:[_-]?url)?/i)?.[0] ?? 'secret';
  return `[redacted:${label.toLowerCase().replace(/[ _]/g, '-')}]`;
}

function isSafeMaskedAccount(value: string): boolean {
  return /^0x[0-9a-fA-F]{4}(?:…|\.\.\.)[0-9a-fA-F]{4,5}$/.test(value) && !/0x[0-9a-fA-F]{40}/.test(value);
}

function redactPaths(value: string): string {
  return value
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*([^\\\s]+)/g, '[path]/$1')
    .replace(/\/(?:[^/\s]+\/)+([^/\s]+)/g, '[path]/$1');
}

function requireConfigured<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function sanitizePathPart(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'artifact';
}

function assertPromptSignatureSafety(input: WalletSignaturePromptInput): void {
  if (input.signatureKind !== 'personal_sign' && input.signatureKind !== 'typed_data') {
    throw new Error('Wallet signature prompt kind is required; fail closed.');
  }
  if (!input.expectedChainIdHex?.trim()) {
    throw new Error('Wallet signature prompt chain is required; fail closed.');
  }
  if (!input.message?.trim()) {
    throw new Error('Wallet signature prompt message is required; fail closed.');
  }
}
