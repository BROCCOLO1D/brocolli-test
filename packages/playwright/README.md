# `@broccolo1d/playwright`

Playwright fixtures for wallet-backed dapp QA.

This package extends `@playwright/test` with wallet fixtures while keeping dapp-specific selectors, routes, test data, and assertions in the consuming app repository. It depends on `@broccolo1d/wallet-browser` for browser launch, guardrails, network assertions, prompt drivers, and artifact helpers.

## Install

```bash
pnpm add -D @broccolo1d/playwright @playwright/test
```

The package is ESM-only and requires Node.js `>=22 <23`.

## Configure

```ts
// playwright.config.ts
import { defineWalletQaConfig } from '@broccolo1d/playwright';

export default defineWalletQaConfig({
  use: {
    walletConfig: {
      useRealWallet: false,
      artifactDir: '.wallet-artifacts/playwright'
    }
  }
});
```

`useRealWallet` defaults to `false`. Enable it only in burner/testnet jobs that provide wallet extension/profile configuration through explicit options or ignored environment config.

## Write a dapp-owned test

```ts
// tests/wallet.spec.ts
import { expect, test } from '@broccolo1d/playwright';

test('connects through wallet policy', async ({ page, wallet, walletArtifacts }) => {
  await page.goto('http://127.0.0.1:5173');

  await wallet.connect({
    requestConnection: async () => page.getByRole('button', { name: /connect/i }).click(),
    expectedAccount: '0x0000000000000000000000000000000000000000',
    expectedChainId: 11155111,
    origin: 'http://127.0.0.1:5173'
  });

  await walletArtifacts.screenshot('connected');
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

```ts
// playwright.config.ts
import { defineWalletQaConfig, type MetaMaskNetworkDriver, type WalletPromptDriver } from '@broccolo1d/playwright';

const expectedAccount = '0x0000000000000000000000000000000000000000';

// Replace these fake drivers with explicit prompt/network automation in real wallet jobs.
const prompt: WalletPromptDriver = {
  async approveConnection() {}
};

const network: MetaMaskNetworkDriver = {
  async getChainId() { return 11155111; },
  async getAccounts() { return [expectedAccount]; },
  async switchChain() {},
  async addEthereumChain() {}
};

export default defineWalletQaConfig({
  use: {
    walletConfig: {
      useRealWallet: false,
      artifactDir: '.wallet-artifacts/playwright',
      prompt,
      network
    }
  }
});
```

## Fixtures

- `walletConfig`: per-test wallet QA configuration.
- `walletContext`: browser context used by the test.
- `walletPage`: page used by the test.
- `wallet`: connect/assert/masking helper.
- `walletArtifacts`: screenshot and JSON manifest writer under the configured local artifact directory.

## Fail-closed behavior

`wallet.connect` requires expected account and chain ID. It also requires one of `requestConnection`, `walletConfig.dapp`, or `walletConfig.dappSelectors` to trigger the dapp connection flow.

Real prompt approval is not implicit. A configured prompt driver is required for wallet prompts. A configured network driver is required for chain/account assertions. Without those drivers, the fixtures throw instead of pretending that a wallet action succeeded.

## Artifact handling

`walletArtifacts` writes local screenshots and JSON under `.wallet-artifacts/playwright` by default. Treat those files as sensitive until reviewed. Do not commit traces, screenshots, videos, profiles, reports, or manifests generated from burner-wallet runs unless they have been scrubbed and intentionally promoted to public docs.
