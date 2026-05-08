#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const cwd = process.cwd();
const requireFromWalletPackage = createRequire(resolve(cwd, 'packages/wallet-browser/package.json'));
const { chromium } = requireFromWalletPackage('playwright');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(cwd, '.wallet-artifacts', 'wildcat-lender', runId);
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!out[key]) out[key] = value.trim();
  }
  return out;
}

const env = parseEnv(resolve(cwd, '.env'));
for (const key of ['SEPOLIA_WALLET_ADDRESS', 'SEPOLIA_WALLET_PRIVATE_KEY', 'METAMASK_PASSWORD']) {
  if (!env[key]?.trim()) throw new Error(`Missing required env var ${key}`);
}

const targetUrl = (env.WILDCAT_LENDER_URL || 'https://testnet.wildcat.finance/lender').trim();
const rpcUrl = (env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com').trim();
const extensionDir = resolve(cwd, (env.METAMASK_EXTENSION_DIR || '.wallet-extensions/metamask/12.17.0/chrome').trim());
const profileDir = resolve(cwd, '.wallet-profiles', `live-wildcat-connect-${runId}`);
const expectedAddress = normalizeAddress(env.SEPOLIA_WALLET_ADDRESS);
const origin = new URL(targetUrl).origin;

function normalizeAddress(value) {
  const address = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Configured wallet address is not a valid 20-byte hex address.');
  return address.toLowerCase();
}

function maskAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-5)}`;
}

function sanitizeText(value) {
  return String(value)
    .replace(/0x[0-9a-fA-F]{40}/g, '[redacted:address]')
    .replace(/https?:\/\/[^\s"']+/g, (url) => {
      try {
        const parsed = new URL(url);
        if (parsed.origin === origin) return `${parsed.origin}${parsed.pathname}`;
      } catch {}
      return '[redacted:url]';
    })
    .slice(0, 600);
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
        if (!(await first.isVisible({ timeout: 500 }).catch(() => false))) continue;
        await first.click({ timeout: 3_000 });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`Unable to click any candidate: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForNotification(context, extensionId, previousPages = new Set(), timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      if (page.isClosed() || previousPages.has(page)) continue;
      const url = page.url();
      if (url.startsWith(`chrome-extension://${extensionId}/`) && url.includes('notification.html')) {
        page.on('console', (msg) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `${msg.type()}: ${msg.text()}\n`, { flag: 'a' }));
        page.on('pageerror', (err) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `pageerror: ${err.message}\n`, { flag: 'a' }));
        await page.bringToFront().catch(() => {});
        return page;
      }
    }
    const page = await context.waitForEvent('page', { timeout: Math.min(1_000, Math.max(1, deadline - Date.now())) }).catch(() => undefined);
    if (page && !page.isClosed() && page.url().startsWith(`chrome-extension://${extensionId}/`) && page.url().includes('notification.html')) {
      page.on('console', (msg) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `${msg.type()}: ${msg.text()}\n`, { flag: 'a' }));
      page.on('pageerror', (err) => writeFileSync(join(artifactDir, 'PROMPT-CONSOLE.log'), `pageerror: ${err.message}\n`, { flag: 'a' }));
      await page.bringToFront().catch(() => {});
      return page;
    }
  }
  throw new Error('Timed out waiting for MetaMask notification prompt.');
}

async function readPromptText(prompt) {
  await prompt.waitForLoadState('domcontentloaded').catch(() => {});
  await prompt.waitForFunction(() => (document.body?.innerText || '').trim().length > 0, undefined, { timeout: 30_000 }).catch(() => {});
  let text = await prompt.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  if (!text.trim()) {
    await prompt.waitForTimeout(2_000);
    text = await prompt.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  }
  return text;
}

