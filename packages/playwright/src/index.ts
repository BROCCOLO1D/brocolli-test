import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile, copyFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { defineConfig, expect, test as base, type BrowserContext, type Page, type PlaywrightTestConfig, type TestInfo } from '@playwright/test';
import {
  assertWalletState,
  connectWallet,
  createWalletDappPageDriver,
  launchWalletBrowser,
  maskEthereumAddress,
  type ConnectWalletResult,
  type MetaMaskNetworkDriver,
  type SepoliaNetworkAssertionResult,
  type WalletBrowserConfig,
  type WalletBrowserLaunchResult,
  type WalletDappDriver,
  type WalletDappPageDriverSelectors,
  type WalletGuardrailConfig,
  type WalletPromptDriver
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

export interface WalletAssertStateOptions {
  expectedAccount?: string;
  expectedChainId?: string | number;
}

export interface WalletQa {
  connect(options?: WalletConnectOptions): Promise<ConnectWalletResult>;
  assertState(options?: WalletAssertStateOptions): Promise<SepoliaNetworkAssertionResult>;
  expectConnected(options?: WalletAssertStateOptions): Promise<SepoliaNetworkAssertionResult>;
  expectChain(options?: Pick<WalletAssertStateOptions, 'expectedChainId' | 'expectedAccount'>): Promise<SepoliaNetworkAssertionResult>;
  maskAddress(address: string): string;
}

export interface WalletArtifacts {
  artifactDir: string;
  screenshot(name: string, options?: Parameters<Page['screenshot']>[0]): Promise<string>;
  writeManifest(name: string, data: Record<string, unknown>): Promise<string>;
  writeProofManifest(options: Omit<WalletQaProofManifestOptions, 'artifactDir'>): Promise<string>;
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
  artifactType: 'wallet-qa-proof';
  status: WalletQaProofStatus;
  origin?: string;
  maskedAccount?: string;
  chainId?: number | string;
  artifacts: WalletQaProofArtifact[];
  failure?: string;
  notes?: string[];
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
}

export interface WalletQaProofVerificationResult {
  status: 'verified';
  artifactDir: string;
  manifestPath: string;
  manifest: WalletQaProofManifest;
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

export function defineWalletQaConfig(config: WalletQaPlaywrightConfig): WalletQaPlaywrightConfig {
  return defineConfig(config) as WalletQaPlaywrightConfig;
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
      return writeWalletQaProofManifest({ ...options, artifactDir: runDir });
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
  const manifest: WalletQaProofManifest = {
    artifactType: 'wallet-qa-proof',
    status: options.status,
    ...(options.origin ? { origin: assertSafeOrigin(options.origin) } : {}),
    ...(options.account ? { maskedAccount: maskEthereumAddress(options.account) } : {}),
    ...(options.chainId !== undefined ? { chainId: options.chainId } : {}),
    artifacts,
    ...(options.failure !== undefined ? { failure: formatWalletQaFailure(options.failure) } : {}),
    ...(options.notes ? { notes: options.notes.map((note) => redactWalletQaValue(note)) } : {})
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
  const manifest = JSON.parse(text) as WalletQaProofManifest;
  if (manifest.artifactType !== 'wallet-qa-proof') {
    throw new Error('Wallet QA proof manifest has an unexpected artifact type.');
  }
  if (manifest.status !== 'connected' && manifest.status !== 'failed') {
    throw new Error('Wallet QA proof manifest has an unexpected status.');
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error('Wallet QA proof manifest artifacts must be an array.');
  }
  for (const artifact of manifest.artifacts) {
    await verifyProofArtifact(resolvedArtifactDir, artifact);
  }
  return { status: 'verified', artifactDir: resolvedArtifactDir, manifestPath, manifest };
}

export function formatWalletQaFailure(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactWalletQaValue(message);
}

export function redactWalletQaValue(value: unknown): string {
  return redactPaths(redactFullAddresses(typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
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

function assertSafeArtifactBasename(fileName: string, label: string): void {
  if (isAbsolute(fileName) || fileName !== basename(fileName) || fileName.includes('..') || fileName.length === 0) {
    throw new Error(`Wallet QA proof ${label} must be a safe basename.`);
  }
}

function assertSafeOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.search === '' && parsed.hash === '') {
      return origin;
    }
  } catch {
    // handled below
  }
  throw new Error('Wallet QA proof origin must be an http(s) origin without query strings or hashes.');
}

function sanitizeLabel(value: string): string {
  return sanitizePathPart(value);
}

function redactFullAddresses(value: string): string {
  return value.replace(/0x[0-9a-fA-F]{40}/g, (address) => maskEthereumAddress(address));
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
