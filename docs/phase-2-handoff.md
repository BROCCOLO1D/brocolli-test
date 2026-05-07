# Phase 2 handoff checklist

Phase 2 should turn the Phase 1 runtime contract into the first runnable wallet-browser harness without expanding beyond the MetaMask/Chromium MVP.

## Implementation slices

### 1. Workspace and version pins

Outcome: the repo has one pnpm-based Node workspace and one lockfile.

- Add `package.json` with `packageManager`, `engines.node`, and scripts for `build`, `test`, `lint` or explicit no-op replacements.
- Add `pnpm-lock.yaml` as the only package-manager lockfile.
- Add `.nvmrc` if the selected Node version is not obvious from `package.json`.
- Install Playwright with an exact version and keep Chromium sourced from that Playwright release unless extension testing proves system Chrome is required.

Done when: `package.json` exposes deterministic install/test commands and the selected Node/package-manager/Playwright versions are visible in committed config.

### 2. MetaMask artifact fetcher

Outcome: a repeatable script prepares the pinned extension outside Git.

- Add `scripts/fetch-metamask.*`.
- Download one pinned MetaMask extension artifact from a documented source.
- Verify version and checksum before unpacking.
- Place unpacked files under `.wallet-extensions/metamask/<version>/`.
- Never commit downloaded extension files.

Done when: a fresh clone can run the script and get a verified local extension directory ignored by Git.

### 3. Wallet browser launcher

Outcome: tests can launch Chromium with the extension loaded in a persistent profile.

- Add `packages/wallet-browser` with `launchWalletBrowser()`.
- Require `METAMASK_EXTENSION_DIR` or use the fetched default path.
- Use `.wallet-profiles/<profile-name>` by default and support throwaway per-run profiles.
- Launch Chromium with extension flags such as `--disable-extensions-except` and `--load-extension`.
- Return the Playwright browser context plus helper metadata, including profile dir and extension id if discoverable.

Done when: a smoke test proves Chromium starts with the MetaMask extension target visible.

### 4. Fixture dapp

Outcome: wallet flows can be debugged against a tiny controlled dapp before real Sepolia apps.

- Add `apps/fixture-dapp`.
- Implement stable `data-testid` selectors for connect, account, chain, sign, and send actions.
- Display current account and chain after connection.
- Keep the app local-first; Sepolia send flow can be gated behind env availability.

Done when: Playwright can load the fixture dapp and assert its wallet interaction controls exist before MetaMask automation is added.

### 5. First MetaMask helper boundary

Outcome: MetaMask UI automation is isolated from dapp tests.

- Add `packages/metamask-automation`.
- Start with helpers for extension page discovery, onboarding/import, account assertion, network assertion, and connect prompt approval.
- Keep selectors and MetaMask UI assumptions in this package only.
- Fail closed on unknown prompt types or mismatched account/chain/origin.

Done when: fixture tests can connect the burner wallet and assert the configured Sepolia address without leaking secrets in logs.

## First end-to-end acceptance target

The first Phase 2 E2E should be intentionally narrow:

1. load `.env` placeholders from a local ignored `.env`;
2. assert `SEPOLIA_CHAIN_ID=11155111` and the expected burner address before wallet approval;
3. fetch/verify pinned MetaMask if missing;
4. create a throwaway profile unless `PRESERVE_WALLET_PROFILE=true`;
5. launch Chromium with MetaMask;
6. import the burner wallet;
7. open `FIXTURE_DAPP_URL`;
8. connect wallet;
9. assert expected address and chain;
10. delete or explicitly preserve the profile according to the test mode.

Do not add `wildcat-app-v2` coverage until this fixture flow is reliable.
