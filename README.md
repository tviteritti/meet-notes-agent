# Meet Notes Agent (`reuniones`)

Chrome extension + local Node server that records a Google Meet (tab + mic), transcribes with Whisper (Groq), writes notes into the project folder, and can answer live questions by calling Cursor CLI against that workspace.

Extensión de Chrome + server Node local: graba un Google Meet (pestaña + mic), transcribe con Whisper (Groq), escribe notas en la carpeta del proyecto y puede responder preguntas en vivo invocando Cursor CLI sobre ese workspace.

## Stack

- Chrome Manifest V3 (tabCapture, offscreen document, AudioWorklet)
- Node.js 22+ (HTTP + WebSocket)
- Groq Whisper (`whisper-large-v3-turbo`) for STT
- Optional: Cursor CLI (`cursor-agent`) for live Q&A ("TAMI")

## Setup

1. Copy config and fill your Groq key + projects root:

```bash
cp config.example.json config.json
```

```json
{
  "port": 3939,
  "userName": "Vos",
  "groqModel": "whisper-large-v3-turbo",
  "language": "es",
  "groqApiKey": "gsk_...",
  "projectsRoot": "C:\\path\\to\\your\\projects",
  "extraProjects": []
}
```

`projectsRoot` is a folder whose subfolders appear as selectable projects. Notes are written under each project's `meetings/` directory (outside this repo).

2. Install and start the server:

```bash
npm install
npm start
```

3. Load the extension in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select the `extension/` folder.

4. Open a Google Meet, pick a project in the popup, allow mic, and start recording.

## Live Q&A (optional)

If Cursor CLI is installed, the server can answer questions about the active project during the meeting (`server/cursor.js` → `cursor-agent` in ask mode). Without it, transcription and notes still work.

## Tests

```bash
npm test
```

## Privacy

- `config.json` (API key) is gitignored.
- Audio is sent to Groq for transcription; transcripts stay on your machine under each project's `meetings/` folder.
- No client data is included in this repository.
