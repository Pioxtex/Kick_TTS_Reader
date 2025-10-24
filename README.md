# 🎙️ Kick TTS Bot – Czytanie czatu na głos (by Pioxtex)

**Kick TTS Bot** to aplikacja dla streamerów Kick.com, która automatycznie **czyta wiadomości z czatu na głos**.  
Zbudowana w **Node.js + Electron**, umożliwia pełną kontrolę z poziomu interfejsu oraz czatu (`!tts`).

---

## 🚀 Główne funkcje

- 🔊 Czytanie wiadomości z czatu Kick w czasie rzeczywistym  
- 👑 Obsługa komend moderatorskich (`!tts mute`, `!tts skip`, `!tts status`, `!tts prefix`, itp.)  
- 🗣️ Wybór głosu systemowego (Windows SAPI – np. Microsoft Paulina)  
- ⚙️ Panel konfiguracyjny z wszystkimi ustawieniami (tempo, głośność, limity, filtry)  
- 🔞 Cenzura wulgaryzmów i automatyczne pomijanie botów  
- 🧠 Antyspam: limit kolejki, cooldown per user, deduplikacja wiadomości  
- 💾 Trwały zapis konfiguracji (`src/settings.json`)  
- 🪄 Prefiks `{user}` – automatyczne wstawianie nicku mówiącego (np. „Pioxtex: ...”)  
- ⚡ Kolejka TTS z priorytetami (VIP/mod/sub > zwykli)  
- 🎛️ Sterowanie z czatu i panelu (pełna dwustronna synchronizacja)

---

## 🧩 Instalacja

1. Zainstaluj **Node.js 18+** i **npm**
2. Sklonuj repo:
   ```bash
   git clone https://github.com/Pioxtex/Kick_TTS_Bot.git
   cd Bot_TTS_Kick_console
   ```
3. Zainstaluj zależności:
   ```bash
   npm install
   ```
4. Uruchom bota:
   ```bash
   npm start
   ```

> Jeśli używasz po raz pierwszy – w folderze `src/` utworzy się `settings.json` z domyślnymi wartościami.

---

## ⚙️ Plik konfiguracyjny (`src/settings.json`)

Zawiera trwałe ustawienia bota. Przykład:

```json
{
  "rate": 0.8,
  "volume": 100,
  "prefix": "{user}: ",
  "voiceName": "Microsoft Paulina Desktop - Polish",
  "maxQueue": 60,
  "skipBots": true,
  "profanity": true,
  "readCommands": true,
  "speakTtsCommands": true,
  "speakBotCommands": false,
  "userCooldownMs": 5000,
  "dedupWindowMs": 30000,
  "allowedUsers": [],
  "lastChannel": "",
}
```

---

## ⚡ Komendy z czatu (moderator/owner)

| Komenda | Opis |
|----------|------|
| `!tts mute` | Wycisza bota |
| `!tts unmute` | Włącza mówienie |
| `!tts toggle` | Przełącza mute/unmute |
| `!tts skip` | Pomija aktualny komunikat |
| `!tts clear` | Czyści kolejkę |
| `!tts rate 1.2` | Ustawia tempo czytania |
| `!tts volume 85` | Ustawia głośność |
| `!tts maxqueue 80` | Limit kolejki |
| `!tts voice Paulina` | Wybiera głos (po fragmencie nazwy) |
| `!tts prefix {user}: ` | Ustawia prefiks (np. „Pioxtex: ”) |
| `!tts status` | Wyświetla aktualne ustawienia |
| `!tts <tekst>` | Czyta dany tekst (jeśli włączone czytanie komend) |

---

## 🧭 Struktura projektu

```
Bot_TTS_Kick_console/
│
├─ src/
│  ├─ main.js
│  ├─ preload.cjs
│  ├─ renderer.html
│  ├─ panel.html
│  ├─ panel.js
│  ├─ ttsBot.js
│  └─ settings.json
│
├─ package.json
└─ README.md
```

---

## 🧑‍💻 Autor
**Pioxtex**  
📺 Kick: [kick.com/pioxtex](https://kick.com/pioxtex)  
💬 Discord / kontakt prywatny: dostępny na życzenie  

---

## 🧾 Licencja
Projekt udostępniony na licencji MIT.
