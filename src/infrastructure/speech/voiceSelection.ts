export function pickBestVoice(voices: SpeechSynthesisVoice[], locale: string) {
  const normalizedLocale = locale.toLowerCase();
  const language = normalizedLocale.split("-")[0];

  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalizedLocale && voice.localService) ??
    voices.find((voice) => voice.lang.toLowerCase() === normalizedLocale) ??
    voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === language && voice.localService) ??
    voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === language) ??
    null
  );
}
