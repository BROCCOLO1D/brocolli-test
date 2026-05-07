import { describe, expect, it } from 'vitest';

import {
  CONNECTED_ACCOUNT_TEST_ID,
  CURRENT_CHAIN_TEST_ID,
  buildPersonalSignParams,
  buildValueTransaction,
  formatAccount,
  formatChainId,
  getFixtureSelectors
} from '../src/fixture.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';

describe('fixture dapp helpers', () => {
  it('exposes stable Playwright selectors for wallet actions and status output', () => {
    expect(getFixtureSelectors()).toEqual({
      connectButton: '[data-testid="connect-wallet-button"]',
      connectedAccount: `[data-testid="${CONNECTED_ACCOUNT_TEST_ID}"]`,
      currentChain: `[data-testid="${CURRENT_CHAIN_TEST_ID}"]`,
      signMessageButton: '[data-testid="sign-message-button"]',
      signMessageStatus: '[data-testid="sign-message-status"]',
      sendTransactionButton: '[data-testid="send-transaction-button"]',
      sendTransactionStatus: '[data-testid="send-transaction-status"]',
      statusOutput: '[data-testid="status-output"]'
    });
  });

  it('formats account and chain values deterministically for display', () => {
    expect(formatAccount(ACCOUNT.toUpperCase())).toBe(ACCOUNT);
    expect(formatAccount(undefined)).toBe('not connected');
    expect(formatChainId('0xaa36a7')).toBe('Sepolia (11155111 / 0xaa36a7)');
    expect(formatChainId('0x7a69')).toBe('Local devnet (31337 / 0x7a69)');
    expect(formatChainId(undefined)).toBe('unknown');
  });

  it('builds EIP-1193 personal_sign params with message first and account second', () => {
    expect(buildPersonalSignParams(ACCOUNT, 'Fixture dapp sign-in')).toEqual([
      '0x466978747572652064617070207369676e2d696e',
      ACCOUNT
    ]);
  });

  it('builds a minimal zero-value transaction back to the connected account by default', () => {
    expect(buildValueTransaction({ from: ACCOUNT, chainId: '0xaa36a7' })).toEqual({
      from: ACCOUNT,
      to: ACCOUNT,
      value: '0x0'
    });
  });

  it('only prepares transactions on Sepolia or local devnet chains', () => {
    expect(buildValueTransaction({ from: ACCOUNT, chainId: '0x7a69' })).toEqual({
      from: ACCOUNT,
      to: ACCOUNT,
      value: '0x0'
    });
    expect(() => buildValueTransaction({ from: ACCOUNT, chainId: '0x1' })).toThrow(/unsupported fixture transaction chain/i);
  });
});
