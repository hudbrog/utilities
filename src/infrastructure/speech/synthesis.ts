import type { SpeechLocale } from "./recognition";
import { pickBestVoice } from "./voiceSelection";

const MIN_COMPLETION_TIMEOUT_MS = 2_500;
const MAX_COMPLETION_TIMEOUT_MS = 10_000;
let latestRequestId = 0;
let settleActiveSpeech: (() => void) | null = null;

export function speechCompletionTimeoutMs(text: string): number {
  return Math.min(MAX_COMPLETION_TIMEOUT_MS, Math.max(MIN_COMPLETION_TIMEOUT_MS, 1_500 + text.length * 120));
}

async function loadVoices() {
  const immediate = speechSynthesis.getVoices();
  if (immediate.length > 0) return immediate;

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const timeout = window.setTimeout(() => resolve(speechSynthesis.getVoices()), 800);
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        window.clearTimeout(timeout);
        resolve(speechSynthesis.getVoices());
      },
      { once: true },
    );
  });
}

export async function speak(text: string, locale: SpeechLocale) {
  if (!("speechSynthesis" in window)) throw new Error("speech-synthesis-not-supported");
  const requestId = ++latestRequestId;
  settleActiveSpeech?.();
  speechSynthesis.cancel();
  const voices = await loadVoices();
  if (requestId !== latestRequestId) return null;
  const voice = pickBestVoice(voices, locale);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.rate = 0.9;
  if (voice) utterance.voice = voice;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let settleAsSuperseded: (() => void) | null = null;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      utterance.onend = null;
      utterance.onerror = null;
      if (settleActiveSpeech === settleAsSuperseded) settleActiveSpeech = null;
      complete();
    };
    settleAsSuperseded = () => finish(resolve);
    settleActiveSpeech = settleAsSuperseded;
    const timeout = window.setTimeout(() => {
      finish(() => {
        if (requestId === latestRequestId) speechSynthesis.cancel();
        reject(new Error("speech-synthesis-timeout"));
      });
    }, speechCompletionTimeoutMs(text));
    utterance.onend = () => finish(resolve);
    utterance.onerror = (event) => finish(() => reject(new Error(event.error)));
    try {
      speechSynthesis.speak(utterance);
    } catch (error) {
      finish(() => reject(error));
    }
  });

  return voice ? { name: voice.name, lang: voice.lang, localService: voice.localService } : null;
}
