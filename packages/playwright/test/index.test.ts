import { describe, expect, it } from 'vitest';

import { defineWalletQaConfig, test } from '../src/index.js';

describe('@brocolli-test/playwright exports', () => {
  it('exports an extended Playwright test and config helper', () => {
    expect(typeof test).toBe('function');
    expect(typeof test.extend).toBe('function');
    expect(defineWalletQaConfig({ use: { walletConfig: { useRealWallet: false } } })).toMatchObject({
      use: { walletConfig: { useRealWallet: false } }
    });
  });
});
