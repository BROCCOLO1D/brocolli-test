import type { BrowserContext, Page } from 'playwright';

import type { WalletBrowserEnv } from './config.js';
import { discoverMetaMaskExtensionPage, isMetaMaskExtensionPageUrl as isKnownMetaMaskExtensionPageUrl } from './extension-pages.js';

export type MetaMaskOnboardingState = 'needs-import' | 'locked' | 'unlocked' | 'unknown';
export type MetaMaskOnboardingStatus = 'pending' | 'verified';

export interface MetaMaskOnboardingEnv extends WalletBrowserEnv {
  SEPOLIA_WALLET_ADDRESS?: string;
  SEPOLIA_WALLET_PRIVATE_KEY?: string;
  METAMASK_PASSWORD?: string;
  METAMASK_ONBOARDING_TIMEOUT_MS?: string;
  METAMASK_ONBOARDING_DEBUG?: string;
}

export interface ResolveMetaMaskOnboardingConfigOptions {
  env?: MetaMaskOnboardingEnv;
  expectedAddress?: string;
  privateKey?: string;
  password?: string;
  timeoutMs?: number;
  debug?: boolean;
}

export interface MetaMaskOnboardingConfig {
  expectedAddress: string;
  privateKey: string;
  password: string;
  timeoutMs: number;
  debug: boolean;
}

export interface RedactedMetaMaskOnboardingPlan {
  status: 'pending';
  expectedAddress: string;
  privateKey: string;
  password: string;
  timeoutMs: number;
  debug: boolean;
  selectors: typeof METAMASK_ONBOARDING_SELECTORS;
  run(driver: MetaMaskOnboardingDriver): Promise<MetaMaskOnboardingResult>;
}

export interface MetaMaskOnboardingResult {
  status: MetaMaskOnboardingStatus;
  expectedAddress: string;
  activeAddress: string;
}

export interface MetaMaskImportPrivateKeyInput {
  expectedAddress: string;
  privateKey: string;
  password: string;
  timeoutMs: number;
}

export interface MetaMaskUnlockInput {
  expectedAddress: string;
  password: string;
  timeoutMs: number;
}

export interface MetaMaskOnboardingDriver {
  getState(): Promise<MetaMaskOnboardingState>;
  importPrivateKey(input: MetaMaskImportPrivateKeyInput): Promise<void>;
  unlock(input: MetaMaskUnlockInput): Promise<void>;
  getActiveAddress(): Promise<string>;
}

export interface MetaMaskPageDriverOptions {
  context: BrowserContext;
  page?: Page;
  extensionId?: string;
  timeoutMs?: number;
}

export interface MetaMaskExtensionPageDiscoveryOptions {
  context: BrowserContext;
  extensionId?: string;
}

export const DEFAULT_METAMASK_ONBOARDING_TIMEOUT_MS = 60_000;

export const METAMASK_ONBOARDING_SELECTORS = {
  termsCheckbox: '[data-testid="onboarding-terms-checkbox"]',
  importWalletButton: '[data-testid="onboarding-import-wallet"]',
  noThanksMetricsButton: '[data-testid="metametrics-no-thanks"]',
  privateKeyInput: '[data-testid="private-key-box"]',
  passwordInput: '[data-testid="create-password-new"]',
  confirmPasswordInput: '[data-testid="create-password-confirm"]',
  importSubmitButton: '[data-testid="import-wallet-button"]',
  unlockPasswordInput: '[data-testid="unlock-password"]',
  unlockSubmitButton: '[data-testid="unlock-submit"]',
  accountAddressButton: '[data-testid="account-menu-icon"]'
} as const;

export function resolveMetaMaskOnboardingConfig(
  options: ResolveMetaMaskOnboardingConfigOptions = {}
): MetaMaskOnboardingConfig {
  const env = options.env ?? process.env;
  const expectedAddress = validateEthereumAddress(options.expectedAddress ?? env.SEPOLIA_WALLET_ADDRESS);
  const privateKey = validatePrivateKey(options.privateKey ?? env.SEPOLIA_WALLET_PRIVATE_KEY);
  const password = validateMetaMaskPassword(options.password ?? env.METAMASK_PASSWORD);

  return {
    expectedAddress,
    privateKey,
    password,
    timeoutMs: resolveTimeoutMs(options.timeoutMs, env.METAMASK_ONBOARDING_TIMEOUT_MS),
    debug: options.debug ?? parseBoolean(env.METAMASK_ONBOARDING_DEBUG)
  };
}

export function validateEthereumAddress(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || !/^0x[a-fA-F0-9]{40}$/i.test(trimmed)) {
    throw new Error('SEPOLIA_WALLET_ADDRESS must be a 0x-prefixed 20-byte Ethereum address.');
  }

  return trimmed.toLowerCase();
}