async function approveConnectPrompt(context, extensionId, expectedOrigin, previousPages = new Set()) {
  const prompt = await waitForNotification(context, extensionId, previousPages, 30_000);
  const text = await readPromptText(prompt);
  await prompt.screenshot({ path: join(artifactDir, 'connect-prompt.png'), fullPage: true }).catch(() => {});
  writeFileSync(join(artifactDir, 'CONNECT-PROMPT-TEXT.txt'), sanitizeText(text));
  if (/signature|sign|transaction|spending cap|confirm transaction/i.test(text)) throw new Error('Refusing to approve non-connect MetaMask prompt during Wildcat connect flow.');
  const expected = new URL(expectedOrigin);
  const baseDomain = expected.hostname.split('.').slice(-2).join('.');
  if (!text.includes(expected.host) && !text.includes(expected.hostname) && !text.includes(expectedOrigin) && !text.includes(baseDomain)) {
    throw new Error(`MetaMask connect prompt did not show expected Wildcat origin. Prompt began: ${sanitizeText(text)}`);
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
  ], 7_000).catch(() => {});
}

async function approveNetworkPrompt(context, extensionId, previousPages = new Set()) {
  const prompt = await waitForNotification(context, extensionId, previousPages, 25_000);
  const text = await readPromptText(prompt);
  if (/signature|sign|transaction|spending cap|confirm transaction/i.test(text)) throw new Error('Refusing to approve non-network MetaMask prompt during Wildcat network setup.');
  if (!/sepolia|11155111|aa36a7|network|switch|add/i.test(text)) throw new Error(`Unrecognized MetaMask network prompt: ${sanitizeText(text)}`);
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
  ], 5_000).catch(() => {});
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

