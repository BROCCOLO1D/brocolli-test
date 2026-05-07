# Phase 4 Sepolia network provisioning usage and acceptance

Phase 4 adds dependency-light Sepolia network helpers for MetaMask-oriented browser wallet automation. The helpers validate the expected chain/account, produce redacted provisioning plans, and expose mockable driver contracts so Sepolia setup can be tested without launching the real extension.

## Required and optional local inputs

Copy `.env.example` to an ignored local `.env` and keep values limited to burner/testnet use:

```bash
SEPOLIA_WALLET_ADDRESS=0x0000000000000000000000000000000000000000
SEPOLIA_CHAIN_ID=11155111
SEPOLIA_RPC_URL=https://sepolia.example.invalid
METAMASK_NETWORK_ASSERTION_TIMEOUT_MS=60000
METAMASK_NETWORK_DEBUG=false
```

`SEPOLIA_WALLET_ADDRESS` is required because Phase 4 fail-closes unless the active MetaMask account matches the configured burner account. `SEPOLIA_CHAIN_ID` defaults to Sepolia (`11155111`, `0xaa36a7`) and only Sepolia plus local/devnet chain IDs are allowed. `SEPOLIA_RPC_URL` is optional for chain/account assertions, but it is required if MetaMask needs `wallet_addEthereumChain` after an unknown-chain switch failure.

## Programmatic network plan and assertions

```ts
import {
  assertExpectedChainAndAccount,
  createSepoliaNetworkPlan,
  provisionSepoliaNetwork,
  resolveSepoliaNetworkConfig
} from '@agent-browser-wallet/wallet-browser';

const networkConfig = resolveSepoliaNetworkConfig({ env: process.env });
const plan = createSepoliaNetworkPlan(networkConfig);
console.log(JSON.stringify(plan)); // RPC URL is sanitized.

await provisionSepoliaNetwork(networkConfig, driver);
await assertExpectedChainAndAccount(networkConfig, driver);
```

The driver is intentionally small and mockable: it needs chain/account reads plus switch/add-chain operations. `createMetaMaskNetworkPageDriver({ page })` now provides an EIP-1193 bridge for already-open wallet/dapp pages with `window.ethereum.request`; extension UI selector automation can still be layered on top once pinned MetaMask pages are verified.

## CLI network plan

After `pnpm build`, agents can validate network provisioning inputs and print a redacted JSON plan without requiring a MetaMask extension artifact:

```bash
pnpm --filter @agent-browser-wallet/wallet-browser cli network-plan
```

The command returns non-zero on invalid chain IDs, invalid account addresses, or malformed optional RPC URLs. Public output and validation errors must not echo raw RPC URLs, private keys, or passwords.

## Acceptance for this slice

- Decimal and hex chain IDs normalize to one canonical Sepolia decimal/hex pair.
- Allowed chain validation includes Sepolia and local/devnet chain IDs, and rejects unsupported networks by default.
- Expected account addresses normalize to lower-case `0x` addresses and fail closed on invalid or mismatched accounts.
- Sepolia switch/add-chain behavior is testable through a mock driver and requires an RPC URL only when adding the chain is necessary.
- Redacted network plans and thrown errors do not leak RPC tokens or wallet secrets.
- No transactions, fixture dapp flows, or Wildcat-specific flows are included in Phase 4.
