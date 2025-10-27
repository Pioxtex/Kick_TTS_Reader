// ttsBot.js — refactor czytelnościowy, bez zmiany działania
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import Filter from 'bad-words';
import { spawn } from 'node:child_process';
import say from 'say';
import { createClient } from '@retconned/kick-js';

const isWin = process.platform === 'win32';

// ─────────────── Ścieżki aplikacji ───────────────
const APP_DIR     = path.join(os.homedir(), 'Documents', 'KickTTSBot');
const CONFIG_PATH = path.join(APP_DIR, 'settings.json');

// ─────────────── Domyślne opcje (zamrożone) ───────────────
const defaults = Object.freeze({
  maxLen: 220,
  rate: 0.8,
  volume: 100,
  chunking: true,
  maxQueue: 60,
  readCommands: true,
  speakTtsCommands: false,
  speakBotCommands: false,
  profanity: true,
  skipBots: true,
  prefix: '{user} - ',
  voiceName: '',
  rememberSettings: true,
  userCooldownMs: 5000,
  dedupWindowMs: 30000,
  lastChannel: "",
  allowedUsers: []
});

// ─────────────── Wulgaryzmy (PL + fuzzy) ───────────────
const POLISH_BAD_BASE = [
  'kurwa','chuj','huj','jeb','pierd','spier','zajeb','dziw','suka',
  'pizd','kutas','cip','debil','idiot','fuck','shit','bitch'
];
const POLISH_FUZZY_RX = POLISH_BAD_BASE.map(w => new RegExp(w.split('').join('\\s*'), 'i'));

// ─────────────── Plik konfig ───────────────
function ensureSettingsFolder() {
  try { fs.mkdirSync(APP_DIR, { recursive: true }); } catch {}
}
function ensureSettingsFile() {
  try {
    ensureSettingsFolder();
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf8');
      console.log('[config] created defaults:', CONFIG_PATH);
    }
  } catch (e) {
    console.error('[config] create failed:', e?.message || e);
  }
}
function loadConfig() {
  try {
    ensureSettingsFile();
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[config] load failed, using defaults:', e?.message || e);
    return { ...defaults };
  }
}
function saveConfig(obj) {
  try {
    ensureSettingsFolder();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[config] save failed:', e?.message || e);
    return false;
  }
}

