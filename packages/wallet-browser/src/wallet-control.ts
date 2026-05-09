import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import {
  assertExpectedChainAndAccount,
  chainIdToHex,
  normalizeChainId,
  normalizeExpectedAccount,
  provisionSepoliaNetwork,
  redactRpcUrl,
  type MetaMaskNetworkDriver,
  type SepoliaNetworkAssertionResult,
  type SepoliaNetworkConfig
} from './network.js';

export type WalletControlAction =
  | 'connectWallet'
  | 'approveSignature'
  | 'approveTransaction'
  | 'switchNetwork'
  | 'assertWalletState'
  | 'resetProfile';

export type WalletControlLogStatus = 'started' | 'prompt-approved' | 'verified' | 'deleted' | 'skipped' | 'failed';

export interface WalletControlLogEvent {
  action: WalletControlAction;
  status: WalletControlLogStatus;
  origin?: string;
  chainId?: number;
  chainIdHex?: string;
  account?: string;
  target?: string;
  valueWei?: string;
  decision?: 'pending' | 'approved' | 'rejected';
  promptType?: 'connect' | 'signature' | 'transaction';
  metadata?: unknown;
}

export type WalletControlLogger = (event: WalletControlLogEvent) => void;

export interface WalletDappDriver {
  requestConnect(): Promise<void>;
  getConnectedAccount(): Promise<string | undefined>;
  requestSignature?(input: WalletSignatureRequestInput): Promise<void>;
  requestTransaction?(input: WalletTransactionRequestInput): Promise<void>;
}

export interface WalletDappPageLocator {
  click(): Promise<void>;
  textContent(): Promise<string | null>;
}

export interface WalletDappPageLike {
  locator(selector: string): WalletDappPageLocator;
}

export interface WalletDappPageDriverSelectors {
  connectButton: string;
  connectedAccount: string;
  signMessageButton: string;
  sendTransactionButton: string;
}

export interface WalletDappPageDriverOptions {
  page: WalletDappPageLike;
  selectors: WalletDappPageDriverSelectors;
}

export type WalletSignatureKind = 'personal_sign' | 'typed_data';

export interface WalletSignatureRequestInput {
  origin?: string;
  expectedAccount: string;
  message?: string;
  signatureKind: WalletSignatureKind;
}

export interface WalletTransactionRequestInput {
  origin?: string;
  expectedAccount: string;
  to?: string;
  value?: string;
}

export interface WalletConnectionPromptInput {
  origin?: string;
  expectedAccount: string;
  expectedChainIdHex: string;
}

export interface WalletSignaturePromptInput {
  origin: string;
  expectedAccount: string;
  expectedChainIdHex: string;
  message: string;
  signatureKind: WalletSignatureKind;
}

export interface WalletTransactionPromptInput {
  origin?: string;
  expectedAccount: string;
  to?: string;
  value?: string;
}

export interface WalletGuardrailConfig {
  maxTransactionValueWei?: string | number | bigint;
  allowedOrigins?: readonly string[];
  allowedTargets?: readonly string[];
}

export interface WalletPromptDriver {
  approveConnection?(input: WalletConnectionPromptInput): Promise<void>;
  approveSignature?(input: WalletSignaturePromptInput): Promise<void>;
  approveTransaction?(input: WalletTransactionPromptInput): Promise<void>;
}

export interface WalletStateOptions {
  network: MetaMaskNetworkDriver;
  expectedAccount: string;
  expectedChainId: string | number;
  logger?: WalletControlLogger;
  metadata?: unknown;
}

export interface ConnectWalletOptions extends WalletStateOptions {
  dapp: WalletDappDriver;
  prompt: WalletPromptDriver;
  origin?: string;
  guardrails?: WalletGuardrailConfig;
}

export type ConnectWalletResult = Omit<SepoliaNetworkAssertionResult, 'status'> & { status: 'connected' };

export interface ApproveSignatureOptions {
  prompt: WalletPromptDriver;
  dapp?: Pick<WalletDappDriver, 'requestSignature'>;
  origin?: string;
  expectedAccount: string;
  expectedChainId: string | number;
  network: MetaMaskNetworkDriver;
  message?: string;
  signatureKind: WalletSignatureKind;
  guardrails?: WalletGuardrailConfig;
  logger?: WalletControlLogger;
  metadata?: unknown;
}

