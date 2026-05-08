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

  // Auto-setup VoiceMeeter once the renderer is ready
  mainWindow.webContents.on('did-finish-load', () => {
    autoSetupVoicemeeter();
  });

  // Recover from renderer crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[CRASH] Renderer gone:', details.reason, details.exitCode);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadFile('renderer/index.html');
      }
    }, 500);
  });

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
  // Register a custom protocol to serve local audio files to the renderer.
  // This avoids file:// CORS issues and base64 IPC memory bombs.
  const { protocol } = require('electron');
  protocol.handle('local-audio', (request) => {
    // URL format: local-audio://read/<encoded-path>
    try {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      // On Windows, pathname comes as /C:/path — strip leading slash
      const cleanPath = filePath.replace(/^\/([A-Z]:)/i, '$1');
      if (!fs.existsSync(cleanPath)) {
        return new Response('Not found', { status: 404 });
      }
      const ext = path.extname(cleanPath).toLowerCase().slice(1);
      const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', opus: 'audio/opus', aac: 'audio/aac', webm: 'audio/webm' };
      const mime = mimeMap[ext] || 'application/octet-stream';
      const data = fs.readFileSync(cleanPath);
      return new Response(data, { headers: { 'Content-Type': mime } });
    } catch(e) {
      return new Response(e.message, { status: 500 });
    }
  });

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

