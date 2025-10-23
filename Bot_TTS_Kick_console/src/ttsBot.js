// TTS Bot – settings.json obok pliku, voice select, pamietanie ustawien, filtry PL + boty, usuwanie polskich znakow
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Filter from 'bad-words';
import { spawn } from 'node:child_process';
import say from 'say';
import { createClient } from '@retconned/kick-js';

const isWin = process.platform === 'win32';

// ─────────────── SETTINGS.JSON OBOK TEGO PLIKU ───────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'settings.json');

function ensureSettingsFile() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const defaults = {
        maxLen: 220,
        rate: 0.75,
        volume: 100,
        chunking: true,
        readCommands: false,
        profanity: true,
        skipBots: true,
        prefix: '{user} ',
        voiceName: '',
        rememberSettings: true
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf8');
      // console.log('[config] created defaults:', CONFIG_PATH);
    }
  } catch (e) {
    // console.error('[config] create failed:', e.message || e);
  }
}

function loadConfig() {
  ensureSettingsFile();
  try {
    const s = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(s);
  } catch (e) {
    // console.error('[config] load failed:', e.message || e);
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    // console.log('[config] saved:', CONFIG_PATH);
  } catch (e) {
    // console.error('[config] save failed:', e.message || e);
  }
}

// ─────────────── PROFANITY (PL + fuzzy) ───────────────
const POLISH_BAD_BASE = [
  'kurwa','chuj','huj','jeb','pierd','spier','zajeb','dziw','suka',
  'pizd','kutas','cip','debil','idiot','fuck','shit','bitch'
];
const POLISH_FUZZY_RX = POLISH_BAD_BASE.map(w => new RegExp(w.split('').join('\\s*'), 'i'));

// ─────────────── HELPERS ───────────────
function mapRateToSapi(rate) {
  const clamped = Math.max(0.5, Math.min(2.0, Number(rate) || 0.75));
  return Math.round((clamped - 1.0) * 5);
}

// ⬇️ nowa funkcja: PL diacritics -> ASCII
function removePolishChars(text) {
  const map = {
    'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z',
    'Ą':'A','Ć':'C','Ę':'E','Ł':'L','Ń':'N','Ó':'O','Ś':'S','Ź':'Z','Ż':'Z'
  };
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, ch => map[ch] || ch);
}

