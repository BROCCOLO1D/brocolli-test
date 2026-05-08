import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BrowserContext, Page } from 'playwright';

import type { WalletBrowserEnv } from './config.js';
import { discoverMetaMaskExtensionPage } from './extension-pages.js';
import { launchWalletBrowser } from './launcher.js';

export interface MetaMaskSmokeOptions {
  cwd?: string;
  env?: WalletBrowserEnv;
  artifactDir?: string;
  extensionScreenshotLabel?: 'metamask-extension' | 'fixture-extension';
  notes?: string[];
}

export interface MetaMaskSmokeScreenshot {
  label: 'browser-page' | 'metamask-extension' | 'fixture-extension';
  path: string;
}

export interface MetaMaskSmokeResult {
  status: 'captured';
  artifactDir: string;
  screenshots: MetaMaskSmokeScreenshot[];
  inspectionGuidePath: string;
  manifestPath: string;
  notes: string[];
}

interface SmokeInspectionGuideOptions {
  artifactDir: string;
  screenshots: readonly MetaMaskSmokeScreenshot[];
  notes: readonly string[];
}

interface SmokeArtifactManifestOptions {
  artifactDir: string;
  screenshots: readonly MetaMaskSmokeScreenshot[];
  inspectionGuidePath: string;
  notes: readonly string[];
}

export interface SmokeArtifactManifestScreenshot {
  label: MetaMaskSmokeScreenshot['label'];
  file: string;
  sizeBytes: number;
  sha256: string;
}

interface SmokeArtifactManifest {
  artifactType: 'wallet-browser-smoke-screenshots';
  inspectionGuide: string;
  screenshots: SmokeArtifactManifestScreenshot[];
  notes: string[];
}

export interface SmokeArtifactVerificationResult {
  status: 'verified';
  artifactDir: string;
  manifestPath: string;
  inspectionGuidePath: string;
  screenshots: SmokeArtifactManifestScreenshot[];
  notes: string[];
}

export type RunMetaMaskSmoke = (options: MetaMaskSmokeOptions) => Promise<MetaMaskSmokeResult>;

export async function captureMetaMaskSmokeScreenshots(options: MetaMaskSmokeOptions = {}): Promise<MetaMaskSmokeResult> {
  const cwd = options.cwd ?? process.cwd();
  const artifactDir = resolve(cwd, options.artifactDir ?? join('.wallet-artifacts', 'metamask-smoke', safeTimestamp()));
  const extensionScreenshotLabel = options.extensionScreenshotLabel ?? 'metamask-extension';
  mkdirSync(artifactDir, { recursive: true });

  const { context } = await launchWalletBrowser({ cwd, env: options.env });
  try {
    const extensionPage = await openOrDiscoverMetaMaskPage(context);
    await waitForMetaMaskUiReady(extensionPage);
    await extensionPage.waitForTimeout(10000);
    const browserPage = await openBrowserSmokePage(context, cwd);

    const screenshots: MetaMaskSmokeScreenshot[] = [
      { label: 'browser-page', path: join(artifactDir, 'browser-page.png') },
      { label: extensionScreenshotLabel, path: join(artifactDir, `${extensionScreenshotLabel}.png`) }
    ];

    await browserPage.screenshot({ path: screenshots[0].path, fullPage: true });
    await extensionPage.bringToFront();
    await extensionPage.screenshot({ path: screenshots[1].path });

    const notes = [
      ...(options.notes ?? []),
      'No wallet was imported, unlocked, connected, used to sign, or used to transact.',
      'Treat generated screenshots as local-only until visually inspected for sensitive content.'
    ];
    const inspectionGuidePath = writeSmokeInspectionGuide({ artifactDir, screenshots, notes });
    const manifestPath = writeSmokeArtifactManifest({ artifactDir, screenshots, inspectionGuidePath, notes });

    return {
      status: 'captured',
      artifactDir,
      screenshots,
      inspectionGuidePath,
      manifestPath,
      notes
    };
  } finally {
    await context.close();
  }
}

