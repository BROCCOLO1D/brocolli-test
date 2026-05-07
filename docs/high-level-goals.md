# High-level goals

This project explores how to make LLM-agent browser environments usable for dapp testing by installing and controlling a real wallet extension profile, starting with MetaMask on Chromium.

## 1. Define the target runtime matrix

Start with the smallest useful surface:

- Playwright first.
- Chromium only at first.
- MetaMask as the first wallet extension.
- Local fixture dapp first.
- Sepolia next.
- `wildcat-app-v2` Sepolia as the first real target app.

Success means the repo clearly states what is supported, what is intentionally out of scope, and what versions are pinned. The detailed Phase 1 contract lives in [Phase 1 runtime matrix](phase-1-runtime-matrix.md).

## 2. Build a MetaMask profile bootstrapper

Create tooling that can launch Chromium with MetaMask installed in an isolated browser profile.

The bootstrapper should:

- download or reference a pinned MetaMask extension build;
- create a per-run or named browser profile directory;
- launch Chromium with the extension loaded;
- keep extension/profile artifacts out of Git;
- expose a repeatable command for agents and tests to use.

## 3. Automate MetaMask onboarding

Automate the first-run MetaMask setup flow for a burner wallet.

The onboarding flow should:

- import the configured burner account;
- set the wallet password;
- verify the active address matches the expected account;
- avoid printing private keys or seed material;
- fail if onboarding screens/selectors drift.

## 4. Add Sepolia network provisioning

Make the wallet reliably usable on Sepolia.

The harness should:

- ensure Sepolia is available in MetaMask;
- optionally configure a custom Sepolia RPC URL from `.env`;
- switch to Sepolia before dapp tests;
- assert the expected chain ID and wallet address before every wallet action.

## 5. Create a tiny fixture dapp

Build a minimal dapp used only to validate the wallet automation layer before testing real apps.

The fixture should support:

- connect wallet;
- display account and chain;
- request message signature;
- submit a simple local or Sepolia transaction;
- expose stable selectors for Playwright.

## 6. Create reusable wallet-control helpers

Hide MetaMask popup and extension-page quirks behind a small helper API.

Initial helpers should include:

- `launchWalletBrowser()`;
- `connectWallet()`;
- `approveSignature()`;
- `approveTransaction()`;
- `switchNetwork()`;
- `assertWalletState()`;
- `resetProfile()`.

These helpers should become the core interface an LLM agent or test suite uses instead of directly scripting every MetaMask popup.

## 7. Add audit and safety guardrails

Every wallet action should be observable and bounded.

The harness should:

- log wallet prompt type, chain, account, dapp origin, target contract, value, and decision;
- fail if the active chain is not local or Sepolia;
- fail if the active address is not the configured burner wallet;
- enforce value caps for Sepolia transactions;
- never log private keys, seed phrases, or full `.env` contents.

## 8. Run against a real Sepolia dapp

After the fixture dapp works, validate the same harness against a real deployed dapp.

The progression should be:

1. run against a simple known Sepolia dapp;
2. document flaky wallet states and selector issues;
3. run against `wildcat-app-v2` Sepolia;
4. capture the exact connect/sign/transaction flows that need helper support.

## 9. Package as an agent-friendly harness

Make the tool easy for an LLM agent, CI job, or human developer to invoke.

Target shape:

```bash
agent-wallet-browser run --profile sepolia-burner -- playwright test
```

The command should prepare the wallet browser, run the requested test command, collect logs/artifacts, and clean up sensitive state according to profile settings.

## 10. Generalize beyond MetaMask

Once MetaMask works, introduce a wallet adapter boundary.

The first adapter is MetaMask. Later adapters could support Rabby or other EIP-1193 wallets. The goal is to keep dapp tests using the same high-level helper API even if the underlying wallet extension changes.