// ─────────────── Helpers ───────────────
function mapRateToSapi(rate) {
  const clamped = Math.max(0.5, Math.min(2.0, Number(rate) || 0.9));
  return Math.round((clamped - 1.0) * 5);
}
function removePolishChars(text) {
  const map = {'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z',
               'Ą':'A','Ć':'C','Ę':'E','Ł':'L','Ń':'N','Ó':'O','Ś':'S','Ź':'Z','Ż':'Z'};
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, ch => map[ch] || ch);
}
function sanitizeOpts(inp = {}) {
  const out = { ...defaults, ...inp };
  out.maxLen            = Math.max(20, Math.min(500, Number(out.maxLen)      || defaults.maxLen));
  out.rate              = Math.max(0.5, Math.min(2.0, Number(out.rate)       || defaults.rate));
  out.volume            = Math.max(0,   Math.min(100, Number(out.volume)     || defaults.volume));
  out.maxQueue          = Math.max(1,   Math.min(200, Number(out.maxQueue)   || defaults.maxQueue));
  out.userCooldownMs    = Math.max(0,   Math.min(120000, Number(out.userCooldownMs) || defaults.userCooldownMs));
  out.dedupWindowMs     = Math.max(0,   Math.min(300000, Number(out.dedupWindowMs)  || defaults.dedupWindowMs));
  out.chunking          = !!out.chunking;
  out.profanity         = !!out.profanity;
  out.skipBots          = !!out.skipBots;
  out.readCommands      = !!out.readCommands;
  out.speakTtsCommands  = out.speakTtsCommands !== false;
  out.speakBotCommands  = !!out.speakBotCommands;
  out.prefix            = (typeof out.prefix === 'string') ? out.prefix : defaults.prefix;
  out.voiceName         = (typeof out.voiceName === 'string') ? out.voiceName : '';
  if (!Array.isArray(out.allowedUsers)) out.allowedUsers = [];
  return out;
}
function prepForTTS(text, maxLen, profanityFilter, filter) {
  let t = (text || '')
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')
    .replace(/:\w+:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

  t = removePolishChars(t);

  if (/(.)\1{9,}/.test(t)) return '';
  t = t.replace(/([!?.,])\1{1,}/g, '$1').replace(/\s{2,}/g, ' ').trim();
  if (t.length < 3) return '';

  if (profanityFilter) {
    for (const rx of POLISH_FUZZY_RX) {
      try { t = t.replace(rx, m => '*'.repeat(Math.max(4, m.length))); } catch {}
    }
    try { t = filter.clean(t); } catch {}
  }
  if (t && !/[.?!]$/.test(t)) t += '.';
  return t;
}
function chunk(text, maxLen = 140) {
  const parts = text.split(/([.?!,])/).reduce((acc, cur) => {
    if (/[.?!,]/.test(cur)) acc[acc.length - 1] += cur;
    else if (cur.trim()) acc.push(cur.trim());
    return acc;
  }, []);
  const out = []; let buf = '';
  for (const p of parts) {
    const cand = (buf ? buf + ' ' : '') + p;
    if (cand.length > maxLen) { if (buf) out.push(buf); buf = p; } else { buf = cand; }
  }
  if (buf) out.push(buf);
  return out;
}

// ─────────────── Klasa bota ───────────────
export class TTSBot {
  constructor(onLog, onState, onMuted) {
    this.onLog   = onLog   || (() => {});
    this.onState = onState || (() => {});
    this.onMuted = onMuted || (() => {});

    globalThis.__ttsOnLog = this.onLog;

    this.client    = null;
    this.queue     = [];
    this.vipQueue  = [];
    this.running   = false;
    this.paused    = false;
    this.currentPS = null;

    this.userLastTs   = new Map();
    this.recentHashes = new Map();

    const saved = loadConfig();
    this.opts = sanitizeOpts({ ...defaults, ...saved });

    this.filter = new Filter({ placeHolder: '*' });
    try { this.filter.addWords(...POLISH_BAD_BASE); } catch {}

    this.ignoredBots   = ['streamlabs','nightbot','moobot','streamelements','fossabot','cloudbot'];
    this.ignoredBotsLC = this.ignoredBots.map(b => b.toLowerCase());

    this._savePending  = null;
    this._saveDebounced = (obj) => {
      clearTimeout(this._savePending);
      this._savePending = setTimeout(() => saveConfig(sanitizeOpts(obj)), 400);
    };
  }

  // Normalizacja nazwy usera
  _normName(s) {
    return String(s || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[@\s]+/g, '')
      .toLowerCase();
  }
  _getUsername(msg) {
    return (
      msg?.sender?.username ||
      msg?.sender?.user?.username ||
      msg?.user?.username ||
      msg?.sender?.slug ||
      msg?.sender?.name ||
      'anon'
    ) + '';
  }
  _isModOrOwner(msg) {
    const s = msg?.sender || {};
    if (s.is_broadcaster || s.is_owner || s.is_moderator || s.is_admin || s.is_streamer) return true;

    const user = this._getUsername(msg).toLowerCase();
    if (this.channel && user && this.channel.toLowerCase() === user) return true;

    const arrays = [ s.roles, s.role, s.user_roles, s.badges, s.identity?.badges ].filter(Boolean);
    for (const arr of arrays) {
      for (const it of arr) {
        const v = (typeof it === 'string' ? it : (it?.type || it?.name || it?.slug || '')).toString().toLowerCase();
        if (!v) continue;
        if (v.includes('broadcaster') || v.includes('owner') || v.includes('streamer') || v.includes('moderator') || v.includes('admin')) {
          return true;
        }
      }
    }
    return false;
  }

  async start(channel, options = {}) {
    const disk = sanitizeOpts(loadConfig());
    this.opts = sanitizeOpts({ ...this.opts, ...disk, ...options });

    this.channel = String(channel || '');
    try { this.setOption('lastChannel', this.channel); } catch {}

    try { this._cfgWatcher?.close?.(); } catch {}
    try {
      this._cfgWatcher = fs.watch(CONFIG_PATH, { persistent: false }, () => {
        try {
          const fresh = sanitizeOpts(loadConfig());
          this.opts = { ...this.opts, ...fresh };
        } catch {}
      });
    } catch {}

    if (this.opts.rememberSettings) this._saveDebounced(this.opts);

    await this._connectWithBackoff(channel);

    this.running = true;
    this.onState('Dziala');
    this._consumeLoop();
  }

  async _connectWithBackoff(channel) {
    let delay = 1000;
    const max = 30000;

    const connectOnce = async () => {
      this.onState('Laczenie...');
      this.onLog('[init] Kanal: ' + channel);
      this.client = createClient(channel, { logger: false, readOnly: true });

      this.client.on('ready',      () => { this.onLog('Polaczono z czatem.'); delay = 1000; });
      this.client.on('error',      (e) => this.onLog('Blad klienta: ' + (e?.message || e)));
      this.client.on('disconnect', () => this.onLog('[ws] disconnect'));
      this.client.on('close',      () => this.onLog('[ws] close'));

      this.client.on('ChatMessage', (msg) => {
        try {
          const user = this._getUsername(msg);
          const raw0 = msg?.content ? String(msg.content) : '';
          if (!raw0) return;

          const raw = raw0.normalize('NFKC');
          const low = raw.toLowerCase().trim();
          const u   = user.toLowerCase();

          const isCommand = low.startsWith('!');
          const isBotUser = this.ignoredBotsLC.some(b => u.includes(b));
          const isMod     = this._isModOrOwner(msg);

          // Whitelist (opcjonalny)
          if (Array.isArray(this.opts.allowedUsers) && this.opts.allowedUsers.length) {
            const wl = this.opts.allowedUsers.map(x => String(x).toLowerCase());
            if (!wl.includes(u)) return;
          }

          // PRIORYTET 1: !tts
          if (low.startsWith('!tts')) {
            const rest = raw.slice(raw.toLowerCase().indexOf('!tts') + 4).trim();
            if (rest) {
              const [sub0, ...tail] = rest.split(/\s+/);
              const sub = (sub0 || '').toLowerCase();
              const adminSet = new Set(['mute','unmute','toggle','skip','clear','status','rate','volume','maxqueue','voice','prefix']);
              if (adminSet.has(sub)) {
                if (!isMod) {
                  const s = msg?.sender || {};
                  const brief = {
                    user,
                    booleans: {
                      is_broadcaster: !!s.is_broadcaster,
                      is_owner:       !!s.is_owner,
                      is_moderator:   !!s.is_moderator,
                      is_admin:       !!s.is_admin,
                      is_streamer:    !!s.is_streamer,
                    },
                    hasRolesArrays: !!(s.roles || s.role || s.user_roles || s.badges || (s.identity && s.identity.badges) || s.chat_roles),
                    matchChannel: this._normName(user) === this._normName(this.channel),
                    inAllowed: Array.isArray(this.opts.allowedUsers) && this.opts.allowedUsers.map(x => this._normName(x)).includes(this._normName(user))
                  };
                  this.onLog('[cmd] ' + user + ' próbuje "' + sub + '", brak uprawnień | perms=' + JSON.stringify(brief));
                  return;
                }
                this._handleCommand(msg, rest);
                return;
              }
            }

            if (!this.opts.readCommands) return;
            if (!this.opts.speakTtsCommands) return;
            if (!this._shouldAccept(u, rest || '')) return;

            const text = prepForTTS(rest || '', this.opts.maxLen, this.opts.profanity, this.filter);
            if (!text) return;

            const prefix = (this.opts.prefix || '{user} ');
            const out = prefix.replace('{user}', user).replace(/(?<!\s)$/, ' ') + text;
            const isVip = !!(msg?.sender?.is_subscriber || msg?.sender?.is_moderator || msg?.sender?.is_affiliate);
            this.enqueue(out, isVip);
            return;
          }

          // PRIORYTET 2: inne komendy
          if (isCommand) return;

          // PRIORYTET 3: zwykłe wiadomości (filtr botów)
          if (isBotUser && this.opts.skipBots) return;
          if (!this._shouldAccept(u, raw)) return;

          const text = prepForTTS(raw, this.opts.maxLen, this.opts.profanity, this.filter);
          if (!text) return;

          const prefix = (this.opts.prefix || '{user} ');
          const out = prefix.replace('{user}', user).replace(/(?<!\s)$/, ' ') + text;
          const isVip = !!(msg?.sender?.is_subscriber || msg?.sender?.is_moderator || msg?.sender?.is_affiliate);
          this.enqueue(out, isVip);
        } catch (e) {
          this.onLog('Blad parsowania wiadomosci: ' + (e?.message || e));
        }
      });

      if (typeof this.client.connect === 'function') {
        try { await this.client.connect(); }
        catch (e) { this.onLog('[ws] connect error: ' + (e?.message || e)); throw e; }
      }
    };

    while (true) {
      try { await connectOnce(); break; }
      catch {
        this.onLog(`[ws] retry in ${Math.round(delay/1000)}s`);
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(max, delay * 2);
      }
    }
  }

  _handleCommand(msg, argLine) {
    const user = this._getUsername(msg);
    const line = (argLine || '').trim();
    if (!line) return;

    const parts = line.split(/\s+/);
    const sub   = (parts.shift() || '').toLowerCase();
    const rest  = parts.join(' ');

    switch (sub) {
      case 'mute': {
        if (!this.paused) {
          this.paused = true;
          try { this.currentPS?.kill(); } catch {}
          this.currentPS = null;
          this.onMuted?.(true);
        }
        this.onLog('[cmd] TTS: MUTE (by ' + user + ')');
        return;
      }
      case 'unmute': {
        if (this.paused) { this.paused = false; this.onMuted?.(false); }
        this.onLog('[cmd] TTS: UNMUTE (by ' + user + ')');
        return;
      }
      case 'toggle': {
        this.paused = !this.paused;
        if (this.paused) { try { this.currentPS?.kill(); } catch {} this.currentPS = null; }
        this.onMuted?.(this.paused);
        this.onLog('[cmd] TTS: TOGGLE -> ' + (this.paused ? 'MUTED' : 'ON') + ' (by ' + user + ')');
        return;
      }
      case 'skip': {
        this.skip();
        this.onLog('[cmd] SKIP (by ' + user + ')');
        return;
      }
      case 'clear': {
        this.queue = [];
        this.vipQueue = [];
        this.onLog('[cmd] CLEAR QUEUE (by ' + user + ')');
        return;
      }
      case 'status': {
        const info = {
          paused: this.paused,
          rate: this.opts.rate,
          volume: this.opts.volume,
          maxQueue: this.opts.maxQueue,
          queued: (this.vipQueue?.length || 0) + (this.queue?.length || 0),
          vipQueued: this.vipQueue?.length || 0,
          voice: this.opts.voiceName || '(domyślny)',
          speakTtsCommands: this.opts.speakTtsCommands,
          readCommands: this.opts.readCommands,
          prefix: this.opts.prefix || '{user} '
        };
        this.onLog('[cmd] STATUS ' + JSON.stringify(info));
        return;
      }
      case 'rate': {
        const n = Number(rest);
        if (!Number.isFinite(n) || n < 0.5 || n > 2.0) { this.onLog('[cmd] rate: podaj 0.5–2.0, np. "!tts rate 1.1"'); return; }
        this.setOption('rate', n);
        this.onLog('[cmd] rate -> ' + n + ' (wejdzie od następnej kwestii)');
        return;
      }
      case 'volume': {
        const n = Number(rest);
        if (!Number.isFinite(n) || n < 0 || n > 100) { this.onLog('[cmd] volume: podaj 0–100, np. "!tts 85"'); return; }
        this.setOption('volume', n);
        this.onLog('[cmd] volume -> ' + n + ' (wejdzie od następnej kwestii)');
        return;
      }
      case 'maxqueue': {
        const n = Number(rest);
        if (!Number.isFinite(n) || n < 1 || n > 200) { this.onLog('[cmd] maxqueue: 1–200'); return; }
        this.setOption('maxQueue', n);
        this.onLog('[cmd] maxQueue -> ' + n);
        return;
      }
      case 'voice': {
        const name = rest.trim();
        if (!name) { this.onLog('[cmd] voice: podaj nazwę'); return; }
        this.setVoice(name);
        this.onLog('[cmd] voice -> ' + name);
        return;
      }
      case 'prefix': {
        const val = rest;
        if (!val) { this.onLog('[cmd] prefix: np. "!tts prefix {user}: "'); return; }
        this.setOption('prefix', val);
        this.onLog('[cmd] prefix -> ' + JSON.stringify(val));
        return;
      }
      default: {
        if (!this.opts.speakTtsCommands) return;
        const text = prepForTTS(line, this.opts.maxLen, this.opts.profanity, this.filter);
        if (!text) return;
        const prefix = (this.opts.prefix || '{user} ');
        const out = prefix.replace('{user}', user).replace(/(?<!\s)$/, ' ') + text;
        const isVip = !!(msg?.sender?.is_subscriber || msg?.sender?.is_moderator || msg?.sender?.is_affiliate);
        this.enqueue(out, isVip);
        return;
      }
    }
  }

  _shouldAccept(userLC, raw) {
    const now = Date.now();

    const last = this.userLastTs.get(userLC) || 0;
    if (now - last < (this.opts.userCooldownMs || 0)) return false;
    this.userLastTs.set(userLC, now);

    const h = raw.toLowerCase().slice(0, 200);
    const prev = this.recentHashes.get(h) || 0;
    if (now - prev < (this.opts.dedupWindowMs || 0)) return false;
    this.recentHashes.set(h, now);

    if (this.recentHashes.size > 1000) {
      const cut = now - (this.opts.dedupWindowMs || 0);
      for (const [k, ts] of this.recentHashes.entries()) if (ts < cut) this.recentHashes.delete(k);
    }
    return true;
  }

  async stop() {
    this.running = false;
    this.paused  = false;
    try { this.currentPS?.kill(); } catch {}
    this.currentPS = null;

    try {
      if (this.client?.destroy) await this.client.destroy();
      else if (this.client?.disconnect) await this.client.disconnect();
    } catch {}
    this.client = null;

    this.queue = [];
    this.vipQueue = [];
    try { this._cfgWatcher?.close?.(); } catch {}

    this.onState('Idle');
  }

  toggleMute() {
    this.paused = !this.paused;
    if (this.paused) { try { this.currentPS?.kill(); } catch {} this.currentPS = null; this.onLog('[mute] Wyciszono'); }
    else { this.onLog('[mute] Odblokowano'); }
    this.onMuted(this.paused);
    return this.paused;
  }

  skip() {
    if (this.currentPS) { try { this.currentPS.kill(); } catch {} this.currentPS = null; this.onLog('[skip] Pominięto bieżącą wiadomość'); return true; }
    this.onLog('[skip] Brak aktywnej wiadomości'); return false;
  }

  enqueue(text, isVip = false) {
    const q = isVip ? this.vipQueue : this.queue;
    const maxQ = Math.max(1, this.opts.maxQueue || 60);
    if (q.length >= maxQ) q.shift();
    q.push(text);
  }
  _nextFromQueues() { return this.vipQueue.shift() ?? this.queue.shift(); }

  async _consumeLoop() {
    while (this.running) {
      if (this.paused) { await new Promise(r => setTimeout(r, 80)); continue; }
      const next = this._nextFromQueues();
      if (!next) { await new Promise(r => setTimeout(r, 50)); continue; }
      try { await this._speakOne(next); }
      catch (e) { this.onLog('Blad TTS: ' + (e?.message || e)); }
    }
  }

  _speakOne(text) {
    const rate   = this.opts.rate;
    const vol    = this.opts.volume;
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
          try {
            this.currentPS = spawn('powershell.exe', ['-NoProfile','-Command',script], { stdio: ['pipe','ignore','ignore'] });
            this.currentPS.stdin.write(pieces[i]);
            this.currentPS.stdin.end();
            this.currentPS.on('close', () => { this.currentPS = null; setTimeout(() => playPieces(i + 1), 60); });
            this.currentPS.on('error', (e) => { throw e; });
          } catch (e) {
            this.onLog('[TTS] SAPI fallback -> say: ' + (e?.message || e));
            try { say.stop(); } catch {}
            const voiceArg = this.opts.voiceName || undefined;
            say.speak(pieces[i], voiceArg, rate, () => setTimeout(() => playPieces(i + 1), 60));
          }
        } else {
          try { say.stop(); } catch {}
          const voiceArg = this.opts.voiceName || undefined;
          say.speak(pieces[i], voiceArg, rate, () => setTimeout(() => playPieces(i + 1), 60));
        }
      };
      playPieces(0);
    });
  }

  // Głosy i opcje
  setVoice(name) {
    this.opts.voiceName = String(name || '');
    if (this.opts.rememberSettings) this._saveDebounced(this.opts);
    this.onLog('[voice] Ustawiono glos: ' + (this.opts.voiceName || '(domyslny)'));
  }
  async listVoices() {
    if (!isWin) { this.onLog('[voice] Lista glosow zalezy od systemu (say).'); return []; }
    return new Promise((resolve) => {
      const ps = spawn('powershell.exe', ['-NoProfile','-Command','$v=New-Object -ComObject SAPI.SpVoice; $v.GetVoices()|%{$_.GetDescription()}'],
        { stdio: ['ignore','pipe','ignore'] });
      const out = [];
      ps.stdout.on('data', b => { out.push(...b.toString('utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)); });
      ps.on('close', () => { this.onLog('[voice] Glosy: ' + (out.join(', ') || '(brak)')); resolve(out); });
    });
  }
  setOption(key, value) {
    if (!((key in this.opts) || (key in defaults))) return false;
    const next = sanitizeOpts({ ...this.opts, [key]: value });
    this.opts = next;
    if (this.opts.rememberSettings) this._saveDebounced(this.opts);
    this.onLog('[opts] ' + key + ' = ' + JSON.stringify(this.opts[key]));
    return true;
  }
  getOptions() { return { ...this.opts }; }
}