export async function captureFixtureExtensionSmokeScreenshots(options: MetaMaskSmokeOptions = {}): Promise<MetaMaskSmokeResult> {
  const cwd = options.cwd ?? process.cwd();
  const artifactDir = resolve(cwd, options.artifactDir ?? join('.wallet-artifacts', 'fixture-extension-smoke', safeTimestamp()));
  const extensionPath = join(artifactDir, 'fixture-extension');
  createFixtureExtension(extensionPath);

  const result = await captureMetaMaskSmokeScreenshots({
    cwd,
    artifactDir,
    env: {
      ...options.env,
      METAMASK_EXTENSION_PATH: extensionPath,
      WALLET_PROFILE_DIR: join(artifactDir, 'profile')
    },
    extensionScreenshotLabel: 'fixture-extension',
    notes: [
      'Fixture extension smoke proves Chromium extension-loading mechanics only; it is not MetaMask UI.',
      'The generated fixture manifest identifies as MetaMask only to exercise the same launcher validation path without downloading the real bundle.'
    ]
  });

  return result;
}

async function openBrowserSmokePage(context: BrowserContext, cwd: string): Promise<Page> {
  const page = await context.newPage();
  const fixtureDappUrl = resolveDefaultFixtureDappSmokeUrl(cwd);
  if (fixtureDappUrl) {
    await page.goto(fixtureDappUrl, { waitUntil: 'domcontentloaded' });
    return page;
  }

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
  const extensionId = await discoverSingleExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/home.html`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function waitForMetaMaskUiReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page
    .getByText(/Create a new wallet|I have an existing wallet|Import an existing wallet|MetaMask encountered an error/i)
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });

  const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
  if (/MetaMask encountered an error/i.test(bodyText)) {
    throw new Error('MetaMask extension UI reached an error screen before smoke screenshot capture.');
  }
}

export function resolveDefaultFixtureDappSmokeUrl(cwd: string): string | undefined {
  const fixtureDappIndex = resolve(cwd, 'apps', 'fixture-dapp', 'index.html');
  return existsSync(fixtureDappIndex) ? pathToFileURL(fixtureDappIndex).toString() : undefined;
}

export function writeSmokeInspectionGuide(options: SmokeInspectionGuideOptions): string {
  const guidePath = join(options.artifactDir, 'INSPECTION.md');
  const checklist = options.screenshots.map((screenshot) => {
    const fileName = basename(screenshot.path);
    return `- [ ] Confirm \`${fileName}\` contains no seed phrases, private keys, passwords, RPC tokens, full wallet addresses, or sensitive local paths.`;
  });
  const notes = options.notes.map((note) => `- ${note}`);
  writeFileSync(
    guidePath,
    `# Wallet browser smoke screenshot inspection

These screenshots are local-only evidence until reviewed. Do not commit or publish them by default.

## Required visual checks

${checklist.join('\n')}
- [ ] Confirm the screenshots do not show wallet import, unlock, account connection, signature approval, or transaction approval state.

## Smoke notes

${notes.join('\n')}

Keep this artifact directory ignored/local-only unless every screenshot above is reviewed and intentionally promoted.
`
  );
  return guidePath;
}

