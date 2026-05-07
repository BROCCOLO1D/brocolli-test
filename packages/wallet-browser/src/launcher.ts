import { chromium, type BrowserContext } from 'playwright';

import { resolveWalletBrowserConfig, type ResolveWalletBrowserConfigOptions, type WalletBrowserConfig } from './config.js';

export interface PreparedChromiumLaunchOptions {
  browserName: 'chromium';
  userDataDir: string;
  options: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;
}

export interface WalletBrowserLaunchResult {
  context: BrowserContext;
  config: WalletBrowserConfig;
}

export function buildChromiumExtensionArgs(metamaskExtensionPath: string): string[] {
  return [
    `--disable-extensions-except=${metamaskExtensionPath}`,
    `--load-extension=${metamaskExtensionPath}`
  ];
}

export function prepareChromiumLaunchOptions(config: WalletBrowserConfig): PreparedChromiumLaunchOptions {
  return {
    browserName: 'chromium',
    userDataDir: config.profileDir,
    options: {
      headless: false,
      args: buildChromiumExtensionArgs(config.metamaskExtensionPath)
    }
  };
}

export async function launchWalletBrowser(
  options: ResolveWalletBrowserConfigOptions = {}
): Promise<WalletBrowserLaunchResult> {
  const config = resolveWalletBrowserConfig(options);
  const launchOptions = prepareChromiumLaunchOptions(config);
  const context = await chromium.launchPersistentContext(launchOptions.userDataDir, launchOptions.options);

  return { context, config };
}
