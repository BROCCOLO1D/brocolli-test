import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { expect, test as base, type Page, type TestInfo } from '@playwright/test';

export interface WalletContractAssertionInput {
  page: Page;
  route: WalletContractRoute;
  testInfo: TestInfo;
}

export interface WalletContractRoute {
  name: string;
  path: string;
  walletAffordance?: string | RegExp;
  assert?: (input: WalletContractAssertionInput) => Promise<void>;
}

export interface WalletContractTestsOptions {
  appName: string;
  baseUrl: string;
  expectedChainId: string | number;
  expectedAccount: string;
  routes: WalletContractRoute[];
  test?: typeof base;
}

export type WalletContractScenario = 'disconnected';

export interface WalletContractRow {
  title: string;
  scenario: WalletContractScenario;
  route: WalletContractRoute;
  url: string;
  artifactBasename: string;
}

export function createWalletContractRows(options: WalletContractTestsOptions): WalletContractRow[] {
  return options.routes.map((route) => {
    const routeSlug = sanitizeContractSlug(route.name);
    return {
      title: `${options.appName} wallet contract: ${routeSlug} renders disconnected wallet affordance`,
      scenario: 'disconnected',
      route,
      url: new URL(route.path, ensureTrailingSlash(options.baseUrl)).toString(),
      artifactBasename: `contract-${routeSlug}-disconnected`
    };
  });
}

export interface WalletContractEvidenceOptions {
  artifactDir: string;
  row: WalletContractRow;
  appName: string;
  expectedChainId: string | number;
  expectedAccount: string;
  screenshotPath: string;
  status: 'passed' | 'failed';
  assertionSummary?: string;
}

export interface WalletContractEvidenceResult {
  manifestPath: string;
  indexPath: string;
}

export async function writeWalletContractEvidence(options: WalletContractEvidenceOptions): Promise<WalletContractEvidenceResult> {
  await mkdir(options.artifactDir, { recursive: true });
  const screenshotFile = basename(options.screenshotPath);
  const manifestFile = `${options.row.artifactBasename}.json`;
  const indexFile = 'wallet-contract-artifact-index.json';
  assertSafeBasename(screenshotFile, 'screenshot');
  assertSafeBasename(manifestFile, 'manifest');
  const bytes = await readFile(options.screenshotPath);
  const fileStat = await stat(options.screenshotPath);
  const manifest = {
    schemaVersion: 1,
    artifactType: 'wallet-contract-test',
    createdAt: new Date().toISOString(),
    appName: options.appName,
    route: { name: options.row.route.name, path: options.row.route.path },
    scenario: options.row.scenario,
    expectedChainId: options.expectedChainId,
    maskedExpectedAccount: maskAccount(options.expectedAccount),
    screenshot: {
      file: screenshotFile,
      sizeBytes: fileStat.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      contentType: 'image/png'
    },
    status: options.status,
    ...(options.assertionSummary ? { assertionSummary: options.assertionSummary } : {})
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  assertNoUnsafePublicText(manifestText, options);
  const manifestPath = join(options.artifactDir, manifestFile);
  await writeFile(manifestPath, manifestText, 'utf8');

  const index = {
    schemaVersion: 1,
    artifactType: 'wallet-contract-artifact-index',
    createdAt: new Date().toISOString(),
    summary: { manifestCount: 1, screenshotCount: 1 },
    manifests: [{ file: manifestFile, screenshot: screenshotFile, status: options.status, scenario: options.row.scenario }]
  };
  const indexPath = join(options.artifactDir, indexFile);
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return { manifestPath, indexPath };
}

export function walletContractTests(options: WalletContractTestsOptions): void {
  const test = options.test ?? base;
  for (const row of createWalletContractRows(options)) {
    test(row.title, async ({ page }, testInfo) => {
      let status: WalletContractEvidenceOptions['status'] = 'passed';
      let assertionSummary = row.route.walletAffordance ? 'wallet affordance visible' : 'route assertion completed';
      let failure: unknown;
      try {
        await page.goto(row.url);
        if (row.route.walletAffordance instanceof RegExp) {
          await expect(page.getByText(row.route.walletAffordance).first()).toBeVisible();
        } else if (row.route.walletAffordance) {
          await expect(page.getByText(row.route.walletAffordance).first()).toBeVisible();
        }
        await row.route.assert?.({ page, route: row.route, testInfo });
      } catch (error) {
        status = 'failed';
        assertionSummary = error instanceof Error ? error.message : 'wallet contract assertion failed';
        failure = error;
      }

      const screenshotPath = testInfo.outputPath(`${row.artifactBasename}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await writeWalletContractEvidence({
        artifactDir: testInfo.outputDir,
        row,
        appName: options.appName,
        expectedChainId: options.expectedChainId,
        expectedAccount: options.expectedAccount,
        screenshotPath,
        status,
        assertionSummary
      });
      if (failure) throw failure;
    });
  }
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function sanitizeContractSlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Wallet contract route names must include at least one safe character.');
  return slug;
}

function assertSafeBasename(value: string, label: string): void {
  if (!value || value !== basename(value) || value.includes('/') || value.includes('\\')) {
    throw new Error(`Wallet contract ${label} must be a safe basename.`);
  }
}

function maskAccount(account: string): string {
  const normalized = account.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized) || normalized === '0x0000000000000000000000000000000000000000') {
    throw new Error('Wallet contract expectedAccount must be a non-zero Ethereum address.');
  }
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

function assertNoUnsafePublicText(text: string, options: WalletContractEvidenceOptions): void {
  if (text.includes(options.expectedAccount) || text.includes(options.expectedAccount.toLowerCase())) {
    throw new Error('Wallet contract manifest must not expose the full expected account.');
  }
  if (text.includes(options.artifactDir)) {
    throw new Error('Wallet contract manifest must not expose local artifact paths.');
  }
}
