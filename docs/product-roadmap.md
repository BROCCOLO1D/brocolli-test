# Product roadmap: Web3 QA automation

`brocolli-test` is an importable Web3 QA automation workspace for dapps that need testing through a real browser-wallet path.

The product line is now public package oriented:

- `@broccolo1d/wallet-browser@0.2.9` — core browser-wallet runtime, guardrails, CLI, and artifact helpers.
- `@broccolo1d/playwright@0.2.9` — Playwright fixtures for downstream dapp QA suites.

Target-specific scripts are not the product. Downstream apps own selectors, routes, modal behavior, assertions, and test data. These packages own wallet runtime primitives, policy boundaries, and verification contracts.

## Product thesis

Dapp QA should be able to answer, automatically and safely:

- Can a burner/testnet wallet connect?
- Did the dapp request the expected chain?
- Does dapp UI match provider state?
- Did a wallet prompt appear, and what type was it?
- Did the prompt match the allowed origin, account, chain, target, value, and typed-data domain?
- Was anything signed or submitted, or was the run connect-only?
- Is there a redacted manifest and screenshot trail proving the result?

The harness should make those answers repeatable for humans, CI, and agents without exposing secrets, raw local paths, or full wallet addresses.

## Target users

- Dapp frontend teams that need wallet-backed regression tests.
- Protocol teams that want smoke tests across staging/testnet deployments.
- Security reviewers who need prompt and transaction evidence without manually clicking through every flow.
- Agent builders who need a safe wallet-enabled browser runtime.

## Implemented state

### Importable packages

```bash
pnpm add -D @broccolo1d/playwright@0.2.9 @playwright/test
pnpm add -D @broccolo1d/wallet-browser@0.2.9 playwright
```

### Playwright fixture layer

```ts
import { expect, test, verifyWalletQaProofManifest } from '@broccolo1d/playwright';

test('connects app-owned wallet flow', async ({ page, wallet, walletArtifacts }) => {
  await page.goto('/');

  const result = await wallet.connect({
    click: async () => page.getByRole('button', { name: /connect/i }).click()
  });

  await wallet.expectConnected();
  await wallet.expectChain({ expectedChainId: 11155111 });

  const screenshot = await walletArtifacts.screenshot('connected');
  await walletArtifacts.connectedProof('wallet-connected', {
    origin: 'http://127.0.0.1:3000',
    account: result.activeAccount,
    chainId: result.chainId,
    attachments: [{ label: 'dapp-connected', path: screenshot, contentType: 'image/png' }]
  });

  await verifyWalletQaProofManifest(walletArtifacts.artifactDir, 'wallet-connected.json');
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

Real `wallet.connect` runs must configure explicit `walletConfig.prompt` and `walletConfig.network` drivers. Prompt approval is never implicit.

### Lower-level runtime layer

```ts
import {
  assertExpectedChainAndAccount,
  launchWalletBrowser,
  resolveSepoliaNetworkConfig,
  resolveWalletBrowserConfig,
  type MetaMaskNetworkDriver
} from '@broccolo1d/wallet-browser';

const expectedAccount = process.env.SEPOLIA_WALLET_ADDRESS;
if (!expectedAccount) throw new Error('SEPOLIA_WALLET_ADDRESS is required');

const { context } = await launchWalletBrowser({ config: resolveWalletBrowserConfig() });
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

### CLI and artifact verification

Implemented commands:

```text
wallet-browser doctor
wallet-browser prepare
wallet-browser smoke-metamask
wallet-browser smoke-fixture-extension
wallet-browser verify-smoke-artifacts [artifact-dir]
wallet-browser verify-fixture-proof <artifact-dir>
wallet-browser onboarding-plan
wallet-browser profile-bootstrap-import --dry-run
wallet-browser network-plan
```

The artifact contract is local-first:

- manifest metadata for scenario, status, masked account, chain, origin, decisions, and attachments;
- screenshots captured as local diagnostics;
- attachment basenames, sha256 hashes, and sizes;
- schema v1 public proof manifests with `createdAt`, `runId`, package/framework/tool provenance, optional test metadata, summary fields, artifact checksum lists, and verifier-computed `manifestSha256`;
- verifier output usable in CI without relaunching a browser;
- rejection of full addresses and absolute local paths in public proof manifests.

Milestone 3 proof artifact upgrade is implemented in `0.2.9`: Playwright proof manifests now emit required schema/provenance fields and verifier-friendly summaries/checksums, verifiers return manifest digests and provenance, fixture proof verification validates schema v1 provenance, and downgraded manifests without `schemaVersion` are rejected.

## Product milestones

### 1. Package foundation — implemented

- `@broccolo1d/playwright` fixtures for app-owned specs.
- `@broccolo1d/wallet-browser` core wallet runtime helpers.
- ESM TypeScript build output and package READMEs.
- npm package metadata for public package consumption.

### 2. Connect QA — implemented and hardening

Current support covers connect-oriented wallet QA with explicit account, chain, origin, prompt, and network policy. Remaining hardening work is consumer integration coverage and negative fixtures across real app flows.

Acceptance focus:

