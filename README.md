# agent-browser-wallet

Private build project for making LLM-agent browser environments dapp-capable by provisioning a real browser wallet extension profile.

## Purpose

LLM agents often drive synthetic or isolated browser clients that do not include the user extensions a real crypto user depends on. That makes dapp testing awkward: the agent can click the web app, but it cannot naturally connect MetaMask, approve wallet prompts, sign messages, switch chains, or submit testnet transactions.

This repo is focused on one concrete path: **Playwright/Chromium + pinned MetaMask extension + isolated burner Sepolia profile + reusable wallet automation helpers**.

## Phase 1 scope

Phase 1 defines the implementation contract before code is added:

- supported MVP runtime matrix;
- explicitly deferred runtimes and wallets;
- pinning/versioning strategy for Playwright, Chromium, MetaMask, Node, package manager, and CI assumptions;
- non-secret environment variable placeholders;
- expected future repo layout;
- acceptance criteria, risks, and Phase 2 handoff checklist.

See [Phase 1 runtime matrix](docs/phase-1-runtime-matrix.md) and [high-level goals](docs/high-level-goals.md).

## Near-term MVP

1. Launch Playwright-managed Chromium with a pinned MetaMask extension in a persistent, isolated profile.
2. Import a supplied burner Sepolia wallet from local secrets.
3. Assert the active address and chain before any wallet action.
4. Validate connect/sign/send flows against a tiny fixture dapp.
5. Reuse the same helper surface against `wildcat-app-v2` on Sepolia after the fixture flow is reliable.

## Safety posture

- Use only burner/local/testnet wallets.
- Keep wallet material in local `.env` files that are ignored by Git; start from [.env.example](.env.example).
- Never commit private keys, seed phrases, RPC tokens, wallet passwords, extension profile directories, traces, screenshots, or test artifacts containing secrets.
- Fail closed on unexpected chain, account, value, contract, dapp origin, or wallet prompt state.
- Treat the MetaMask profile as sensitive even when it only contains testnet funds.
