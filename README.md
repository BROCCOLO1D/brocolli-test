# brocolli-test

Wallet QA packages for Playwright suites that need to exercise dapps through a real browser-wallet path.

This repository is a pnpm workspace with two public packages:

- `@broccolo1d/wallet-browser`: lower-level browser, MetaMask, network, prompt, guardrail, and artifact helpers.
- `@broccolo1d/playwright`: Playwright fixtures that downstream dapp test suites import.

The default posture is conservative. Real-wallet launch is opt-in. Prompt approval requires explicit drivers and policy. Local profiles, screenshots, traces, manifests, extension bundles, and environment files are treated as sensitive runtime state.

## Status

Implemented today:

- importable TypeScript packages with ESM output;
- persistent Chromium launch with an unpacked MetaMask extension;
- redacted launch, onboarding, network, and smoke-artifact CLI commands;
- connect-oriented wallet control helpers with chain/account/origin guardrails;
- Playwright fixtures for app-owned dapp QA specs;
- fail-closed prompt guard helpers for explicit origin/account/chain policy;
- local-only smoke screenshot manifests and wallet QA proof manifests with basename/hash/size verification;
- tracked-file and git-history sensitive-content scan.

Not claimed:

- production-wallet automation;
- mainnet automation;
- generic wallet coverage beyond the current MetaMask-oriented implementation;
- blanket approval of signatures or transactions without explicit policy and prompt drivers.

## Repository layout

```text
packages/wallet-browser/           # Core wallet runtime, policy, CLI, and artifact helpers
packages/playwright/                # Playwright fixtures for downstream dapp QA suites
scripts/fetch-metamask-extension.py # Local MetaMask extension fetch utility
scripts/sensitive-scan.py           # Repository sensitive-content scan
docs/architecture.md                # Package boundaries and runtime model
docs/security-and-artifacts.md      # Secret, profile, trace, screenshot, and manifest policy
docs/product-roadmap.md             # Product milestones and non-goals
```

Ignored local runtime paths:

```text
.env
.wallet-extensions/
.wallet-profiles/
.wallet-artifacts/
playwright-report/
test-results/
traces/
```

## Quickstart

Requirements:

- Node.js `>=22 <23`
- pnpm `11.0.8`
- Chromium dependencies required by Playwright on the host running browser flows

Install and verify the committed code:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm security:scan
```

Print the wallet-browser CLI help from the workspace root:

```bash
pnpm wallet:cli --help
```

Fetch the pinned MetaMask extension into ignored local storage:

```bash
pnpm wallet:metamask:fetch --dry-run
pnpm wallet:metamask:fetch
```

Prepare and inspect a redacted Chromium/MetaMask launch plan. This resolves paths from the repository root and does not launch Chromium:

```bash
pnpm wallet:prepare
```

Run local smoke commands only with burner/testnet configuration. On Linux, WSL, or CI without a display, wrap real browser commands with Xvfb:

```bash
xvfb-run -a pnpm wallet:smoke:metamask
pnpm wallet:smoke:verify
```

`pnpm wallet:smoke:verify` verifies the latest smoke artifact directory by default. Pass an explicit directory to verify a specific run:

```bash
pnpm wallet:smoke:verify .wallet-artifacts/metamask-smoke/<run-id>
```

## Using `@broccolo1d/playwright`

Downstream dapp suites own routes, selectors, assertions, and test data. They import the shared fixtures and supply explicit wallet policy.

```ts
// tests/wallet.spec.ts
import { expect, test } from '@broccolo1d/playwright';

test('connects with explicit wallet policy', async ({ page, wallet, walletArtifacts }) => {
  await page.goto('http://127.0.0.1:5173');

  await wallet.connect({
    requestConnection: async () => page.getByRole('button', { name: /connect/i }).click(),
    expectedAccount: '0x0000000000000000000000000000000000000000',
    expectedChainId: 11155111,
    origin: 'http://127.0.0.1:5173'
  });

  const screenshot = await walletArtifacts.screenshot('connected');
  await walletArtifacts.writeProofManifest({
    status: 'connected',
    origin: 'http://127.0.0.1:5173',
    account: '0x0000000000000000000000000000000000000000',
    chainId: 11155111,
    attachments: [{ label: 'wallet-connected', path: screenshot, contentType: 'image/png' }]
  });
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

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

// Replace this fake delegate with explicit prompt automation in real wallet jobs.
const promptDelegate: WalletPromptDriver = {
  async approveConnection() {}
};
const prompt = createFailClosedWalletPromptDriver({
  origin,
  expectedAccount,
  expectedChainIdHex: '0xaa36a7',
  delegate: promptDelegate
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
      prompt,
      network
    }
  }
});
```

`useRealWallet` defaults to `false`. When enabled, `wallet.connect` still fails closed unless a prompt driver and network driver are configured. `writeProofManifest` stores public proof metadata with attachment basenames, sha256 hashes, sizes, masked accounts, and redacted failures; use `verifyWalletQaProofManifest` before promoting any artifact manifest.

## Using `@broccolo1d/wallet-browser`

The lower-level package exposes runtime helpers for packages or apps that do not want the Playwright fixture layer.

```ts
import {
  assertExpectedChainAndAccount,
  launchWalletBrowser,
  type MetaMaskNetworkDriver,
  resolveSepoliaNetworkConfig,
  resolveWalletBrowserConfig
} from '@broccolo1d/wallet-browser';

const expectedAccount = '0x0000000000000000000000000000000000000000';
const config = resolveWalletBrowserConfig();
const { context } = await launchWalletBrowser({ config });

// Replace with an app-provided network driver in real wallet jobs.
const network: MetaMaskNetworkDriver = {
  async getChainId() { return 11155111; },
  async getAccounts() { return [expectedAccount]; },
  async switchChain() {},
  async addEthereumChain() {}
};

const sepolia = resolveSepoliaNetworkConfig({ expectedAccount });

try {
  await assertExpectedChainAndAccount(sepolia, network);
} finally {
  await context.close();
}
```

Prefer package APIs over shelling out from tests. Use the CLI for local setup, smoke capture, and artifact verification.

## Local burner configuration

Create ignored local config only for burner/testnet flows:

```bash
cp .env.example .env
chmod 600 .env
```

Fill `.env` with non-production testnet values. Do not use production wallets or mainnet accounts. Do not commit `.env`, profiles, traces, screenshots, videos, reports, extension bundles, or proof artifacts.

## Safety model

- Burner/testnet wallets only.
- Real wallet usage is opt-in.
- Unknown prompts fail closed.
- Signatures and transactions require explicit policy and prompt-driver support.
- Transaction value caps default to zero wei.
- Account, chain ID, origin, prompt type, target, and value are policy inputs.
- Public output must redact private keys, seed phrases, wallet passwords, RPC credentials, local paths, and full wallet addresses.
- Artifacts remain local unless reviewed, scrubbed, and verified.

See [docs/security-and-artifacts.md](docs/security-and-artifacts.md) for the full handling policy.

## Packaging

The packages are public-package ready and keep package names unchanged:

```bash
pnpm --filter @broccolo1d/wallet-browser pack --dry-run
pnpm --filter @broccolo1d/playwright pack --dry-run
```

Tarballs include package README files, the root license, package metadata, and built `dist/` output.

## Docs

- [Architecture](docs/architecture.md)
- [Security and artifact handling](docs/security-and-artifacts.md)
- [Product roadmap](docs/product-roadmap.md)
- [`@broccolo1d/wallet-browser`](packages/wallet-browser/README.md)
- [`@broccolo1d/playwright`](packages/playwright/README.md)
