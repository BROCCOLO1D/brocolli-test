# brocolli-test

brocolli-test is a two-package workspace for wallet-backed dapp QA.

```text
@broccolo1d/playwright
  └─ imports @broccolo1d/wallet-browser
       └─ uses Playwright Chromium persistent contexts
            └─ loads an unpacked MetaMask extension from ignored local storage
```


## TLDR

Lets you do stuff like:
```ts
import { test } from '@broccolo1d/playwright';

test('wallet connects on Sepolia', async ({ page, wallet, walletArtifacts }) => {
  await page.goto('http://127.0.0.1:5173');
  
  // Your test drives the dapp UI; configured wallet drivers approve only expected prompts.
  const result = await wallet.connect({
    click: async () => page.getByRole('button', { name: /connect/i }).click()
  });
  
  await wallet.expectConnected();
  await wallet.expectChain({ expectedChainId: 11155111 });

  const screenshot = await walletArtifacts.screenshot('connected');
  await walletArtifacts.connectedProof('wallet-connected', {
    origin: 'http://127.0.0.1:5173',
    account: result.activeAccount,
    chainId: result.chainId,
    attachments: [{ label: 'dapp-connected', path: screenshot, contentType: 'image/png' }]
  });
});
```


## Packages

| Package | Version | Purpose |
| --- | ---: | --- |
| [`@broccolo1d/wallet-browser`](packages/wallet-browser/README.md) | `0.2.4` | Core browser automation for MetaMask integration with Chromium context management and wallet state verification. |
| [`@broccolo1d/playwright`](packages/playwright/README.md) | `0.2.4` | Playwright test fixtures and utilities for wallet-integrated dapp testing with structured proof artifacts. |


## Runtime model

1. A test or CLI command resolves configuration.
2. Chromium launches with a persistent profile and an unpacked extension only when explicitly requested.
3. Dapp code triggers wallet actions through app-owned UI drivers.
4. Wallet prompt drivers validate expected prompt text and policy before clicking.
5. Network drivers assert account and chain state.
6. Artifacts are written under ignored local directories and verified before sharing.


## Install in a dapp test repo

Most consumer repos should start with the Playwright package:

```bash
pnpm add -D @broccolo1d/playwright @playwright/test
```

Use the lower-level browser package directly when building custom runners or non-fixture integrations:

```bash
pnpm add -D @broccolo1d/wallet-browser playwright
```

Both packages are ESM-only and require Node.js `>=22 <23`.

## Playwright usage

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

// Supply real, reviewed prompt automation in jobs that approve wallet UI.
const promptAutomation: WalletPromptDriver = {
  async approveConnection() {
    throw new Error('configure app-specific prompt automation before enabling real wallet approval');
  },
  async approveSignature() {
    throw new Error('configure app-specific prompt automation before enabling real signature approval');
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

```ts
// tests/wallet.spec.ts
import { expect, test, verifyWalletQaProofManifest } from '@broccolo1d/playwright';

test('connects with explicit wallet policy', async ({ page, wallet, walletArtifacts }) => {
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

  const screenshot = await walletArtifacts.screenshot('connected');

  await walletArtifacts.connectedProof('wallet-connected', {
    origin: 'http://127.0.0.1:5173',
    account: result.activeAccount,
    chainId: result.chainId,
    attachments: [{ label: 'dapp-connected', path: screenshot, contentType: 'image/png' }]
  });

  await verifyWalletQaProofManifest(walletArtifacts.artifactDir, 'wallet-connected.json');
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

`useRealWallet` defaults to `false`. When enabled, `wallet.connect`, `wallet.switchChain`, `wallet.signMessage`, and `wallet.signTypedData` still require explicit expected account/chain inputs and configured dapp, prompt, and network drivers. Signature helpers require the expected origin and message/canonical typed-data JSON before they trigger the dapp request or approve a MetaMask prompt. Transaction approval remains intentionally absent until a zero-value or capped-testnet policy is implemented and tested.

## Lower-level wallet-browser usage

```ts
import {
  assertExpectedChainAndAccount,
  launchWalletBrowser,
  type MetaMaskNetworkDriver,
  resolveSepoliaNetworkConfig,
  resolveWalletBrowserConfig
} from '@broccolo1d/wallet-browser';

const expectedAccount = process.env.SEPOLIA_WALLET_ADDRESS;
if (!expectedAccount) throw new Error('SEPOLIA_WALLET_ADDRESS is required for wallet QA');

const config = resolveWalletBrowserConfig();
const { context } = await launchWalletBrowser({ config });

const network: MetaMaskNetworkDriver = {
  async getChainId() { return 11155111; },
  async getAccounts() { return [expectedAccount]; },
  async switchChain() {},
  async addEthereumChain() {}
};

try {
  await assertExpectedChainAndAccount(resolveSepoliaNetworkConfig({ expectedAccount }), network);
} finally {
  await context.close();
}
```

Prefer package APIs from tests. Use the CLI for local setup, smoke capture, and verification.
 

## CLI examples

```bash
pnpm wallet:cli --help
pnpm wallet:doctor
pnpm wallet:metamask:fetch --dry-run
pnpm wallet:metamask:fetch
pnpm wallet:prepare
```

`wallet:doctor` prints JSON setup diagnostics for Node, Playwright/Chromium, MetaMask extension artifacts, `.env` key presence, wallet profile paths, and ignored wallet-local directories. It is safe to run before browser setup because it never launches Chromium and never prints private keys, wallet passwords, RPC tokens, or full `.env` contents.

`wallet:prepare` prints a launch plan and does not launch Chromium. The raw local output can include machine-specific paths; keep it local or redact before sharing.

Real browser smoke commands are local-only and should use burner/testnet configuration. On Linux, WSL, or CI without a display, run with Xvfb:

```bash
xvfb-run -a pnpm wallet:smoke:metamask
pnpm wallet:smoke:verify
pnpm wallet:smoke:verify .wallet-artifacts/metamask-smoke/<run-id>
```

## Packaging checks

```bash
pnpm --filter @broccolo1d/wallet-browser pack --dry-run
pnpm --filter @broccolo1d/playwright pack --dry-run
```

Tarballs include package README files, the root license, package metadata, and built `dist/` output.

## Safety model

See [docs/security-and-artifacts.md](docs/security-and-artifacts.md) for the full handling policy.

## Docs

- [Architecture](docs/architecture.md)
- [Security and artifact handling](docs/security-and-artifacts.md)
- [Product roadmap](docs/product-roadmap.md)
- [`@broccolo1d/wallet-browser`](packages/wallet-browser/README.md)
- [`@broccolo1d/playwright`](packages/playwright/README.md)
