import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { unlockEnglishAudio } from "./infrastructure/speech/englishAudio";

window.addEventListener("click", unlockEnglishAudio, { capture: true });
window.addEventListener("touchend", unlockEnglishAudio, { capture: true, passive: true });
window.addEventListener("keydown", unlockEnglishAudio, { capture: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
