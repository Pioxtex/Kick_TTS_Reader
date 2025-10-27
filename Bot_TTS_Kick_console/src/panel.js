// panel.js — refactor czytelnościowy bez zmiany działania

// ──────────────────────────────────────────────────────────────
// DOM utils
const $ = (id) => document.getElementById(id);
const logBox   = $('log');
const updStatus = $('updStatus');
const btnCheck  = $('btnUpdCheck');
const btnGet    = $('btnUpdGet');

// ──────────────────────────────────────────────────────────────
// Log
function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  logBox.textContent += line + '\n';
  logBox.scrollTop = logBox.scrollHeight;
}

// ──────────────────────────────────────────────────────────────
// Update info
async function refreshUpdateInfo() {
  try {
    const res = await window.api.checkUpdate();
    if (!res?.ok) {
      updStatus.textContent = 'Błąd: ' + (res?.error || 'nieznany');
      btnGet.style.display = 'none';
      return;
    }
    const { current, latest, hasUpdate, url } = res;
    updStatus.textContent =
      `Wersja: ${current} | Najnowsza: ${latest}` +
      (hasUpdate ? '  — jest dostępna aktualizacja' : '  — aktualne');
    btnGet.style.display = hasUpdate ? 'inline-block' : 'none';
    btnGet.onclick = () => window.api.openUpdate(url);
  } catch {
    updStatus.textContent = 'Błąd sprawdzania aktualizacji';
    btnGet.style.display = 'none';
  }
}

// ──────────────────────────────────────────────────────────────
// Voices
async function reloadVoices(current) {
  const sel = $('voiceSelect');
  sel.innerHTML = '';
  const makeOpt = (value, text, selected = false) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = text; if (selected) o.selected = true;
    return o;
  };

  sel.appendChild(makeOpt('', '(domyślny)'));

  let voices = [];
  try { voices = await window.api.listVoices(); } catch {}
  (voices || []).forEach(v => {
    const selected = !!current && v.toLowerCase().includes(current.toLowerCase());
    sel.appendChild(makeOpt(v, v, selected));
  });
}

// ──────────────────────────────────────────────────────────────
// Options <-> UI
async function loadOptionsToUI() {
  const opts = await window.api.getOptions();
  if (!opts) { log('Brak instancji bota'); return; }

  const pick = (v, fallback) => (v ?? fallback);

  $('rate').value              = pick(opts.rate, 0.9);
  $('volume').value            = pick(opts.volume, 100);
  $('maxLen').value            = pick(opts.maxLen, 220);
  $('maxQueue').value          = pick(opts.maxQueue, 60);
  $('prefix').value            = pick(opts.prefix, '{user} ');
  $('skipBots').checked        = !!opts.skipBots;
  $('profanity').checked       = !!opts.profanity;
  $('readCommands').checked    = !!opts.readCommands;
  $('speakTtsCommands').checked= (opts.speakTtsCommands !== false);
  $('speakBotCommands').checked= !!opts.speakBotCommands;

  $('chunking').checked        = !!opts.chunking;
  $('userCooldownMs').value    = pick(opts.userCooldownMs, 5000);
  $('dedupWindowMs').value     = pick(opts.dedupWindowMs, 30000);

  await reloadVoices(opts.voiceName || '');
}

async function saveAll() {
  const set = (k, v) => window.api.setOption(k, v);

  await set('rate',           Number($('rate').value));
  await set('volume',         Number($('volume').value));
  await set('maxLen',         Number($('maxLen').value));
  await set('maxQueue',       Number($('maxQueue').value));
  await set('prefix',         String($('prefix').value || '{user} '));
  await set('skipBots',       $('skipBots').checked);
  await set('profanity',      $('profanity').checked);
  await set('readCommands',   $('readCommands').checked);
  await set('speakTtsCommands',$('speakTtsCommands').checked);
  await set('speakBotCommands',$('speakBotCommands').checked);
  await set('chunking',       $('chunking').checked);
  await set('userCooldownMs', Number($('userCooldownMs').value));
  await set('dedupWindowMs',  Number($('dedupWindowMs').value));

  await window.api.setVoice($('voiceSelect').value);
  log('Zapisano ustawienia.');
}

// ──────────────────────────────────────────────────────────────
// Events
btnCheck?.addEventListener('click', refreshUpdateInfo);
document.addEventListener('DOMContentLoaded', refreshUpdateInfo);

$('reloadVoices').addEventListener('click', async () => {
  const opts = await window.api.getOptions();
  await reloadVoices(opts?.voiceName || '');
  log('Odświeżono listę głosów.');
});

$('btnMute').addEventListener('click', async () => {
  const muted = await window.api.muteToggle();
  log(muted ? 'Wyciszono.' : 'Odblokowano.');
});

$('btnSkip').addEventListener('click', async () => {
  const ok = await window.api.skip();
  log(ok ? 'Pominięto bieżący komunikat.' : 'Brak aktywnej wiadomości.');
});

$('btnSave').addEventListener('click', saveAll);

// Log bridge
window.api.onLog?.((m) => log(m));

// Inicjalny załadunek
document.addEventListener('DOMContentLoaded', loadOptionsToUI);