function safeSend(channel, ...args) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return;
    try { if (!wc.mainFrame) return; } catch(e) { return; }
    wc.send(channel, ...args);
  } catch (e) { /* frame disposed between checks */ }
}

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

    if (key === 'Control') { uioHeld.ctrl = true; clearTimeout(uioModifierReleaseTimer); updatePeakCombo(); safeSend('global-modifier-change', buildModifierCombo()); return; }
    if (key === 'Shift')   { uioHeld.shift = true; clearTimeout(uioModifierReleaseTimer); updatePeakCombo(); safeSend('global-modifier-change', buildModifierCombo()); return; }
    if (key === 'Alt')     { uioHeld.alt = true; clearTimeout(uioModifierReleaseTimer); updatePeakCombo(); safeSend('global-modifier-change', buildModifierCombo()); return; }

    // Non-modifier key pressed — clear peak tracking since this isn't modifier-only
    uioPeakModifierCombo = '';
    clearTimeout(uioModifierReleaseTimer);
    uioHeldKeys.add(key);
    const combo = buildCombo(key);
    safeSend('global-keydown', combo);
    safeSend('global-combo-update', combo);
  });

  uiohook.on('keyup', (e) => {
    const key = UIOHOOK_KEYCODE_MAP[e.keycode];
    if (!key) return;

    if (key === 'Control' || key === 'Shift' || key === 'Alt') {
      if (key === 'Control') uioHeld.ctrl = false;
      if (key === 'Shift') uioHeld.shift = false;
      if (key === 'Alt') uioHeld.alt = false;

      safeSend('global-modifier-change', buildModifierCombo());

      // If no non-modifier keys were pressed, schedule a modifier-only finalize
      // Use a short delay so simultaneous releases are batched
      if (uioHeldKeys.size === 0 && uioPeakModifierCombo) {
        clearTimeout(uioModifierReleaseTimer);
        uioModifierReleaseTimer = setTimeout(() => {
          // Only fire if ALL modifiers are now released
          if (!uioHeld.ctrl && !uioHeld.shift && !uioHeld.alt && uioPeakModifierCombo) {
            const combo = uioPeakModifierCombo;
            uioPeakModifierCombo = '';
            safeSend('global-keydown', combo);
            safeSend('global-modifier-release', combo);
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
    safeSend('global-mousedown', combo);
    safeSend('global-combo-update', combo);
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

// ── Voicemeeter Remote API ──────────────────────────────────────────────
// Uses koffi to load VoicemeeterRemote DLL. No native compilation needed.
// Falls back gracefully if the DLL or koffi is not available.
let vmLib = null;   // koffi loaded library
let vmFns = null;   // bound function references
let vmConnected = false;

function findVoicemeeterDll() {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    path.join(programFiles, 'VB', 'Voicemeeter', 'VoicemeeterRemote64.dll'),
    path.join(programFilesX86, 'VB', 'Voicemeeter', 'VoicemeeterRemote64.dll'),
    path.join(programFiles, 'VB', 'Voicemeeter', 'VoicemeeterRemote.dll'),
    path.join(programFilesX86, 'VB', 'Voicemeeter', 'VoicemeeterRemote.dll'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findVoicemeeterExe() {
  // Try to find VoiceMeeter executable automatically
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    path.join(programFiles, 'VB', 'Voicemeeter', 'voicemeeter.exe'),
    path.join(programFilesX86, 'VB', 'Voicemeeter', 'voicemeeter.exe'),
    path.join(programFiles, 'VB', 'Voicemeeter', 'voicemeeterpro.exe'),
    path.join(programFilesX86, 'VB', 'Voicemeeter', 'voicemeeterpro.exe'),
    path.join(programFiles, 'VB', 'Voicemeeter', 'voicemeeter8x64.exe'),
    path.join(programFilesX86, 'VB', 'Voicemeeter', 'voicemeeter8x64.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isVoicemeeterRunning() {
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      'tasklist /FI "IMAGENAME eq voicemeeter.exe" /FI "IMAGENAME eq voicemeeterpro.exe" /FI "IMAGENAME eq voicemeeter8x64.exe" /NH',
      { timeout: 3000, windowsHide: true, encoding: 'utf-8' }
    );
    return result.toLowerCase().includes('voicemeeter');
  } catch(e) { return false; }
}

function loadVmLibrary() {
  if (vmLib) return true;
  try {
    const koffi = require('koffi');
    const dllPath = findVoicemeeterDll();
    if (!dllPath) {
      console.log('[VM] DLL not found');
      return false;
    }
    vmLib = koffi.load(dllPath);
    vmFns = {
      Login:               vmLib.func('long __stdcall VBVMR_Login()'),
      Logout:              vmLib.func('long __stdcall VBVMR_Logout()'),
      RunVoicemeeter:      vmLib.func('long __stdcall VBVMR_RunVoicemeeter(long)'),
      SetParameterStringA: vmLib.func('long __stdcall VBVMR_SetParameterStringA(str, str)'),
      SetParameterFloat:   vmLib.func('long __stdcall VBVMR_SetParameterFloat(str, float)'),
      GetParameterFloat:   vmLib.func('long __stdcall VBVMR_GetParameterFloat(str, _Out_ float *)'),
      IsParametersDirty:   vmLib.func('long __stdcall VBVMR_IsParametersDirty()'),
      GetVoicemeeterType:  vmLib.func('long __stdcall VBVMR_GetVoicemeeterType(_Out_ long *)'),
      Input_GetDeviceNumber:  vmLib.func('long __stdcall VBVMR_Input_GetDeviceNumber()'),
      Input_GetDeviceDescA:   vmLib.func('long __stdcall VBVMR_Input_GetDeviceDescA(long, _Out_ long *, _Out_ str, _Out_ str)'),
    };
    console.log('[VM] Library loaded from:', dllPath);
    return true;
  } catch(e) {
    console.log('[VM] Failed to load library:', e.message);
    return false;
  }
}

function connectVoicemeeterRemote() {
  if (vmConnected) return { success: true, loginResult: -2 };
  if (!loadVmLibrary()) return { success: false, loginResult: -99 };
  try {
    const loginResult = vmFns.Login();
    console.log('[VM] Login result:', loginResult);
    if (loginResult < 0 && loginResult !== -2) return { success: false, loginResult };
    vmConnected = true;
    if (loginResult === 1) {
      console.log('[VM] VM not running — calling RunVoicemeeter(1)...');
      try { vmFns.RunVoicemeeter(1); } catch(e) { console.log('[VM] RunVoicemeeter failed:', e.message); }
    }
    try { vmFns.IsParametersDirty(); } catch(e) {}
    return { success: true, loginResult };
  } catch (e) {
    console.log('[VM] Connection error:', e.message);
    return { success: false, loginResult: -99 };
  }
}

function disconnectVoicemeeterRemote() {
  if (vmConnected && vmFns) {
    try { vmFns.Logout(); } catch(e) {}
    vmConnected = false;
  }
}

function waitForVmReady(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!vmConnected || !vmFns) { resolve(false); return; }
      try {
        const dirty = vmFns.IsParametersDirty();
        if (dirty >= 0) {
          console.log(`[VM] Engine ready — IsParametersDirty=${dirty} after ${Date.now() - start}ms`);
          resolve(true);
          return;
        }
        if ((Date.now() - start) % 5000 < 1100)
          console.log(`[VM] IsParametersDirty=${dirty}, waiting... (${Date.now() - start}ms)`);
      } catch(e) {}
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 1000);
    };
    setTimeout(check, 1000);
  });
}

function vmEnumerateInputDevices() {
  if (!vmFns) return [];
  try {
    const nb = vmFns.Input_GetDeviceNumber();
    const devices = [];
    for (let i = 0; i < nb; i++) {
      try {
        const typeBuf = [0], nameBuf = ['\0'.repeat(512)], hwIdBuf = ['\0'.repeat(512)];
        if (vmFns.Input_GetDeviceDescA(i, typeBuf, nameBuf, hwIdBuf) === 0) {
          const typeStr = { 1: 'mme', 3: 'wdm', 4: 'ks', 5: 'asio' }[typeBuf[0]] || 'unknown';
          devices.push({ typeStr, name: nameBuf[0].replace(/\0+$/, '') });
        }
      } catch(e) {}
    }
    return devices;
  } catch(e) { return []; }
}

function findVmDeviceName(browserLabel) {
  const devices = vmEnumerateInputDevices();
  console.log(`[VM] Enumerated ${devices.length} input devices`);
  for (const d of devices) console.log(`[VM]   [${d.typeStr}] "${d.name}"`);
  if (!devices.length) return null;
  const clean = browserLabel.replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)\s*$/, '').trim();
  const wdm = devices.filter(d => d.typeStr === 'wdm');
  // Exact
  let m = wdm.find(d => d.name === clean);
  if (m) return m;
  // Substring
  m = wdm.find(d => clean.includes(d.name) || d.name.includes(clean));
  if (m) return m;
  // Simplified
  const simp = clean.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase();
  m = wdm.find(d => { const ds = d.name.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase(); return simp.includes(ds) || ds.includes(simp); });
  if (m) return m;
  // Any type
  m = devices.find(d => clean.includes(d.name) || d.name.includes(clean));
  if (m) return m;
  // Word overlap
  const words = clean.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let best = null, bestScore = 0;
  for (const d of wdm) {
    const dw = d.name.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const score = words.filter(w => dw.some(x => x.includes(w) || w.includes(x))).length;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return (best && bestScore >= 2) ? best : null;
}

async function vmSetStripDevice(stripIndex, deviceName) {
  if (!vmConnected || !vmFns) return false;
  try {
    const vmDev = findVmDeviceName(deviceName);
    const param = vmDev ? `Strip[${stripIndex}].device.${vmDev.typeStr}` : `Strip[${stripIndex}].device.wdm`;
    const value = vmDev ? vmDev.name : deviceName.replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)\s*$/, '').trim();
    console.log(`[VM] Setting ${param} = "${value}"`);

    let result = -2;
    for (let i = 0; i < 30; i++) {
      try { vmFns.IsParametersDirty(); } catch(e) {}
      result = vmFns.SetParameterStringA(param, value);
      if (result === 0) break;
      if (result !== -2) break;
      if (i % 5 === 0) console.log(`[VM] Engine not ready (attempt ${i+1}/30)...`);
      await new Promise(r => setTimeout(r, 1000));
    }
    if (result !== 0) { console.log(`[VM] Set strip failed: ${result}`); return false; }
    for (let i = 0; i < 10; i++) { if (vmFns.IsParametersDirty() === 0) break; await new Promise(r => setTimeout(r, 50)); }
    console.log('[VM] Strip device set OK');
    return true;
  } catch(e) { console.error('[VM] vmSetStripDevice error:', e); return false; }
}

