# Architecture

brocolli-test is a two-package workspace for wallet-backed dapp QA.

```text
@broccolo1d/playwright
  └─ imports @broccolo1d/wallet-browser
       └─ uses Playwright Chromium persistent contexts
            └─ loads an unpacked MetaMask extension from ignored local storage
```

## Package boundaries

### `@broccolo1d/wallet-browser`

Core runtime and policy primitives:

- resolve wallet runtime configuration from explicit options and environment;
- prepare persistent Chromium launch options for an unpacked extension;
- launch and close a wallet-enabled browser context;
- discover MetaMask extension pages;
- create redacted onboarding, network, and profile-bootstrap plans;
- classify and approve only supported prompt paths through explicit drivers;
- assert expected chain and account state;
- write and verify local smoke/proof artifacts;
- expose the `wallet-browser` CLI for local setup and verification.

This package does not own dapp selectors or app assertions.

### `@broccolo1d/playwright`

Fixture layer for downstream dapp suites:

- extends `@playwright/test` with `walletConfig`, `walletContext`, `walletPage`, `wallet`, and `walletArtifacts` fixtures;
- keeps `useRealWallet` disabled by default;
- delegates launch, guardrails, prompt handling, network assertions, and address masking to `@broccolo1d/wallet-browser`;
- leaves routes, connect buttons, UI assertions, and app-specific manifests to the consuming repo.

## Runtime model

1. A test or CLI command resolves configuration.
2. Chromium launches with a persistent profile and an unpacked extension only when explicitly requested.
3. Dapp code triggers wallet actions through app-owned UI drivers.
4. Wallet prompt drivers validate expected prompt text and policy before clicking.
5. Network drivers assert account and chain state.
6. Artifacts are written under ignored local directories and verified before sharing.

## Fail-closed policy

The default path is connect-oriented and conservative:

- no real wallet is launched unless requested;
- no prompt is approved without a configured prompt driver;
- no chain/account assertion runs without a configured network driver;
- signatures and transactions are rejected unless explicit policy and driver support are present;
- unknown prompt text or unsupported prompt types throw instead of clicking.

## Artifact contract

Smoke artifacts use `SMOKE-MANIFEST.json` plus screenshots and an `INSPECTION.md` checklist. Fixture proof artifacts use the package proof verifier. Verifiers are intentionally strict about path leaks, unsafe names, missing files, hash mismatches, full wallet addresses, and unreviewed sensitive content.

Artifacts are evidence for local QA runs. They are not public release material until reviewed and scrubbed.
