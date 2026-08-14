# English Learning SRS

Offline-first vocabulary trainer for a Russian-speaking child learning English. The project is deployed as a GitHub Pages PWA at:

<https://hudbrog.github.io/utilities/>

## Current state

The deployed UI is still the Stage 0 diagnostic PWA. It validates the risks that must pass on the intended iPhone/iPad before the complete learner UI is built:

- installed home-screen launch;
- complete offline app-shell caching;
- Russian and English speech synthesis;
- Russian and English one-shot speech recognition with up to five alternatives;
- feature-detected on-device speech language-pack APIs;
- IndexedDB persistence across relaunch, reboot, and static releases;
- a locally saved physical-device gate checklist and downloadable JSON report.

Phase 1 domain implementation is underway under `src/domain`. It currently includes the validated curriculum contract, exact answer normalization, deterministic distractors and exercise policy, the 0–7 SRS scheduler, local-calendar due-date arithmetic, STT-problem evidence tracking, deterministic session generation, backlog suppression, and in-session remediation insertion. These modules are deliberately independent of React, Dexie, browser APIs, and the wall clock.

The Phase 2 storage foundation under `src/infrastructure/db` provides the versioned learner database, curriculum reconciliation, resumable materialized queues, atomic and idempotent answer commits, introduction-ledger accounting, and validated backup/restore. Stage 0 diagnostic records remain in their separate database.

The default route now runs the first child-facing multiple-choice study loop, including persisted resume/reveal state, deterministic answer options, automatic correct-answer TTS, replay, remediation, progress, and a simple chunk summary. It currently uses the clearly identified eight-word fixture in `src/generated/fixtureCurriculum.ts`; `#diagnostics` retains the Stage 0 device checks.

The parent route (`#parent`) provides today's workload, explicit unit start/pause controls, learner settings, difficult-word inspection, directional progress and attempt history, answer overrides, STT-problem reset, and validated backup/restore. Mature study questions support the three-attempt STT flow, non-penalizing MC fallback, and directional listening unlock.

The recovered Duome archive supplies stable English lexemes and course order, but not Russian translations. A production curriculum bundle therefore remains blocked on a curated translation input; the app does not invent translations or synonyms.

The previous math trainer is preserved at [`/utilities/legacy/math-trainer.html`](https://hudbrog.github.io/utilities/legacy/math-trainer.html).

## Local development

Requirements: Node.js 24 and Corepack.

```bash
corepack enable
pnpm install
pnpm dev
```

Production checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:verify
```

Vite is intentionally configured with `base: "/utilities/"`. Do not replace this with `/`: GitHub Pages serves this repository as a project site.

## Duome archive inspection

The archive contains two JSON files. After extracting them, reproduce the Stage 0 report with:

```bash
pnpm curriculum:inspect -- \
  --course /path/to/enfromru141.json \
  --words /path/to/enfromru141-words.json \
  --output docs/stage-0/import-shape-report.md
```

See [`docs/stage-0/import-shape-report.md`](docs/stage-0/import-shape-report.md) for the findings. The source archive is not committed.

## Deployment

Pushes to `main` run the pinned GitHub Pages workflow. It installs from the lockfile, type-checks, tests, builds, verifies the `/utilities/` URLs, and deploys only `dist/`.
