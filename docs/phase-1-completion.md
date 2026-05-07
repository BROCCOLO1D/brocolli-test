# Phase 1 completion status

Phase 1 is documentation/repo-structure only. Its job is to make the first implementation task obvious without adding wallet automation code yet.

## Deliverable map

| Required deliverable | Status | Evidence |
| --- | --- | --- |
| README communicates repo purpose, Phase 1 scope, and near-term MVP | Complete | [README](../README.md) states the agent-browser wallet problem, MetaMask/Chromium path, Phase 1 scope, MVP sequence, and safety posture. |
| High-level goals stay focused and keep 10 milestones intact | Complete | [High-level goals](high-level-goals.md) keeps the 10 milestones and links Phase 1 to the runtime matrix. |
| Focused Phase 1 runtime matrix exists | Complete | [Phase 1 runtime matrix](phase-1-runtime-matrix.md) defines supported MVP runtime, deferred surfaces, versioning, env placeholders, layout, acceptance criteria, risks, and Phase 2 handoff. |
| Non-secret env example exists | Complete | [`.env.example`](../.env.example) contains placeholder Sepolia burner/runtime variables only. |
| Phase 2 handoff is concise and implementation-ready | Complete | [Phase 2 handoff checklist](phase-2-handoff.md) defines first implementation slices and the initial fixture-based E2E target. |
| Security/artifact handling is explicit | Complete | [Security and artifact handling](security-and-artifacts.md) defines Git/logging policies, CI expectations, and profile/artifact guardrails. |

## Phase 1 exit criteria

Phase 1 can be treated as complete when these checks pass:

- [x] README links to the Phase 1 contract, safety contract, Phase 2 handoff, and high-level goals.
- [x] Runtime matrix chooses Playwright Test, Chromium, MetaMask, Sepolia burner profile, fixture dapp first, and `wildcat-app-v2` later.
- [x] Deferred runtimes and wallets are explicitly listed so the repo does not drift back into broad pathway comparison.
- [x] Pinning strategy states how Node, pnpm, Playwright, Chromium, MetaMask, OS, and CI assumptions will be recorded in Phase 2.
- [x] `.env.example` uses placeholders only and `.gitignore` keeps `.env`, profiles, extension artifacts, traces, reports, and test outputs untracked.
- [x] Phase 2 has a first narrow acceptance target before any real Sepolia dapp coverage.

## Recommended first Phase 2 task

Start with the smallest code-bearing slice: add the pnpm TypeScript workspace and exact version pins, without implementing wallet automation yet.

Expected outputs:

- root `package.json` with `packageManager`, `engines.node`, and deterministic scripts;
- `pnpm-lock.yaml` as the only package-manager lockfile;
- `.nvmrc` if useful for the chosen Node LTS version;
- no wallet secrets, profiles, extension bundles, traces, or generated reports tracked by Git.

Do not start with MetaMask selectors or `wildcat-app-v2`; those depend on the workspace and fixture flow existing first.
