import { expect, test } from '@playwright/test';

import { buildPersonalSignParams, buildValueTransaction, getFixtureSelectors } from '../src/fixture.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = '0xaa36a7';
const SIGNATURE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TX_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('fixture dapp completes connect, sign, and transaction requests with an injected provider', async ({ page }) => {
  const selectors = getFixtureSelectors();

  await page.addInitScript(({ account, chainId, signature, txHash }) => {
    type RequestArgs = { method: string; params?: unknown[] | Record<string, unknown> };
    const requests: RequestArgs[] = [];
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    window.ethereum = {
      async request(args: RequestArgs): Promise<unknown> {
        requests.push(args);
        if (args.method === 'eth_accounts') {
          return [];
        }
        if (args.method === 'eth_requestAccounts') {
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
    window.__fixtureProviderRequests = requests;
  }, { account: ACCOUNT, chainId: CHAIN_ID, signature: SIGNATURE, txHash: TX_HASH });

  await page.goto('/');
  await expect(page.locator(selectors.statusOutput)).toContainText('Wallet provider detected');

  await page.locator(selectors.connectButton).click();
  await expect(page.locator(selectors.connectedAccount)).toHaveText(ACCOUNT);
  await expect(page.locator(selectors.currentChain)).toHaveText('Sepolia (11155111 / 0xaa36a7)');

  await page.locator(selectors.signMessageButton).click();
  await expect(page.locator(selectors.signMessageStatus)).toContainText(`Signature received: ${SIGNATURE.slice(0, 18)}...`);

  await page.locator(selectors.sendTransactionButton).click();
  await expect(page.locator(selectors.sendTransactionStatus)).toContainText(`Transaction sent: ${TX_HASH.slice(0, 18)}...`);

  await expect.poll(async () => page.evaluate(() => window.__fixtureProviderRequests)).toEqual([
    { method: 'eth_accounts' },
    { method: 'eth_chainId' },
    { method: 'eth_requestAccounts' },
    { method: 'eth_chainId' },
    { method: 'personal_sign', params: buildPersonalSignParams(ACCOUNT) },
    { method: 'eth_sendTransaction', params: [buildValueTransaction({ from: ACCOUNT, chainId: CHAIN_ID })] }
  ]);
});
