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

### Importable Playwright package

```ts
import { test, expect } from '@brocolli-test/playwright';

test('connects app-owned wallet flow', async ({ page, wallet }) => {
  await page.goto('/');
  await wallet.connect({
    requestConnection: async () => page.getByRole('button', { name: /connect/i }).click(),
    expectedAccount: process.env.SEPOLIA_WALLET_ADDRESS!,
    expectedChainId: 11155111,
    origin: 'http://127.0.0.1:3000'
  });
  await expect(page.getByText(/connected/i)).toBeVisible();
});
```

### Lower-level library

```ts
const browser = await launchWalletBrowser({ profileName: 'sepolia-burner' });
await assertExpectedChainAndAccount({
  driver: browser.network,
  expectedChainId: 11155111,
  expectedAccount: process.env.SEPOLIA_WALLET_ADDRESS!
});
```

### Artifact contract

Each run should write a local-only directory with:

- `manifest.json` with scenario, target, status, masked account, chain, origin, decisions, and screenshot hashes;
- screenshots captured only after guardrails pass or as redacted failure diagnostics;
- prompt text/classification when safe;
- verifier output that can be used in CI without launching a browser.

## Product milestones

### 1. Importable package foundation

Keep the public product centered on packages that downstream apps import, not target-specific shell scripts.

Required pieces:

- `@brocolli-test/playwright` fixtures for app-owned specs;
- `@brocolli-test/wallet-browser` core wallet runtime helpers;
- wallet config: extension path/version, profile mode, burner account, network;
- policy config: allowed prompt types, chains, accounts, value caps, contracts, typed-data domains;
- artifact writer: manifest, screenshot registry, redacted logs;
- verifier helpers that downstream apps can call from their own tests/CI.

### 2. First-class connect QA

Make connect-only QA polished and repeatable.

Acceptance:

- `broccoli-control` passes from a fresh throwaway profile;
- the local Wildcat fork owns and passes its package-import smoke spec;
- wrong-origin and wrong-chain fixtures fail before wallet approval;
- artifacts prove connected provider state and dapp UI state;
- package logs and test output stay short, JSON-friendly, and redacted.

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

Add safe signature testing with `broccoli-control` first.

Acceptance:

- known fixture message can be approved under policy;
- wrong origin, wrong domain, wrong chain, or unexpected message is rejected;
- signature rejection path is asserted in dapp UI;
- no arbitrary blind signing.

### 5. Transaction QA

Add zero-value and capped-value transaction testing.

Acceptance:

- `broccoli-control` zero-value/capped ERC20 transaction can be approved under policy;
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

### 7. App integration examples

Keep example integrations in downstream app repos so dapp-specific selectors and assertions stay app-owned.

Example consumers:

- `BROCCOLO1D/broccoli-control`;
- local `BROCCOLO1D/wildcat-app-v2` fork;
- additional known testnet dapps.

Each app should own its routes, connect selectors, wallet modal behavior, and post-connect assertions while importing shared wallet runtime/policy/artifact helpers from this package.

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

1. **Publish package-ready builds.** Move from local tarballs to npm packages after the scope/account is ready, publishing `@brocolli-test/wallet-browser` before `@brocolli-test/playwright`.
2. **Harden app-owned fixtures.** Expand `broccoli-control` tests for connect, wrong-chain, wrong-account, signature, and capped ERC20 transfer cases.
3. **Generalize policy helpers.** Keep reusable origin/chain/account/value checks in package APIs while selectors and dapp assertions stay in consumer repos.
4. **Unify proof manifests.** Provide a generic `WALLET-QA-MANIFEST.json` writer/verifier that downstream apps can call from their own Playwright tests.
5. **Add negative fixtures.** Create fixture cases for wrong origin, wrong chain, bad account, and unexpected prompt so the policy layer proves it refuses unsafe flows.
6. **Add prompt classifier tests.** Use fake Playwright pages to cover connect/network/sign/transaction/unknown prompt text without launching MetaMask in CI.
7. **Document CI recipe.** Add a conservative GitHub Actions example for fixture connect QA with Xvfb and secret-backed burner config.
8. **Then expand beyond connect.** Add signature QA, then zero-value transaction QA, only after connect QA is stable and policy-gated.