async function addOrSwitchSepolia(page, context, extensionId) {
  const previousPages = new Set(context.pages());
  const requestPromise = page.evaluate(async ({ rpcUrl }) => {
    const provider = globalThis.ethereum;
    if (!provider?.request) throw new Error('window.ethereum is not available on Wildcat page.');
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
  await approveNetworkPrompt(context, extensionId, previousPages).catch(async (error) => {
    // If MetaMask already switched synchronously there may be no prompt.
    const chain = await page.evaluate(() => globalThis.ethereum?.request?.({ method: 'eth_chainId' })).catch(() => undefined);
    if (chain !== '0xaa36a7') throw error;
  });
  await requestPromise;
}

async function dismissCommonModals(page) {
  for (const candidate of [
    (p) => p.getByRole('button', { name: /^Decline$/i }),
    (p) => p.getByRole('button', { name: /^Allow$/i }),
    (p) => p.getByRole('button', { name: /Accept|Agree|I understand|Close/i })
  ]) {
    await clickFirst(page, [candidate], 2_000).catch(() => {});
  }
}

async function selectMetaMaskIfModalAppears(page) {
  await clickFirst(page, [
    (p) => p.getByRole('button', { name: /MetaMask/i }),
    (p) => p.getByText(/MetaMask/i),
    '[data-testid*="metamask" i]',
    'button:has-text("MetaMask")'
  ], 12_000).catch(() => {});
}

function screenshotEntry(label, file) {
  const path = join(artifactDir, file);
  const bytes = readFileSync(path);
  return { label, file: basename(file), sizeBytes: statSync(path).size, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function writeFailure(blocker, stage, error) {
  const safeMessage = sanitizeText(error instanceof Error ? error.message : String(error));
  writeFileSync(join(artifactDir, 'WILDCAT-LENDER-MANIFEST.json'), `${JSON.stringify({
    artifactType: 'wildcat-lender-wallet-connection-proof',
    target: 'wildcat-lender',
    status: 'failed',
    failure: { blocker, stage, safeMessage },
    diagnostics: ['Live Wildcat run failed before connected proof; screenshots are local-only and not claimed as proof.']
  }, null, 2)}\n`);
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
});

try {
  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  const wallet = await context.newPage();
  await wallet.goto(`chrome-extension://${extensionId}/home.html`, { waitUntil: 'domcontentloaded' });
  await onboarding(wallet);
  await importPrivateKey(wallet);

  const page = await context.newPage();
  page.on('console', (msg) => writeFileSync(join(artifactDir, 'WILDCAT-CONSOLE.log'), `${msg.type()}: ${sanitizeText(msg.text())}\n`, { flag: 'a' }));
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  await dismissCommonModals(page);

  const beforeConnectPages = new Set(context.pages());
  await clickFirst(page, [
    (p) => p.getByRole('button', { name: /^Connect Wallet$/i }),
    (p) => p.getByRole('button', { name: /^Connect$/i }),
    'button:has-text("Connect Wallet")',
    'button:has-text("Connect")'
  ], 20_000);
  await page.waitForTimeout(1_000);
  await selectMetaMaskIfModalAppears(page);
  await approveConnectPrompt(context, extensionId, origin, beforeConnectPages);

  await page.waitForTimeout(5_000);
  let state = await page.evaluate(async () => {
    const provider = globalThis.ethereum;
    const [accounts, chainId] = await Promise.all([
      provider?.request?.({ method: 'eth_accounts' }),
      provider?.request?.({ method: 'eth_chainId' })
    ]);
    return { accounts, chainId, text: document.body?.innerText || '' };
  });
  if (state.chainId !== '0xaa36a7') {
    await addOrSwitchSepolia(page, context, extensionId);
    await page.waitForTimeout(2_000);
    state = await page.evaluate(async () => {
      const provider = globalThis.ethereum;
      const [accounts, chainId] = await Promise.all([
        provider?.request?.({ method: 'eth_accounts' }),
        provider?.request?.({ method: 'eth_chainId' })
      ]);
      return { accounts, chainId, text: document.body?.innerText || '' };
    });
  }
  const observedAccount = Array.isArray(state.accounts) ? String(state.accounts[0] || '').toLowerCase() : '';
  if (observedAccount !== expectedAddress) throw new Error(`Wildcat provider account mismatch after connect.`);
  if (state.chainId !== '0xaa36a7') throw new Error(`Wildcat provider chain mismatch after connect.`);
  const bodyText = String(state.text || '');
  if (/Connect Wallet/i.test(bodyText) && !bodyText.toLowerCase().includes(expectedAddress.slice(2, 6))) {
    throw new Error('Wildcat UI still appears disconnected after provider connected.');
  }

  const screenshotFile = 'wildcat-connected.png';
  await page.screenshot({ path: join(artifactDir, screenshotFile), fullPage: false });
  const manifest = {
    artifactType: 'wildcat-lender-wallet-connection-proof',
    target: 'wildcat-lender',
    status: 'connected',
    evidence: {
      connectionState: 'connected',
      maskedAccount: maskAddress(expectedAddress),
      chainId: 11155111,
      origin: targetUrl
    },
    screenshots: [screenshotEntry('wildcat-connected', screenshotFile)],
    diagnostics: ['Generated from real Chromium + MetaMask against Wildcat testnet lender page.', 'No signing or transaction prompt was approved.']
  };
  writeFileSync(join(artifactDir, 'WILDCAT-LENDER-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'connected', artifactDir, manifest: join(artifactDir, 'WILDCAT-LENDER-MANIFEST.json'), screenshot: join(artifactDir, screenshotFile), maskedAccount: maskAddress(expectedAddress), chain: 'Sepolia (11155111 / 0xaa36a7)' }, null, 2));
} catch (error) {
  const page = context.pages().find((candidate) => !candidate.isClosed() && candidate.url().startsWith(origin)) || context.pages().find((candidate) => !candidate.isClosed());
  if (page) await page.screenshot({ path: join(artifactDir, 'failure.png'), fullPage: false }).catch(() => {});
  writeFailure('unknown', 'verify-wallet-state', error);
  console.error(JSON.stringify({ status: 'failed', artifactDir, error: sanitizeText(error instanceof Error ? error.message : String(error)) }, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
}
