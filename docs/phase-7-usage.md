# Phase 7 audit and safety guardrails usage and acceptance

Phase 7 makes wallet-control helpers observable and bounded. It is the maximum completed phase for this overnight loop; Phase 8 is intentionally not started here.

## Guardrail inputs

Guardrails are passed programmatically to wallet-control helpers so tests and agents can make policy explicit per dapp flow:

```ts
import {
  approveTransaction,
  connectWallet,
  type WalletGuardrailConfig
} from '@agent-browser-wallet/wallet-browser';

const guardrails: WalletGuardrailConfig = {
  allowedOrigins: ['http://127.0.0.1:5173'],
  allowedTargets: ['0x0000000000000000000000000000000000000000'],
  maxTransactionValueWei: '0'
};

await connectWallet({
  dapp,
  prompt,
  network,
  expectedAccount: process.env.SEPOLIA_WALLET_ADDRESS!,
  expectedChainId: 11155111,
  origin: process.env.FIXTURE_DAPP_URL,
  guardrails,
  logger: (event) => auditEvents.push(event)
});

await approveTransaction({
  dapp,
  prompt,
  expectedAccount: process.env.SEPOLIA_WALLET_ADDRESS!,
  origin: process.env.FIXTURE_DAPP_URL,
  to: '0x0000000000000000000000000000000000000000',
  value: '0x0',
  guardrails,
  logger: (event) => auditEvents.push(event)
});
```

The default transaction value cap is zero wei. Set `maxTransactionValueWei` only for a fixture flow that deliberately needs a tiny non-zero Sepolia value.

## What is audited

`WalletControlLogger` receives sanitized structured events with these fields when available:

- `action`: helper name such as `connectWallet`, `approveSignature`, `approveTransaction`, `switchNetwork`, or `assertWalletState`.
- `status`: lifecycle state such as `started`, `prompt-approved`, `verified`, or `failed`.
- `promptType`: `connect`, `signature`, or `transaction`.
- `origin`: dapp origin normalized to scheme, host, and safe path; query strings and fragments are stripped.
- `chainId` and `chainIdHex`: active or expected chain context where the helper verifies network state.
- `account`: configured burner account expected by the helper.
- `target`: transaction target contract/account where available.
- `valueWei`: transaction value normalized to decimal wei where available.
- `decision`: `pending`, `approved`, or `rejected`.
- `metadata`: optional caller context after recursive redaction.

## Fail-closed behavior

Wallet-control helpers reject before dapp requests or MetaMask prompt approvals when policy is unsafe:

- Chain assertions accept Sepolia and local/devnet chains only.
- Active account must match the configured burner account.
- Dapp origins must match `allowedOrigins` when an allowlist is configured.
- Transaction targets must match `allowedTargets` when an allowlist is configured.
- Transaction values must be at or below `maxTransactionValueWei`, defaulting to zero wei.
- Missing prompt-driver methods fail closed instead of guessing at wallet UI state.

Origin comparisons use the same sanitized origin form that is logged, so sensitive query or fragment data never becomes part of policy output.

## Redaction guarantees

Audit events and helper failure logs must not expose private keys, seed phrases, wallet passwords, RPC tokens, or full `.env` contents. The logger boundary masks:

- hex private-key-looking values;
- password, seed phrase, mnemonic, private-key, token, and secret object fields;
- env-style secret assignment lines;
- seed-like word sequences;
- HTTP(S) URLs that may contain RPC tokens.

`SEPOLIA_RPC_URL` values are reported only as sanitized URL placeholders such as `https://sepolia.infura.io/[redacted-url]`.

## Local `.env` placeholders

`.env.example` includes non-secret guardrail placeholders:

```bash
WALLET_GUARDRAIL_MAX_TRANSACTION_VALUE_WEI=0
WALLET_GUARDRAIL_ALLOWED_ORIGINS=http://127.0.0.1:5173
WALLET_GUARDRAIL_ALLOWED_TARGETS=0x0000000000000000000000000000000000000000
WALLET_AUDIT_LOG_MODE=structured
WALLET_AUDIT_LOG_PATH=.wallet-audit/wallet-control.jsonl
```

These are placeholders for local tooling or agent wrappers. Library helpers still receive guardrails explicitly from callers.

## Acceptance checks

Run from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm fixture:test:mocked-provider
pnpm build
git diff --check
```

Phase 7 acceptance requires tests proving:

- zero-value transactions pass under the default cap;
- tiny non-zero values pass only when explicitly capped;
- above-cap values reject before dapp or prompt side effects;
- disallowed origins and transaction targets reject before side effects;
- audit events include prompt type, chain/account/origin/target/value/decision where available;
- secret-like values are redacted from structured audit output.
