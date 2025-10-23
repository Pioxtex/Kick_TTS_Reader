import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let win;

async function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'Kick TTS Reader by Pioxtex',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await win.loadFile(path.join(__dirname, 'renderer.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let bot = null;

ipcMain.handle('bot:start', async (_e, payload) => {
  const { channel, options } = payload;
  if (!channel) throw new Error('Brak kanalu');
  if (bot) { await bot.stop().catch(()=>{}); bot = null; }

  const mod = await import('./ttsBot.js');
  bot = new mod.TTSBot((text) => {
    win?.webContents.send('ui:log', text);
  }, (state) => {
    win?.webContents.send('ui:state', state);
  }, (muted) => {
    win?.webContents.send('ui:muted', muted);
  });
  try {
    await bot.start(channel, options);
    return true;
  } catch (e) {
    win?.webContents.send('ui:log', 'Start error: ' + (e?.message || e));
    return false;
  }
});

ipcMain.handle('bot:stop', async () => {
  if (bot) { await bot.stop().catch(()=>{}); bot = null; }
  return true;
});

ipcMain.handle('bot:toggleMute', async () => {
  if (!bot) return false;
  return bot.toggleMute();
});

ipcMain.handle('bot:skip', async () => {
  if (!bot) return false;
  return bot.skip();
});