export interface ApproveTransactionOptions {
  prompt: WalletPromptDriver;
  dapp?: Pick<WalletDappDriver, 'requestTransaction'>;
  origin?: string;
  expectedAccount: string;
  expectedChainId?: string | number;
  network?: MetaMaskNetworkDriver;
  to?: string;
  value?: string;
  guardrails?: WalletGuardrailConfig;
  logger?: WalletControlLogger;
  metadata?: unknown;
}

export interface ResetProfileOptions {
  profileDir: string;
  allowedProfileRoot?: string;
  logger?: WalletControlLogger;
  metadata?: unknown;
}

export interface ResetProfileResult {
  status: 'deleted' | 'skipped';
  profileDir: string;
  allowedProfileRoot: string;
}

export function createWalletDappPageDriver(options: WalletDappPageDriverOptions): WalletDappDriver {
  const { page, selectors } = options;
  return {
    async requestConnect() {
      await page.locator(selectors.connectButton).click();
    },
    async getConnectedAccount() {
      return (await page.locator(selectors.connectedAccount).textContent())?.trim() || undefined;
    },
    async requestSignature() {
      await page.locator(selectors.signMessageButton).click();
    },
    async requestTransaction() {
      await page.locator(selectors.sendTransactionButton).click();
    }
  };
}

export async function connectWallet(options: ConnectWalletOptions): Promise<ConnectWalletResult> {
  const config = createWalletStateConfig(options);
  logWalletControl(options.logger, {
    action: 'connectWallet',
    status: 'started',
    origin: options.origin,
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
    account: config.expectedAccount,
    decision: 'pending',
    promptType: 'connect',
    metadata: options.metadata
  });

  try {
    assertAllowedOrigin(options.origin, options.guardrails);
    await options.dapp.requestConnect();
    if (!options.prompt.approveConnection) {
      throw new Error('MetaMask connection prompt approval is not implemented for the provided prompt driver; fail closed.');
    }
    await options.prompt.approveConnection({
      origin: options.origin,
      expectedAccount: config.expectedAccount,
      expectedChainIdHex: config.chainIdHex
    });
    logWalletControl(options.logger, {
      action: 'connectWallet',
      status: 'prompt-approved',
      origin: options.origin,
      chainId: config.chainId,
      chainIdHex: config.chainIdHex,
      account: config.expectedAccount,
      decision: 'approved',
      promptType: 'connect',
      metadata: options.metadata
    });

    const connectedAccount = normalizeExpectedAccount(await options.dapp.getConnectedAccount());
    if (connectedAccount !== config.expectedAccount) {
      throw new Error(`Dapp connected account ${connectedAccount} does not match expected ${config.expectedAccount}.`);
    }

    const state = await assertExpectedChainAndAccount(config, options.network);
    logWalletControl(options.logger, {
      action: 'connectWallet',
      status: 'verified',
      origin: options.origin,
      chainId: state.chainId,
      chainIdHex: state.chainIdHex,
      account: state.activeAccount,
      decision: 'approved',
      promptType: 'connect',
      metadata: options.metadata
    });

    return { ...state, status: 'connected' };
  } catch (error) {
    logWalletControl(options.logger, {
      action: 'connectWallet',
      status: 'failed',
      origin: options.origin,
      chainId: config.chainId,
      chainIdHex: config.chainIdHex,
      account: config.expectedAccount,
      decision: 'rejected',
      promptType: 'connect',
      metadata: createFailureMetadata(options.metadata, error)
    });
    throw error;
  }
}

