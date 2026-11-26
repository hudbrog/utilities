import index from "../../generated/englishAudio.json";

const clips: Readonly<Record<string, readonly number[]>> = index.clips;
export const englishPacks = index.packs.map((name) => import.meta.env.BASE_URL + "audio/en/" + name);

export function findEnglishClip(text: string) {
  const key = text.trim().toLowerCase();
  if (!Object.hasOwn(clips, key)) return null;
  const [pack, start, length] = clips[key];
  return { url: englishPacks[pack], start, length };
}

let context: AudioContext | undefined;
let unlocking: Promise<void> | undefined;
let lastPack: { url: string; bytes: Promise<ArrayBuffer> } | undefined;

function audioContext() {
  if (!context || context.state === "closed") context = new AudioContext();
  return context;
}

// Resume inside the tap itself. Scoring and IndexedDB finish after Safari's user gesture.
export function unlockEnglishAudio() {
  if (typeof AudioContext === "undefined") return;
  const ctx = audioContext();
  if (ctx.state !== "running") {
    unlocking = ctx.resume().catch(() => {});
  }
}

function loadPack(url: string) {
  if (lastPack?.url !== url) {
    const bytes = fetch(url).then((response) => {
      if (!response.ok) throw new Error("english-audio-pack-unavailable");
      return response.arrayBuffer();
    }).catch((error: unknown) => {
      if (lastPack?.bytes === bytes) lastPack = undefined;
      throw error;
    });
    lastPack = { url, bytes };
  }
  return lastPack.bytes;
}

export async function playEnglishClip(clip: NonNullable<ReturnType<typeof findEnglishClip>>,
  signal: AbortSignal, onStarted: () => void) {
  const ctx = audioContext();
  if (ctx.state !== "running") await unlocking;
  signal.throwIfAborted();
  if (ctx.state !== "running") throw new Error("english-audio-needs-tap");

  const pack = await loadPack(clip.url);
  signal.throwIfAborted();
  if (clip.start + clip.length > pack.byteLength) throw new Error("english-audio-pack-truncated");
  const buffer = await ctx.decodeAudioData(pack.slice(clip.start, clip.start + clip.length));
  signal.throwIfAborted();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => { source.stop(); };
      source.onended = () => {
        signal.removeEventListener("abort", stop);
        resolve();
      };
      signal.addEventListener("abort", stop, { once: true });
      try {
        source.start();
        onStarted();
      } catch (error) {
        signal.removeEventListener("abort", stop);
        reject(error);
      }
    });
  } finally {
    source.disconnect();
  }
}
