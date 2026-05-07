# Security and artifact handling

The MVP uses burner Sepolia wallets only, but its local browser profile can still contain private key material, session state, RPC credentials, traces, and screenshots. Treat every wallet-enabled run as sensitive by default.

## Data classification

| Data | Examples | Git policy | Logging/artifact policy |
| --- | --- | --- | --- |
| Public config | package versions, fixture dapp source, non-secret docs | May be committed | May be logged |
| Placeholder config | `.env.example` names and fake values | May be committed | May be logged |
| Local secrets | `.env`, private keys, seed phrases, wallet password, RPC tokens | Never commit | Never log |
| Sensitive runtime state | `.wallet-profiles/`, MetaMask local storage, extension state | Never commit | Do not upload unless explicitly scrubbed |
| Test artifacts | Playwright traces, videos, screenshots, reports | Never commit | Scrub before sharing; assume screenshots can reveal account/session state |
| Downloaded extension artifacts | `.wallet-extensions/` unpacked MetaMask files | Never commit | Log version/checksum/path only |

## Required guardrails for implementation

- Load secrets from ignored local `.env` files or CI secret stores only.
- Validate `SEPOLIA_WALLET_ADDRESS` against the imported MetaMask account before approving dapp prompts.
- Validate chain ID, dapp origin, target contract, and transaction value before approving signatures or transactions.
- Redact private-key-like values, seed phrases, wallet passwords, and RPC tokens from errors and structured logs.
- Default to throwaway profile directories for automated tests; require an explicit flag for preserving a named profile.
- Delete throwaway profiles after successful runs; on failure, preserve only when the caller opts in for debugging.
- Keep Playwright traces, screenshots, videos, reports, wallet profiles, and extension bundles ignored by Git.

## CI expectations

- Inject secrets through the CI secret store, never checked-in config.
- Run only against burner Sepolia accounts with limited funds.
- Disable trace/video retention by default for secret-backed wallet runs, or upload only scrubbed artifacts with restricted access.
- Fail the job if `.env`, profile directories, extension directories, traces, or reports become tracked files.
- Print only MetaMask version, checksum, account address, chain ID, dapp origin, and high-level approval decisions.
