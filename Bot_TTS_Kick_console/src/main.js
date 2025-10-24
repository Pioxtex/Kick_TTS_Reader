// src/main.js
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TTSBot } from './ttsBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let panelWindow = null;
let bot = null;

/** Bezpieczne IPC – nie wysyłaj do zniszczonych okien */
function safeSend(win, channel, payload) {
  try {
    if (!win) return;
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
    const wc = win.webContents;
    if (!wc) return;
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return;
    wc.send(channel, payload);
  } catch {
    // cicho ignorujemy – okno mogło zniknąć w międzyczasie
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 740,
    title: 'Kick TTS Reader by Pioxtex',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) { panelWindow.focus(); return; }
  panelWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    title: 'Kick TTS Reader by Pioxtex - Panel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  panelWindow.loadFile(path.join(__dirname, 'panel.html'));
  panelWindow.on('closed', () => { panelWindow = null; });
}

app.whenReady().then(() => {
  createMainWindow();
  // openPanelWindow(); // jeśli chcesz, by panel startował od razu

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ───────────────────── IPC: BOT CORE ───────────────────── */

ipcMain.handle('bot:start', async (_e, { channel, options }) => {
  if (!channel) throw new Error('Brak kanalu');

  if (bot) {
    try { await bot.stop(); } catch {}
    bot = null;
  }

  // ── routing logów ──────────────────────────────
  const routeLog = (raw) => {
    const msg = String(raw || '');
    const toPanelOnly = msg.startsWith('[opts]') || msg.startsWith('[voice]');
    if (toPanelOnly) {
      safeSend(panelWindow, 'bot:log', msg);
    } else {
      safeSend(mainWindow,  'ui:log',  msg);
      safeSend(panelWindow, 'bot:log', msg);
    }
  };
  // ───────────────────────────────────────────────

  bot = new TTSBot(
    (text) => routeLog(text),
    (state) => {
      const s = String(state);
      safeSend(mainWindow,  'ui:state', s);
      safeSend(panelWindow, 'bot:state', s);
    },
    (muted) => {
      const m = !!muted;
      safeSend(mainWindow,  'ui:muted', m);
      safeSend(panelWindow, 'bot:muted', m);
    }
  );

  try {
    await bot.start(channel, options || {});
    return true;
  } catch (e) {
    const msg = 'Start error: ' + (e?.message || e);
    safeSend(mainWindow,  'ui:log', msg);
    safeSend(panelWindow, 'bot:log', msg);
    return false;
  }
});

ipcMain.handle('bot:stop', async () => {
  if (bot) {
    try { await bot.stop(); } catch {}
    bot = null;
  }
  return true;
});

ipcMain.handle('bot:toggleMute', async () => bot?.toggleMute() ?? false);
ipcMain.handle('bot:skip',       async () => bot?.skip() ?? false);

/* ───────────────────── IPC: OPCJE / GŁOSY ───────────────────── */

ipcMain.handle('bot:getOptions', async () => bot?.getOptions?.() ?? null);

ipcMain.handle('bot:setOption', async (_e, { key, value }) => {
  try { return bot?.setOption?.(key, value) ?? false; }
  catch { return false; }
});

ipcMain.handle('bot:setVoice', async (_e, name) => {
  try { bot?.setVoice?.(name); return true; }
  catch { return false; }
});

ipcMain.handle('bot:listVoices', async () => {
  try { return bot?.listVoices?.() ?? []; }
  catch { return []; }
});

/* ───────────────────── IPC: PANEL ───────────────────── */

ipcMain.handle('panel:open', async () => { openPanelWindow(); return true; });
