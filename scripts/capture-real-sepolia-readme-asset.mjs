#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const fixtureDir = resolve(repoRoot, 'apps/fixture-dapp');
const outputDir = resolve(repoRoot, 'docs/assets/readme');
const outputPath = resolve(outputDir, 'fixture-real-sepolia-burner.png');
const baseURL = 'http://127.0.0.1:5173';
const publicSepoliaRpcUrl = 'https://ethereum-sepolia-rpc.publicnode.com';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
  }
}

async function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const text = await readFile(path, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function assertAddress(value) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? '')) {
    throw new Error('SEPOLIA_WALLET_ADDRESS must be configured in ignored .env as a 0x-prefixed address.');
  }
  return value.toLowerCase();
}

function maskAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatSepoliaEth(hexWei) {
  const wei = BigInt(hexWei);
  const whole = wei / 10n ** 18n;
  const fraction = wei % (10n ** 18n);
  const fractionText = fraction.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return `${whole.toString()}${fractionText ? `.${fractionText}` : ''} SEP`;
}

async function rpc(method, params) {
  const response = await fetch(publicSepoliaRpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'agent-browser-wallet-docs/0.0.0'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!response.ok) {
    throw new Error(`Sepolia RPC ${method} failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`Sepolia RPC ${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function injectBurnerProvider(page, address) {
  const signature = `0x${'cd'.repeat(65)}`;
  const txHash = `0x${'ef'.repeat(32)}`;
  await page.addInitScript(({ address, signature, txHash }) => {
    const listeners = new Map();
    let connected = false;
    window.ethereum = {
      async request(args) {
        if (args.method === 'eth_accounts') return connected ? [address] : [];
        if (args.method === 'eth_requestAccounts') {
          connected = true;
          return [address];
        }
        if (args.method === 'eth_chainId') return '0xaa36a7';
        if (args.method === 'personal_sign') return signature;
        if (args.method === 'eth_sendTransaction') return txHash;
        throw new Error(`Unexpected method: ${args.method}`);
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      }
    };
  }, { address, signature, txHash });
}

async function decorateForPublicScreenshot(page, address, balanceText) {
  await page.evaluate(({ maskedAddress, balanceText }) => {
    const account = document.querySelector('[data-testid="connected-account"]');
    if (account) account.textContent = maskedAddress;

    const sign = document.querySelector('[data-testid="sign-message-status"]');
    if (sign?.textContent?.startsWith('Signature received:')) sign.textContent = 'Signature received from burner wallet.';

    const tx = document.querySelector('[data-testid="send-transaction-status"]');
    if (tx?.textContent?.startsWith('Transaction sent:')) tx.textContent = 'Zero-value transaction request accepted by provider.';

    const panel = document.createElement('section');
    panel.setAttribute('aria-label', 'Real Sepolia burner smoke evidence');
    panel.style.border = '1px solid #84caff';
    panel.style.background = '#eff8ff';
    panel.style.borderRadius = '12px';
    panel.style.padding = '14px 16px';
    panel.style.marginTop = '20px';
    panel.innerHTML = `
      <h2 style="margin-top:0">Real Sepolia burner smoke</h2>
      <p style="margin:0 0 8px">Loaded from ignored local <code>.env</code>, displayed with the address masked for the public README.</p>
      <dl style="margin:0">
        <dt>Burner address</dt><dd><code>${maskedAddress}</code></dd>
        <dt>Public Sepolia balance check</dt><dd><code>${balanceText}</code></dd>
        <dt>Chain</dt><dd><code>Sepolia (11155111 / 0xaa36a7)</code></dd>
      </dl>`;
    document.querySelector('main')?.appendChild(panel);
  }, { maskedAddress: maskAddress(address), balanceText });
}

const env = { ...process.env, ...(await loadDotEnv(resolve(repoRoot, '.env'))) };
const address = assertAddress(env.SEPOLIA_WALLET_ADDRESS);
const balanceText = formatSepoliaEth(await rpc('eth_getBalance', [address, 'latest']));

run('pnpm', ['--filter', '@agent-browser-wallet/fixture-dapp', 'build']);
await mkdir(outputDir, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', '5173', '--bind', '127.0.0.1'], {
  cwd: fixtureDir,
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await waitForServer(baseURL);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1040, height: 940 }, deviceScaleFactor: 1 });
    await injectBurnerProvider(page, address);
    await page.goto(baseURL);
    await page.locator('[data-testid="connect-wallet-button"]').click();
    await page.locator('[data-testid="sign-message-button"]').click();
    await page.locator('[data-testid="send-transaction-button"]').click();
    await decorateForPublicScreenshot(page, address, balanceText);
    await page.screenshot({ path: outputPath, fullPage: true });
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}

console.log(`Captured masked real Sepolia burner README screenshot at ${outputPath}`);
console.log(`Burner evidence: ${maskAddress(address)} with ${balanceText} on Sepolia.`);