- app-owned connect specs import package fixtures instead of shelling out;
- wrong-origin, wrong-account, and wrong-chain cases fail before approval;
- artifacts prove connected provider state and dapp UI state;
- package logs and test output stay short, JSON-friendly, and redacted.

### 3. Canonical dapp flow helpers — in progress

Package APIs now cover the common connect/account/chain foundation plus guarded switch-chain and signature flows:

- `wallet.connect()` triggers an app-owned connect action and approves only expected connection prompts;
- `wallet.expectConnected()`, `wallet.expectChain()`, and `wallet.assertState()` verify provider state;
- `wallet.switchChain()` delegates to wallet-browser network switching only after expected account/chain and a network driver are configured;
- `wallet.signMessage()` supports SIWE/personal-sign flows with expected origin, account, chain, message, prompt, and dapp-trigger inputs;
- `wallet.signTypedData()` supports typed-data flows with expected origin, account, chain, canonical typed-data JSON/message, prompt, and dapp-trigger inputs.

Transaction approval is deliberately still absent until a zero-value or explicitly capped testnet policy is implemented with rejection tests.

Acceptance focus:

- common dapp tests import package helpers instead of recipe/autobrowse scripts;
- every wallet action has explicit origin/account/chain/policy inputs before approval;
- wrong-origin, wrong-account, wrong-chain, wrong-message, and unexpected-prompt cases fail before approval;
- package logs, docs, and proof artifacts stay redacted and free of local paths/secrets.

### 4. Prompt classifier and policy firewall — planned

Promote prompt handling into reusable classification and decision records across connect, add/switch network, personal sign, typed-data sign, token approval, contract transaction, value transfer, and unknown/dangerous states.

Acceptance:

- allow connect, network, and explicitly requested signature prompts only under strict origin, account, chain, and message rules;
- reject unknown, token approval, spending cap, and transaction prompts by default;
- emit audit decisions for every prompt without logging secrets or full local paths;
- keep typed-data domain/message validation visible to package consumers.

### 5. Transaction QA — planned

Add zero-value and capped-value transaction testing.

Acceptance:

- known zero-value or capped testnet transaction can be approved under policy;
- non-zero value fails unless an explicit cap allows it;
- wrong target contract fails;
- unsupported chain fails before `eth_sendTransaction` approval;
- transaction hash/status is captured when available.

### 6. CI packaging — in progress

Make secret-backed CI usage practical but conservative. The artifact index, stable Playwright annotations, prompt/action decision records, and [`docs/ci-artifact-review.md`](./ci-artifact-review.md) runbook now cover the reviewed-evidence upload path.

Acceptance:

- documented GitHub Actions example using CI secrets and Xvfb;
- traces/videos disabled by default;
- artifacts uploaded only after redaction, proof verification, artifact-index generation, and screenshot review;
- separate opt-in path for short-lived failure diagnostics;
- fail if `.env`, profiles, extensions, traces, reports, or raw wallet artifacts become tracked.

### 7. App integration examples — planned

Keep example integrations in downstream app repos so dapp-specific selectors and assertions stay app-owned.

Example consumers:

- `BROCCOLO1D/broccoli-control`;
- local `BROCCOLO1D/wildcat-app-v2` fork;
- additional known testnet dapps.

Each app should own routes, connect selectors, wallet modal behavior, and post-connect assertions while importing shared wallet runtime, policy, and artifact helpers from these packages.

### 8. Agent integration — planned

Expose the harness as a safe tool for autonomous agents.

Agent-facing output should answer:

- what was attempted;
- what wallet prompt appeared;
- what policy decision was made;
- whether dapp state matched provider state;
- where local proof artifacts were written.

Agents should not receive raw secrets, full profiles, full wallet addresses, or unverified screenshot claims.

## Non-goals

- Mainnet automation.
- Production/private wallets.
- Blind signing.
- Unbounded transaction approval.
- Broad wallet comparison before MetaMask QA is solid.
- Committed real-wallet screenshots unless explicitly reviewed and scrubbed.

## Immediate progression steps

0. **Build the next killer-feature pair.** Follow [`docs/plans/2026-05-21-wallet-contract-tests-and-scenarios.md`](./plans/2026-05-21-wallet-contract-tests-and-scenarios.md): first ship `walletScenario()` / `installWalletScenario()` for declarative deterministic wallet states, then ship `walletContractTests()` for reusable dapp wallet contract rows.
1. **Use scenario builder as the foundation.** Cover disconnected, connected, wrong-chain, invalid-account, rejected signature, pending/rejected transaction, and optional EIP-6963 discovery states without real wallet secrets.
2. **Make contract tests evidence-producing by default.** Every route/state row must write a screenshot, structured manifest, and artifact-index entry; selector/modal assertions remain consumer-owned.
3. **Adopt in Wildcat as the first real consumer.** After package tests/docs pass, replace/augment bespoke Wildcat wallet smoke coverage with the public scenario/contract-test APIs.
4. **Keep smoke vs proof wording strict.** Scenario and contract rows are CI-safe UI smoke unless paired with private-key-backed real MetaMask/test-wallet proof.
5. **Continue policy hardening through the new APIs.** Preserve fail-closed origin/account/chain/prompt behavior; do not add transaction approval until explicit capped/zero-value policy and rejection tests exist.
