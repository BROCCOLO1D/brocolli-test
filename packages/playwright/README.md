# `@broccolo1d/playwright`

Playwright fixtures for policy-gated browser-wallet dapp QA.

This package is for consumer app repos. The app owns routes, selectors, wallet modal behavior, test data, prompt automation, and assertions. `@broccolo1d/playwright` provides the fixture surface for connect/account/chain proof, artifact capture, and fail-closed policy wiring.

## Install

```bash
pnpm add -D @broccolo1d/playwright@0.2.1 @playwright/test
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

const expectedAccount = process.env.SEPOLIA_WALLET_ADDRESS;
if (!expectedAccount) throw new Error('SEPOLIA_WALLET_ADDRESS is required for wallet QA');

const origin = 'http://127.0.0.1:5173';

// Implement this in the app test repo after reviewing the exact wallet UI flow.
const promptAutomation: WalletPromptDriver = {
  async approveConnection() {
    throw new Error('prompt automation must be implemented before approving real wallet prompts');
  }
};

const prompt = createFailClosedWalletPromptDriver({
  origin,
  expectedAccount,
  expectedChainIdHex: '0xaa36a7',
  delegate: promptAutomation
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

`useRealWallet` defaults to `false`. When enabled, launch options are passed to `@broccolo1d/wallet-browser`, but prompt approval and network reads still require explicit drivers.

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
    attachments: [{ label: 'dapp-connected', path: screenshot, contentType: 'image/png' }],
    notes: ['connect-only wallet QA proof']
  });

  await verifyWalletQaProofManifest(walletArtifacts.artifactDir);
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

The proof manifest stores public-oriented metadata: attachment basenames, sha256 hashes, sizes, masked account, safe origin, chain ID, and redacted failure text. It intentionally does not store full local paths or full wallet addresses.

## Fixture surface

- `walletConfig`: per-test wallet QA configuration.
- `walletContext`: browser context under test.
- `walletPage`: page under test.
- `wallet`: `connect`, `assertState`, and `maskAddress` helpers.
- `walletArtifacts`: screenshot, JSON, proof-manifest, and failure-manifest writers.

## Helpers

- `defineWalletQaConfig(config)`: typed Playwright config wrapper for wallet QA fixtures.
- `createFailClosedWalletPromptDriver(options)`: wraps explicit prompt automation and rejects missing handlers, missing/wrong origin, wrong account, or wrong chain.
- `writeWalletQaProofManifest(options)`: writes a public proof manifest with safe attachment metadata and redacted failures.
- `verifyWalletQaProofManifest(artifactDir)`: verifies manifest shape, attachment hashes/sizes, and rejects full addresses or local path leaks.
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
  await verifyWalletQaProofManifest(walletArtifacts.artifactDir);
}
```

## Fail-closed behavior

`wallet.connect` requires expected account and chain ID in options or config. It also requires one of `requestConnection`, `walletConfig.dapp`, or `walletConfig.dappSelectors` to trigger the dapp flow.

No prompt approval is implicit. No signature or transaction approval is claimed by this fixture API. Add those only through reviewed app-owned prompt automation and lower-level policy helpers.

## CI pattern

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm exec playwright install --with-deps chromium
- run: xvfb-run -a pnpm test
  env:
    SEPOLIA_WALLET_ADDRESS: ${{ secrets.SEPOLIA_WALLET_ADDRESS }}
```

Keep traces, videos, raw screenshots, profiles, extension bundles, and `.env` files out of git. Upload artifacts only after `verifyWalletQaProofManifest` passes and screenshots have been reviewed.
