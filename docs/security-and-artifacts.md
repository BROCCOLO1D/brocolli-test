# Security and artifact handling

Agent Browser Wallet drives real wallet software. Even on testnets, browser profiles and artifacts can contain private key material, sessions, RPC credentials, prompt text, local paths, and screenshots. Treat every wallet-enabled run as sensitive by default.

## Data classification

| Data | Examples | Git policy | Logging/artifact policy |
| --- | --- | --- | --- |
| Public config | package versions, fixture source, target/policy examples with placeholder values | May be committed | May be logged |
| Placeholder config | `.env.example`, fake addresses, fake targets | May be committed | May be logged |
| Local secrets | `.env`, private keys, seed phrases, wallet password, RPC tokens | Never commit | Never log |
| Sensitive runtime state | `.wallet-profiles/`, MetaMask local storage, extension state | Never commit | Do not upload unless explicitly scrubbed |
| Downloaded wallet artifacts | `.wallet-extensions/` unpacked MetaMask files | Never commit | Log version/checksum only |
| QA artifacts | `.wallet-artifacts/`, screenshots, traces, videos, prompt text, reports | Never commit by default | Scrub and verify before sharing |

## Required guardrails

- Use burner/testnet wallets only.
- Load secrets from ignored local `.env` files or CI secret stores only.
- Validate account, chain ID, dapp origin, prompt type, target contract, typed-data domain, and transaction value before approving wallet prompts.
- Default to connect-only behavior; signatures and transactions require explicit policy.
- Reject unknown prompts.
- Default transaction value cap is zero wei.
- Redact private-key-like values, seed phrases, wallet passwords, RPC URLs/tokens, full `.env` contents, full wallet addresses, and sensitive local paths from public output.
- Keep Playwright traces, screenshots, videos, reports, wallet profiles, extension bundles, and local proof manifests ignored by Git.

## Artifact rules

A proof artifact is acceptable only when:

- it has a manifest with target, scenario, status, masked account, chain ID, origin, screenshot basenames, screenshot hashes, and prompt decisions;
- screenshots are captured after guardrails pass, or are clearly marked as redacted failure diagnostics;
- verifiers reject wrong chains, wrong origins, missing screenshots, hash mismatches, unsafe screenshot names, full addresses, and local path leaks;
- logs state whether any signing or transaction prompt was approved.

## CI expectations

- Inject secrets through CI secret storage only.
- Use burner/testnet accounts with limited funds.
- Run browser-wallet flows under Xvfb or another explicit display server.
- Disable trace/video retention by default for secret-backed runs.
- Upload only scrubbed artifacts, preferably after verifier success.
- Fail if `.env`, profiles, extension directories, traces, reports, or local proof artifacts become tracked.
