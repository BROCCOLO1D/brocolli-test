# Wallet Contract Tests and Scenario Builder Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make `@broccolo1d/playwright` stand out with two novel public surfaces: reusable dapp wallet contract tests and a declarative wallet state scenario builder.

**Architecture:** Keep dapp selectors/routes/assertions app-owned, but provide strongly typed contracts and deterministic provider scenarios that consumer repos can compose. Implement the scenario builder first because contract tests should use it for fast CI-safe states before optional real-wallet proof runs.

**Tech Stack:** TypeScript, Playwright fixtures, Vitest, EIP-1193 injected provider mocks, existing `walletArtifacts` proof/index helpers, existing fail-closed policy helpers.

**Current status (2026-05-22):** Feature 11 and Feature 4 are implemented in `@broccolo1d/playwright` and covered by package tests, typecheck, packed-consumer verification, README examples, and root roadmap presentation. The remaining adoption blocker is publishing `@broccolo1d/playwright@0.2.10` to npm; the public registry still reports `0.2.9` as latest and the local ignored npm auth currently returns `E401` for `npm whoami`, so Wildcat should not consume a tarball or local workspace path as if it proved the public API contract.

---

## Priority Order for Next Cycles

1. **Wallet State Scenario Builder** (`walletScenario`) — foundation for deterministic disconnected/connected/wrong-chain/pending/rejected states.
2. **Wallet Contract Tests for Dapps** (`walletContractTests`) — reusable smoke/compliance suite built on the scenario builder and existing artifact helpers.
3. **Wildcat consumer proof** — adopt both in `wildcat-app-v2` only after package API/tests/docs are usable locally.

## Non-goals for this plan

- No mainnet automation.
- No blind prompt approval.
- No transaction approval beyond deterministic mocked/pending/rejected provider responses.
- No app-specific selectors inside the package. Consumer tests pass selectors/callbacks.
- No real private-key-backed MetaMask proof unless ignored local/CI testnet secrets already exist.

---

# Feature 11: Wallet State Scenario Builder

## Public API Target

```ts
import { walletScenario, installWalletScenario } from '@broccolo1d/playwright';

await installWalletScenario(page, walletScenario()
  .disconnected()
  .withChain(11155111)
  .withProviderInfo({ walletId: 'io.metamask', name: 'MetaMask' })
  .build());

await installWalletScenario(page, walletScenario()
  .connected({ account: '0x1111111111111111111111111111111111111111' })
  .withChain('0xaa36a7')
  .withTokenBalance({ symbol: 'USDC', amount: '1000' })
  .withPendingTransaction({ hash: '0xabc...', label: 'borrower-approval' })
  .build());
```

The installed provider should support the common CI-safe EIP-1193 calls:

- `eth_accounts`
- `eth_requestAccounts`
- `eth_chainId`
- `net_version`
- `wallet_switchEthereumChain`
- `wallet_addEthereumChain`
- configurable failure for `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`
- optional EIP-6963 announcement for discovery tests

## Acceptance Criteria

- Builder rejects zero/invalid accounts and invalid chain IDs.
- Disconnected state returns `[]` for `eth_accounts` and configurable `eth_requestAccounts` behavior.
- Connected state returns one normalized non-zero account.
- Wrong-chain state can be represented without mutating expected chain metadata.
- Pending/rejected transaction/signature scenarios produce deterministic errors/results without real wallet secrets.
- Provider emits `accountsChanged`/`chainChanged` events when scripted methods change state.
- EIP-6963 metadata can be attached but remains optional.
- Tests cover all states without launching a real browser wallet.
- README documents that scenario builder is UI smoke only, not private-key-backed proof.

## Implementation Tasks

### Task 1: Add scenario model types

**Objective:** Define the public state model without changing runtime behavior.

**Files:**
- Modify: `packages/playwright/src/index.ts`
- Test: `packages/playwright/test/wallet-qa-helper.test.ts`

**Step 1: Write failing tests**

Add a `describe('wallet scenario builder')` block asserting:

