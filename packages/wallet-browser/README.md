# `@broccolo1d/wallet-browser`

Core browser-wallet runtime helpers for dapp QA.

This package owns launch configuration, MetaMask-oriented browser helpers, prompt guardrails, network/account assertions, local smoke artifacts, proof verification, and the `wallet-browser` CLI. It is the lower-level dependency used by `@broccolo1d/playwright`.

## Install

```bash
pnpm add -D @broccolo1d/wallet-browser playwright
```

The package is ESM-only and requires Node.js `>=22 <23`.

## CLI

Build before invoking the source CLI directly from the repository root:

```bash
pnpm --filter @broccolo1d/wallet-browser build
node packages/wallet-browser/dist/cli.js --help
```

From this repository root, use the convenience scripts:

```bash
pnpm wallet:cli --help
pnpm wallet:metamask:fetch --dry-run
pnpm wallet:metamask:fetch
pnpm wallet:prepare
pnpm wallet:smoke:metamask
pnpm wallet:smoke:fixture-extension
pnpm wallet:smoke:verify
```

The root convenience scripts build the package and invoke `packages/wallet-browser/dist/cli.js` from the repository root, so default `.wallet-*` paths resolve consistently. Fetch the pinned extension before `wallet:prepare` when using the default extension path.

Commands:

```text
wallet-browser prepare
wallet-browser smoke-metamask
wallet-browser smoke-fixture-extension
wallet-browser verify-smoke-artifacts [artifact-dir]
wallet-browser verify-fixture-proof <artifact-dir>
wallet-browser onboarding-plan
wallet-browser profile-bootstrap-import --dry-run
wallet-browser network-plan
```

`verify-smoke-artifacts` accepts an explicit artifact directory. If omitted, it verifies the newest directory under `.wallet-artifacts/metamask-smoke/` or `.wallet-artifacts/fixture-extension-smoke/`.

## API sketch

```ts
import {
  assertExpectedChainAndAccount,
  launchWalletBrowser,
  type MetaMaskNetworkDriver,
  resolveSepoliaNetworkConfig,
  resolveWalletBrowserConfig,
  verifySmokeArtifactManifest
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

verifySmokeArtifactManifest('.wallet-artifacts/metamask-smoke/run-id');
```

## Configuration

Use explicit options where possible. Environment-backed local runs use ignored `.env` files. Relevant keys include:

- `METAMASK_EXTENSION_PATH` or `METAMASK_EXTENSION_DIR`
- `METAMASK_EXTENSION_VERSION`
- `WALLET_PROFILE_DIR`
- `WALLET_PROFILE_NAME`
- `PRESERVE_WALLET_PROFILE`
- `SEPOLIA_WALLET_ADDRESS`
- `SEPOLIA_RPC_URL`
- `SEPOLIA_CHAIN_ID`
- `METAMASK_PASSWORD`

Never commit `.env`, wallet profiles, extension bundles, traces, screenshots, videos, reports, or local proof artifacts.

## Safety notes

- Use burner/testnet wallets only.
- `prepare`, `onboarding-plan`, `network-plan`, and dry-run commands print redacted plans.
- Smoke commands launch Chromium and capture local-only screenshots, but do not import, unlock, connect, sign, or transact.
- Prompt approval requires explicit prompt-driver support and guardrail policy.
- Unknown prompts, signatures, and transactions fail closed unless intentionally supported by the caller.
