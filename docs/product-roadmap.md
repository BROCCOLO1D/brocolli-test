# Product roadmap: Web3 QA automation

brocolli-test is focused on becoming an importable QA automation package for dapps that need testing through a real browser wallet.

## Product thesis

Dapp QA should be able to answer, automatically and safely:

- Can a fresh wallet connect?
- Did the dapp request the expected chain?
- Does dapp UI match provider state?
- Did a wallet prompt appear, and what type was it?
- Did the prompt match the allowed origin, account, chain, target, value, and typed-data domain?
- Was anything signed or submitted, or was the run connect-only?
- Is there a redacted manifest and screenshot trail proving the result?

The harness should make those answers repeatable for humans, CI, and agents.

## Target users

- Dapp frontend teams that need wallet-backed regression tests.
- Protocol teams that want smoke tests across staging/testnet deployments.
- Security reviewers who need prompt and transaction evidence without manually clicking through every flow.
- Agent builders who need a safe wallet-enabled browser runtime.

## Near-term product shape

### CLI

```bash
wallet qa connect --target fixture --policy policies/connect-only.json
wallet qa connect --url https://testnet.wildcat.finance/lender --policy policies/wildcat-connect-only.json
wallet qa verify .wallet-artifacts/<scenario>/<run-id>
```

### Library

```ts
const run = await runWalletQaScenario({
  target: fixtureTarget(),
  wallet: metamaskWallet({ profile: 'sepolia-burner' }),
  policy: connectOnlyPolicy({ chainId: 11155111, origin: 'http://127.0.0.1:5173' })
});
```

### Artifact contract

Each run should write a local-only directory with:

- `manifest.json` with scenario, target, status, masked account, chain, origin, decisions, and screenshot hashes;
- screenshots captured only after guardrails pass or as redacted failure diagnostics;
- prompt text/classification when safe;
- verifier output that can be used in CI without launching a browser.

## Product milestones

### 1. Scenario engine

Convert `scripts/live-fixture-connect.mjs` and `scripts/live-wildcat-connect.mjs` into one reusable scenario runner.

Required pieces:

- target config: URL, allowed origins, connect button strategy, wallet-choice strategy, expected post-connect checks;
- wallet config: extension path/version, profile mode, burner account, network;
- policy config: allowed prompt types, chains, accounts, value caps, contracts, typed-data domains;
- artifact writer: manifest, screenshot registry, redacted logs;
- verifier: one generic proof verifier plus target-specific assertions.

### 2. First-class connect QA

Make connect-only QA polished and repeatable.

Acceptance:

- fixture target passes from a fresh throwaway profile;
- Wildcat testnet target passes from local burner config;
- wrong-origin and wrong-chain fixtures fail before wallet approval;
- artifacts prove connected provider state and dapp UI state;
- CLI output is short, JSON-friendly, and redacted.

### 3. Prompt classifier and policy firewall

Promote prompt handling into a reusable classifier.

Prompt classes:

- connect;
- add/switch network;
- personal sign;
- typed-data sign;
- token approval;
- contract transaction;
- value transfer;
- unknown/dangerous.

Policy behavior:

- allow connect/network prompts under strict origin + chain rules;
- reject unknown prompts by default;
- reject signatures and transactions unless explicitly enabled;
- emit audit decisions for every prompt.

### 4. Signature QA

Add safe signature testing with fixture dapp first.

Acceptance:

- known fixture message can be approved under policy;
- wrong origin, wrong domain, wrong chain, or unexpected message is rejected;
- signature rejection path is asserted in dapp UI;
- no arbitrary blind signing.

### 5. Transaction QA

Add zero-value and capped-value transaction testing.

Acceptance:

- fixture zero-value transaction can be approved under policy;
- non-zero value fails unless explicit cap allows it;
- wrong target contract fails;
- unsupported chain fails before `eth_sendTransaction` approval;
- transaction hash/status is captured when available.

### 6. CI packaging

Make secret-backed CI usage practical but conservative.

Acceptance:

- documented GitHub Actions recipe using CI secrets and Xvfb;
- traces/videos disabled by default;
- artifacts uploaded only after redaction/verifier pass;
- fail if `.env`, profiles, extensions, traces, or reports become tracked.

### 7. Target registry

Add a target registry so dapp QA flows are data-driven instead of one-off scripts.

Example targets:

- fixture;
- Wildcat testnet lender;
- additional known testnet dapps;
- local Anvil/Hardhat fixture.

Each target should define allowed origins, expected chain(s), connect selectors, wallet modal behavior, and post-connect assertions.

### 8. Agent integration

Expose the harness as a safe tool for autonomous agents.

Agent-facing output should answer:

- what was attempted;
- what wallet prompt appeared;
- what policy decision was made;
- whether dapp state matched provider state;
- where local proof artifacts were written.

Agents should not receive raw secrets, full profiles, or unverified screenshot claims.

## Non-goals for now

- Mainnet automation.
- Production/private wallets.
- Blind signing.
- Unbounded transaction approval.
- Broad wallet comparison research before MetaMask QA is solid.
- Committed real-wallet screenshots unless explicitly reviewed and scrubbed.

## Immediate progression steps

1. **Refactor live runners into shared modules.** Extract MetaMask launch, onboarding/import, page discovery, prompt approval, Sepolia assertion, artifact writing, and verifier invocation from the fixture/Wildcat scripts.
2. **Introduce target and policy config files.** Add `targets/fixture.json`, `targets/wildcat-lender.json`, and `policies/connect-only.json` as non-secret committed examples.
3. **Build `wallet qa connect`.** One CLI command should run connect-only QA for any target config and emit a single redacted JSON result.
4. **Unify proof manifests.** Replace fixture/Wildcat-specific manifest shapes with a generic `WALLET-QA-MANIFEST.json`, keeping target-specific verifier checks as plugins.
5. **Add negative fixtures.** Create fixture cases for wrong origin, wrong chain, bad account, and unexpected prompt so the policy layer proves it refuses unsafe flows.
6. **Add prompt classifier tests.** Use fake Playwright pages to cover connect/network/sign/transaction/unknown prompt text without launching MetaMask in CI.
7. **Document CI recipe.** Add a conservative GitHub Actions example for fixture connect QA with Xvfb and secret-backed burner config.
8. **Then expand beyond connect.** Add signature QA, then zero-value transaction QA, only after connect QA is stable and policy-gated.
