import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

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
} from '@brocolli-test/wallet-browser';

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
} from '@brocolli-test/wallet-browser';

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
  /** Browser/extension/profile options passed to @brocolli-test/wallet-browser when useRealWallet is true. */
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
  requestConnection?: () => Promise<void>;
  expectedAccount?: string;
  expectedChainId?: string | number;
  origin?: string;
  guardrails?: WalletGuardrailConfig;
}

export interface WalletAssertStateOptions {
  expectedAccount?: string;
  expectedChainId?: string | number;
}

export interface WalletQa {
  connect(options?: WalletConnectOptions): Promise<ConnectWalletResult>;
  assertState(options?: WalletAssertStateOptions): Promise<SepoliaNetworkAssertionResult>;
  maskAddress(address: string): string;
}

export interface WalletArtifacts {
  artifactDir: string;
  screenshot(name: string, options?: Parameters<Page['screenshot']>[0]): Promise<string>;
  writeManifest(name: string, data: Record<string, unknown>): Promise<string>;
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

function createWalletQa(page: Page, config: WalletQaConfig): WalletQa {
  return {
    async connect(options = {}) {
      const expectedAccount = options.expectedAccount ?? config.expectedAccount;
      const expectedChainId = options.expectedChainId ?? config.expectedChainId;
      if (!expectedAccount || expectedChainId === undefined) {
        throw new Error('wallet.connect requires expectedAccount and expectedChainId in options or walletConfig.');
      }

      const dapp = createDappDriver(page, config, options.requestConnection);
      const prompt = requireConfigured(config.prompt, 'wallet.connect requires walletConfig.prompt to approve a real wallet prompt; fail closed.');
      const network = requireConfigured(config.network, 'wallet.connect requires walletConfig.network to verify chain/account; fail closed.');
      return connectWallet({
        dapp,
        prompt,
        network,
        expectedAccount,
        expectedChainId,
        origin: options.origin ?? config.origin,
        guardrails: options.guardrails ?? config.guardrails
      });
    },

    async assertState(options = {}) {
      const expectedAccount = options.expectedAccount ?? config.expectedAccount;
      const expectedChainId = options.expectedChainId ?? config.expectedChainId;
      if (!expectedAccount || expectedChainId === undefined) {
        throw new Error('wallet.assertState requires expectedAccount and expectedChainId in options or walletConfig.');
      }

      const network = requireConfigured(config.network, 'wallet.assertState requires walletConfig.network to read wallet state; fail closed.');
      return assertWalletState({ network, expectedAccount, expectedChainId });
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

  return requireConfigured(configured, 'wallet.connect requires requestConnection, walletConfig.dapp, or walletConfig.dappSelectors; fail closed.');
}

function createWalletArtifacts(page: Page, config: WalletQaConfig, testInfo: TestInfo): WalletArtifacts {
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
    }
  };
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
