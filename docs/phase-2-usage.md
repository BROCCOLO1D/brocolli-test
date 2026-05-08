# Phase 2 usage and acceptance

Phase 2 adds the first TypeScript foundation for launching Playwright-managed Chromium with an unpacked MetaMask extension in an isolated persistent profile. It does **not** onboard MetaMask, import a wallet, read private keys, sign messages, or send transactions.

## Install and verify

Use the pinned package manager from `package.json`:

```bash
corepack enable
corepack prepare pnpm@11.0.8 --activate
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm --filter @agent-browser-wallet/wallet-browser cli --help
```

## Provide MetaMask locally

The launcher expects an unpacked MetaMask extension directory that stays outside Git. Phase 2 pins MetaMask `13.29.0` for the default local artifact path:

```text
.wallet-extensions/metamask/13.29.0/chrome
```

A later artifact fetcher can populate that directory. Until then, either create the pinned default path yourself or provide one of these environment variables:

```bash
export METAMASK_EXTENSION_PATH="$PWD/.wallet-extensions/metamask/<version>"
# or, for compatibility with Phase 1 naming:
export METAMASK_EXTENSION_DIR="$PWD/.wallet-extensions/metamask/<version>"
```

The directory must already exist and contain a valid Manifest V3 `manifest.json` whose `name` or `short_name` identifies MetaMask. If the resolved path is missing or is not an unpacked MetaMask extension directory, config resolution fails before Chromium launch with a clear error. `METAMASK_EXTENSION_VERSION` may be used to point the default path at another reviewed version, but the committed default remains pinned until deliberately changed.

## Profile resolution

By default the wallet browser package creates and uses:

```text
.wallet-profiles/sepolia-burner
```

Developers can override profile storage with:

```bash
export WALLET_PROFILE_NAME="local-debug"
# or an exact path:
export WALLET_PROFILE_DIR="$PWD/.wallet-profiles/local-debug"
```

`PRESERVE_WALLET_PROFILE=true` records caller intent for later cleanup policy, but Phase 2 only resolves/creates the directory. Browser profiles are sensitive and remain ignored by Git.

## Programmatic launcher foundation

```ts
import {
  prepareChromiumLaunchOptions,
  resolveWalletBrowserConfig
} from '@agent-browser-wallet/wallet-browser';

const config = resolveWalletBrowserConfig({
  // Optional explicit config overrides env variables for library consumers.
  // metamaskExtensionPath: '/absolute/path/to/unpacked/metamask',
  // profileName: 'local-debug'
});
const launch = prepareChromiumLaunchOptions(config);

// launch.userDataDir is the persistent Chromium profile directory.
// launch.options.args includes --disable-extensions-except and --load-extension.
```

`launchWalletBrowser()` is also exported for Phase 3+ code that is ready to actually open Playwright Chromium. Tests in Phase 2 cover config/path logic and launch-option construction without requiring a real MetaMask artifact.

## CLI launcher-plan stub

After `pnpm build`, developers and agents can ask the package to validate config and print a sanitized launch plan without opening Chromium:

```bash
pnpm --filter @agent-browser-wallet/wallet-browser cli prepare
```

The command prints JSON with Chromium launch metadata such as `userDataDir`, extension `args`, `profileName`, `preserveProfile`, the resolved MetaMask extension path/configured version, the extension identity/version read from `manifest.json` when present, and a `config.present`/`config.missing` summary of the non-secret prepare-only variables it considered. It does not read `.env`, private keys, seed phrases, wallet passwords, or RPC tokens. If validation fails, env-injected local path values such as `METAMASK_EXTENSION_PATH`, `METAMASK_EXTENSION_DIR`, and `WALLET_PROFILE_DIR` are redacted from CLI error output.

## Local MetaMask smoke screenshots

Prepare the pinned real artifact locally with:

```bash
pnpm wallet:metamask:fetch
```

This downloads the official `metamask-chrome-13.29.0.zip` release asset from GitHub, unpacks it to the ignored default path `.wallet-extensions/metamask/13.29.0/chrome`, validates that the extracted manifest identifies MetaMask and reports the pinned version, and prints JSON metadata. Use `pnpm wallet:metamask:fetch --dry-run` to inspect the URL and local paths without downloading. Do not commit `.wallet-extensions/` or the downloaded zip.

Once an unpacked MetaMask artifact exists at the pinned default path or `METAMASK_EXTENSION_PATH` / `METAMASK_EXTENSION_DIR`, generate local-only Chromium screenshots with:

```bash
pnpm wallet:smoke:metamask
```

This script builds `@agent-browser-wallet/fixture-dapp` and `@agent-browser-wallet/wallet-browser`, launches real Playwright Chromium with a persistent user data directory and the unpacked MetaMask extension loaded, opens the fixture dapp as the normal browser page without connecting it to a wallet, opens or discovers the MetaMask extension UI (`chrome-extension://<id>/home.html` / notification pages), captures screenshots, writes an `INSPECTION.md` visual-review checklist next to the screenshots, prints JSON metadata, and closes the browser context. Screenshots are written under ignored `.wallet-artifacts/metamask-smoke/<timestamp>/` because browser screenshots/traces are treated as sensitive until manually inspected.

If a real MetaMask artifact is not available, use the generated fixture-extension smoke only to verify the Chromium extension-loading mechanics:

```bash
pnpm wallet:smoke:fixture-extension
```

The fixture command creates an ignored unpacked extension under `.wallet-artifacts/fixture-extension-smoke/<timestamp>/fixture-extension/`, launches it through the same Chromium persistent-context foundation, and captures `browser-page.png` plus `fixture-extension.png` with an adjacent `INSPECTION.md` checklist. The fixture page is intentionally labeled **not MetaMask UI**; do not use it as evidence of MetaMask onboarding, wallet connection, signing, or transaction support. Like the real MetaMask smoke path, this launches a headed Chromium instance so Linux/CI environments without a display should run it under `xvfb-run` rather than expecting headless extension UI screenshots.

Safety boundaries for this milestone:

- It does **not** import a wallet, unlock MetaMask, connect to the fixture dapp, approve prompts, sign, or transact.
- Do not move screenshots into `docs/assets/readme/` until visually inspected and confirmed to contain no seed phrases, private keys, passwords, RPC tokens, full addresses, or sensitive local paths.
- If the MetaMask artifact is absent, the command fails during config validation rather than producing a fake MetaMask screenshot.
- Wallet onboarding plus fixture-dapp connect screenshots are the next milestone.

## Acceptance for this foundation

- Node, pnpm, Playwright, TypeScript, and Vitest versions are pinned in committed package files and lockfile.
- `@agent-browser-wallet/wallet-browser` resolves a MetaMask extension directory from env/config or the pinned default artifact path, validates that an unpacked MetaMask Manifest V3 extension manifest exists, verifies that default artifact manifests report the configured/pinned version, resolves Chrome `__MSG_...__` localized names from `_locales/<default_locale>/messages.json`, requires resolved `name` or `short_name` to exactly identify MetaMask rather than merely containing the word, creates an isolated profile directory, and rejects profile paths that point at the project root or overlap the extension artifact.
- Launch options are Chromium-only, use a persistent context user data directory, and include MetaMask extension flags.
- The CLI `wallet-browser prepare` command exposes the same prepared launch plan in machine-readable JSON without launching Chromium.
- Missing extension config fails closed before launch.
- No Phase 2 code reads private keys, seed phrases, wallet passwords, RPC tokens, or `.env` contents.
