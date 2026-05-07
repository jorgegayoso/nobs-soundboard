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
    };
    console.log('[VM] Library loaded from:', dllPath);
    return true;
  } catch(e) {
    console.log('[VM] Failed to load library:', e.message);
    return false;
  }
}

function connectVoicemeeterRemote() {
  if (vmConnected) return true;
  if (!loadVmLibrary()) return false;

  try {
    const loginResult = vmFns.Login();
    console.log('[VM] Login result:', loginResult);
    // 0 = OK (VM running), 1 = OK (VM not running, will launch), -1 = error, -2 = already logged in
    if (loginResult === -2) {
      // Already logged in from a previous attempt
      vmConnected = true;
      // Drain dirty flag
      try { vmFns.IsParametersDirty(); } catch(e) {}
      return true;
    }
    if (loginResult !== 0 && loginResult !== 1) {
      console.log('[VM] Login failed with code:', loginResult);
      return false;
    }

    vmConnected = true;

    // CRITICAL: Must call IsParametersDirty() after login to acknowledge initial state.
    // The API won't apply parameter changes until the dirty flag has been read at least once.
    // Give VM a moment to initialize its internal state, then drain.
    try { vmFns.IsParametersDirty(); } catch(e) {}

    console.log('[VM] Connected successfully');
    return true;
  } catch (e) {
    console.log('[VM] Connection error:', e.message);
    return false;
  }
}

function disconnectVoicemeeterRemote() {
  if (vmConnected && vmFns) {
    try { vmFns.Logout(); } catch(e) {}
    vmConnected = false;
  }
}

// Wait for VoiceMeeter to be fully ready (parameters readable)
function waitForVmReady(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!vmConnected || !vmFns) { resolve(false); return; }
      try {
        // Try reading a parameter — if VM engine is ready this returns 0
        const koffi = require('koffi');
        const buf = Buffer.alloc(4);
        const result = vmFns.GetParameterFloat('Strip[0].Mute', buf);
        if (result === 0) {
          // Drain dirty flag one more time
          vmFns.IsParametersDirty();
          resolve(true);
          return;
        }
      } catch(e) {}
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 500);
    };
    check();
  });
}

function vmSetStripDevice(stripIndex, deviceName) {
  if (!vmConnected || !vmFns) {
    console.log('[VM] Not connected, cannot set strip device');
    return false;
  }
  try {
    // Drain any pending dirty state first
    vmFns.IsParametersDirty();

    const param = `Strip[${stripIndex}].device.wdm`;
    console.log(`[VM] Setting ${param} = "${deviceName}"`);
    const result = vmFns.SetParameterStringA(param, deviceName);
    console.log(`[VM] SetParameterStringA result: ${result}`);

    if (result !== 0) {
      // result -1 = error, -2 = no server, -3 = unknown param, -5 = structure mismatch
      console.log(`[VM] SetParameterStringA failed with code ${result}`);
      return false;
    }

    // CRITICAL: Must call IsParametersDirty() after setting parameters
    // to signal VoiceMeeter to apply the changes
    let dirty = vmFns.IsParametersDirty();
    console.log(`[VM] IsParametersDirty after set: ${dirty}`);

    // Poll a few times to ensure VM processes the change
    let retries = 10;
    while (retries > 0) {
      dirty = vmFns.IsParametersDirty();
      if (dirty === 0) break; // 0 = no more pending changes, all applied
      retries--;
      // Small sync delay — we need the change to propagate
      const end = Date.now() + 50;
      while (Date.now() < end) {} // busy-wait 50ms (sync context)
    }

    return true;
  } catch(e) {
    console.error('[VM] SetParameterString error:', e);
    return false;
  }
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
          const ready = await waitForVmReady(10000);
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
      if (connectVoicemeeterRemote()) {
        connected = true;
        break;
      }
    }

    if (!connected) {
      return { success: false, error: 'VoiceMeeter launched but could not connect via API' };
    }

    // Wait for the engine to be ready
    const ready = await waitForVmReady(10000);
    console.log('[VM] Ready after exe launch:', ready);

    // Try to hide the window
    try {
      const { execSync } = require('child_process');
      // SW_HIDE = 0 hides the window completely, SW_MINIMIZE = 6 just minimizes
      const psCmd = `
        Start-Sleep -Milliseconds 500;
        $procs = Get-Process | Where-Object { $_.ProcessName -match 'voicemeeter' };
        foreach ($p in $procs) {
          if ($p.MainWindowHandle -ne 0) {
            Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Win32{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);}';
            [Win32]::ShowWindow($p.MainWindowHandle, 0);
          }
        }
      `.replace(/\n/g, ' ');
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 8000, windowsHide: true });
    } catch(e) { console.log('[VM] Hide window failed (non-critical):', e.message); }

    return { success: true, method: 'exe' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// Auto-launch and connect VoiceMeeter on app startup
async function autoSetupVoicemeeter() {
  const cfg = loadConfig();

  // Step 1: Try to connect (VM may already be running)
  if (connectVoicemeeterRemote()) {
    console.log('[VM] Already running, connected on startup');
    await waitForVmReady(5000);
    // Notify renderer that VM is ready
    mainWindow?.webContents.send('vm-status', { connected: true, running: true });
    return;
  }

  // Step 2: Auto-launch VoiceMeeter if we can find it
  const vmPath = cfg.voicemeeterPath || findVoicemeeterExe();
  if (vmPath) {
    console.log('[VM] Auto-launching from:', vmPath);
    const result = await launchVoicemeeterSilent(vmPath);
    console.log('[VM] Auto-launch result:', result);
    mainWindow?.webContents.send('vm-status', {
      connected: vmConnected,
      running: result.success,
      autoLaunched: true
    });
  } else {
    console.log('[VM] No VoiceMeeter exe found, skipping auto-launch');
    mainWindow?.webContents.send('vm-status', { connected: false, running: false });
  }
}

// Clean up on exit
app.on('will-quit', () => {
  disconnectVoicemeeterRemote();
});

ipcMain.handle('vm-connect', async () => {
  const ok = connectVoicemeeterRemote();
  if (ok) {
    await waitForVmReady(5000);
    // Drain dirty flag
    try { vmFns.IsParametersDirty(); } catch(e) {}
  }
  return { success: ok };
});

ipcMain.handle('vm-set-strip-device', async (_, { stripIndex, deviceName }) => {
  if (!vmConnected) connectVoicemeeterRemote();
  if (!vmConnected) return { success: false, error: 'Not connected to Voicemeeter' };

  // Wait for VM to be ready before setting
  await waitForVmReady(3000);

  const ok = vmSetStripDevice(stripIndex || 0, deviceName);
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