export async function approveSignature(options: ApproveSignatureOptions): Promise<void> {
  const expectedAccount = normalizeExpectedAccount(options.expectedAccount);
  let stateConfig: SepoliaNetworkConfig | undefined;
  try {
    assertExplicitSignatureOrigin(options.origin);
    assertExplicitSignatureMessage(options.message);
    assertAllowedOrigin(options.origin, options.guardrails);
    assertExplicitSignatureKind(options.signatureKind);
    stateConfig = createWalletStateConfig(options);
    logWalletControl(options.logger, {
      action: 'approveSignature',
      status: 'started',
      origin: options.origin,
      chainId: stateConfig.chainId,
      chainIdHex: stateConfig.chainIdHex,
      account: expectedAccount,
      decision: 'pending',
      promptType: 'signature',
      metadata: options.metadata
    });
    await assertExpectedChainAndAccount(stateConfig, options.network);
    if (!options.prompt.approveSignature) {
      throw new Error('MetaMask signature prompt approval is not implemented for the provided prompt driver; fail closed.');
    }
    if (options.dapp?.requestSignature) {
      await options.dapp.requestSignature({
        origin: options.origin,
        expectedAccount,
        message: options.message,
        signatureKind: options.signatureKind
      });
    }
    await options.prompt.approveSignature({
      origin: options.origin,
      expectedAccount,
      expectedChainIdHex: stateConfig.chainIdHex,
      message: options.message,
      signatureKind: options.signatureKind
    });
    logWalletControl(options.logger, {
      action: 'approveSignature',
      status: 'prompt-approved',
      origin: options.origin,
      chainId: stateConfig?.chainId,
      chainIdHex: stateConfig?.chainIdHex,
      account: expectedAccount,
      decision: 'approved',
      promptType: 'signature',
      metadata: options.metadata
    });
  } catch (error) {
    logWalletControl(options.logger, {
      action: 'approveSignature',
      status: 'failed',
      origin: options.origin,
      chainId: stateConfig?.chainId,
      chainIdHex: stateConfig?.chainIdHex,
      account: expectedAccount,
      decision: 'rejected',
      promptType: 'signature',
      metadata: createFailureMetadata(options.metadata, error)
    });
    throw error;
  }
}

export async function approveTransaction(options: ApproveTransactionOptions): Promise<void> {
  const expectedAccount = normalizeExpectedAccount(options.expectedAccount);
  const stateConfig = createOptionalWalletStateConfig(options);
  const target = options.to ? normalizeExpectedAccount(options.to) : undefined;
  const valueWei = parseTransactionValueWei(options.value);
  const maxValueWei = parseTransactionValueWei(options.guardrails?.maxTransactionValueWei ?? 0n);
  logWalletControl(options.logger, {
    action: 'approveTransaction',
    status: 'started',
    origin: options.origin,
    chainId: stateConfig?.chainId,
    chainIdHex: stateConfig?.chainIdHex,
    account: expectedAccount,
    target,
    valueWei: valueWei.toString(),
    decision: 'pending',
    promptType: 'transaction',
    metadata: options.metadata
  });
  try {
    assertAllowedOrigin(options.origin, options.guardrails);
    assertAllowedTarget(target, options.guardrails);
    if (valueWei > maxValueWei) {
      throw new Error(`Transaction value ${valueWei.toString()} wei exceeds configured wallet transaction value cap ${maxValueWei.toString()} wei.`);
    }
    if (stateConfig && options.network) {
      await assertExpectedChainAndAccount(stateConfig, options.network);
    }
    if (!options.prompt.approveTransaction) {
      throw new Error('MetaMask transaction prompt approval is not implemented for the provided prompt driver; fail closed.');
    }
    if (options.dapp?.requestTransaction) {
      await options.dapp.requestTransaction({
        origin: options.origin,
        expectedAccount,
        to: target,
        value: options.value
      });
    }
    await options.prompt.approveTransaction({
      origin: options.origin,
      expectedAccount,
      to: target,
      value: options.value
    });
    logWalletControl(options.logger, {
      action: 'approveTransaction',
      status: 'prompt-approved',
      origin: options.origin,
      chainId: stateConfig?.chainId,
      chainIdHex: stateConfig?.chainIdHex,
      account: expectedAccount,
      target,
      valueWei: valueWei.toString(),
      decision: 'approved',
      promptType: 'transaction',
      metadata: options.metadata
    });
  } catch (error) {
    logWalletControl(options.logger, {
      action: 'approveTransaction',
      status: 'failed',
      origin: options.origin,
      chainId: stateConfig?.chainId,
      chainIdHex: stateConfig?.chainIdHex,
      account: expectedAccount,
      target,
      valueWei: valueWei.toString(),
      decision: 'rejected',
      promptType: 'transaction',
      metadata: createFailureMetadata(options.metadata, error)
    });
    throw error;
  }
}

