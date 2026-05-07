# Phase 5 fixture dapp usage and acceptance

Phase 5 starts a tiny local dapp for validating wallet automation before any `wildcat-app-v2` Sepolia integration. The fixture intentionally uses the browser EIP-1193 provider at `window.ethereum` directly instead of wallet SDKs or dapp framework dependencies.

## Run the fixture locally

Install and build from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm fixture:test
pnpm fixture:test:mocked-provider
pnpm fixture:build
```

Then build and serve the app directory with the root helper script:

```bash
pnpm fixture:build
pnpm fixture:serve
```

Open `http://127.0.0.1:5173`. The committed `.env.example` uses the same URL as `FIXTURE_DAPP_URL`.

## Wallet actions

The fixture supports the first deterministic dapp actions needed by wallet automation:

1. `eth_requestAccounts` to connect a wallet.
2. `eth_accounts` and `eth_chainId` reads to display connected account and chain.
3. `personal_sign` with a fixed UTF-8 message encoded as hex.
4. `eth_sendTransaction` with a minimal zero-value transaction back to the connected account by default.

The zero-value self-transaction is meant to exercise wallet prompt handling without intentionally moving Sepolia funds. Wallet automation must still assert the expected account, chain, dapp origin, and transaction fields before approving prompts.

## Stable Playwright selectors

Use these `data-testid` selectors in page-level tests and future wallet helper flows:

| Purpose | Selector |
| --- | --- |
| Connect button | `[data-testid="connect-wallet-button"]` |
| Connected account | `[data-testid="connected-account"]` |
| Current chain | `[data-testid="current-chain"]` |
| Sign-message button | `[data-testid="sign-message-button"]` |
| Sign-message status | `[data-testid="sign-message-status"]` |
| Send-transaction button | `[data-testid="send-transaction-button"]` |
| Send-transaction status | `[data-testid="send-transaction-status"]` |
| Error/status output | `[data-testid="status-output"]` |

The selectors are also exported by `apps/fixture-dapp/src/fixture.ts` through `getFixtureSelectors()` so tests can avoid duplicating string literals.

## Tests available now

`pnpm fixture:test` runs dependency-light Vitest coverage for stable selector exports, account/chain formatting, `personal_sign` params, and minimal transaction payload construction. These tests do not require MetaMask, a browser profile, a private key, an RPC URL, or Playwright traces.

`pnpm fixture:test:mocked-provider` runs a Playwright Chromium smoke test against the built static fixture. It injects a mock `window.ethereum` provider before page load, clicks the stable selectors, and asserts the exact `eth_requestAccounts`, `eth_chainId`, `personal_sign`, and `eth_sendTransaction` request payloads without requiring real MetaMask. The Playwright config disables trace, screenshot, and video capture for this fixture smoke path.

Real MetaMask approval tests should only run after the fixture behavior is stable under this mocked-provider path.

## Acceptance for this slice

- The fixture app lives under `apps/fixture-dapp/` and is included in the pnpm workspace.
- Root scripts can build and test the fixture without changing the existing `pnpm build` and `pnpm test` entry points.
- The app uses direct EIP-1193 `window.ethereum.request` calls and no wallet SDKs.
- Public UI state uses stable `data-testid` selectors suitable for Playwright automation.
- Unit tests cover deterministic request payload construction and display formatting without touching secrets.
- The mocked-provider Playwright smoke test exercises the full browser UI path without MetaMask and with trace/screenshot/video capture disabled.
- Screenshots, traces, browser profiles, wallet extensions, and reports remain ignored/sensitive according to [security and artifact handling](security-and-artifacts.md).
