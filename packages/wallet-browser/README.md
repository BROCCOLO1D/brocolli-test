# `@broccolo1d/wallet-browser`

Core browser-wallet runtime helpers for dapp QA.

This lower-level package owns Chromium/MetaMask launch configuration, prompt guardrails, network/account assertions, local smoke artifacts, proof verification, and the `wallet-browser` CLI. Most app test suites should consume `@broccolo1d/playwright`; use this package directly for custom runners, package integrations, and low-level wallet runtime work.

## Install

```bash
pnpm add -D @broccolo1d/wallet-browser@0.2.6 playwright
```

ESM-only. Node.js `>=22 <23`.

## CLI

After install, the package exposes a `wallet-browser` binary:

```bash
pnpm exec wallet-browser --help
pnpm exec wallet-browser doctor
pnpm exec wallet-browser prepare
pnpm exec wallet-browser verify-smoke-artifacts .wallet-artifacts/metamask-smoke/<run-id>
```

From this repository root, convenience scripts build the package first and resolve default `.wallet-*` paths consistently:

```bash
pnpm wallet:cli --help
pnpm wallet:doctor
pnpm wallet:metamask:fetch --dry-run
pnpm wallet:metamask:fetch
pnpm wallet:prepare
pnpm wallet:smoke:metamask
pnpm wallet:smoke:fixture-extension
pnpm wallet:smoke:verify
```

Commands:

```text
wallet-browser prepare
wallet-browser doctor
wallet-browser smoke-metamask
wallet-browser smoke-fixture-extension
wallet-browser verify-smoke-artifacts [artifact-dir]
wallet-browser verify-fixture-proof <artifact-dir>
wallet-browser onboarding-plan
wallet-browser profile-bootstrap-import --dry-run
wallet-browser network-plan
```

`doctor` prints setup diagnostics for Node 22, Playwright/Chromium resolution, the configured MetaMask extension path/manifest, `.env` key presence, wallet profile usability, and `.gitignore` protection for local wallet directories. It exits non-zero for actionable setup errors and never prints `.env` values, private keys, wallet passwords, or RPC tokens.

`prepare`, `onboarding-plan`, `network-plan`, and dry-run commands print redacted plans. The raw local output can still contain machine-specific paths; redact before sharing. `smoke-metamask` launches Chromium and captures local-only screenshots, but it does not import, unlock, connect, sign, or transact.

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
  const sepolia = resolveSepoliaNetworkConfig({ expectedAccount });
  await assertExpectedChainAndAccount(sepolia, network);
} finally {
  await context.close();
}

verifySmokeArtifactManifest('.wallet-artifacts/metamask-smoke/<run-id>');
```

## Configuration

Prefer explicit options in code. Environment-backed local runs should use ignored `.env` files. Before launching a browser, run:

```bash
npx wallet-browser doctor
# or inside this repo:
pnpm wallet:doctor
```

The doctor report lists configured key names and setup status only; it does not print secret values. Fix any `error` checks before running `prepare` or smoke commands.

Relevant keys include:

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

## Smoke and artifact verification

```bash
# Real browser smoke: local burner/testnet config only.
xvfb-run -a pnpm exec wallet-browser smoke-metamask

# Verify the newest smoke artifact directory.
pnpm exec wallet-browser verify-smoke-artifacts

# Verify one explicit run.
pnpm exec wallet-browser verify-smoke-artifacts .wallet-artifacts/metamask-smoke/<run-id>
```

`verify-smoke-artifacts` checks manifest shape and attachment hash/size metadata. If no directory is supplied, it verifies the newest run under `.wallet-artifacts/metamask-smoke/` or `.wallet-artifacts/fixture-extension-smoke/`.

## Safety notes

- Burner/testnet wallets only.
- Real wallet launch requires explicit configuration.
- Prompt approval requires explicit prompt-driver support and guardrail policy.
- Unknown prompts, signatures, and transactions fail closed unless intentionally supported by the caller.
- Transaction value caps default to zero wei.
- Plans and public manifests must not expose private keys, seed phrases, wallet passwords, RPC credentials, local paths, or full wallet addresses.
- Raw screenshots, traces, videos, profiles, and extension bundles remain local unless reviewed and verified.
