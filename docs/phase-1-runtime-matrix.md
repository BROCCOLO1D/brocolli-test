# Phase 1 runtime matrix

Phase 1 turns the product direction into an implementation contract for the first wallet-backed browser runtime. It does not implement wallet automation yet; it defines the supported surface, versioning policy, repo layout, and handoff criteria for Phase 2.

## MVP supported runtime matrix

| Dimension | MVP target | Notes |
| --- | --- | --- |
| Automation runner | Playwright Test for Node.js | Use Playwright APIs directly; no Selenium/Puppeteer abstraction in Phase 1/2. |
| Browser | Chromium launched via persistent context | Extension support requires persistent user data dirs, not ordinary ephemeral contexts. |
| Wallet extension | MetaMask browser extension | Pin a reviewed release and automate only that UI/version until deliberately upgraded. |
| Wallet account | Supplied burner wallet on Sepolia | Imported from local secrets; never generated or committed by docs/examples. |
| Network | Sepolia plus local fixture chain when useful | Sepolia is the first public testnet; local chain is allowed for fixture speed/isolation. |
| First dapp | `apps/fixture-dapp` | Minimal connect/sign/send surface with stable `data-testid` selectors. |
| Later dapp | `wildcat-app-v2` on Sepolia | Only after fixture dapp proves the helper surface. |
| Runtime mode | Local Linux/WSL2 and Linux CI, headful or headed-under-Xvfb | Treat true extension headless as experimental until proven with pinned Chromium/Playwright. |

## Explicitly deferred

- Firefox, WebKit, Chrome Stable, Brave, Edge, and remote browsers.
- Puppeteer, Selenium, Browserbase, CDP-only agent environments, and mobile wallet flows.
- Wallets other than MetaMask, including Rabby, Coinbase Wallet, Phantom, WalletConnect-only flows, and hardware wallets.
- Mainnet or production-wallet automation.
- Multi-account rotation, cross-chain portfolios, real asset custody, or autonomous high-value signing.
- Broad pathway comparison/research docs; this repo stays focused on extension-profile automation.

## Pinning and versioning strategy

Phase 2 should add exact pins in package/config files; until then these are the Phase 1 rules:

- **Node.js:** standardize on the active LTS line and document the exact version in `.nvmrc` or `package.json#engines` when the package is introduced.
- **Package manager:** use one package manager only, preferably `pnpm` with `packageManager` pinned in `package.json`; do not mix lockfiles.
- **Playwright:** pin an exact package version in the lockfile. Browser revisions must come from that Playwright release unless a separate Chromium path is explicitly configured.
- **Chromium:** use Playwright-managed Chromium for repeatability. If extension support forces a system browser, document the exact channel/path and CI image.
- **MetaMask:** download or vendor-reference a specific extension release artifact by version and checksum. Store the unpacked extension under an ignored artifact directory, not Git.
- **OS/CI:** target Linux CI first, with WSL2 as a supported local developer environment. CI must provide a display server such as Xvfb if the chosen Chromium/MetaMask combination cannot run extension flows headlessly.
- **Upgrade policy:** bump Playwright/Chromium/MetaMask one axis at a time, rerun fixture connect/sign/send acceptance tests, and update selector notes when UI drift occurs.

## Environment variables

Create local `.env` files from `.env.example`. Values below are placeholders only and must never be committed with real secrets.

| Variable | Required later | Purpose |
| --- | --- | --- |
| `SEPOLIA_WALLET_ADDRESS` | Yes | Expected burner address used for account assertions. |
| `SEPOLIA_WALLET_PRIVATE_KEY` | Yes | Burner private key imported into MetaMask during profile setup. |
| `SEPOLIA_RPC_URL` | Optional | Custom Sepolia RPC endpoint if public defaults are too slow/flaky. |
| `METAMASK_PASSWORD` | Yes | Local password for the isolated MetaMask profile. |
| `WALLET_PROFILE_DIR` | Optional | Override for ignored browser profile storage. |
| `METAMASK_EXTENSION_DIR` | Optional | Override for ignored unpacked extension storage. |

Safety requirements:

- `.env` and `.env.*` remain ignored; `.env.example` is the only committed env file.
- Do not print private keys, seed phrases, wallet passwords, full env dumps, profile contents, traces, or screenshots that expose secrets.
- Treat browser profile directories as sensitive artifacts because MetaMask can persist encrypted key material and session state.

## Expected future directory layout

```text
.
├── apps/
│   └── fixture-dapp/          # Minimal dapp for connect/sign/send validation
├── packages/
│   ├── wallet-browser/        # Launch/profile/bootstrap APIs
│   └── metamask-automation/   # MetaMask-specific page/popup helpers
├── tests/
│   ├── fixture-dapp/          # Playwright tests proving the MVP flows
│   └── metamask/              # Wallet onboarding/network/helper tests
├── scripts/
│   ├── fetch-metamask.*       # Download/checksum pinned extension artifact
│   └── prepare-profile.*      # Create/reset ignored browser profiles
├── docs/
│   ├── high-level-goals.md
│   └── phase-1-runtime-matrix.md
├── .wallet-extensions/        # Ignored unpacked extension artifacts
├── .wallet-profiles/          # Ignored persistent browser profiles
├── test-results/              # Ignored Playwright outputs
└── playwright-report/         # Ignored Playwright HTML report
```

The package names are placeholders for layout planning, not an API commitment. Phase 2 can rename them if the first implementation finds a clearer boundary.

## Acceptance criteria for completing Phase 1

- README states the repository purpose, safety posture, Phase 1 scope, and near-term MVP path.
- High-level goals remain a concise 10-milestone roadmap centered on MetaMask extension automation.
- This runtime matrix documents supported MVP runtime, deferred surfaces, versioning/pinning policy, env placeholders, future layout, risks, and Phase 2 handoff.
- `.env.example` exists with only placeholder values and `.gitignore` still protects real env files.
- Markdown links validate and whitespace checks pass.

## Risks and decisions

- **Chrome extension automation:** MetaMask runs in extension pages/popups outside the dapp tab, so helpers must discover extension targets and avoid hard-coding only main-page selectors.
- **Manifest V3:** MetaMask extension internals can change as MV3 behavior evolves. The MVP should treat MetaMask as a black-box UI/API surface and pin exact versions.
- **Headful/headless:** Chrome extension flows are more reliable in headed or Xvfb-backed runs. Do not promise true headless support until fixture tests prove it.
- **Persistent profiles:** Extensions require persistent contexts, but profiles can contain sensitive state. Default to per-run throwaway profiles with explicit opt-in named profiles for debugging.
- **CI:** CI needs a display server, sandbox-compatible Chromium launch flags, artifact scrubbing, and secret injection only through the CI secret store.
- **Selector drift:** MetaMask UI changes are expected. Keep selectors isolated in the MetaMask helper package and fail loudly when onboarding or prompt screens no longer match.
- **Safety:** All signing/transaction helpers must assert account, chain, dapp origin, target, and value before approving anything.

## Phase 2 handoff checklist

- [ ] Add Node/package-manager pins and initial workspace files.
- [ ] Add ignored artifact/profile directories to `.gitignore`.
- [ ] Implement a script that fetches a pinned MetaMask release and verifies its checksum.
- [ ] Implement `launchWalletBrowser()` around Playwright persistent Chromium contexts.
- [ ] Build the fixture dapp with connect, account/chain display, signature, and simple transaction flows.
- [ ] Add first Playwright acceptance tests for browser launch and fixture dapp connection.
