const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

// ── Paths ───────────────────────────────────────────────────────────────
const APP_ROOT = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : __dirname;
// Store config and sounds in user data so they persist across updates/reinstalls
const USER_DATA = path.join(app.getPath('appData'), 'Nob', 'soundboard');
const SOUNDS_DIR = path.join(USER_DATA, 'sounds');
const CONFIG_PATH = path.join(USER_DATA, 'soundboard-config.json');
const ICON_PATH = path.join(__dirname, 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'tray-icon.png');

function ensureDirs() {
  if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });
  if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

// ── Config ──────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) { console.error('Config load error:', e); }
  return {
    volume: 80,
    outputDeviceId: null,
    inputDeviceId: null,
    buttons: [],
    categories: [
      { id: 'cat_1', name: 'Category 1', color: '#00c853' }
    ]
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) { console.error('Config save error:', e); }
}

// ── Window ──────────────────────────────────────────────────────────────
let mainWindow;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0a0a0f',
    frame: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('renderer/index.html');

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip("Nob's Soundboard");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Nob's Soundboard",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click tray icon to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  createTray();
  setupGlobalHotkeys();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Global Hotkeys via uiohook-napi ─────────────────────────────────────
// This captures keyboard (and mouse) events system-wide, even when the app
// is in the background. We forward them to the renderer for matching.
const UIOHOOK_KEYCODE_MAP = {
  1:  'Escape', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7',
  9:  '8', 10: '9', 11: '0', 12: '-', 13: '=', 14: 'Backspace',
  15: 'Tab', 16: 'q', 17: 'w', 18: 'e', 19: 'r', 20: 't', 21: 'y',
  22: 'u', 23: 'i', 24: 'o', 25: 'p', 26: '[', 27: ']', 28: 'Enter',
  29: 'Control', 30: 'a', 31: 's', 32: 'd', 33: 'f', 34: 'g', 35: 'h',
  36: 'j', 37: 'k', 38: 'l', 39: ';', 40: "'", 41: '`', 42: 'Shift',
  43: '\\', 44: 'z', 45: 'x', 46: 'c', 47: 'v', 48: 'b', 49: 'n',
  50: 'm', 51: ',', 52: '.', 53: '/', 54: 'Shift', 56: 'Alt',
  57: ' ', 58: 'CapsLock',
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6',
  65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12',
  3639: 'PrintScreen', 3653: 'Pause',
  3655: 'Home', 3657: 'PageUp', 3663: 'End', 3665: 'PageDown',
  57416: 'ArrowUp', 57419: 'ArrowLeft', 57421: 'ArrowRight', 57424: 'ArrowDown',
  3612: 'Control', 3640: 'Alt',
  // Numpad
  69: 'NumLock', 3637: 'Num/', 55: 'Num*', 74: 'Num-', 78: 'Num+',
  3612: 'NumEnter',
  71: 'Num7', 72: 'Num8', 73: 'Num9',
  75: 'Num4', 76: 'Num5', 77: 'Num6',
  79: 'Num1', 80: 'Num2', 81: 'Num3',
  82: 'Num0', 83: 'Num.',
};

// Mouse button map for uiohook
const MOUSE_BUTTON_MAP = {
  1: 'Mouse1', 2: 'Mouse3', 3: 'Mouse2', 4: 'Mouse4', 5: 'Mouse5'
};

let uioHeld = { ctrl: false, shift: false, alt: false };
// Track currently held keys/buttons for building combos live
let uioHeldKeys = new Set(); // non-modifier keys currently held
let uioPeakModifierCombo = ''; // tracks the highest combo reached before release
let uioModifierReleaseTimer = null;

