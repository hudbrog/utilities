export function WordAudioButton({ english, play, disabled }: { english: string; play: (english: string) => void; disabled?: boolean }) {
  const label = `Послушать: ${english}`;
  return <button type="button" className="word-audio" disabled={disabled} aria-label={label} title={label}
    onClick={() => play(english)}><span aria-hidden="true">🔊</span></button>;
}
