# English Learning SRS

Offline-first vocabulary trainer for a Russian-speaking child learning English. The project is deployed as a GitHub Pages PWA at:

<https://hudbrog.github.io/utilities/>

## Current state: Stage 0

The current build is a diagnostic PWA, not the learner application yet. It validates the risks that must pass on the intended iPhone/iPad before the complete UI is built:

- installed home-screen launch;
- complete offline app-shell caching;
- Russian and English speech synthesis;
- Russian and English one-shot speech recognition with up to five alternatives;
- feature-detected on-device speech language-pack APIs;
- IndexedDB persistence across relaunch, reboot, and static releases;
- a locally saved physical-device gate checklist and downloadable JSON report.

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