function setupGlobalHotkeys() {
  let uiohook;
  try {
    const mod = require('uiohook-napi');
    uiohook = mod.uIOhook;
  } catch (e) {
    console.warn('uiohook-napi not available — global hotkeys disabled.', e.message);
    return;
  }

  uiohook.on('keydown', (e) => {
    const key = UIOHOOK_KEYCODE_MAP[e.keycode];
    if (!key) return;

    if (key === 'Control') { uioHeld.ctrl = true; clearTimeout(uioModifierReleaseTimer); updatePeakCombo(); mainWindow?.webContents.send('global-modifier-change', buildModifierCombo()); return; }
    if (key === 'Shift')   { uioHeld.shift = true; clearTimeout(uioModifierReleaseTimer); updatePeakCombo(); mainWindow?.webContents.send('global-modifier-change', buildModifierCombo()); return; }
    if (key === 'Alt')     { uioHeld.alt = true; clearTimeout(uioModifierReleaseTimer); updatePeakCombo(); mainWindow?.webContents.send('global-modifier-change', buildModifierCombo()); return; }

    // Non-modifier key pressed — clear peak tracking since this isn't modifier-only
    uioPeakModifierCombo = '';
    clearTimeout(uioModifierReleaseTimer);
    uioHeldKeys.add(key);
    const combo = buildCombo(key);
    mainWindow?.webContents.send('global-keydown', combo);
    mainWindow?.webContents.send('global-combo-update', combo);
  });

  uiohook.on('keyup', (e) => {
    const key = UIOHOOK_KEYCODE_MAP[e.keycode];
    if (!key) return;

    if (key === 'Control' || key === 'Shift' || key === 'Alt') {
      if (key === 'Control') uioHeld.ctrl = false;
      if (key === 'Shift') uioHeld.shift = false;
      if (key === 'Alt') uioHeld.alt = false;

      mainWindow?.webContents.send('global-modifier-change', buildModifierCombo());

      // If no non-modifier keys were pressed, schedule a modifier-only finalize
      // Use a short delay so simultaneous releases are batched
      if (uioHeldKeys.size === 0 && uioPeakModifierCombo) {
        clearTimeout(uioModifierReleaseTimer);
        uioModifierReleaseTimer = setTimeout(() => {
          // Only fire if ALL modifiers are now released
          if (!uioHeld.ctrl && !uioHeld.shift && !uioHeld.alt && uioPeakModifierCombo) {
            const combo = uioPeakModifierCombo;
            uioPeakModifierCombo = '';
            mainWindow?.webContents.send('global-keydown', combo);
            mainWindow?.webContents.send('global-modifier-release', combo);
          }
        }, 80); // 80ms window to catch simultaneous releases
      }
      return;
    }

    uioHeldKeys.delete(key);
  });

  uiohook.on('mousedown', (e) => {
    const btn = MOUSE_BUTTON_MAP[e.button];
    if (!btn) return;
    const combo = buildCombo(btn);
    mainWindow?.webContents.send('global-mousedown', combo);
    mainWindow?.webContents.send('global-combo-update', combo);
  });

  uiohook.start();
  console.log('[uiohook] Global hotkey listener started');
}

function updatePeakCombo() {
  const current = buildModifierCombo();
  if (current) uioPeakModifierCombo = current;
}

function buildModifierCombo() {
  const parts = [];
  if (uioHeld.ctrl) parts.push('Ctrl');
  if (uioHeld.shift) parts.push('Shift');
  if (uioHeld.alt) parts.push('Alt');
  return parts.join('+') || '';
}

function buildCombo(key) {
  const parts = [];
  if (uioHeld.ctrl) parts.push('Ctrl');
  if (uioHeld.shift) parts.push('Shift');
  if (uioHeld.alt) parts.push('Alt');
  parts.push(key);
  return parts.join('+');
}

// ── IPC: window controls ────────────────────────────────────────────────
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('win-close', () => mainWindow?.hide());

// ── IPC: config ─────────────────────────────────────────────────────────
ipcMain.handle('load-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });

// ── IPC: file picker ────────────────────────────────────────────────────
ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Sound Files',
    filters: [
      { name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus', 'wma', 'aac'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  return result.canceled ? [] : result.filePaths;
});

// ── IPC: open external URL ──────────────────────────────────────────────
ipcMain.handle('open-external', async (_, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch(e) { return false; }
});

// ── IPC: fetch URL title ────────────────────────────────────────────────
function fetchPage(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redir = res.headers.location;
        if (redir.startsWith('/')) { const u = new URL(url); redir = u.origin + redir; }
        return fetchPage(redir, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { data += chunk; if (data.length > 50000) { res.destroy(); resolve(data); } });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

ipcMain.handle('fetch-url-title', async (_, url) => {
  try {
    const html = await fetchPage(url);
    // Try <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      let title = titleMatch[1].trim();
      // Clean up common suffixes
      title = title.replace(/\s*[-–|]\s*(YouTube|MyInstants|SoundCloud|Voicy|TikTok).*$/i, '').trim();
      // Decode HTML entities
      title = title.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
      title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (title) return title;
    }
    // Try og:title
    const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                     html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogMatch) return ogMatch[1].trim();
    return null;
  } catch(e) {
    console.warn('[fetch-url-title] Error:', e.message);
    return null;
  }
});

