# Agent Browser Wallet

Web3 QA automation for real browser-wallet flows.

Agent Browser Wallet is a Playwright/Chromium harness for testing dapps through a real wallet extension instead of a mocked provider. It launches Chromium with MetaMask, prepares an isolated burner wallet profile, drives dapp UI, handles wallet prompts through fail-closed guardrails, and writes redacted proof artifacts that can be verified after a run.

The project focus is now narrow and product-oriented:

> Help dapp teams and agent builders run repeatable, safe QA checks for wallet connection, chain switching, signature prompts, transaction prompts, and dapp state using the same browser-wallet path a user would use.

## Why this exists

Most Web3 QA either mocks `window.ethereum` or relies on manual wallet testing. That misses the failure modes users actually hit:

- broken wallet connect modals;
- stale or hidden MetaMask popups;
- wrong-chain flows;
- account mismatch bugs;
- signature and transaction prompts that ask for more than expected;
- dapp UI that says connected while provider state disagrees.

This repo is building a safer middle layer: real browser, real wallet extension, real dapp, explicit policy, auditable proof.

## Product pillars

1. **Real wallet runtime**  
   Persistent Chromium context + pinned MetaMask extension + isolated burner/testnet profile.

2. **Dapp QA flows**  
   Reusable checks for connect, chain/account assertion, prompt classification, signature rejection/approval, and transaction guardrails.

3. **Policy before clicks**  
   Every wallet action is bounded by expected origin, chain, account, prompt type, target, and value.

4. **Proof artifacts**  
   Runs produce local-only screenshots, manifests, hashes, and redacted diagnostics. Verifiers reject wrong chains, wrong origins, missing screenshots, path leaks, and full-address leaks.

5. **Agent-ready interface**  
   The long-term shape is a CLI/library that agents and CI jobs can call without hand-scripting MetaMask each time.

## Current status

Working today:

- TypeScript/pnpm workspace with fixture dapp and wallet-browser package.
- MetaMask extension fetcher for ignored local extension artifacts.
- Persistent Chromium + MetaMask smoke commands.
- Wallet config, onboarding, network, prompt, guardrail, and proof-verifier modules.
- Fixture dapp with mocked-provider tests for connect, signing, zero-value transaction, account/chain events, and guardrail failures.
- Local live runner for fixture dapp connection through real Chromium + MetaMask.
- Local live runner for Wildcat testnet lender connection through real Chromium + MetaMask.
- Redacted proof verification for fixture and Wildcat connection artifacts.
- Sensitive-content scan for tracked files and git history patches.

Local dogfood already proved:

- Chromium can load real MetaMask under Xvfb.
- A Sepolia burner wallet can be imported from ignored `.env`.
- The fixture dapp can connect to MetaMask on Sepolia and produce verified proof.
- `https://testnet.wildcat.finance/lender` can connect to MetaMask on Sepolia and produce verified proof.
- The Wildcat flow stops before terms signing, message signing, or transactions.

## Repository layout

```text
apps/fixture-dapp/                 # Minimal dapp used for deterministic QA flows
packages/wallet-browser/           # Core config, network, prompt, guardrail, proof helpers
scripts/live-fixture-connect.mjs   # Local real-wallet fixture connection runner
scripts/live-wildcat-connect.mjs   # Local real-wallet Wildcat connection runner
scripts/fetch-metamask-extension.py
scripts/sensitive-scan.py
docs/product-roadmap.md            # Product direction and buildout plan
docs/security-and-artifacts.md     # Safety policy for secrets, profiles, traces, screenshots
```

Ignored local runtime directories:

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

Install and verify the committed code:

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

Run non-secret smoke/config commands:

```bash
pnpm --filter @agent-browser-wallet/wallet-browser cli --help
pnpm --filter @agent-browser-wallet/wallet-browser cli prepare
pnpm wallet:smoke:metamask
pnpm wallet:smoke:fixture-extension
```

On Linux/WSL/CI without a display, wrap real browser commands with Xvfb:

```bash
xvfb-run -a pnpm wallet:smoke:metamask
```

## Local live QA runs

Create a local burner/testnet config:

```bash
cp .env.example .env
chmod 600 .env
```

Fill only burner/testnet values. Never use production wallets.

Run the fixture dapp live connection proof:

```bash
pnpm fixture:build
pnpm fixture:serve
# in another shell:
xvfb-run -a pnpm wallet:live:fixture-connect
```

Run the Wildcat testnet lender live connection proof:

```bash
xvfb-run -a pnpm wallet:live:wildcat-connect
```

Verify generated proof artifacts:

```bash
node packages/wallet-browser/dist/cli.js verify-fixture-proof .wallet-artifacts/fixture-connect/<run-id>
node packages/wallet-browser/dist/cli.js verify-wildcat-lender-artifacts .wallet-artifacts/wildcat-lender/<run-id>
```

## Safety posture

- Burner/testnet wallets only.
- Fail closed on unexpected origin, chain, account, prompt type, target, or value.
- Default transaction value cap is zero wei.
- Refuse unknown signing or transaction prompts unless a specific policy allows them.
- Treat wallet profiles, traces, screenshots, and videos as sensitive.
- Never commit `.env`, wallet profiles, extension bundles, traces, reports, or local proof artifacts.
- Redact private keys, seed phrases, wallet passwords, RPC tokens, full `.env` contents, sensitive local paths, and full wallet addresses from public logs/docs.

## Product buildout path

See [docs/product-roadmap.md](docs/product-roadmap.md) for the focused progression. The next milestone is to turn the proven live runners into a reusable QA scenario engine:

```bash
pnpm wallet qa connect --target fixture --policy policies/connect-only.json
pnpm wallet qa connect --url https://testnet.wildcat.finance/lender --policy policies/wildcat-connect-only.json
```

That scenario engine should become the base for dapp QA suites, CI smoke tests, and eventually guarded signature/transaction workflows.

## Docs

- [Product roadmap](docs/product-roadmap.md)
- [Security and artifact handling](docs/security-and-artifacts.md)