export function writeSmokeArtifactManifest(options: SmokeArtifactManifestOptions): string {
  const manifestPath = join(options.artifactDir, 'SMOKE-MANIFEST.json');
  const screenshots = options.screenshots.map((screenshot) => {
    const bytes = readFileSync(screenshot.path);
    return {
      label: screenshot.label,
      file: basename(screenshot.path),
      sizeBytes: statSync(screenshot.path).size,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  });

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        artifactType: 'wallet-browser-smoke-screenshots',
        inspectionGuide: basename(options.inspectionGuidePath),
        screenshots,
        notes: options.notes
      },
      null,
      2
    )}\n`
  );
  return manifestPath;
}

export function verifySmokeArtifactManifest(artifactDir: string): SmokeArtifactVerificationResult {
  const manifestPath = join(artifactDir, 'SMOKE-MANIFEST.json');
  const manifestText = readFileSync(manifestPath, 'utf8');
  if (manifestText.includes(artifactDir)) {
    throw new Error('Smoke artifact manifest must not contain the full artifact directory path.');
  }

  const manifest = JSON.parse(manifestText) as SmokeArtifactManifest;
  if (manifest.artifactType !== 'wallet-browser-smoke-screenshots') {
    throw new Error('Smoke artifact manifest has an unexpected artifact type.');
  }
  if (!isSafeArtifactFileName(manifest.inspectionGuide)) {
    throw new Error('Smoke artifact manifest inspection guide must be a safe basename.');
  }
  const inspectionGuidePath = join(artifactDir, manifest.inspectionGuide);
  if (!existsSync(inspectionGuidePath)) {
    throw new Error('Smoke artifact inspection guide is missing.');
  }
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length === 0) {
    throw new Error('Smoke artifact manifest must list at least one screenshot.');
  }

  const screenshots = manifest.screenshots.map((screenshot) => verifyManifestScreenshot(artifactDir, screenshot));
  return {
    status: 'verified',
    artifactDir,
    manifestPath,
    inspectionGuidePath,
    screenshots,
    notes: Array.isArray(manifest.notes) ? manifest.notes : []
  };
}

function verifyManifestScreenshot(artifactDir: string, screenshot: SmokeArtifactManifestScreenshot): SmokeArtifactManifestScreenshot {
  if (!isKnownScreenshotLabel(screenshot.label)) {
    throw new Error(`Smoke artifact manifest contains an unexpected screenshot label: ${String(screenshot.label)}`);
  }
  if (!isSafeArtifactFileName(screenshot.file)) {
    throw new Error(`Smoke artifact manifest screenshot file must be a safe basename: ${String(screenshot.file)}`);
  }
  const screenshotPath = join(artifactDir, screenshot.file);
  const bytes = readFileSync(screenshotPath);
  const sizeBytes = statSync(screenshotPath).size;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (screenshot.sizeBytes !== sizeBytes) {
    throw new Error(`Smoke artifact screenshot size mismatch for ${screenshot.file}.`);
  }
  if (screenshot.sha256 !== sha256) {
    throw new Error(`Smoke artifact screenshot hash mismatch for ${screenshot.file}.`);
  }
  return { ...screenshot, sizeBytes, sha256 };
}

function isKnownScreenshotLabel(label: string): label is MetaMaskSmokeScreenshot['label'] {
  return label === 'browser-page' || label === 'metamask-extension' || label === 'fixture-extension';
}

function isSafeArtifactFileName(fileName: string): boolean {
  return typeof fileName === 'string' && fileName.length > 0 && fileName === basename(fileName) && !fileName.includes('..');
}

function createFixtureExtension(extensionPath: string): void {
  mkdirSync(extensionPath, { recursive: true });
  writeFileSync(
    join(extensionPath, 'manifest.json'),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: 'MetaMask',
        short_name: 'MetaMask',
        version: '0.0.0',
        background: { service_worker: 'service-worker.js' },
        action: { default_title: 'Fixture extension' }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(extensionPath, 'service-worker.js'), "chrome.runtime.onInstalled.addListener(() => undefined);\n");
  writeFileSync(
    join(extensionPath, 'home.html'),
    `<!doctype html>
<title>Fixture extension smoke</title>
<main style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 48rem;">
  <h1>Fixture extension loading smoke</h1>
  <p>This generated extension proves Chromium loaded an unpacked extension in a persistent context.</p>
  <p><strong>This is not MetaMask UI.</strong> It does not import, unlock, connect, sign, or transact.</p>
</main>`
  );
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
