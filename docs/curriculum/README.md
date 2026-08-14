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

Both commands checkpoint after every batch and skip completed concept IDs when rerun. Use `--limit 100` for a trial. The default model is `openai/gpt-5.6-luna`; override it with `--model`, `OPENROUTER_GENERATION_MODEL`, or `OPENROUTER_REVIEW_MODEL`. For a genuinely independent audit, set a different OpenRouter model for the review pass.

The adapter defaults to `https://openrouter.ai/api/v1` and requires providers to support the structured-output parameters used by the pipeline. Optional configuration:

```bash
export OPENROUTER_BASE_URL='https://openrouter.ai/api/v1'
export OPENROUTER_HTTP_REFERER='https://github.com/hudbrog/utilities'
export OPENROUTER_APP_TITLE='English Learning SRS Curriculum Pipeline'
```

## 3. Human approval and validation

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

Review every `needs_human_review` record and answer-collision warning. Correct the values and set `reviewStatus` to `approved`. Run validation with `--require-approved` for the final gate. Add `--require-human` to `prepare-approval` if every record must receive explicit human approval.

## 4. Assemble the application bundle

```bash
pnpm curriculum:assemble -- \
  --worklist .curriculum/source.worklist.jsonl \
  --manifest .curriculum/source.manifest.json \
  --approved .curriculum/translations.approved.json \
  --output .curriculum/curriculum.json
```

Assembly rejects missing, stale, or non-approved records. To adopt the hybrid policy and accept only the narrowly defined high-confidence `auto_reviewed` records as well, add `--allow-auto-reviewed`. The `.curriculum` directory is intentionally ignored; decide separately when the reviewed production bundle should be committed and wired into the app.
