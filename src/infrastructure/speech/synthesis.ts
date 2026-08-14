import type { SpeechLocale } from "./recognition";
import { pickBestVoice } from "./voiceSelection";

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
  const voices = await loadVoices();
  const voice = pickBestVoice(voices, locale);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.rate = 0.9;
  if (voice) utterance.voice = voice;

  speechSynthesis.cancel();
  await new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error));
    speechSynthesis.speak(utterance);
  });

  return voice ? { name: voice.name, lang: voice.lang, localService: voice.localService } : null;
}
