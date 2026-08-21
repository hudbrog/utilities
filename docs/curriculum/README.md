# Production curriculum pipeline

This toolchain converts the recovered course archive into a reviewed curriculum bundle. Intermediate files are JSON/JSONL and provider-independent; generation and review use OpenRouter through its OpenAI-compatible API.

## 1. Build the stable source worklist

```bash
mkdir -p .curriculum
pnpm curriculum:worklist -- \
  --course /path/to/enfromru141.json \
  --words /path/to/enfromru141-words.json \
  --output .curriculum/source.worklist.jsonl \
  --manifest .curriculum/source.manifest.json \
  --version 2026-08-14
```

Inspect `unresolved` in the manifest before continuing.

## 2. Generate and independently review translations

```bash
export OPENROUTER_API_KEY='...'

pnpm curriculum:generate -- \
  --worklist .curriculum/source.worklist.jsonl \
  --output .curriculum/translations.generated.jsonl \
  --batch-size 20

pnpm curriculum:review -- \
  --worklist .curriculum/source.worklist.jsonl \
  --candidates .curriculum/translations.generated.jsonl \
  --output .curriculum/translations.reviewed.jsonl \
  --batch-size 20
```

Both commands checkpoint after every successful batch. Rerunning the exact command validates the existing output, reports how many concept IDs are already complete, and sends only unprocessed records to the API. `--limit` applies to the remaining records rather than the whole worklist. Use `--limit 100` for a trial, or `--dry-run` to inspect resume counts without an API key or API requests.

The output file belongs to its worklist: the command refuses unknown IDs instead of silently mixing runs. Keep separate output paths when experimenting with another source worklist or translation policy.

The default model is `openai/gpt-5.6-luna`; override it with `--model`, `OPENROUTER_GENERATION_MODEL`, or `OPENROUTER_REVIEW_MODEL`. For a genuinely independent audit, set a different OpenRouter model for the review pass.

The adapter defaults to `https://openrouter.ai/api/v1` and requires providers to support the structured-output parameters used by the pipeline. Optional configuration:

```bash
export OPENROUTER_BASE_URL='https://openrouter.ai/api/v1'
export OPENROUTER_HTTP_REFERER='https://github.com/hudbrog/utilities'
export OPENROUTER_APP_TITLE='English Learning SRS Curriculum Pipeline'
```

## 3. Prepare the review seed

```bash
pnpm curriculum:prepare-approval -- \
  --worklist .curriculum/source.worklist.jsonl \
  --candidates .curriculum/translations.generated.jsonl \
  --reviews .curriculum/translations.reviewed.jsonl \
  --output .curriculum/translations.approved.json

pnpm curriculum:validate -- \
  --worklist .curriculum/source.worklist.jsonl \
  --approved .curriculum/translations.approved.json \
  --report .curriculum/validation.json
```

The repository keeps the first reviewed result at `curriculum/translations.approved.json`. Despite the historical filename, records may still be `auto_reviewed` or `needs_human_review`; this is the immutable proposal seed, not permission to use every word in study sessions.

Build the offline package consumed by the parent interface:

```bash
pnpm curriculum:review-package -- \
  --worklist .curriculum/source.worklist.jsonl \
  --manifest .curriculum/source.manifest.json \
  --approved curriculum/translations.approved.json \
  --output public/curriculum-review.json
```

The package includes a fingerprint for every proposal and unit. A changed proposal invalidates its saved word decision and its unit approval, while unrelated units stay approved. `--generated-at` can pin the metadata timestamp for reproducible builds.

## 4. Review incrementally in the app

Open `#parent`, choose **Курс**, and review one unit at a time. The parent can:

- accept all clean `auto_reviewed` proposals in the selected unit;
- accept, correct, exclude, or defer individual words;
- approve a unit only after every proposal is resolved;
- start or pause new words only after unit approval;
- export the accumulated decisions as `translations.approved.json`.

Only approved units are materialized into the learner database. Unresolved proposals are unavailable to sessions and distractor generation. Local decisions and unit approvals are included in the normal learner backup.

To fold exported decisions back into the repository, replace the seed deliberately, rebuild `public/curriculum-review.json`, run the checks below, and commit both files together.

For a strict one-off data check, review every `needs_human_review` record and answer-collision warning, set accepted records to `approved`, then run validation with `--require-approved`. Add `--require-human` to `prepare-approval` if every record must receive explicit human approval.

## 5. Assemble a fully approved application bundle

```bash
pnpm curriculum:assemble -- \
  --worklist .curriculum/source.worklist.jsonl \
  --manifest .curriculum/source.manifest.json \
  --approved .curriculum/translations.approved.json \
  --output .curriculum/curriculum.json
```

Assembly rejects missing, stale, or non-approved records. To adopt the hybrid policy and accept only the narrowly defined high-confidence `auto_reviewed` records as well, add `--allow-auto-reviewed`. This strict bundle remains useful for release validation; the app itself uses the incremental review package described above.
