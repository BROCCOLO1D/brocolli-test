#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const cwd = process.cwd();
const requireFromWalletPackage = createRequire(resolve(cwd, 'packages/wallet-browser/package.json'));
const { chromium } = requireFromWalletPackage('playwright');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(cwd, '.wallet-artifacts', 'fixture-connect', runId);
mkdirSync(artifactDir, { recursive: true });

function parseEnv(file) {
  const out = { ...process.env };
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!out[key]) out[key] = value.trim();
  }
  return out;
}

const env = parseEnv(resolve(cwd, '.env'));
const required = ['SEPOLIA_WALLET_ADDRESS', 'SEPOLIA_WALLET_PRIVATE_KEY', 'METAMASK_PASSWORD'];
for (const key of required) {
  if (!env[key]?.trim()) throw new Error(`Missing required env var ${key}`);
}

const fixtureUrl = (env.FIXTURE_DAPP_URL || 'http://127.0.0.1:5173').trim();
const rpcUrl = (env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com').trim();
const extensionDir = resolve(cwd, (env.METAMASK_EXTENSION_DIR || '.wallet-extensions/metamask/12.17.0/chrome').trim());
const profileDir = resolve(cwd, '.wallet-profiles', `live-fixture-connect-${runId}`);
const expectedAddress = normalizeAddress(env.SEPOLIA_WALLET_ADDRESS);
const origin = new URL(fixtureUrl).origin;

function normalizeAddress(value) {
  const address = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Configured wallet address is not a valid 20-byte hex address.');
  return address.toLowerCase();
}

function maskAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
}

async function clickFirst(page, candidates, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      try {
        const locator = typeof candidate === 'string' ? page.locator(candidate) : candidate(page);
        const count = await locator.count().catch(() => 0);
        if (count === 0) continue;
        const first = locator.first();
        if (!(await first.isVisible({ timeout: 400 }).catch(() => false))) continue;
        await first.click({ timeout: 2_000 });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`Unable to click any candidate button: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForNotification(context, extensionId, previousPages = new Set(), timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      if (previousPages.has(page)) continue;
      const url = page.url();
      if (url.startsWith(`chrome-extension://${extensionId}/`) && url.includes('notification.html')) {
        await page.bringToFront().catch(() => {});
        page.on('console', (msg) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `${msg.type()}: ${msg.text()}\n`, { flag: 'a' }));
        page.on('pageerror', (err) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `pageerror: ${err.message}\n`, { flag: 'a' }));
        return page;
      }
    }
    const pagePromise = context.waitForEvent('page', { timeout: Math.min(1_000, Math.max(1, deadline - Date.now())) }).catch(() => undefined);
    const page = await pagePromise;
    if (page && !page.isClosed() && page.url().startsWith(`chrome-extension://${extensionId}/`) && page.url().includes('notification.html')) {
      await page.bringToFront().catch(() => {});
      page.on('console', (msg) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `${msg.type()}: ${msg.text()}\n`, { flag: 'a' }));
      page.on('pageerror', (err) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `pageerror: ${err.message}\n`, { flag: 'a' }));
      return page;
    }
  }
  throw new Error('Timed out waiting for MetaMask notification prompt.');
}

async function describePages(context) {
  const entries = [];
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    const body = await page.locator('body').innerText({ timeout: 500 }).catch(() => '');
    entries.push(`${page.url()} body=${body.trim().slice(0, 40).replace(/\s+/g, ' ')}`);
  }
  return entries.join(' | ');
}