export function validatePrivateKey(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error('SEPOLIA_WALLET_PRIVATE_KEY is required for MetaMask onboarding.');
  }

  const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error('SEPOLIA_WALLET_PRIVATE_KEY must be a 32-byte hex private key.');
  }

  return normalized;
}

export function validateMetaMaskPassword(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 8) {
    throw new Error('METAMASK_PASSWORD must be at least 8 characters long.');
  }

  return trimmed;
}

export function maskSecret(value: string): string {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }

  return `[redacted:${value.length} chars]`;
}

export function createMetaMaskOnboardingPlan(config: MetaMaskOnboardingConfig): RedactedMetaMaskOnboardingPlan {
  return {
    status: 'pending',
    expectedAddress: config.expectedAddress,
    privateKey: maskSecret(config.privateKey),
    password: maskSecret(config.password),
    timeoutMs: config.timeoutMs,
    debug: config.debug,
    selectors: METAMASK_ONBOARDING_SELECTORS,
    run: (driver) => runMetaMaskOnboarding(config, driver)
  };
}

export async function runMetaMaskOnboarding(
  config: MetaMaskOnboardingConfig,
  driver: MetaMaskOnboardingDriver
): Promise<MetaMaskOnboardingResult> {
  const state = await runRedactedOnboardingStep(config, 'read MetaMask onboarding state', () => driver.getState());

  switch (state) {
    case 'needs-import':
      await runRedactedOnboardingStep(config, 'import private key into MetaMask', () =>
        driver.importPrivateKey({
          expectedAddress: config.expectedAddress,
          privateKey: config.privateKey,
          password: config.password,
          timeoutMs: config.timeoutMs
        })
      );
      await runRedactedOnboardingStep(config, 'unlock MetaMask', () =>
        driver.unlock({ expectedAddress: config.expectedAddress, password: config.password, timeoutMs: config.timeoutMs })
      );
      break;
    case 'locked':
      await runRedactedOnboardingStep(config, 'unlock MetaMask', () =>
        driver.unlock({ expectedAddress: config.expectedAddress, password: config.password, timeoutMs: config.timeoutMs })
      );
      break;
    case 'unlocked':
      break;
    case 'unknown':
      throw new Error('Unknown MetaMask onboarding state; refusing to continue without leaking onboarding secrets.');
  }

  const activeAddress = validateEthereumAddress(
    await runRedactedOnboardingStep(config, 'read active MetaMask address', () => driver.getActiveAddress())
  );
  if (activeAddress !== config.expectedAddress) {
    throw new Error(`MetaMask active address ${activeAddress} does not match expected ${config.expectedAddress}.`);
  }

  return { status: 'verified', expectedAddress: config.expectedAddress, activeAddress };
}

export async function importPrivateKeyIntoMetaMaskPage(page: Page, input: MetaMaskImportPrivateKeyInput): Promise<void> {
  await clickIfPresent(page, METAMASK_ONBOARDING_SELECTORS.termsCheckbox, input.timeoutMs);
  await clickIfPresent(page, METAMASK_ONBOARDING_SELECTORS.importWalletButton, input.timeoutMs);
  await clickIfPresent(page, METAMASK_ONBOARDING_SELECTORS.noThanksMetricsButton, input.timeoutMs);

  const srpWords = 'test test test test test test test test test test test junk'.split(' ');
  if (await selectorExists(page, '[data-testid="import-srp__srp-word-0"]')) {
    for (let index = 0; index < srpWords.length; index += 1) {
      await page.locator(`[data-testid="import-srp__srp-word-${index}"]`).fill(srpWords[index]);
    }
  } else if (await selectorExists(page, METAMASK_ONBOARDING_SELECTORS.privateKeyInput)) {
    await page.locator(METAMASK_ONBOARDING_SELECTORS.privateKeyInput).fill(input.privateKey);
  }

  if (await selectorExists(page, METAMASK_ONBOARDING_SELECTORS.passwordInput)) {
    await page.locator(METAMASK_ONBOARDING_SELECTORS.passwordInput).fill(input.password);
  }
  if (await selectorExists(page, METAMASK_ONBOARDING_SELECTORS.confirmPasswordInput)) {
    await page.locator(METAMASK_ONBOARDING_SELECTORS.confirmPasswordInput).fill(input.password);
  }

  await clickIfPresent(page, '[data-testid="import-srp-confirm"]', input.timeoutMs);
  await clickIfPresent(page, METAMASK_ONBOARDING_SELECTORS.importSubmitButton, input.timeoutMs);
  await clickIfPresent(page, '[data-testid="onboarding-complete-done"]', input.timeoutMs);
  await clickIfPresent(page, '[data-testid="pin-extension-next"]', input.timeoutMs);
  await clickIfPresent(page, '[data-testid="pin-extension-done"]', input.timeoutMs);
}

