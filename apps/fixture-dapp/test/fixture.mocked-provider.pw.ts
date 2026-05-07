import { expect, test, type Page } from '@playwright/test';

import { buildPersonalSignParams, buildValueTransaction, getFixtureSelectors } from '../src/fixture.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = '0xaa36a7';
const SIGNATURE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TX_HASH = `0x${'bb'.repeat(32)}`;

type RequestArgs = { method: string; params?: unknown[] | Record<string, unknown> };

type FixtureWindow = typeof window & {
  ethereum?: {
    request(args: RequestArgs): Promise<unknown>;
    on(event: string, listener: (...args: unknown[]) => void): void;
  };
  __fixtureProviderRequests?: RequestArgs[];
};

async function injectProvider(page: Page, chainId = CHAIN_ID): Promise<void> {
  await page.addInitScript(({ account, chainId, signature, txHash }) => {
    type RequestArgs = { method: string; params?: unknown[] | Record<string, unknown> };
    const requests: RequestArgs[] = [];
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const fixtureWindow = window as FixtureWindow;
    let connected = false;

    fixtureWindow.ethereum = {
      async request(args: RequestArgs): Promise<unknown> {
        requests.push(args);
        if (args.method === 'eth_accounts') {
          return connected ? [account] : [];
        }
        if (args.method === 'eth_requestAccounts') {
          connected = true;
          return [account];
        }
        if (args.method === 'eth_chainId') {
          return chainId;
        }
        if (args.method === 'personal_sign') {
          return signature;
        }
        if (args.method === 'eth_sendTransaction') {
          return txHash;
        }
        throw new Error(`Unexpected method: ${args.method}`);
      },
      on(event: string, listener: (...args: unknown[]) => void): void {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      }
    };
    fixtureWindow.__fixtureProviderRequests = requests;
  }, { account: ACCOUNT, chainId, signature: SIGNATURE, txHash: TX_HASH });
}

async function getProviderRequests(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as FixtureWindow).__fixtureProviderRequests);
}

test('fixture dapp completes connect, sign, and transaction requests with an injected provider', async ({ page }) => {
  const selectors = getFixtureSelectors();

  await injectProvider(page);

  await page.goto('/');
  await expect(page.locator(selectors.statusOutput)).toContainText('Wallet provider detected');

  await page.locator(selectors.connectButton).click();
  await expect(page.locator(selectors.connectedAccount)).toHaveText(ACCOUNT);
  await expect(page.locator(selectors.currentChain)).toHaveText('Sepolia (11155111 / 0xaa36a7)');

  await page.locator(selectors.signMessageButton).click();
  await expect(page.locator(selectors.signMessageStatus)).toContainText(`Signature received: ${SIGNATURE.slice(0, 18)}...`);

  await page.locator(selectors.sendTransactionButton).click();
  await expect(page.locator(selectors.sendTransactionStatus)).toContainText(`Transaction sent: ${TX_HASH.slice(0, 18)}...`);

  await expect.poll(async () => getProviderRequests(page)).toEqual([
    { method: 'eth_accounts' },
    { method: 'eth_chainId' },
    { method: 'eth_requestAccounts' },
    { method: 'eth_chainId' },
    { method: 'personal_sign', params: buildPersonalSignParams(ACCOUNT) },
    { method: 'eth_sendTransaction', params: [buildValueTransaction({ from: ACCOUNT, chainId: CHAIN_ID })] }
  ]);
});

test('fixture dapp refuses to prepare a transaction on unsupported chains', async ({ page }) => {
  const selectors = getFixtureSelectors();

  await injectProvider(page, '0x1');

  await page.goto('/');
  await page.locator(selectors.connectButton).click();
  await expect(page.locator(selectors.currentChain)).toHaveText('Unknown chain (1 / 0x1)');

  await page.locator(selectors.sendTransactionButton).click();
  await expect(page.locator(selectors.sendTransactionStatus)).toContainText('Error: Unsupported fixture transaction chain: 0x1');
  await expect(page.locator(selectors.statusOutput)).toContainText('Error: Unsupported fixture transaction chain: 0x1');

  await expect.poll(async () => getProviderRequests(page)).toEqual([
    { method: 'eth_accounts' },
    { method: 'eth_chainId' },
    { method: 'eth_requestAccounts' },
    { method: 'eth_chainId' }
  ]);
});