```ts
const scenario = walletScenario()
  .connected({ account: ACCOUNT })
  .withChain(11155111)
  .build();

expect(scenario).toMatchObject({
  account: ACCOUNT.toLowerCase(),
  chainIdHex: '0xaa36a7',
  connectionState: 'connected'
});
```

Also assert invalid/zero account and invalid chain ID throw.

**Step 2: Run focused test**

```bash
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright test -- wallet-qa-helper.test.ts
```

Expected: FAIL because `walletScenario` is not exported.

**Step 3: Implement minimal model**

Add exported types near `DeterministicInjectedWalletOptions`:

```ts
export type WalletScenarioConnectionState = 'disconnected' | 'connected';

export interface WalletScenarioProviderInfo {
  walletId?: string;
  name?: string;
  icon?: string;
  rdns?: string;
}

export interface WalletScenarioState {
  connectionState: WalletScenarioConnectionState;
  account?: string;
  chainIdHex: string;
  providerInfo?: WalletScenarioProviderInfo;
  tokenBalances?: WalletScenarioTokenBalance[];
  pendingTransactions?: WalletScenarioPendingTransaction[];
}
```

Expose `walletScenario()` returning a small immutable builder with `disconnected()`, `connected({ account })`, `withChain(chainId)`, `withProviderInfo(info)`, `withTokenBalance(balance)`, `withPendingTransaction(tx)`, and `build()`.

**Step 4: Run focused test again**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/playwright/src/index.ts packages/playwright/test/wallet-qa-helper.test.ts
git commit -m "feat(playwright): add wallet scenario state builder"
```

---

### Task 2: Replace deterministic injected wallet internals with scenario installer

**Objective:** Keep `installDeterministicInjectedWallet` backwards compatible while introducing `installWalletScenario`.

**Files:**
- Modify: `packages/playwright/src/index.ts`
- Test: `packages/playwright/test/wallet-qa-helper.test.ts`

**Step 1: Write failing tests**

Use a fake `page.addInitScript` recorder to assert `installWalletScenario(page, scenario)` passes normalized state into the init script. Also assert `installDeterministicInjectedWallet(page, { account, chainId })` delegates to a connected scenario.

**Step 2: Run focused test**

Expected: FAIL because `installWalletScenario` does not exist.

**Step 3: Implement**

Create:

```ts
export async function installWalletScenario(
  page: DeterministicInjectedWalletPage,
  scenario: WalletScenarioState
): Promise<void> { /* addInitScript provider install */ }
```

Move the current provider implementation out of `installDeterministicInjectedWallet` and parameterize it by scenario:

- disconnected `eth_accounts` returns `[]`
- connected `eth_accounts` returns `[account]`
- `eth_requestAccounts` either returns account or throws configured request error
- `eth_chainId` returns `scenario.chainIdHex`
- `wallet_switchEthereumChain` updates `provider.chainId` only when configured as supported

Keep `installDeterministicInjectedWallet` as:

```ts
return installWalletScenario(page, walletScenario()
  .connected({ account: options.account })
  .withChain(options.chainId)
  .withProviderInfo({ walletId: 'io.metamask', name: 'MetaMask' })
  .build());
```

**Step 4: Run tests**

```bash
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright test -- wallet-qa-helper.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/playwright/src/index.ts packages/playwright/test/wallet-qa-helper.test.ts
git commit -m "feat(playwright): install deterministic wallet scenarios"
```

---

### Task 3: Add scripted method outcomes

**Objective:** Let scenarios represent pending/rejected signature and transaction states without real signing.

**Files:**
- Modify: `packages/playwright/src/index.ts`
- Test: `packages/playwright/test/wallet-qa-helper.test.ts`

**Step 1: Write failing tests**

Assert scenario methods can configure:

```ts
walletScenario()
  .connected({ account: ACCOUNT })
  .withChain(11155111)
  .rejectsMethod('personal_sign', { code: 4001, message: 'User rejected request.' })
  .resolvesMethod('eth_sendTransaction', '0x1234')
  .build();