export async function switchNetwork(options: WalletStateOptions): Promise<SepoliaNetworkAssertionResult> {
  const config = createWalletStateConfig(options);
  logWalletControl(options.logger, {
    action: 'switchNetwork',
    status: 'started',
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
    account: config.expectedAccount,
    decision: 'pending',
    metadata: options.metadata
  });
  try {
    const result = await provisionSepoliaNetwork(config, options.network);
    logWalletControl(options.logger, {
      action: 'switchNetwork',
      status: 'verified',
      chainId: result.chainId,
      chainIdHex: result.chainIdHex,
      account: result.activeAccount,
      decision: 'approved',
      metadata: options.metadata
    });
    return result;
  } catch (error) {
    logWalletControl(options.logger, {
      action: 'switchNetwork',
      status: 'failed',
      chainId: config.chainId,
      chainIdHex: config.chainIdHex,
      account: config.expectedAccount,
      decision: 'rejected',
      metadata: createFailureMetadata(options.metadata, error)
    });
    throw error;
  }
}

export async function assertWalletState(options: WalletStateOptions): Promise<SepoliaNetworkAssertionResult> {
  const config = createWalletStateConfig(options);
  logWalletControl(options.logger, {
    action: 'assertWalletState',
    status: 'started',
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
    account: config.expectedAccount,
    decision: 'pending',
    metadata: options.metadata
  });
  try {
    const result = await assertExpectedChainAndAccount(config, options.network);
    logWalletControl(options.logger, {
      action: 'assertWalletState',
      status: 'verified',
      chainId: result.chainId,
      chainIdHex: result.chainIdHex,
      account: result.activeAccount,
      decision: 'approved',
      metadata: options.metadata
    });
    return result;
  } catch (error) {
    logWalletControl(options.logger, {
      action: 'assertWalletState',
      status: 'failed',
      chainId: config.chainId,
      chainIdHex: config.chainIdHex,
      account: config.expectedAccount,
      decision: 'rejected',
      metadata: createFailureMetadata(options.metadata, error)
    });
    throw error;
  }
}

export async function resetProfile(options: ResetProfileOptions): Promise<ResetProfileResult> {
  const profileDir = resolve(options.profileDir);
  const allowedProfileRoot = resolve(options.allowedProfileRoot ?? '.wallet-profiles');
  assertProfileDirIsSafe(profileDir, allowedProfileRoot);

  if (!existsSync(profileDir)) {
    const result = { status: 'skipped' as const, profileDir, allowedProfileRoot };
    logWalletControl(options.logger, { action: 'resetProfile', status: 'skipped', metadata: options.metadata });
    return result;
  }

  await rm(profileDir, { recursive: true, force: true });
  const result = { status: 'deleted' as const, profileDir, allowedProfileRoot };
  logWalletControl(options.logger, { action: 'resetProfile', status: 'deleted', metadata: options.metadata });
  return result;
}

function createFailureMetadata(metadata: unknown, error: unknown): unknown {
  return {
    value: metadata,
    errorMessage: error instanceof Error ? error.message : String(error)
  };
}

function createOptionalWalletStateConfig(options: { expectedAccount: string; expectedChainId?: string | number; network?: MetaMaskNetworkDriver }): SepoliaNetworkConfig | undefined {
  if (options.expectedChainId === undefined && options.network === undefined) {
    return undefined;
  }
  if (options.expectedChainId === undefined || options.network === undefined) {
    throw new Error('Wallet action chain guardrail requires both expectedChainId and network driver when either is configured.');
  }
  return createWalletStateConfig({
    network: options.network,
    expectedAccount: options.expectedAccount,
    expectedChainId: options.expectedChainId
  });
}

function createWalletStateConfig(options: WalletStateOptions): SepoliaNetworkConfig {
  const chainId = normalizeChainId(options.expectedChainId);
  return {
    chainId,
    chainIdHex: chainIdToHex(chainId),
    expectedAccount: normalizeExpectedAccount(options.expectedAccount),
    timeoutMs: 30_000,
    debug: false
  };
}

function parseTransactionValueWei(value: string | number | bigint | undefined): bigint {
  if (value === undefined || value === '') {
    return 0n;
  }
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error('Transaction value guardrail must be a non-negative wei amount.');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Transaction value guardrail must be a non-negative safe integer wei amount.');
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  throw new Error('Transaction value guardrail must be a non-negative decimal or 0x-prefixed wei amount.');
}

function assertExplicitSignatureKind(signatureKind: WalletSignatureKind | undefined): asserts signatureKind is WalletSignatureKind {
  if (signatureKind !== 'personal_sign' && signatureKind !== 'typed_data') {
    throw new Error('Signature kind is required before approving a wallet signature prompt.');
  }
}

function assertExplicitSignatureOrigin(origin: string | undefined): asserts origin is string {
  if (!origin?.trim()) {
    throw new Error('Signature origin is required before requesting or approving a wallet signature prompt.');
  }
}

