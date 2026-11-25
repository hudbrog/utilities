"""Render English curriculum audio with Kokoro. Run from any directory."""
import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / 'src/generated/englishAudio.json'
PACKS = ROOT / 'public/audio/en'
VOICE = 'af_heart'
# Change this ID when changing the model, voice, speed, processing or encoder.
RECIPE = 'kokoro-v1.0-fp32-af_heart-misaki-0.9.4-en-us-1x-mp3-48k-v1'
MODEL_SHA = '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5'
VOICES_SHA = 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d'
# Pronunciations follow the sense used in the packaged curricula.
PHONES = {
    'read': 'ɹˈid', 'reads': 'ɹˈidz', 'live': 'lˈɪv', 'lives': 'lˈɪvz',
    'wind': 'wˈɪnd', 'present': 'pɹˈɛzᵊnt', 'does': 'dˈʌz', 'us': 'ˈʌs',
    'i': 'ˈI', 'a': 'ˈA', 'the': 'ðˈi', 'the us': 'ðə jˌu ˈɛs',
    'a.m.': 'ˌA ˈɛm', 'p.m.': 'pˌi ˈɛm', 'ms.': 'mˈɪz',
    'mr.': 'mˈɪstəɹ', 'mrs.': 'mˈɪsᵻz', 'dr.': 'dˈɑktəɹ',
}
SPOKEN = {'st. petersburg': 'Saint Petersburg', 'ok': 'okay', "'s": 'apostrophe s'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def init_engine(model, voices):
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    global engine, style
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model), options, providers=['CPUExecutionProvider'])
    engine = Kokoro.from_session(session, str(voices))
    style = engine.get_voice_style(VOICE)


def render(item):
    import numpy as np
    word, phones = item
    if not phones or any(c not in engine.tokenizer.vocab for c in phones):
        raise ValueError(f'Invalid pronunciation for {word!r}: {phones!r}')
    samples, rate = engine.create(phones, style, is_phonemes=True, speed=1.0)
    if len(samples) < rate * 0.10 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.01:
        raise ValueError(f'Invalid waveform for {word!r}')
    audio = subprocess.run([
        'ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0',
        '-c:a', 'libmp3lame', '-b:a', '48k', '-id3v2_version', '0', '-write_xing', '0',
        '-f', 'mp3', 'pipe:1',
    ], input=samples.astype('<f4').tobytes(), stdout=subprocess.PIPE, check=True)
    return word, audio.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--voices', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    duo = json.loads((ROOT / 'public/curriculum-review.json').read_text())['proposals']
    workbook = json.loads((ROOT / 'public/academy-stars-1.json').read_text())['concepts']
    words = sorted({entry['en'].strip().lower() for entry in duo + workbook})
    old = json.loads(INDEX.read_text()) if INDEX.exists() else {}
    overrides = PHONES | SPOKEN
    clips = {}
    if old.get('recipe') == RECIPE:
        packs = []
        for name in old['packs']:
            data = (PACKS / name).read_bytes()
            if not name.endswith(f'-{sha(data)[:16]}.pack'):
                raise ValueError(f'Corrupt pronunciation pack: {name}')
            packs.append(data)
        for word in words:
            if word in old['clips'] and overrides.get(word) == old['overrides'].get(word):
                pack, start, size = old['clips'][word]
                clip = packs[pack][start:start + size]
                if len(clip) != size or not size:
                    raise ValueError(f'Truncated clip: {word}')
                clips[word] = clip
    missing = [word for word in words if word not in clips]
    if missing:
        for path, expected in [(args.model, MODEL_SHA), (args.voices, VOICES_SHA)]:
            with path.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                    raise ValueError(f'Unexpected model asset: {path}')
        from misaki import en, espeak
        g2p = en.G2P(british=False, fallback=espeak.EspeakFallback(british=False))
        pronunciations = [(word, PHONES.get(word) or g2p(SPOKEN.get(word, word))[0]) for word in missing]
        with ProcessPoolExecutor(args.workers, initializer=init_engine, initargs=(args.model, args.voices)) as pool:
            for i, (word, data) in enumerate(pool.map(render, pronunciations, chunksize=4), 1):
                clips[word] = data
                if i % 100 == 0:
                    print(f'Rendered {i}/{len(missing)}', flush=True)

    # Stable hash buckets limit download churn when a unit or pronunciation changes.
    buckets = [bytearray() for _ in range(16)]
    entries = {}
    for word in words:
        bucket = int(sha(word.encode())[0], 16)
        data = clips[word]
        entries[word] = [bucket, len(buckets[bucket]), len(data)]
        buckets[bucket].extend(data)
    PACKS.mkdir(parents=True, exist_ok=True)
    names = []
    for i, data in enumerate(buckets):
        name = f'{i:x}-{sha(data)[:16]}.pack'
        names.append(name)
        path = PACKS / name
        if not path.exists():
            path.write_bytes(data)
    index = dict(recipe=RECIPE, overrides=overrides, packs=names, clips=entries)
    with tempfile.NamedTemporaryFile(mode='w', dir=INDEX.parent, delete=False, encoding='utf-8') as temp:
        temp.write(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n')
    os.replace(temp.name, INDEX)
    for name in set(old.get('packs', [])) - set(names):
        (PACKS / name).unlink(missing_ok=True)
    print(f'{len(entries)} clips, {sum(map(len, buckets)):,} bytes; {len(missing)} rendered.')


if __name__ == '__main__':
    main()
