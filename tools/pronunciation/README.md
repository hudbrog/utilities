# Generating English recordings

Run from the repository root with Python 3.12 and FFmpeg (with libmp3lame).
The CPU build is sufficient. The model and voice weights stay on the build machine.

```sh
python3 -m venv .curriculum/kokoro-env
. .curriculum/kokoro-env/bin/activate
pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
pip install 'kokoro-onnx==0.4.9' 'misaki[en]==0.9.4' 'transformers<5' 'spacy>=3.8,<3.9'
pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
assets=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
curl -fL "$assets/kokoro-v1.0.onnx" -o .curriculum/kokoro.onnx
curl -fL "$assets/voices-v1.0.bin" -o .curriculum/voices.bin
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 python tools/pronunciation/generate.py \
  --model .curriculum/kokoro.onnx --voices .curriculum/voices.bin
pnpm build && pnpm build:verify
```

The generator reads canonical English from both shipped curricula, deduplicates
case and surrounding whitespace, and renders each missing word with the US
Misaki pronunciation dictionary. Set an entry in `PHONES` for a sense-specific
pronunciation (e.g. *live* meaning «жить»), or in `SPOKEN` for an expansion.
Listen to the changed recordings before shipping.

Each pack contains independent 24 kHz mono MP3 clips. Its index stores the pack
number, byte offset and length for each word. Existing packs supply unchanged clips
on the next run. The stable buckets keep unrelated packs intact across updates.
Commit `public/audio/en/` and `src/generated/englishAudio.json` together.
