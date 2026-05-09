# `@broccolo1d/playwright`

Playwright fixtures for wallet-backed dapp QA.

App repos own routes, selectors, prompt automation, test data, and assertions. This package supplies a small fixture surface for connect/account/chain proof without hiding wallet policy.

## Install

```bash
pnpm add -D @broccolo1d/playwright @playwright/test
```

ESM-only. Node.js `>=22 <23`.

## Configure

```ts
// playwright.config.ts
import {
  createFailClosedWalletPromptDriver,
  defineWalletQaConfig,
  type MetaMaskNetworkDriver,
  type WalletPromptDriver
} from '@broccolo1d/playwright';

const expectedAccount = '0x0000000000000000000000000000000000000000';
const origin = 'http://127.0.0.1:5173';

// Replace with explicit prompt automation in real wallet jobs.
const delegate: WalletPromptDriver = {
  async approveConnection() {}
};

const prompt = createFailClosedWalletPromptDriver({
  origin,
  expectedAccount,
  expectedChainIdHex: '0xaa36a7',
  delegate
});

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
      expectedAccount,
      expectedChainId: 11155111,
      origin,
      prompt,
      network
    }
  }
});
```

`useRealWallet` defaults to `false`. When enabled, launch config is passed to `@broccolo1d/wallet-browser`, but prompt approval and network reads still require explicit drivers.

## Write a dapp-owned test

```ts
// tests/wallet.spec.ts
import { expect, test, verifyWalletQaProofManifest } from '@broccolo1d/playwright';

test('connects through wallet policy', async ({ page, wallet, walletArtifacts }) => {
  await page.goto('http://127.0.0.1:5173');

  const result = await wallet.connect({
    requestConnection: async () => page.getByRole('button', { name: /connect/i }).click()
  });

  await wallet.assertState();
  const screenshot = await walletArtifacts.screenshot('connected');
  await walletArtifacts.writeProofManifest({
    status: 'connected',
    origin: 'http://127.0.0.1:5173',
    account: result.activeAccount,
    chainId: result.chainId,
    attachments: [{ label: 'wallet-connected', path: screenshot, contentType: 'image/png' }]
  });

  await verifyWalletQaProofManifest(walletArtifacts.artifactDir);
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

## Fixtures

- `walletConfig`: per-test wallet QA configuration.
- `walletContext`: the browser context under test.
- `walletPage`: the page under test.
- `wallet`: `connect`, `assertState`, and `maskAddress` helpers.
- `walletArtifacts`: screenshot, JSON, proof-manifest, and failure-manifest writers.

## Helpers

- `createFailClosedWalletPromptDriver(options)`: wraps an explicit prompt driver and rejects missing handlers, wrong origin, wrong account, or wrong chain.
- `writeWalletQaProofManifest(options)`: writes a public manifest with attachment basename, sha256, size, masked account, safe origin, and redacted failure text.
- `verifyWalletQaProofManifest(artifactDir)`: verifies manifest shape and attachment hashes/sizes.
- `formatWalletQaFailure(error)` / `redactWalletQaValue(value)`: produce doc-safe failure snippets by masking wallet addresses and local paths.

## Failure proof

```ts
try {
  await wallet.assertState({ expectedChainId: 1 });
} catch (error) {
  await walletArtifacts.writeProofManifest({
    status: 'failed',
    failure: error,
    notes: ['negative proof: wrong chain is rejected']
  });
}
```

The manifest is public-oriented metadata. It must not contain full local paths or full wallet addresses. Treat raw screenshots, traces, videos, and profiles as sensitive until reviewed.

## Fail-closed behavior

`wallet.connect` requires expected account and chain ID in options or config. It also requires one of `requestConnection`, `walletConfig.dapp`, or `walletConfig.dappSelectors` to trigger the dapp flow.

No prompt approval is implicit. No signature or transaction approval is claimed by this package-level fixture API. Use lower-level wallet-browser helpers only with explicit policy and tests.