async function approveConnectPrompt(context, extensionId, expectedOrigin, previousPages = new Set()) {
  const prompt = await waitForNotification(context, extensionId, previousPages);
  await prompt.waitForLoadState('domcontentloaded').catch(() => {});
  await prompt.waitForFunction(() => (document.body?.innerText || '').trim().length > 0, undefined, { timeout: 30_000 }).catch(() => {});
  let text = await prompt.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  if (!text.trim()) {
    await prompt.waitForTimeout(2_000);
    text = await prompt.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  }
  await prompt.screenshot({ path: join(artifactDir, 'connect-prompt.png'), fullPage: true }).catch(() => {});
  writeFileSync(join(artifactDir, 'CONNECT-PROMPT-TEXT.txt'), text.replace(/0x[0-9a-fA-F]{40}/g, '[redacted:address]'));
  if (/signature|sign|transaction|spending cap|confirm transaction/i.test(text)) {
    throw new Error('Refusing to approve non-connect MetaMask prompt during connect flow.');
  }
  const expected = new URL(expectedOrigin);
  if (!text.includes(expected.host) && !text.includes(expected.hostname) && !text.includes(expectedOrigin)) {
    throw new Error(`MetaMask connect prompt did not show the expected fixture origin. Prompt text began: ${text.slice(0, 120).replace(/\s+/g, ' ')} Pages: ${await describePages(context)}`);
  }
  await clickFirst(prompt, [
    '[data-testid="page-container-footer-next"]',
    '[data-testid="page-container-footer-connect"]',
    (p) => p.getByRole('button', { name: /^Next$/i }),
    (p) => p.getByRole('button', { name: /^Connect$/i })
  ]);
  await clickFirst(prompt, [
    '[data-testid="page-container-footer-connect"]',
    '[data-testid="page-container-footer-next"]',
    (p) => p.getByRole('button', { name: /^Connect$/i }),
    (p) => p.getByRole('button', { name: /^Next$/i })
  ]).catch(() => {
    // Some MetaMask versions only need one click and close the prompt immediately.
  });
}

async function approveNetworkPrompt(context, extensionId, previousPages = new Set()) {
  const prompt = await waitForNotification(context, extensionId, previousPages, 20_000);
  await prompt.waitForLoadState('domcontentloaded').catch(() => {});
  await prompt.waitForFunction(() => (document.body?.innerText || '').trim().length > 0, undefined, { timeout: 30_000 }).catch(() => {});
  let text = await prompt.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  if (!text.trim()) {
    await prompt.waitForTimeout(2_000);
    text = await prompt.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  }
  if (/signature|sign|transaction|spending cap|confirm transaction/i.test(text)) {
    throw new Error('Refusing to approve non-network MetaMask prompt during network setup.');
  }
  if (!/sepolia|11155111|aa36a7|network|switch|add/i.test(text)) {
    throw new Error('MetaMask network prompt was not recognizable as a Sepolia add/switch prompt.');
  }
  await clickFirst(prompt, [
    '[data-testid="confirmation-submit-button"]',
    '[data-testid="page-container-footer-next"]',
    (p) => p.getByRole('button', { name: /Approve|Switch network|Switch|Confirm/i }),
    'button.btn-primary'
  ]);
  await clickFirst(prompt, [
    '[data-testid="confirmation-submit-button"]',
    (p) => p.getByRole('button', { name: /Switch to Sepolia|Switch network|Switch|Confirm/i }),
    'button.btn-primary'
  ], 5_000).catch(() => {
    // Some MetaMask versions only need one network-approval click and close the prompt immediately.
  });
}

async function onboarding(page) {
  await page.locator('[data-testid="onboarding-terms-checkbox"]').click({ timeout: 20_000 });
  await page.locator('[data-testid="onboarding-create-wallet"]').click();
  await page.getByText(/No thanks/i).click();
  await page.locator('[data-testid="create-password-new"]').fill(env.METAMASK_PASSWORD);
  await page.locator('[data-testid="create-password-confirm"]').fill(env.METAMASK_PASSWORD);
  await page.locator('[data-testid="create-password-terms"]').click();
  await page.locator('[data-testid="create-password-wallet"]').click();
  await page.locator('[data-testid="secure-wallet-later"]').click();
  await page.locator('[data-testid="skip-srp-backup-popover-checkbox"]').click();
  await page.locator('[data-testid="skip-srp-backup"]').click();
  await page.locator('[data-testid="onboarding-complete-done"]').click();
  await page.getByText(/Next/i).click();
  await page.locator('[data-testid="pin-extension-done"]').click();
}

async function importPrivateKey(page) {
  await page.locator('[data-testid="account-menu-icon"]').click({ timeout: 20_000 });
  await page.getByText(/Add account or hardware wallet/i).click();
  await page.getByText('Private Key', { exact: true }).click();
  await page.locator('#private-key-box').fill(env.SEPOLIA_WALLET_PRIVATE_KEY);
  await page.getByText(/^Import$/).click();
  await page.getByText(/Account 2|Imported/i).first().waitFor({ timeout: 20_000 }).catch(() => {});
}

