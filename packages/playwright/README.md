# `@broccolo1d/playwright`

Playwright fixtures for policy-gated browser-wallet dapp QA.

This package is for consumer app repos. The app owns routes, selectors, wallet modal behavior, test data, prompt automation, and assertions. `@broccolo1d/playwright` provides the fixture surface for connect/account/chain proof, artifact capture, and fail-closed policy wiring.

## Install

```bash
pnpm add -D @broccolo1d/playwright@0.2.9 @playwright/test
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
  },
  async approveSignature() {
    throw new Error('prompt automation must be implemented before approving real signature prompts');
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
import { annotateWalletQaArtifact, expect, test, verifyWalletQaProofManifest } from '@broccolo1d/playwright';

test('connects through wallet policy', async ({ page, wallet, walletArtifacts }) => {
  await page.goto('http://127.0.0.1:5173');

  const result = await wallet.connect({
    click: async () => page.getByRole('button', { name: /connect/i }).click()
  });

  await wallet.switchChain();
  await wallet.expectConnected();
  await wallet.expectChain({ expectedChainId: 11155111 });

  await wallet.signMessage({
    message: 'Sign in with Example',
    click: async () => page.getByRole('button', { name: /sign in/i }).click()
  });

  await wallet.signTypedData({
    message: JSON.stringify({ domain: { name: 'Example', chainId: 11155111 } }),
    click: async () => page.getByRole('button', { name: /sign typed data/i }).click()
  });

  const screenshot = await walletArtifacts.screenshot('connected');
  await walletArtifacts.connectedProof('wallet-connected', {
    origin: 'http://127.0.0.1:5173',
    account: result.activeAccount,
    chainId: result.chainId,
    attachments: [{ label: 'dapp-connected', path: screenshot, contentType: 'image/png' }],
    notes: ['connect-only wallet QA proof']
  });

  const verification = await verifyWalletQaProofManifest(walletArtifacts.artifactDir, 'wallet-connected.json');
  await walletArtifacts.writeArtifactIndex({ manifestNames: ['wallet-connected.json'] });
  annotateWalletQaArtifact(test.info(), {
    kind: 'proof-manifest',
    file: 'wallet-connected.json',
    status: 'connected',
    chainId: result.chainId,
    maskedAccount: verification.manifest.maskedAccount
  });
  annotateWalletQaArtifact(test.info(), {
    kind: 'artifact-index',
    file: 'wallet-qa-artifact-index.json',
    status: 'connected'
  });
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

The proof manifest stores public-oriented metadata: `schemaVersion: 1`, `createdAt`, `runId`, package/framework/tool provenance, optional Playwright project/title metadata, attachment basenames, sha256 hashes, sizes, masked account, safe origin, chain ID, redacted failure text, verifier-friendly `summary`, and artifact checksum lists. It intentionally does not store full local paths, full wallet addresses, raw query/hash origins, or raw secrets.

`verifyWalletQaProofManifest()` returns the parsed manifest plus verifier-side provenance (`schemaVersion`, `createdAt`, `runId`, `provenance`) and a `manifestSha256` digest computed from the manifest file. The digest is intentionally returned by the verifier instead of embedded in the manifest to avoid self-hashing ambiguity. Manifests must include schema v1 provenance; downgraded manifests without `schemaVersion` are rejected.

`walletArtifacts.writeArtifactIndex({ manifestNames })` (or `writeWalletQaArtifactIndex`) writes `wallet-qa-artifact-index.json`: a CI-friendly, public-safe summary of verified proof manifests, manifest sha256 digests, masked account/chain/origin fields, and evidence artifact basenames/hashes. Upload this index with reviewed proof artifacts so agents and CI reviewers can discover evidence without scanning raw Playwright output.

`annotateWalletQaArtifact(test.info(), { kind, file, status, chainId, maskedAccount })` adds stable Playwright annotations such as `wallet-qa:proof-manifest` and `wallet-qa:artifact-index` to the current test. Annotation files must be safe basenames, and notes are redacted through the same address/path/secret filters used by proof manifests so reports can point reviewers at promoted artifacts without leaking local paths or wallet material.

## Wildcat README-quality example

Wildcat uses this package as a product-app example rather than a toy fixture. Copy this pattern when documenting another dapp integration:

```bash
# CI-safe app smoke; no private wallet material.
NEXT_PUBLIC_TARGET_NETWORK=Sepolia \
NEXT_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/test-alchemy-key \
NEXT_PUBLIC_API_URL=https://api.wildcat.finance \
NEXT_PUBLIC_TOKENS_LIST_URL=https://tokens.1inch.eth.link \
NEXT_PUBLIC_TOKENS_IMG_HOSTNAME=tokens.1inch.io \
WILDCAT_WALLET_QA_RUN_APP=1 \
npm run test:wallet -- --grep "loads local lender shell"
```

```bash
# Optional connected-wallet proof; local/testnet secrets only, from ignored config.
chmod 600 .env
set -a && . ./.env && set +a
NEXT_PUBLIC_TARGET_NETWORK=Sepolia npm run test:wallet:real-metamask
```

Publishable docs should link only reviewed files copied out of raw Playwright output, for example:

```text
docs/screenshots/wildcat-connected-sepolia-test-wallet.png
docs/screenshots/wildcat-connected-sepolia-test-wallet-proof.json
```

Positive connected-wallet evidence must show the app running locally on the requested testnet with a connected deterministic test wallet and visible network/account UI. Do not present no-wallet pages, connect dialogs, blank screenshots, public-address-only injected-wallet state, raw `.wallet-artifacts`, traces, videos, extension bundles, or MetaMask profiles as final README evidence.

## Fixture surface

- `walletConfig`: per-test wallet QA configuration.
- `walletContext`: browser context under test.
- `walletPage`: page under test.
- `wallet`: `connect`, `expectConnected`, `expectChain`, `assertState`, `switchChain`, `signMessage`, `signTypedData`, and `maskAddress` helpers.
- `walletArtifacts`: screenshot, JSON, connected-proof, proof-manifest, artifact-index, and failure-manifest writers.

## Helpers

- `defineWalletQaConfig(config)`: typed Playwright config wrapper for wallet QA fixtures.
- `installDeterministicInjectedWallet(page, { account, chainId })`: installs a minimal deterministic EIP-1193 provider with a non-zero public test account, `eth_accounts`/`eth_requestAccounts`, `eth_chainId`/`net_version`, and guarded chain-switch responses. Use this for dapp-owned smoke/proof tests that should verify connected UI without real private wallet material.
- `createFailClosedWalletPromptDriver(options)`: wraps explicit prompt automation and rejects missing handlers, missing/wrong origin, wrong account, or wrong chain.
- `writeWalletQaProofManifest(options)`: writes a public schema v1 proof manifest with safe attachment metadata, provenance, summaries, checksums, and redacted failures.
- `verifyWalletQaProofManifest(artifactDir)`: verifies manifest shape, required schema v1 provenance, summary/checksum consistency, attachment hashes/sizes, and rejects full addresses, raw secrets/RPC tokens, local path leaks, and downgraded manifests without `schemaVersion`.
- `writeWalletQaArtifactIndex({ artifactDir, manifestNames })`: verifies the listed proof manifests and writes a public-safe `wallet-qa-artifact-index.json` for CI uploads/review.
- `createWalletQaArtifactAnnotation(options)` / `annotateWalletQaArtifact(testInfo, options)`: build and push stable Playwright annotations (`wallet-qa:proof-manifest`, `wallet-qa:artifact-index`, etc.) with safe artifact basenames and redacted descriptions.
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

`wallet.connect` requires expected account and chain ID in options or config. It also requires one of `click`, `requestConnection`, `walletConfig.dapp`, or `walletConfig.dappSelectors` to trigger the dapp flow. Prefer `click` for new dapp-owned tests; `requestConnection` remains supported for existing tests.

`wallet.switchChain` requires expected account, expected chain ID, and `walletConfig.network` before it calls the lower-level network switch helper. It rejects unsupported or unsafe chain state instead of switching blindly.

`wallet.signMessage` and `wallet.signTypedData` are the supported signature helpers for SIWE/personal-sign and typed-data flows. They require expected account, expected chain ID, origin, expected message text/canonical typed-data JSON, `walletConfig.network`, `walletConfig.prompt`, and a dapp trigger (`click`, `requestSignature`, `walletConfig.dapp.requestSignature`, or `walletConfig.dappSelectors`). The helpers assert wallet state before requesting the dapp signature and then approve only the matching `personal_sign` or `typed_data` prompt.

No prompt approval is implicit. Transaction approval is not exposed by this fixture API yet; add it only after a zero-value or explicit capped-testnet policy exists with rejection tests.

## CI pattern

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm exec playwright install --with-deps chromium
- run: xvfb-run -a pnpm test
  env:
    SEPOLIA_WALLET_ADDRESS: ${{ secrets.SEPOLIA_WALLET_ADDRESS }}
```

Keep traces, videos, raw screenshots, profiles, extension bundles, and `.env` files out of git. Upload artifacts only after `verifyWalletQaProofManifest` passes and screenshots have been reviewed.
