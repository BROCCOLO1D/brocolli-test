# CI artifact upload and review runbook

Use this runbook when a downstream dapp wants wallet-QA evidence from `@broccolo1d/playwright` in CI. The default is conservative: prove that manifests are verified and public-safe before uploading anything, and keep raw wallet/browser state out of GitHub artifacts unless a human explicitly needs failure diagnostics.

## Upload policy

Upload these after `verifyWalletQaProofManifest()` and `walletArtifacts.writeArtifactIndex()` succeed:

- `wallet-qa-artifact-index.json`
- reviewed proof manifests such as `wallet-connected.json`
- screenshots that were referenced by a verified manifest and manually reviewed for account/path/secret leakage

Do not upload these from secret-backed wallet runs by default:

- `.env` files or CI environment dumps
- MetaMask profiles, browser user data, extension bundles, or unpacked `.wallet-extensions/`
- Playwright traces, videos, and full HTML reports from real-wallet runs
- raw `.wallet-artifacts/` directories that have not been verified and reviewed
- private keys, seed phrases, wallet passwords, RPC URLs/tokens, full wallet addresses, or absolute local paths

If failure diagnostics require traces/videos/reports, split them into a separate opt-in job or manual rerun that uses a burner wallet with limited testnet funds and short artifact retention.

## Minimal GitHub Actions pattern

```yaml
name: wallet-qa

on:
  workflow_dispatch:

jobs:
  connected-proof:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      CI: true
      PLAYWRIGHT_HTML_OPEN: never
      # Keep traces/videos/reports off for secret-backed real-wallet runs.
      PLAYWRIGHT_TRACE: off
      PLAYWRIGHT_VIDEO: off
      SEPOLIA_WALLET_ADDRESS: ${{ secrets.SEPOLIA_WALLET_ADDRESS }}
      SEPOLIA_WALLET_PRIVATE_KEY: ${{ secrets.SEPOLIA_WALLET_PRIVATE_KEY }}
      SEPOLIA_CHAIN_ID: "11155111"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - name: Run wallet QA proof
        run: xvfb-run -a pnpm test -- --grep "wallet connected proof"
      - name: Verify proof and write artifact index
        run: pnpm run verify:wallet-qa-proof
      - name: Upload reviewed wallet QA evidence
        uses: actions/upload-artifact@v4
        if: success()
        with:
          name: wallet-qa-reviewed-evidence
          retention-days: 7
          if-no-files-found: error
          path: |
            .wallet-artifacts/playwright/wallet-qa-artifact-index.json
            .wallet-artifacts/playwright/wallet-connected.json
            .wallet-artifacts/playwright/*.png
```

The verification step should fail closed when the manifest is missing schema v1 provenance, includes raw local paths/full addresses/secret-like values, references unsafe screenshot names, has checksum mismatches, or omits expected chain/origin/account summary fields.

## Review checklist for uploaded evidence

Before linking artifacts from an issue, PR, release note, or README, verify:

- `wallet-qa-artifact-index.json` lists only reviewed manifest basenames and verifier-computed `manifestSha256` values.
- Every manifest has `schemaVersion: 1`, `summary.status`, `summary.chainId`, `summary.origin`, masked account fields, package/framework/tool provenance, and attachment checksums.
- Prompt/action `decisions` state whether connect/sign/transaction prompts were approved, rejected, skipped, or only observed.
- Screenshots show the intended dapp state and visible account/network UI when claiming positive connected-wallet evidence.
- Screenshots do not show private keys, seed phrases, RPC tokens, full wallet addresses, local profile paths, CI workspace paths, or unrelated tabs.
- No Playwright traces, videos, HTML reports, MetaMask profiles, extension bundles, or raw unreviewed artifact directories are attached.
- Public docs copy reviewed screenshots/proofs into stable paths such as `docs/screenshots/*.png` and link those files, not raw `.wallet-artifacts/` output.

## Optional failure diagnostics

For debugging-only workflows, keep artifacts separate and short-lived:

```yaml
- name: Upload wallet QA failure diagnostics
  uses: actions/upload-artifact@v4
  if: failure() && env.WALLET_QA_UPLOAD_FAILURE_DIAGNOSTICS == '1'
  with:
    name: wallet-qa-failure-diagnostics
    retention-days: 1
    path: |
      .wallet-artifacts/playwright/*.json
      .wallet-artifacts/playwright/*.png
```

Do not include traces, videos, profiles, extension directories, or `.env` files unless the run is explicitly non-secret-backed and the files have been reviewed locally first.

## Agent handoff format

When an agent posts CI evidence, keep it terse and verifiable:

```text
Wallet QA evidence:
- status: connected
- chain: Sepolia (11155111 / 0xaa36a7)
- account: 0x1234…abcd
- manifest: wallet-connected.json (sha256: <verifier-computed digest>)
- index: wallet-qa-artifact-index.json
- prompt decisions: connect approved; signatures skipped; transactions skipped
- raw traces/profiles/extensions: not uploaded
```

Never paste private keys, npm tokens, wallet passwords, RPC URLs, full addresses, local paths, or unreviewed screenshots into PR comments or issue updates.