// ── IPC: yt-dlp download ────────────────────────────────────────────────
ipcMain.handle('download-url', async (_, { url, categoryName, fileName }) => {
  const safeCat = (categoryName || 'Uncategorized').replace(/[^a-zA-Z0-9 _-]/g, '_');
  const safeName = (fileName || url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 60))
    .replace(/[^a-zA-Z0-9 _-]/g, '_');
  const catDir = path.join(SOUNDS_DIR, safeCat);
  if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });

  const expectedMp3 = path.join(catDir, safeName + '.mp3');

  if (fs.existsSync(expectedMp3)) {
    return { success: true, filePath: expectedMp3 };
  }

  const filesBefore = new Set(fs.readdirSync(catDir));
  const outTemplate = path.join(catDir, safeName + '.%(ext)s');

  return new Promise((resolve) => {
    const args = [
      'yt-dlp',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '-o', `"${outTemplate}"`,
      '--no-playlist',
      '--no-warnings',
      '--force-overwrites',
      `"${url}"`
    ].join(' ');

    console.log('[yt-dlp] Running:', args);

    const proc = spawn(args, [], { shell: true, cwd: catDir, windowsHide: true });

    let stdoutBuf = '', stderrBuf = '';
    proc.stdout.on('data', d => { stdoutBuf += d.toString(); });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('close', (code) => {
      console.log('[yt-dlp] Exit code:', code);
      if (stdoutBuf) console.log('[yt-dlp] stdout:', stdoutBuf);
      if (stderrBuf) console.log('[yt-dlp] stderr:', stderrBuf);

      if (fs.existsSync(expectedMp3)) {
        resolve({ success: true, filePath: expectedMp3 });
        return;
      }

      const filesAfter = fs.readdirSync(catDir);
      const newFiles = filesAfter.filter(f => !filesBefore.has(f));

      if (newFiles.length > 0) {
        const audioExts = ['.mp3', '.opus', '.m4a', '.wav', '.webm', '.aac', '.ogg'];
        const audioFile = newFiles.find(f => audioExts.some(e => f.toLowerCase().endsWith(e))) || newFiles[0];
        const foundPath = path.join(catDir, audioFile);
        if (foundPath !== expectedMp3) {
          try { fs.renameSync(foundPath, expectedMp3); resolve({ success: true, filePath: expectedMp3 }); return; }
          catch(e) { resolve({ success: true, filePath: foundPath }); return; }
        }
        resolve({ success: true, filePath: foundPath });
        return;
      }

      const allFiles = fs.readdirSync(catDir).filter(f => f.startsWith(safeName));
      if (allFiles.length > 0) {
        resolve({ success: true, filePath: path.join(catDir, allFiles[0]) });
        return;
      }

      resolve({ success: false, error: stderrBuf || stdoutBuf || `yt-dlp exited with code ${code}` });
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: 'Failed to start yt-dlp.\n' + err.message });
    });
  });
});

ipcMain.handle('get-sounds-dir', () => SOUNDS_DIR);

// ── IPC: VoiceMeeter ───────────────────────────────────────────────────
ipcMain.handle('pick-voicemeeter-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select VoiceMeeter Executable',
    filters: [
      { name: 'Executable', extensions: ['exe'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('launch-voicemeeter', async (_, vmPath) => {
  if (!vmPath || !fs.existsSync(vmPath)) {
    return { success: false, error: 'VoiceMeeter path not found' };
  }
  try {
    const proc = spawn(vmPath, [], { detached: true, stdio: 'ignore', windowsHide: false });
    proc.unref();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