async function addOrSwitchSepolia(dapp, context, extensionId) {
  const previousPages = new Set(context.pages());
  const requestPromise = dapp.evaluate(async ({ rpcUrl }) => {
    const provider = globalThis.ethereum;
    if (!provider?.request) throw new Error('window.ethereum is not available on fixture dapp page.');
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      if (code !== 4902 && code !== -32603) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0xaa36a7',
          chainName: 'Sepolia',
          nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: ['https://sepolia.etherscan.io']
        }]
      });
    }
  }, { rpcUrl });
  await approveNetworkPrompt(context, extensionId, previousPages);
  await requestPromise;
}

function screenshotEntry(label, file) {
  const path = join(artifactDir, file);
  const bytes = readFileSync(path);
  return { label, file: basename(file), sizeBytes: statSync(path).size, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
});

try {
  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const extensionId = new URL(serviceWorker.url()).host;

  const wallet = await context.newPage();
  await wallet.goto(`chrome-extension://${extensionId}/home.html`, { waitUntil: 'domcontentloaded' });
  await onboarding(wallet);
  await importPrivateKey(wallet);

  const dapp = await context.newPage();
  await dapp.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  const beforeConnectPages = new Set(context.pages());
  await dapp.locator('[data-testid="connect-wallet-button"]').click({ timeout: 20_000 });
  await approveConnectPrompt(context, extensionId, origin, beforeConnectPages);

  await dapp.locator('[data-testid="connected-account"]').waitFor({ timeout: 20_000 });
  const connectedText = (await dapp.locator('[data-testid="connected-account"]').innerText()).trim().toLowerCase();
  if (!connectedText.includes(expectedAddress)) {
    throw new Error(`Fixture connected account mismatch. Observed masked text did not contain expected account.`);
  }

  await addOrSwitchSepolia(dapp, context, extensionId);
  await dapp.reload({ waitUntil: 'domcontentloaded' });
  await dapp.locator('[data-testid="connect-wallet-button"]').click({ timeout: 20_000 }).catch(() => {});
  await dapp.locator('[data-testid="connected-account"]').waitFor({ timeout: 20_000 });
  await dapp.locator('[data-testid="current-chain"]').waitFor({ timeout: 20_000 });
  const chainText = (await dapp.locator('[data-testid="current-chain"]').innerText()).trim();
  if (!/11155111|0xaa36a7|Sepolia/i.test(chainText)) {
    throw new Error(`Fixture chain mismatch after Sepolia setup: ${chainText}`);
  }

  const screenshotFile = 'fixture-connected.png';
  await dapp.screenshot({ path: join(artifactDir, screenshotFile), fullPage: true });
  const manifest = {
    artifactType: 'fixture-dapp-wallet-connection-proof',
    target: 'fixture-dapp',
    status: 'connected',
    evidence: {
      connectionState: 'connected',
      maskedAccount: maskAddress(expectedAddress),
      chainId: 11155111,
      origin
    },
    screenshots: [screenshotEntry('fixture-connected', screenshotFile)],
    notes: ['Generated from real Chromium + MetaMask extension against local fixture dapp.', 'Manifest intentionally omits private key, wallet password, RPC URL, full address, profile path, and extension path.']
  };
  writeFileSync(join(artifactDir, 'FIXTURE-PROOF-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'connected', artifactDir, manifest: join(artifactDir, 'FIXTURE-PROOF-MANIFEST.json'), screenshot: join(artifactDir, screenshotFile), maskedAccount: maskAddress(expectedAddress), chain: chainText }, null, 2));
} catch (error) {
  const failureFile = 'failure.png';
  const page = context.pages().find((candidate) => !candidate.isClosed());
  if (page) await page.screenshot({ path: join(artifactDir, failureFile), fullPage: true }).catch(() => {});
  writeFileSync(join(artifactDir, 'FAILED-RUN.json'), `${JSON.stringify({ status: 'failed', stage: 'live-fixture-connect', error: error instanceof Error ? error.message : String(error), screenshot: existsSync(join(artifactDir, failureFile)) ? failureFile : undefined }, null, 2)}\n`);
  console.error(JSON.stringify({ status: 'failed', artifactDir, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
}