```

**Step 2: Implement model fields**

Add:

```ts
export interface WalletScenarioMethodOutcome {
  method: string;
  type: 'resolve' | 'reject';
  value?: unknown;
  error?: { code?: number; message: string };
}
```

Builder methods:

- `resolvesMethod(method, value)`
- `rejectsMethod(method, error)`
- convenience `rejectsSignature(error?)`
- convenience `rejectsTransaction(error?)`

**Step 3: Implement provider routing**

In the injected provider `request()` handler, check scripted outcomes before default unsupported-method failure.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/playwright/src/index.ts packages/playwright/test/wallet-qa-helper.test.ts
git commit -m "feat(playwright): script wallet scenario method outcomes"
```

---

### Task 4: Add optional EIP-6963 announcement support

**Objective:** Make scenario builder useful for modern wallet discovery smoke tests.

**Files:**
- Modify: `packages/playwright/src/index.ts`
- Test: `packages/playwright/test/wallet-qa-helper.test.ts`

**Step 1: Write failing tests**

Assert a scenario with provider info installs an init script that dispatches an `eip6963:announceProvider` event after receiving `eip6963:requestProvider`, and includes safe metadata only.

**Step 2: Implement event bridge**

Inside injected script:

```ts
window.addEventListener('eip6963:requestProvider', () => {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info, provider }
  }));
});
```

Use defaults:

- `walletId: 'io.metamask'`
- `name: 'MetaMask'`
- no icon unless explicitly supplied

**Step 3: Run focused tests**

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/playwright/src/index.ts packages/playwright/test/wallet-qa-helper.test.ts
git commit -m "feat(playwright): support eip6963 wallet scenario discovery"
```

---

### Task 5: Document scenario builder

**Objective:** Make the API adoptable by app teams without confusing it with real-wallet proof.

**Files:**
- Modify: `packages/playwright/README.md`
- Modify: `docs/product-roadmap.md`

**Step 1: Add README section**

Add `## Wallet scenario builder` after `## Helpers` or before it. Include disconnected, connected, wrong-chain, rejected-signature, and EIP-6963 examples.

**Step 2: Update roadmap**

Mark scenario builder as the immediate package priority and explain it is CI-safe UI smoke, not private-key-backed evidence.

**Step 3: Run doc-adjacent validation**

```bash
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright test -- wallet-qa-helper.test.ts
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright typecheck
```

**Step 4: Commit**

```bash
git add packages/playwright/README.md docs/product-roadmap.md
git commit -m "docs(playwright): document wallet scenario builder"
```

---

# Feature 4: Wallet Contract Tests for Dapps

## Public API Target

```ts
import { walletContractTests } from '@broccolo1d/playwright/contracts';

walletContractTests({
  appName: 'Wildcat',
  baseUrl: 'http://127.0.0.1:3000',
  expectedChainId: 11155111,
  expectedAccount: '0x1111111111111111111111111111111111111111',
  routes: [
    { name: 'lender', path: '/lender', walletAffordance: /connect|wallet/i },
    { name: 'borrower', path: '/borrower', walletAffordance: /connect|wallet/i }
  ],
  connect: async ({ page }) => {
    await page.getByRole('button', { name: /connect/i }).click();
    await page.getByText(/metamask/i).click();
  },
  assertConnected: async ({ page, account }) => {
    await expect(page.getByText(account.slice(0, 6))).toBeVisible();
  }
});
```

The package owns common wallet-state rows and artifact output; the app owns route list, selectors, modal clicks, and assertions.

## Acceptance Criteria

- Contract suite can run as plain Playwright tests in consumer repos.
- Routes render with wallet affordances in disconnected mode.
- Connected injected-wallet state proves visible app account/network affordance through consumer callback.
- Wrong-chain and invalid-account scenarios fail closed through consumer-visible UI expectations.
- Each generated row writes screenshot + structured manifest + artifact-index entry.
- Test titles and artifact basenames are stable and safe.
- Contract tests are importable from public package output.
- Wildcat can adopt the suite with minimal wrapper code and no package-private imports.

## Implementation Tasks

### Task 6: Create contracts module skeleton

**Objective:** Add an importable `contracts` entrypoint without changing behavior.

