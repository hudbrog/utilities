# English Learning SRS

Offline-first vocabulary trainer for a Russian-speaking child learning English. The project is deployed as a GitHub Pages PWA at:

<https://hudbrog.github.io/utilities/>

## Current state

The default route runs the child-facing study loop, while `#parent` provides the parent controls and `#diagnostics` retains the Stage 0 device checks. The diagnostic route validates:

- installed home-screen launch;
- complete offline app-shell caching;
- Russian and English speech synthesis;
- Russian and English one-shot speech recognition with up to five alternatives;
- feature-detected on-device speech language-pack APIs;
- IndexedDB persistence across relaunch, reboot, and static releases;
- a locally saved physical-device gate checklist and downloadable JSON report.

The domain layer includes the validated curriculum contract, exact answer normalization, deterministic distractors and exercise policy, an automatic FSRS-6 scheduler, local-calendar due-date arithmetic, STT-problem evidence tracking, deterministic session generation, backlog suppression, and in-session remediation insertion. FSRS runs independently per translation direction at 90% desired retention; its behavior and lazy migration are documented in [`docs/scheduling.md`](docs/scheduling.md). These modules are deliberately independent of React, Dexie, browser APIs, and the wall clock.

The Phase 2 storage foundation under `src/infrastructure/db` provides the versioned learner database, curriculum reconciliation, resumable materialized queues, atomic and idempotent answer commits, introduction-ledger accounting, and validated backup/restore. Stage 0 diagnostic records remain in their separate database.

The study loop includes persisted resume/reveal state, deterministic answer options, automatic correct-answer TTS and advancement, wrong-answer replay and remediation, progress, a simple chunk summary, and the mature three-attempt STT flow with non-penalizing multiple-choice fallback. Session ordering separates opposite directions of the same concept whenever possible, and a transition guard prevents rapid repeat taps from answering the next question.

The parent route (`#parent`) provides today's workload, learner settings, difficult-word inspection, directional progress and attempt history, answer overrides, STT-problem reset, explicit PWA update checks, and validated backup/restore. Parent settings show the running build version and can force a service-worker update check; a discovered build is installed only after the parent confirms the reload. It also exposes the production curriculum one unit at a time for review: translations can be accepted, edited, excluded, exported, and approved before a unit is allowed into learner sessions. Multiple approved units can then be active together and supply new words in unit order. Review decisions and unit approvals survive app restarts and are included in backups.

The committed seed contains 1,372 LLM-reviewed proposals across 62 Duome-derived units. The resumable generation, independent review, incremental parent approval, validation, and assembly workflow is documented in [`docs/curriculum/README.md`](docs/curriculum/README.md). Unreviewed proposals are never question targets or correct answers, but non-excluded proposals may safely enlarge the multiple-choice distractor pool.

The previous math trainer is preserved at [`/utilities/legacy/math-trainer.html`](https://hudbrog.github.io/utilities/legacy/math-trainer.html).

## Local development

Requirements: Node.js 24 and Corepack.

With NVM installed (Linux, macOS, or WSL), select the project's Node version first:

```bash
nvm install
nvm use
```

```bash
corepack enable
pnpm install --frozen-lockfile
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
