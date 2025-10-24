const $ = (id) => document.getElementById(id);
const logBox = $('log');

function log(s) {
  const line = new Date().toLocaleTimeString() + '  ' + s;
  logBox.textContent += line + '\n';
  logBox.scrollTop = logBox.scrollHeight;
}

async function loadOptionsToUI() {
  const opts = await window.api.getOptions();
  if (!opts) { log('Brak instancji bota'); return; }

  $('rate').value = opts.rate ?? 0.9;
  $('volume').value = opts.volume ?? 100;
  $('maxLen').value = opts.maxLen ?? 220;
  $('maxQueue').value = opts.maxQueue ?? 60;
  $('prefix').value = opts.prefix ?? '{user} ';
  $('skipBots').checked = !!opts.skipBots;
  $('profanity').checked = !!opts.profanity;
  $('readCommands').checked     = !!opts.readCommands;
  $('speakTtsCommands').checked = opts.speakTtsCommands !== false;
  $('speakBotCommands').checked = !!opts.speakBotCommands;

  $('chunking').checked = !!opts.chunking;
  $('userCooldownMs').value = opts.userCooldownMs ?? 5000;
  $('dedupWindowMs').value = opts.dedupWindowMs ?? 30000;

  await reloadVoices(opts.voiceName || '');
}

async function reloadVoices(current) {
  const sel = $('voiceSelect');
  sel.innerHTML = '';
  let voices = [];
  try { voices = await window.api.listVoices(); } catch {}
  const opt = document.createElement('option');
  opt.value = ''; opt.textContent = '(domyślny)';
  sel.appendChild(opt);

  (voices || []).forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if (current && v.toLowerCase().includes(current.toLowerCase())) o.selected = true;
    sel.appendChild(o);
  });
}

async function saveAll() {
  const set = async (k, v) => { await window.api.setOption(k, v); };

  await set('rate', Number($('rate').value));
  await set('volume', Number($('volume').value));
  await set('maxLen', Number($('maxLen').value));
  await set('maxQueue', Number($('maxQueue').value));
  await set('prefix', String($('prefix').value || '{user} '));
  await set('skipBots', $('skipBots').checked);
  await set('profanity', $('profanity').checked);
  await set('readCommands', $('readCommands').checked);
  await set('speakTtsCommands', $('speakTtsCommands').checked);
  await set('speakBotCommands', $('speakBotCommands').checked);
  await set('chunking', $('chunking').checked);
  await set('userCooldownMs', Number($('userCooldownMs').value));
  await set('dedupWindowMs', Number($('dedupWindowMs').value));

  const vSel = $('voiceSelect').value;
  await window.api.setVoice(vSel);
  log('Zapisano ustawienia.');
}

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
$('btnSave').addEventListener('click', async () => { await saveAll(); });

window.api.onLog?.((m) => log(m));
document.addEventListener('DOMContentLoaded', loadOptionsToUI);