function prepForTTS(text, maxLen, profanityFilter, filter) {
  let t = (text || '')
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')
    .replace(/:\w+:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

  // ⬇️ konwersja PL -> ASCII, zanim pojda filtry / TTS
  t = removePolishChars(t);

  if (profanityFilter) {
    for (const rx of POLISH_FUZZY_RX) {
      try { t = t.replace(rx, (m) => '*'.repeat(Math.max(4, m.length))); } catch {}
    }
    try { t = filter.clean(t); } catch {}
  }

  if (t && !/[.?!]$/.test(t)) t += '.';
  return t;
}

function chunk(text, maxLen = 140) {
  const parts = text
    .split(/([.?!,])/)
    .reduce((acc, cur) => {
      if (/[.?!,]/.test(cur)) acc[acc.length - 1] += cur;
      else if (cur.trim()) acc.push(cur.trim());
      return acc;
    }, []);
  const out = [];
  let buf = '';
  for (const p of parts) {
    const candidate = (buf ? buf + ' ' : '') + p;
    if (candidate.length > maxLen) {
      if (buf) out.push(buf);
      buf = p;
    } else {
      buf = candidate;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ─────────────── KLASA BOT ───────────────
export class TTSBot {
  constructor(onLog, onState, onMuted) {
    this.onLog = onLog || (() => {});
    this.onState = onState || (() => {});
    this.onMuted = onMuted || (() => {});

    globalThis.__ttsOnLog = this.onLog;

    this.client = null;
    this.queue = [];
    this.running = false;
    this.paused = false;
    this.currentPS = null;

    // log sciezki i odczyt
    // this.onLog('[config] path: ' + CONFIG_PATH);
    const saved = loadConfig();
    // this.onLog('[config] loaded@ctor: ' + JSON.stringify(saved));

    // merge default + plik
    this.opts = {
      maxLen: 220,
      rate: 0.75,
      volume: 100,
      chunking: true,
      maxQueue: 60,
      readCommands: false,
      profanity: true,
      skipBots: true,
      prefix: '{user} ',
      voiceName: '',
      rememberSettings: true,
      ...saved
    };

    // this.onLog('[config] effective@ctor: ' + JSON.stringify(this.opts));

    // filter i boty
    this.filter = new Filter({ placeHolder: '*' });
    try { this.filter.addWords(...POLISH_BAD_BASE); } catch {}
    this.ignoredBots = ['streamlabs','nightbot','moobot','streamelements','fossabot','cloudbot'];
    this.ignoredBotsLC = this.ignoredBots.map(b => b.toLowerCase());
  }

  async start(channel, options = {}) {
    // ponownie wczytaj z dysku
    const disk = loadConfig();
    // this.onLog('[config] loaded@start: ' + JSON.stringify(disk));

    this.opts = { ...this.opts, ...disk, ...options };
    // this.onLog('[config] effective@start: ' + JSON.stringify(this.opts));

    // watcher zmian settings.json
    try { this._cfgWatcher?.close?.(); } catch {}
    try {
      this._cfgWatcher = fs.watch(CONFIG_PATH, { persistent: false }, () => {
        try {
          const fresh = loadConfig();
          this.opts = { ...this.opts, ...fresh };
          // this.onLog('[config] reloaded@watch: ' + JSON.stringify(fresh));
        } catch {}
      });
    } catch {}

    if (this.opts.rememberSettings) saveConfig(this.opts);

    this.onState('Laczenie...');
    this.onLog('[init] Kanal: ' + channel);

    this.client = createClient(channel, { logger: false, readOnly: true });
    this.client.on('ready', () => this.onLog('Polaczono z czatem.'));
    this.client.on('error', (e) => this.onLog('Blad klienta: ' + (e?.message || e)));

    this.client.on('ChatMessage', (msg) => {
      const user = msg?.sender?.username || 'anon';
      const raw = msg?.content || '';
      if (!raw) return;

      const u = user.toLowerCase();
      if (this.opts.skipBots && this.ignoredBotsLC.some(b => u.includes(b))) return;
      if (!this.opts.readCommands && raw.trim().startsWith('!')) return;

      const text = prepForTTS(raw, this.opts.maxLen, this.opts.profanity, this.filter);
      if (!text) return;

      const out = (this.opts.prefix || '{user} ').replace('{user}', user) + text;
      this.enqueue(out);
    });

    if (typeof this.client.connect === 'function') await this.client.connect();

    this.running = true;
    this.onState('Dziala');
    this._consumeLoop();
  }

  async stop() {
    this.running = false;
    this.paused = false;
    try { this.currentPS?.kill(); } catch {}
    this.currentPS = null;
    try {
      if (this.client?.destroy) await this.client.destroy();
      else if (this.client?.disconnect) await this.client.disconnect();
    } catch {}
    this.client = null;
    this.queue = [];
    this.onState('Idle');
  }

  toggleMute() {
    this.paused = !this.paused;
    if (this.paused) {
      try { this.currentPS?.kill(); } catch {}
      this.currentPS = null;
      this.onLog('[mute] Wyciszono');
    } else {
      this.onLog('[mute] Odblokowano');
    }
    this.onMuted(this.paused);
    return this.paused;
  }

  skip() {
    if (this.currentPS) {
      try { this.currentPS.kill(); } catch {}
      this.currentPS = null;
      this.onLog('[skip] Pominieto biezaca wiadomosc');
      return true;
    } else {
      this.onLog('[skip] Brak aktywnej wiadomosci');
      return false;
    }
  }

  enqueue(text) {
    const maxQ = Math.max(1, this.opts.maxQueue || 60);
    if (this.queue.length >= maxQ) this.queue.shift();
    this.queue.push(text);
  }

  async _consumeLoop() {
    while (this.running) {
      if (this.paused) { await new Promise(r => setTimeout(r, 80)); continue; }
      const next = this.queue.shift();
      if (!next) { await new Promise(r => setTimeout(r, 50)); continue; }
      try { await this._speakOne(next); }
      catch (e) { this.onLog('Blad TTS: ' + (e?.message || e)); }
    }
  }

  _speakOne(text) {
    const rate = Math.max(0.5, Math.min(2.0, Number(this.opts.rate) || 0.75));
    const vol  = Math.max(0, Math.min(100, Number(this.opts.volume) || 100));
    const pieces = this.opts.chunking ? chunk(text) : [text];
    this.onLog('[TTS] ' + text);

    return new Promise((resolve) => {
      const playPieces = (i = 0) => {
        if (i >= pieces.length) return resolve();
        if (this.paused || !this.running) return resolve();

        if (isWin) {
          const vname = String(this.opts.voiceName || '');
          const psVoice = vname
            ? `$target='${vname.replace(/'/g, "''")}'; $tok=$v.GetVoices()|Where-Object{$_.GetDescription()-like"*${vname}*"}|Select-Object -First 1; if($tok){$v.Voice=$tok;}`
            : '';
          const script = `$v=New-Object -ComObject SAPI.SpVoice; $v.Volume=${vol}; $v.Rate=${mapRateToSapi(rate)}; ${psVoice} $in=[Console]::In.ReadToEnd(); $v.Speak($in)|Out-Null;`;
          this.currentPS = spawn('powershell.exe', ['-NoProfile','-Command',script], { stdio: ['pipe','ignore','ignore'] });
          this.currentPS.stdin.write(pieces[i]);
          this.currentPS.stdin.end();
          this.currentPS.on('close', () => {
            this.currentPS = null;
            setTimeout(() => playPieces(i + 1), 60);
          });
        } else {
          try { say.stop(); } catch {}
          const voiceArg = this.opts.voiceName || undefined;
          say.speak(pieces[i], voiceArg, rate, () => setTimeout(() => playPieces(i + 1), 60));
        }
      };
      playPieces(0);
    });
  }

  // glosy & opcje
  setVoice(name) {
    this.opts.voiceName = String(name || '');
    if (this.opts.rememberSettings) saveConfig(this.opts);
    this.onLog('[voice] Ustawiono glos: ' + (this.opts.voiceName || '(domyslny)'));
  }

  async listVoices() {
    if (!isWin) {
      this.onLog('[voice] Lista glosow zalezy od systemu (say).');
      return [];
    }
    return new Promise((resolve) => {
      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-Command',
        '$v=New-Object -ComObject SAPI.SpVoice; $v.GetVoices()|%{$_.GetDescription()}'
      ], { stdio: ['ignore','pipe','ignore'] });
      const out = [];
      ps.stdout.on('data', (b) => {
        out.push(...b.toString('utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean));
      });
      ps.on('close', () => {
        this.onLog('[voice] Glosy: ' + (out.join(', ') || '(brak)'));
        resolve(out);
      });
    });
  }

  setOption(key, value) {
    if (!(key in this.opts)) return false;
    this.opts[key] = value;
    if (this.opts.rememberSettings) saveConfig(this.opts);
    this.onLog('[opts] ' + key + ' = ' + JSON.stringify(value));
    return true;
  }

  getOptions() { return { ...this.opts }; }
}