function assertExplicitSignatureMessage(message: string | undefined): asserts message is string {
  if (!message?.trim()) {
    throw new Error('Expected signature message is required before requesting or approving a wallet signature prompt.');
  }
}

function assertAllowedOrigin(origin: string | undefined, guardrails: WalletGuardrailConfig | undefined): void {
  const allowedOrigins = guardrails?.allowedOrigins;
  if (!allowedOrigins?.length) {
    return;
  }
  if (!origin) {
    throw new Error('Dapp origin is required when wallet origin guardrails are configured.');
  }
  const normalizedOrigin = normalizeDappOriginForPolicy(origin);
  const allowed = allowedOrigins.map((allowedOrigin) => normalizeDappOriginForPolicy(allowedOrigin));
  if (!allowed.includes(normalizedOrigin)) {
    throw new Error(`Dapp origin ${normalizedOrigin} is not allowed by wallet guardrails.`);
  }
}

function assertAllowedTarget(target: string | undefined, guardrails: WalletGuardrailConfig | undefined): void {
  const allowedTargets = guardrails?.allowedTargets;
  if (!allowedTargets?.length) {
    return;
  }
  if (!target) {
    throw new Error('Transaction target is required when wallet target guardrails are configured.');
  }
  const allowed = allowedTargets.map((allowedTarget) => normalizeExpectedAccount(allowedTarget));
  if (!allowed.includes(target)) {
    throw new Error(`Transaction target ${target} is not allowed by wallet guardrails.`);
  }
}

function normalizeDappOriginForPolicy(origin: string): string {
  return sanitizeDappOrigin(origin).toLowerCase();
}

function assertProfileDirIsSafe(profileDir: string, allowedProfileRoot: string): void {
  const rel = relative(allowedProfileRoot, profileDir);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`${sep}..${sep}`)) {
    throw new Error(`Refusing to reset wallet profile outside allowed wallet profile root: ${profileDir}`);
  }
}

function logWalletControl(logger: WalletControlLogger | undefined, event: WalletControlLogEvent): void {
  if (!logger) {
    return;
  }
  logger(sanitizeLogEvent(event) as WalletControlLogEvent);
}

function sanitizeLogEvent(event: WalletControlLogEvent): unknown {
  return redactStructuredValue(event);
}

function redactStructuredValue(value: unknown, keyHint?: string): unknown {
  if (typeof value === 'string') {
    return keyHint === 'origin' ? sanitizeDappOrigin(value) : redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStructuredValue(item, keyHint));
  }
  if (value && typeof value === 'object') {
    const redactedEntries = Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => {
      const sensitiveReplacement = redactionForSensitiveKey(key);
      return [key, sensitiveReplacement ?? redactStructuredValue(innerValue, key)];
    });
    return Object.fromEntries(redactedEntries);
  }
  return value;
}

function redactString(value: string): string {
  return value
    .replace(/^.*\b[A-Z0-9_]*PRIVATE[_-]?KEY[A-Z0-9_]*\s*=.*$/gim, '[redacted:private-key]')
    .replace(/^.*\b[A-Z0-9_]*(?:MNEMONIC|SEED|PHRASE)[A-Z0-9_]*\s*=.*$/gim, '[redacted:seed-phrase]')
    .replace(/^.*\b[A-Z0-9_]*PASSWORD[A-Z0-9_]*\s*=.*$/gim, '[redacted:password]')
    .replace(/0x[a-fA-F0-9]{64}/g, '[redacted:private-key]')
    .replace(/\b[a-fA-F0-9]{64}\b/g, '[redacted:private-key]')
    .replace(/\b(?:[a-z][a-z0-9]*\s+){11,23}[a-z][a-z0-9]*\b/gi, '[redacted:seed-phrase]')
    .replace(/https?:\/\/[^\s)"']+/gi, (match) => redactRpcUrl(match));
}

function sanitizeDappOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return redactString(value);
  }
}

function redactionForSensitiveKey(key: string): string | undefined {
  if (/private[_-]?key/i.test(key)) {
    return '[redacted:private-key]';
  }
  if (/seed|phrase|mnemonic/i.test(key)) {
    return '[redacted:seed-phrase]';
  }
  if (/password|passphrase/i.test(key)) {
    return '[redacted:password]';
  }
  if (/token|secret/i.test(key)) {
    return '[redacted]';
  }
  return undefined;
}
