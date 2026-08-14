# Stage 0 physical-device runbook

Target: the iPhone/iPad that will be used for ordinary study.

## Preparation

1. Open `https://hudbrog.github.io/utilities/` in Safari while online.
2. Wait until the status strip says **Кэш готов для офлайн**.
3. Tap **Сохранить метку** once.
4. Test Russian and English TTS and STT while still online.
5. Use **Share → Add to Home Screen**, then launch the new icon.

## Installed and offline checks

1. Confirm that **Запуск с домашнего экрана** and **SpeechRecognition** are available.
2. Close the app from the app switcher, relaunch it, and confirm the saved IndexedDB timestamp and count.
3. Enable airplane mode, fully close the app, and cold-launch it from the home screen.
4. Repeat both TTS tests.
5. Repeat both STT tests. Speak `велосипед` for `ru-RU` and `daughter` for `en-US`.
6. If the local language-pack API is available, use **Проверить пакет** and install a downloadable pack before retrying.
7. Mark each result in the in-app checklist and download the diagnostic JSON.

## Durability checks

1. Reboot the device and confirm that the IndexedDB timestamp/count and checklist remain.
2. Deploy a harmless version change, accept the in-app update, and confirm that the same state remains.
3. Leave the app installed and used intermittently for at least one week before closing the Stage 0 persistence gate.

## Interpretation

- A recognizer browser error, permission error, or missing language pack is a platform failure, not a learning failure.
- If either offline STT locale cannot pass reliably, V0.1 remains valid in multiple-choice-only mode on that device.
- Failure of offline STT does not authorize adding a backend or a WASM speech model to V0.1; those remain separate product decisions.
