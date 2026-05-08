# agent-browser-wallet

Real browser-wallet automation for AI agents and dapp test harnesses.

This repo is now focused on a concrete path: **Playwright + persistent Chromium + pinned MetaMask + isolated burner/testnet profiles**. The goal is to let an agent drive a dapp in the same kind of browser a real user has: one with a wallet extension installed, wallet prompts, chain switching, account assertions, screenshots, and safety guardrails.

## Current target

- **Runner:** Playwright
- **Browser:** Chromium persistent contexts, because extension support requires a real profile
- **Wallet:** pinned MetaMask extension artifact, downloaded locally and ignored by Git
- **First dapp:** local fixture dapp for deterministic connect/sign/send tests
- **Live target:** `https://testnet.wildcat.finance/lender` on Sepolia
- **Wallet policy:** burner/testnet only; no production wallets or mainnet funds

## What works today

### CI-safe / committed

- `wallet-browser prepare` validates MetaMask extension/profile launch config and prints a sanitized persistent-context plan.
- `wallet-browser smoke-metamask` launches real Chromium with the pinned MetaMask extension and captures local-only smoke screenshots.
- `wallet-browser smoke-fixture-extension` launches the fixture dapp beside the extension in the same persistent context.
- `wallet-browser verify-smoke-artifacts` checks local screenshot manifests against captured files.
- The package exposes a CI-safe fixture connection proof harness that composes wallet-control connection approval, Sepolia/account verification, post-verification screenshot capture, and local-only proof manifest generation for the later real Chromium runner.
- `wallet-browser verify-fixture-proof` validates fixture connection proof manifests, requiring connected state, masked account evidence, Sepolia chain `11155111`, safe screenshot basenames, and matching screenshot hashes before a proof can be accepted.
- `wallet-browser profile-bootstrap-import --dry-run` validates burner import/profile inputs and writes a sanitized local manifest without launching a browser or entering secrets.
- The fixture dapp has stable selectors and mocked-provider tests for connect, signature, zero-value transaction, account/chain events, and guardrail rejection.
- Wallet-control helper modules model connect/sign/send/network/account guardrails with redacted structured logs.
- MetaMask page discovery handles `home.html` and `notification.html`, stale/closed page handles, preferred prompt-page selection, context re-querying, and optional keeper-page creation.
- MetaMask connection prompt approval has a CI-safe driver that discovers `notification.html`, verifies the prompt looks like an origin-matching connect request, and fails closed on transaction/signature/unknown prompt text before clicking.
- Sensitive artifacts are ignored by default: `.env`, `.wallet-extensions/`, `.wallet-profiles/`, `.wallet-artifacts/`, traces, reports, and local audit logs.

### Local-only / dogfooded

Using ignored local secrets and artifacts, we have proven:

- real Chromium can load real MetaMask;
- the Sepolia burner can be imported into MetaMask as `Imported Account 1`;
- the active MetaMask account can show the masked burner `0x81611...34B61` without exposing the full private key, seed phrase, password, or full address;
- Wildcat testnet loads and opens its wallet chooser after clicking **Connect Wallet**.

Still in progress:

- completing the MetaMask connection approval for fixture dapp and Wildcat;
- wiring the real browser import runner behind the new `profile-bootstrap-import` dry-run manifest path.

## Screenshots and evidence

Committed README images are public-safe mocked-provider or masked public Sepolia evidence.

<p align="center">
  <img src="docs/assets/readme/fixture-connected-actions.png" width="760" alt="Fixture dapp after connecting a mocked Sepolia wallet, signing a message, and submitting a zero-value transaction">
</p>

<p align="center">
  <img src="docs/assets/readme/fixture-guardrail-rejected.png" width="760" alt="Fixture dapp rejecting a transaction attempt on an unsupported chain">
</p>

<p align="center">
  <img src="docs/assets/readme/fixture-real-sepolia-burner.png" width="760" alt="Fixture dapp connected to the masked real Sepolia burner wallet with a public balance check">
</p>

Generate public-safe mocked screenshots:

```bash
pnpm docs:assets
```

Generate the local masked Sepolia burner screenshot:

```bash
pnpm docs:assets:real-sepolia
```

Real MetaMask/Wildcat screenshots are treated as local-sensitive artifacts until inspected. They live under `.wallet-artifacts/` and should not be committed unless explicitly scrubbed.

## Try it

