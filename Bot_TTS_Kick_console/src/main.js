// src/main.js
import { app, shell, BrowserWindow, ipcMain } from 'electron';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { TTSBot } from './ttsBot.js';

import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPDATE_REPO_OWNER   = 'Pioxtex';
const UPDATE_REPO_NAME    = 'Kick_TTS_Reader';
const UPDATE_RELEASES_API = `https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest`;
const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest`;

const APP_DIR     = path.join(os.homedir(), 'Documents', 'KickTTSBot');
const CONFIG_PATH = path.join(APP_DIR, 'settings.json');

let mainWindow = null;
let panelWindow = null;
let bot = null;

/** HELPER do porówniania semver */
function cmpSemver(a, b) {
  const pa = String(a).replace(/^v/,'').split('.').map(n=>parseInt(n||'0',10));
  const pb = String(b).replace(/^v/,'').split('.').map(n=>parseInt(n||'0',10));
  for (let i=0;i<Math.max(pa.length,pb.length);i++){
    const x = pa[i]||0, y = pb[i]||0;
    if (x>y) return 1; if (x<y) return -1;
  }
  return 0;
}

/** Pobieranie "latest" */
function fetchLatestRelease() {
  return new Promise((resolve,reject)=>{
    const req = https.request(UPDATE_RELEASES_API, {
      method: 'GET',
      headers: { 'User-Agent': 'KickTTSBot-Updater' }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** IPC do panelu */
ipcMain.handle('update:check', async () => {
  try {
    const current = app.getVersion();
    const rel = await fetchLatestRelease();
    const latest = rel.tag_name || rel.name || '0.0.0';
    const hasUpdate = cmpSemver(latest, current) > 0;
    return {
      ok: true,
      current, latest, hasUpdate,
      url: UPDATE_RELEASES_URL,
      body: rel.body || ''
    };
  } catch (e) {
    return { ok:false, error: e?.message || String(e) };
  }
});

ipcMain.handle('update:open', (_e, url) => {
  try {
    shell.openExternal(url || UPDATE_RELEASES_URL);
    return true;
  } catch {
    return false;
  }
});

/** Odczyt nazwy uzytkownika z settings.json */
ipcMain.handle('cfg:getLastChannel', () => {
    try {
      fs.mkdirSync(APP_DIR, { recursive: true });
      if (!fs.existsSync(CONFIG_PATH)) return '';
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const cfg = JSON.parse(raw);
      return cfg.lastChannel || '';
    } catch {
    return '';
  }
});

/** Zapis nazwy uzytkownika */
ipcMain.handle('cfg:setLastChannel', (_e, ch) => {
  try {
    fs.mkdirSync(APP_DIR, { recursive: true });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
    cfg.lastChannel = String(ch || '');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
});

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