**Files:**
- Create: `packages/playwright/src/contracts.ts`
- Modify: `packages/playwright/package.json`
- Test: `packages/playwright/test/wallet-contracts.test.ts`

**Step 1: Inspect package exports**

Check current `packages/playwright/package.json` exports and build config before editing.

**Step 2: Write failing import test**

Create a Vitest test importing:

```ts
import { walletContractTests } from '../src/contracts.js';
expect(walletContractTests).toBeTypeOf('function');
```

**Step 3: Implement no-op function and export path**

`contracts.ts` initially exports a typed function that registers no tests until options are passed. Add package export if needed:

```json
"./contracts": {
  "types": "./dist/contracts.d.ts",
  "import": "./dist/contracts.js"
}
```

**Step 4: Run focused tests and typecheck**

```bash
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright test -- wallet-contracts.test.ts
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright typecheck
```

**Step 5: Commit**

```bash
git add packages/playwright/src/contracts.ts packages/playwright/package.json packages/playwright/test/wallet-contracts.test.ts
git commit -m "feat(playwright): add wallet contracts entrypoint"
```

---

### Task 7: Define contract options and route smoke rows

**Objective:** Provide route-level disconnected smoke tests with artifact output.

**Files:**
- Modify: `packages/playwright/src/contracts.ts`
- Test: `packages/playwright/test/wallet-contracts.test.ts`

**Step 1: Define types**

```ts
export interface WalletContractRoute {
  name: string;
  path: string;
  walletAffordance?: string | RegExp;
  assert?: (input: WalletContractAssertionInput) => Promise<void>;
}

export interface WalletContractTestsOptions {
  appName: string;
  baseUrl: string;
  expectedChainId: string | number;
  expectedAccount: string;
  routes: WalletContractRoute[];
  test?: typeof base;
}
```

**Step 2: Implement route tests**

For each route:

- `page.goto(new URL(route.path, baseUrl).toString())`
- assert optional affordance via `page.getByText(...)`
- call route-specific `assert`
- screenshot `contract-${route.name}-disconnected.png`
- manifest `contract-${route.name}-disconnected.json`

**Step 3: Add tests using fake Playwright registration**

If direct Playwright test registration is hard to unit test, factor a pure `createWalletContractRows(options)` that returns row metadata and unit-test it, then have `walletContractTests()` register rows.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/playwright/src/contracts.ts packages/playwright/test/wallet-contracts.test.ts
git commit -m "feat(playwright): add wallet contract route smoke rows"
```

---

### Task 8: Add connected, wrong-chain, and invalid-account contract rows

**Objective:** Use `walletScenario` to provide reusable wallet-state rows.

**Files:**
- Modify: `packages/playwright/src/contracts.ts`
- Test: `packages/playwright/test/wallet-contracts.test.ts`

**Step 1: Extend options**

Add callbacks:

```ts
connect?: (input: WalletContractAssertionInput) => Promise<void>;
assertConnected?: (input: WalletContractConnectedInput) => Promise<void>;
assertDisconnected?: (input: WalletContractAssertionInput) => Promise<void>;
assertWrongChain?: (input: WalletContractAssertionInput) => Promise<void>;
assertInvalidAccount?: (input: WalletContractAssertionInput) => Promise<void>;
```

**Step 2: Register rows**

Rows:

- `route renders disconnected wallet affordance`
- `route shows connected wallet state`
- `route fails closed on wrong chain`
- `route fails closed on invalid account` — this should use a disconnected/failed `eth_requestAccounts` scenario rather than installing zero address.

**Step 3: Ensure evidence for every row**

Each row must produce:

- screenshot
- structured manifest with route, scenario name, expected chain, masked expected account, assertion summary
- artifact-index entry

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/playwright/src/contracts.ts packages/playwright/test/wallet-contracts.test.ts
git commit -m "feat(playwright): add wallet state contract rows"
```

---

### Task 9: Add stable manifest schema and verifier helper

**Objective:** Make contract evidence reviewable by CI/agents.