Install and run the baseline checks:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm security:scan
```

Fetch the pinned MetaMask extension locally:

```bash
pnpm wallet:metamask:fetch --dry-run
pnpm wallet:metamask:fetch
```

Run headed browser smoke tests in WSL/Linux with Xvfb:

```bash
xvfb-run -a pnpm wallet:smoke:metamask
xvfb-run -a pnpm wallet:smoke:fixture-extension
pnpm wallet:smoke:verify .wallet-artifacts/metamask-smoke/<run-id>
pnpm --filter @agent-browser-wallet/wallet-browser cli verify-fixture-proof .wallet-artifacts/fixture-connection-proof/<run-id>
```

Inspect sanitized plans:

```bash
pnpm --filter @agent-browser-wallet/wallet-browser cli --help
pnpm --filter @agent-browser-wallet/wallet-browser cli prepare
pnpm --filter @agent-browser-wallet/wallet-browser cli onboarding-plan
pnpm --filter @agent-browser-wallet/wallet-browser cli profile-bootstrap-import --dry-run
pnpm --filter @agent-browser-wallet/wallet-browser cli network-plan
```

Serve the fixture dapp:

```bash
pnpm fixture:build
pnpm fixture:serve
```

Then open `http://127.0.0.1:5173`.

## Local secret setup

Copy `.env.example` to `.env` and use only testnet/burner values:

```bash
cp .env.example .env
chmod 600 .env
```

Important variables:

- `SEPOLIA_WALLET_ADDRESS`
- `SEPOLIA_WALLET_PRIVATE_KEY`
- `SEPOLIA_RPC_URL` optional/custom RPC
- `SEPOLIA_CHAIN_ID=11155111`
- `METAMASK_PASSWORD`
- `WALLET_PROFILE_DIR`
- `METAMASK_EXTENSION_DIR`

Never commit `.env`, wallet profiles, extension bundles, traces, Playwright reports, screenshot artifacts, or local audit logs.

## Suggested 5-step plan

1. **Exercise connection prompt approval locally.** Use the CI-safe MetaMask prompt driver against a real pinned extension/profile, confirm the default selectors still match the current MetaMask build, and record any selector drift as local-only diagnostics.
2. **Promote real burner onboarding/import runner.** Connect the dry-run `profile-bootstrap-import` manifest path to a real local-only runner that avoids screenshots during secret entry and verifies the active masked account.
3. **Complete fixture dapp real-wallet connection.** Wire the real Chromium/MetaMask runner into the fixture proof harness, use the imported burner profile to connect the local fixture dapp, assert `eth_accounts` and chain, capture inspected local screenshots only after verification, and accept the run only when `verify-fixture-proof` passes against the generated `.wallet-artifacts/fixture-connection-proof/<run-id>/FIXTURE-PROOF-MANIFEST.json` evidence.
4. **Complete Wildcat lender connection.** Drive `https://testnet.wildcat.finance/lender`, dismiss consent, choose MetaMask, approve connection, verify the masked `0x8161…4b61` account, and capture a safe screenshot.
5. **Package an agent-facing command.** Add a single opt-in command such as `wallet-browser run --profile sepolia-burner --target wildcat-lender` that prepares the profile, enforces origin/chain/account guardrails, collects artifacts, and exits with a redacted status object.

## Overnight stretch plan

If running unattended overnight, aim for one autonomous loop with strict safety limits:

1. **No transaction approvals.** Only connect-wallet and read-only account/chain checks; reject sign/send prompts.
2. **Retry prompt discovery variants.** Try MetaMask popup, notification page, extension home, and new-page events; record which selector/path worked.
3. **Capture artifacts every attempt.** Save screenshots, sanitized page text, active URLs, and a redacted JSON manifest under `.wallet-artifacts/overnight-wildcat/<timestamp>/`.
4. **Stop on first verified connection.** Verification requires Wildcat UI or provider state showing the expected masked burner account on Sepolia.
5. **Summarize failure modes.** If connection still fails, produce a ranked list of blockers: connect-modal selection, MetaMask notification discovery, chain mismatch, page/context closure, or Wildcat-side provider state.

Stretch goal: after a verified Wildcat connection screenshot, generalize the successful prompt path into a reusable `connectWallet()` driver and add mock tests for the discovered state machine before touching any transaction/signature flows.

## Safety posture

- Burner/testnet wallets only.
- Fail closed on unexpected chain, account, origin, prompt type, target, or value.
- Default transaction value cap is zero wei.
- Treat wallet profiles as secrets even if encrypted.
- Treat screenshots/traces/reports as sensitive until inspected.
- Redact private keys, seed phrases, wallet passwords, RPC tokens, full `.env` contents, and full wallet addresses from logs and public docs.

## Docs

- [Phase 1 runtime matrix](docs/phase-1-runtime-matrix.md)
- [Phase 2 usage and acceptance](docs/phase-2-usage.md)
- [Phase 3 MetaMask onboarding usage](docs/phase-3-usage.md)
- [Phase 4 Sepolia network provisioning usage](docs/phase-4-usage.md)
- [Phase 5 fixture dapp usage](docs/phase-5-usage.md)
- [Phase 6 wallet-control helper usage](docs/phase-6-usage.md)
- [Phase 7 audit and safety guardrails](docs/phase-7-usage.md)
- [Security and artifact handling](docs/security-and-artifacts.md)
- [High-level goals](docs/high-level-goals.md)