// Launch VoiceMeeter via the Remote API (preferred) or by spawning the exe
async function launchVoicemeeterSilent(vmPathOverride) {
  // Method 1: Use the Remote API's RunVoicemeeter function
  // This is the official way — it launches VM and connects in one step
  if (loadVmLibrary() && vmFns.RunVoicemeeter) {
    try {
      // RunVoicemeeter(type): 1=Voicemeeter, 2=Banana, 3=Potato
      const runResult = vmFns.RunVoicemeeter(1);
      console.log('[VM] RunVoicemeeter result:', runResult);
      if (runResult === 0) {
        // Now login
        const loginResult = vmFns.Login();
        console.log('[VM] Post-launch Login result:', loginResult);
        if (loginResult === 0 || loginResult === -2) {
          vmConnected = true;
          // Wait for VM to be ready
          const ready = await waitForVmReady(30000);
          console.log('[VM] Ready after RunVoicemeeter:', ready);
          return { success: true, method: 'api' };
        }
      }
    } catch(e) {
      console.log('[VM] RunVoicemeeter failed:', e.message);
    }
  }

  // Method 2: Spawn the exe directly (fallback)
  const vmPath = vmPathOverride || findVoicemeeterExe();
  if (!vmPath || !fs.existsSync(vmPath)) {
    return { success: false, error: 'VoiceMeeter executable not found. Use VM Path to set it.' };
  }

  try {
    const proc = spawn(vmPath, [], { detached: true, stdio: 'ignore', windowsHide: true });
    proc.unref();

    // Wait for VM to start and become connectable
    let connected = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      const result = connectVoicemeeterRemote();
      if (result.success) { connected = true; break; }
    }

    if (!connected) {
      return { success: false, error: 'VoiceMeeter launched but could not connect via API' };
    }

    const ready = await waitForVmReady(30000);
    console.log('[VM] Ready after exe launch:', ready);

    hideVoicemeeterWindow();

    return { success: true, method: 'exe' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// Auto-launch and connect VoiceMeeter on app startup
async function autoSetupVoicemeeter() {
  const cfg = loadConfig();
  const conn = connectVoicemeeterRemote();
  if (conn.success) {
    const fresh = (conn.loginResult === 1);
    console.log(`[VM] Connected (loginResult=${conn.loginResult}, fresh=${fresh})`);
    const ready = await waitForVmReady(fresh ? 30000 : 15000);
    console.log('[VM] Engine ready:', ready);
    if (fresh) hideVoicemeeterWindow();
    safeSend('vm-status', { connected: true, running: true, ready });
    return;
  }
  const vmPath = cfg.voicemeeterPath || findVoicemeeterExe();
  if (vmPath) {
    console.log('[VM] Auto-launching from:', vmPath);
    const result = await launchVoicemeeterSilent(vmPath);
    if (result.success && vmConnected) {
      const ready = await waitForVmReady(30000);
      console.log('[VM] Engine ready after auto-launch:', ready);
    }
    safeSend('vm-status', { connected: vmConnected, running: result.success, autoLaunched: true });
  } else {
    safeSend('vm-status', { connected: false, running: false });
  }
}

function hideVoicemeeterWindow() {
  try {
    const { exec } = require('child_process');
    // Write a temp .ps1 script to avoid nested quoting issues
    const tmpScript = path.join(app.getPath('temp'), 'vm_minimize.ps1');
    fs.writeFileSync(tmpScript, `
Start-Sleep -Milliseconds 2000
$procs = Get-Process | Where-Object { $_.ProcessName -match 'voicemeeter' }
foreach ($p in $procs) {
  if ($p.MainWindowHandle -ne 0) {
    Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Win32{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);}'
    [Win32]::ShowWindow($p.MainWindowHandle, 6)
  }
}
`);
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"`, { timeout: 10000, windowsHide: true }, (err) => {
      try { fs.unlinkSync(tmpScript); } catch(e) {}
      if (err) console.log('[VM] Minimize failed (non-critical):', err.message);
      else console.log('[VM] Window minimized');
    });
  } catch(e) { console.log('[VM] Minimize error:', e.message); }
}