**Files:**
- Modify: `packages/playwright/src/contracts.ts`
- Modify: `packages/playwright/src/index.ts` if shared verifier utilities are needed
- Test: `packages/playwright/test/wallet-contracts.test.ts`

**Step 1: Define manifest**

```ts
export interface WalletContractManifest {
  schemaVersion: 1;
  artifactType: 'wallet-contract-test';
  createdAt: string;
  appName: string;
  route: { name: string; path: string };
  scenario: 'disconnected' | 'connected' | 'wrong-chain' | 'invalid-account';
  expectedChainId: string | number;
  maskedExpectedAccount: string;
  screenshot: WalletQaProofArtifact;
  status: 'passed' | 'failed';
  assertionSummary?: string;
}
```

**Step 2: Add verifier**

Export `verifyWalletContractManifest(artifactDir, manifestName)` or keep contract manifests compatible with `writeWalletQaArtifactIndex` if possible. Prefer reuse of existing index/proof redaction helpers.

**Step 3: Test redaction**

Assert no full account, local path, private-key-like value, or nested artifact path appears in JSON.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/playwright/src/contracts.ts packages/playwright/test/wallet-contracts.test.ts
git commit -m "feat(playwright): verify wallet contract evidence manifests"
```

---

### Task 10: Document wallet contract tests

**Objective:** Make the feature understandable and obviously useful.

**Files:**
- Modify: `packages/playwright/README.md`
- Modify: `docs/product-roadmap.md`

**Step 1: README section**

Add `## Wallet contract tests` with:

- install/import example
- minimal route matrix example
- connected/wrong-chain callbacks
- artifact output list
- warning that these are UI smoke/contract rows unless paired with real-wallet proof

**Step 2: Roadmap update**

Add a milestone note that contract tests are now the top adoption primitive after scenario builder.

**Step 3: Run gates**

```bash
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright test
npm exec pnpm@11.0.8 -- --filter @broccolo1d/playwright typecheck
```

**Step 4: Commit**

```bash
git add packages/playwright/README.md docs/product-roadmap.md
git commit -m "docs(playwright): document wallet contract tests"
```

---

# Wildcat Adoption Follow-up

Only start this after package tests/typecheck pass and docs are credible.

## Task 11: Add Wildcat wrapper spec

**Objective:** Prove the new APIs against `wildcat-app-v2` without leaking app-specific behavior into the package.

**Files:**
- Modify/create in `/home/hermes/work/broccoli/wildcat-app-v2/tests/wallet/`
- Modify: `/home/hermes/work/broccoli/wildcat-app-v2/docs/wallet-qa.md`
- Modify: `/home/hermes/work/broccoli/wildcat-app-v2/README.md`

**Steps:**

1. Import `walletContractTests` from packed/local package.
2. Configure Wildcat routes already covered by current route smoke matrix.
3. Pass Wildcat-specific connect modal callbacks.
4. Run no-secret route/contract tests locally.
5. Verify each row writes screenshot + JSON + artifact-index evidence.
6. Update docs with exact command and evidence review notes.
7. Commit in Wildcat repo and open/merge PR if permissions/checks allow.

**Suggested commands:**

```bash
cd /home/hermes/work/broccoli/wildcat-app-v2
npm ci
NEXT_PUBLIC_TARGET_NETWORK=Sepolia WILDCAT_WALLET_QA_RUN_APP=1 npm run test:wallet
npm run test:wallet:workflow
```

---

# Verification Checklist

- [x] `walletScenario` unit tests pass.
- [x] `installDeterministicInjectedWallet` remains backwards compatible.
- [x] `walletContractTests` has a public package export.
- [x] Every contract row emits screenshot + JSON manifest + artifact-index entry.
- [x] README explicitly distinguishes UI smoke from real private-key-backed proof.
- [x] `packages/playwright` typecheck passes.
- [x] Packed package import/consumer test still passes before publishing.
- [ ] Wildcat adoption uses public APIs only.

Wildcat adoption remains intentionally unchecked until `@broccolo1d/playwright@0.2.10` is visible on npm and the downstream app can adopt it through normal package installation rather than a local tarball/workspace workaround.
