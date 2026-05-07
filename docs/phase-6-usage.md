# Phase 6 wallet-control helper usage and acceptance

Phase 6 starts the reusable wallet-control layer that agents and tests should call instead of scripting dapp tabs and MetaMask popups directly. The first slice is fully mockable and fail-closed where real MetaMask prompt UI automation is not wired yet.

## Helper API

```ts
import {
  approveSignature,
  approveTransaction,
  assertWalletState,
  connectWallet,
  resetProfile,
  switchNetwork
} from '@agent-browser-wallet/wallet-browser';
```

The helper module composes the earlier launcher/config, onboarding, and network layers through typed driver boundaries:

- `WalletDappDriver` initiates dapp-side requests such as `eth_requestAccounts` and reads the connected account.
- `WalletPromptDriver` owns MetaMask prompt approval methods. Missing signature or transaction approval methods fail closed instead of guessing at extension UI state.
- `MetaMaskNetworkDriver` is reused from Phase 4 for chain/account assertions and Sepolia switching.
- `WalletControlLogger` receives sanitized structured events for helper lifecycle and prompt decisions.

## Mocked fixture-style connect example

```ts
const result = await connectWallet({
  dapp: {
    async requestConnect() {
      await page.getByTestId('connect-wallet-button').click();
    },
    async getConnectedAccount() {
      return page.getByTestId('connected-account').textContent();
    }
  },
  prompt: {
    async approveConnection({ origin, expectedAccount, expectedChainIdHex }) {
      // Future real MetaMask popup automation plugs in here.
      // Mocked-provider tests can no-op after asserting the requested prompt shape.
    }
  },
  network: createMetaMaskNetworkPageDriver({ page }),
  expectedAccount: '0x0000000000000000000000000000000000000000',
  expectedChainId: '0xaa36a7',
  origin: 'http://127.0.0.1:5173',
  logger: (event) => console.log(JSON.stringify(event))
});
```

`connectWallet()` performs the dapp connect request, asks the prompt driver to approve the connection prompt, verifies the connected dapp account, and then asserts the active wallet chain/account through the Phase 4 network driver.

## Fail-closed prompt placeholders

`approveSignature()` and `approveTransaction()` require explicit prompt-driver methods. If a driver does not implement the relevant prompt approval method, the helper rejects with a fail-closed error. This keeps future real MetaMask selector work behind a stable API without silently approving unknown UI states.

## Network and state helpers

`switchNetwork()` delegates to Phase 4 Sepolia provisioning and returns the same verified state object. `assertWalletState()` delegates to Phase 4 chain/account assertions. Both emit sanitized structured events when a logger is supplied.

## Reset profile safety

`resetProfile({ profileDir, allowedProfileRoot })` recursively deletes only when the resolved profile directory is inside the resolved allowed wallet profile root. By default the allowed root is `.wallet-profiles`. Attempts to delete the root itself or anything outside the allowed root fail closed.

## Logging and redaction

Wallet-control logs are structured objects with action, status, prompt type, origin, account, and chain metadata. Before events reach the caller-provided logger, obvious secret material is redacted:

- 32-byte private-key-looking hex strings become `[redacted:private-key]`;
- HTTP(S) URLs are reduced through the shared RPC URL sanitizer;
- sensitive object keys such as password, seed phrase, token, and secret become `[redacted]`.

Do not attach raw `.env` contents, private keys, wallet passwords, seed phrases, browser profile dumps, traces, or screenshots to logger metadata.

## Acceptance for this slice

- Wallet-control helpers are exported from `@agent-browser-wallet/wallet-browser`.
- Connect sequencing is testable with mock dapp/prompt/network drivers.
- Signature and transaction approvals fail closed until an explicit prompt driver method is provided.
- Network switching and state assertions reuse the Phase 4 network driver and expected chain/account validation.
- Profile reset refuses paths outside the configured wallet profile root.
- Structured helper logs redact fake private keys and RPC-token URLs in tests.