export async function unlockMetaMaskPage(page: Page, input: MetaMaskUnlockInput): Promise<void> {
  await page.locator(METAMASK_ONBOARDING_SELECTORS.unlockPasswordInput).fill(input.password);
  await page.locator(METAMASK_ONBOARDING_SELECTORS.unlockSubmitButton).click();
  await clickIfPresent(page, '[data-testid="onboarding-complete-done"]', input.timeoutMs);
  await clickIfPresent(page, '[data-testid="pin-extension-next"]', input.timeoutMs);
  await clickIfPresent(page, '[data-testid="pin-extension-done"]', input.timeoutMs);
}

export async function verifyMetaMaskActiveAddress(page: Page, expectedAddress: string): Promise<string> {
  const normalized = validateEthereumAddress(expectedAddress);
  const body = (await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '')).toLowerCase();
  if (body.includes(normalized) || (body.includes(normalized.slice(0, 6)) && body.includes(normalized.slice(-5)))) {
    return normalized;
  }

  throw new Error(`MetaMask active address did not match expected ${normalized.slice(0, 6)}…${normalized.slice(-4)}.`);
}

export function isMetaMaskExtensionPageUrl(url: string, extensionId?: string): boolean {
  return isKnownMetaMaskExtensionPageUrl(url, { extensionId });
}

export function findMetaMaskExtensionPage(options: MetaMaskExtensionPageDiscoveryOptions): Page {
  try {
    return discoverMetaMaskExtensionPage(options.context.pages(), { extensionId: options.extensionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('No MetaMask extension page found')) {
      throw new Error('Unknown MetaMask extension UI state: no MetaMask extension page is open in the provided BrowserContext.');
    }

    if (message.startsWith('Multiple MetaMask extension page candidates found')) {
      throw new Error('Unknown MetaMask extension UI state: multiple MetaMask extension pages are open; pass an explicit Page to avoid ambiguity.');
    }

    throw error;
  }
}

export async function createMetaMaskPageDriver(options: MetaMaskPageDriverOptions): Promise<MetaMaskOnboardingDriver> {
  const page = options.page ?? findMetaMaskExtensionPage(options);

  return {
    async getState() {
      if (await hasAnyVisibleSelector(page, [METAMASK_ONBOARDING_SELECTORS.unlockPasswordInput])) {
        return 'locked';
      }

      if (
        await hasAnyVisibleSelector(page, [
          METAMASK_ONBOARDING_SELECTORS.termsCheckbox,
          METAMASK_ONBOARDING_SELECTORS.importWalletButton,
          METAMASK_ONBOARDING_SELECTORS.privateKeyInput
        ])
      ) {
        return 'needs-import';
      }

      if (await hasAnyVisibleSelector(page, [METAMASK_ONBOARDING_SELECTORS.accountAddressButton])) {
        return 'unlocked';
      }

      return 'unknown';
    },
    async importPrivateKey(input) {
      await importPrivateKeyIntoMetaMaskPage(page, input);
    },
    async unlock(input) {
      await unlockMetaMaskPage(page, input);
    },
    async getActiveAddress() {
      return verifyMetaMaskActiveAddress(page, '');
    }
  };
}

async function selectorExists(page: Page, selector: string): Promise<boolean> {
  try {
    return (await page.locator(selector).count()) > 0;
  } catch {
    return false;
  }
}

async function clickIfPresent(page: Page, selector: string, timeoutMs: number): Promise<boolean> {
  try {
    if (!(await selectorExists(page, selector))) return false;
    await page.locator(selector).click({ timeout: Math.min(timeoutMs, 5_000) });
    await page.waitForTimeout?.(250).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyVisibleSelector(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      if ((await page.locator(selector).count()) > 0) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

function resolveTimeoutMs(explicit: number | undefined, envValue: string | undefined): number {
  const value = explicit ?? (envValue?.trim() ? Number(envValue) : DEFAULT_METAMASK_ONBOARDING_TIMEOUT_MS);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('METAMASK_ONBOARDING_TIMEOUT_MS must be a positive integer number of milliseconds.');
  }

  return value;
}

async function runRedactedOnboardingStep<T>(
  config: MetaMaskOnboardingConfig,
  step: string,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ${step}: ${redactOnboardingSecrets(rawMessage, config)}`);
  }
}

function redactOnboardingSecrets(message: string, config: MetaMaskOnboardingConfig): string {
  return [config.privateKey, config.privateKey.slice(2), config.password]
    .filter((value) => value.length > 0)
    .reduce((redacted, secret) => redacted.split(secret).join(maskSecret(secret)), message)
    .replace(/0x[a-fA-F0-9]{64}/g, '[redacted:private-key]')
    .replace(/\b[a-fA-F0-9]{64}\b/g, '[redacted:private-key]');
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
