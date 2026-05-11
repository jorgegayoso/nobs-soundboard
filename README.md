# Nob's Soundboard

A dark, neon-styled desktop soundboard that plays audio through a virtual audio cable so anyone listening to your mic (Discord, Zoom, Teams, etc.) hears the sounds alongside your voice.

Built with Electron. Runs on Windows, with experimental macOS/Linux support.

![alt text](https://github.com/jorgegayoso/nobs-soundboard/raw/main/art/view.png "Nob's Soundboard")

## Features

- Dark industrial-neon UI with colored 3D puck buttons and glow animations
- Categories with custom colors — organize sounds into collapsible groups
- YouTube / URL downloads — paste a link, auto-downloads via yt-dlp
- Audio trimming — built-in waveform editor to trim start/end points
- Per-button volume and gain (dB) control
- Loop modes — repeat on end, fixed interval, or random interval
- Global hotkeys — bind any key combo to trigger sounds even when the app is in the background
- Bulk select — play, stop, loop, or delete multiple buttons at once
- VoiceMeeter integration — auto-connects to VoiceMeeter Remote API, routes your mic through Strip[0]
- Output device selector — pick your virtual audio cable or any output device
- Master volume slider and STOP ALL button
- Favorites sidebar with drag-and-drop ordering
- Tray icon — minimize to system tray, restore on click
- Portable config — all data stored in `%APPDATA%\Nob\soundboard\`

## Installation

### From Installer (.exe)

Download the latest release and run the installer. During setup you can optionally install VoiceMeeter (free virtual audio mixer from VB-Audio).

On first launch, the app automatically downloads **yt-dlp** and **ffmpeg** into the tools folder. No manual PATH setup needed.

### From Source

Prerequisites: [Node.js](https://nodejs.org) v18+

```bash
git clone <repo-url>
cd soundboard
npm install
npm start
```

### Building the Installer

```bash
npm run build
```

Output goes to the `dist/` folder. The NSIS installer includes an optional VoiceMeeter install page.

## Data & Folder Structure

Everything lives under `%APPDATA%\Nob\soundboard\`:

```
Nob/soundboard/
├── soundboard-config.json    # All settings, button configs, categories
├── sounds/                   # Downloaded and imported audio files
│   ├── Category 1/
│   └── Category 2/
├── tools/                    # Auto-downloaded binaries
│   ├── yt-dlp.exe
│   └── ffmpeg.exe
└── runtime/                  # Electron session data (cache, localStorage, etc.)
    ├── Cache/
    ├── Local Storage/
    └── ...
```

Config and sounds persist across app updates and reinstalls.

## Virtual Audio Cable Setup

To route sounds through your mic:

1. Let the installer set up [VoiceMeeter](https://vb-audio.com/Voicemeeter/) (recommended) or install it yourself
2. In the soundboard, with VoiceMeeter open, select your microphone as the input device
3. In Discord/Zoom/Teams, set your input mic to the virtual cable output (VoiceMeeter Out B1)
4. Press buttons — everyone on the call hears the sounds

**VoiceMeeter (recommended):** Mixes your real mic + soundboard audio into one virtual output. The app auto-connects to VoiceMeeter's Remote API and sets up the mic strip. Use the **VM Auto** toggle (bottom-right) to control whether VoiceMeeter launches with the app.

## Usage

| Action | How |
|--------|-----|
| Add a sound | Bottom bar → **+ Add Sound** |
| Browse local files | Bottom bar → **Browse Local** |
| Edit a sound | Right-click the button → **Edit** |
| Trim audio | Right-click the button → **Trim Audio** |
| Delete a sound | Right-click the button → **Delete** |
| Bulk select | Right-click a button → **Select Multiple**, then click buttons to select |
| Add category | Bottom bar → **+ Add Category** |
| Edit category | Right-click the category header |
| Set keyboard shortcut | Edit dialog → set a keybind (e.g. `F1`, `ctrl+1`) |
| Change output device | Top bar device selector |
| Stop all playback | Top bar **STOP** button |
| Toggle VM auto-start | Bottom bar **VM Auto** button |
| Set VoiceMeeter path | Bottom bar **VM Path** button |

## Dependencies

All dependencies are handled automatically — nothing to install manually.

| Package | Purpose | How it's included |
|---------|---------|-------------------|
| [Electron](https://www.electronjs.org/) | Desktop app shell, file dialogs, system tray | Bundled into the installer by electron-builder |
| [uiohook-napi](https://github.com/nicog98/uiohook-napi) | Global keyboard/mouse hotkeys (works when app is unfocused) | Bundled via `npm install` → packaged into installer |
| [koffi](https://koffi.dev/) | FFI bindings for VoiceMeeter Remote API DLL | Bundled via `npm install` → packaged into installer |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Downloads audio from YouTube and 1000+ sites | Auto-downloaded on first launch |
| [ffmpeg](https://ffmpeg.org/) | Audio format conversion for yt-dlp | Auto-downloaded on first launch |

## License

MIT
