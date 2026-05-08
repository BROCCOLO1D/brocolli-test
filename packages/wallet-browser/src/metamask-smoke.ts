import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { BrowserContext, Page } from 'playwright';

import type { WalletBrowserEnv } from './config.js';
import { discoverMetaMaskExtensionPage } from './extension-pages.js';
import { launchWalletBrowser } from './launcher.js';

export interface MetaMaskSmokeOptions {
  cwd?: string;
  env?: WalletBrowserEnv;
  artifactDir?: string;
}

export interface MetaMaskSmokeScreenshot {
  label: 'browser-page' | 'metamask-extension';
  path: string;
}

export interface MetaMaskSmokeResult {
  status: 'captured';
  artifactDir: string;
  screenshots: MetaMaskSmokeScreenshot[];
  notes: string[];
}

export type RunMetaMaskSmoke = (options: MetaMaskSmokeOptions) => Promise<MetaMaskSmokeResult>;

export async function captureMetaMaskSmokeScreenshots(options: MetaMaskSmokeOptions = {}): Promise<MetaMaskSmokeResult> {
  const cwd = options.cwd ?? process.cwd();
  const artifactDir = resolve(cwd, options.artifactDir ?? join('.wallet-artifacts', 'metamask-smoke', safeTimestamp()));
  mkdirSync(artifactDir, { recursive: true });

  const { context } = await launchWalletBrowser({ cwd, env: options.env });
  try {
    const browserPage = await openBrowserSmokePage(context);
    const extensionPage = await openOrDiscoverMetaMaskPage(context);

    const screenshots: MetaMaskSmokeScreenshot[] = [
      { label: 'browser-page', path: join(artifactDir, 'browser-page.png') },
      { label: 'metamask-extension', path: join(artifactDir, 'metamask-extension.png') }
    ];

    await browserPage.screenshot({ path: screenshots[0].path, fullPage: true });
    await extensionPage.screenshot({ path: screenshots[1].path, fullPage: true });

    return {
      status: 'captured',
      artifactDir,
      screenshots,
      notes: [
        'No wallet was imported, unlocked, connected, used to sign, or used to transact.',
        'Treat generated screenshots as local-only until visually inspected for sensitive content.'
      ]
    };
  } finally {
    await context.close();
  }
}

async function openBrowserSmokePage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.setContent(`<!doctype html>
<title>Agent Browser Wallet MetaMask Smoke</title>
<main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 52rem;">
  <h1>Agent Browser Wallet MetaMask smoke</h1>
  <p>Chromium launched with an unpacked MetaMask extension in a persistent context.</p>
  <p>This milestone does not import, unlock, connect, sign, or transact.</p>
</main>`);
  return page;
}

async function openOrDiscoverMetaMaskPage(context: BrowserContext): Promise<Page> {
  const existingPage = tryDiscoverMetaMaskPage(context.pages());
  if (existingPage) {
    return existingPage;
  }

  const extensionId = await discoverSingleExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/home.html`);
  return page;
}

function tryDiscoverMetaMaskPage(pages: readonly Page[]): Page | undefined {
  try {
    return discoverMetaMaskExtensionPage(pages);
  } catch {
    return undefined;
  }
}

async function discoverSingleExtensionId(context: BrowserContext): Promise<string> {
  let ids = collectExtensionIds(context);
  if (ids.size === 0) {
    await context.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => undefined);
    ids = collectExtensionIds(context);
  }

  if (ids.size !== 1) {
    throw new Error('Unable to discover a single loaded MetaMask extension id from Chromium service workers.');
  }

  return [...ids][0];
}

function collectExtensionIds(context: BrowserContext): Set<string> {
  const ids = new Set<string>();
  for (const worker of context.serviceWorkers()) {
    const id = extensionIdFromChromeExtensionUrl(worker.url());
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function extensionIdFromChromeExtensionUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'chrome-extension:' ? parsed.hostname : undefined;
  } catch {
    return undefined;
  }
}

function safeTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
