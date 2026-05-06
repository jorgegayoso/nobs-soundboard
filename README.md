# ⚡ Soundboard

A dark, neon-styled microphone soundboard. Plays sounds through a virtual audio cable so anyone listening to your mic (Discord, Zoom, etc.) hears them.

## Features

- **Dark industrial-neon UI** — no white backgrounds, no generic AI look
- **Colored puck buttons** with 3D press effect and glow animation while playing
- **Categories** — color-coded groups, right-click to edit/delete
- **Right-click any button** to edit name, source, color, category, or keybind
- **Local files** — WAV, MP3, OGG, FLAC, M4A, and more
- **YouTube / URL support** — paste a link, downloads via yt-dlp
- **Output device selector** — pick your virtual audio cable
- **Volume control** and **Stop All**
- **Keyboard shortcuts** — bind any key combo to a sound
- **Quick-add bar** — paste a URL in the sidebar and hit Enter
- **Exports to .exe** via electron-builder

---

## Quick Start

### 1. Install Node.js (v18+)
https://nodejs.org

### 2. Clone & install
```bash
cd soundboard-app
npm install
```

### 3. Run in dev mode
```bash
npm start
```

### 4. Build .exe
```bash
npm run build
```
Output is in the `dist/` folder.

---

## Virtual Audio Cable Setup

To route sounds through your mic:

1. **Install VB-CABLE** (free): https://vb-audio.com/Cable/
2. In the soundboard, select **CABLE Input (VB-Audio Virtual Cable)** as output device
3. In Discord/Zoom/etc., set your input mic to **CABLE Output (VB-Audio Virtual Cable)**
4. Press buttons → your friends hear the sounds

**Want to mix your real mic + soundboard?** Use [VoiceMeeter](https://vb-audio.com/Voicemeeter/) (free) to combine both inputs.

---

## YouTube / URL Downloads

For URL downloading to work, you need **yt-dlp** installed and on your PATH:

```bash
pip install yt-dlp
```

Or download from https://github.com/yt-dlp/yt-dlp/releases

Downloaded audio is cached in your app data folder so it only downloads once.

---

## Usage

| Action | How |
|--------|-----|
| Add a sound | Bottom bar → **+ Add Sound** |
| Add from files | Bottom bar → **Browse Local** |
| Quick-add URL | Paste in sidebar ★ bar, press Enter |
| Edit a sound | **Right-click** the button → Edit |
| Delete a sound | **Right-click** the button → Delete |
| Add category | Bottom bar → **+ Add Category** |
| Edit category | **Right-click** the category header |
| Keyboard shortcut | Set a keybind in the Edit dialog (e.g. `F1`, `ctrl+1`) |
| Change output | Top bar device selector |
| Stop playback | Top bar **■ STOP** button |

---

## Tech Stack

| Component | Purpose |
|-----------|---------|
| Electron | Desktop app shell, file dialogs, yt-dlp integration |
| Web Audio API | Sound playback with device routing (`setSinkId`) |
| Vanilla JS | No framework bloat — fast, single-file renderer |
| yt-dlp | Downloads audio from YouTube and 1000+ sites |