// Clean up on exit
app.on('will-quit', () => {
  disconnectVoicemeeterRemote();
});

ipcMain.handle('vm-connect', async () => {
  const conn = connectVoicemeeterRemote();
  if (conn.success) await waitForVmReady(conn.loginResult === 1 ? 30000 : 10000);
  return { success: conn.success };
});

ipcMain.handle('vm-set-strip-device', async (_, { stripIndex, deviceName }) => {
  if (!vmConnected) { const c = connectVoicemeeterRemote(); if (!c.success) return { success: false, error: 'Not connected' }; }
  await waitForVmReady(15000);
  const ok = await vmSetStripDevice(stripIndex || 0, deviceName);
  return { success: ok, deviceName };
});

ipcMain.handle('vm-get-status', async () => {
  return {
    connected: vmConnected,
    dllFound: !!findVoicemeeterDll(),
    exeFound: !!(loadConfig().voicemeeterPath || findVoicemeeterExe()),
  };
});

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
  const result = await launchVoicemeeterSilent(vmPath);
  return result;
});

// ── IPC: read audio file as base64 for waveform rendering ──────────────
ipcMain.handle('read-audio-file', async (_, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', opus: 'audio/opus', aac: 'audio/aac', webm: 'audio/webm' };
    const mime = mimeMap[ext] || 'audio/mpeg';
    return { success: true, base64: data.toString('base64'), mime };
  } catch(e) {
    return { success: false, error: e.message };
  }
});
