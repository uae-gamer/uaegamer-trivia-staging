import QRCode from './vendor/qr/index.js';
import Level from './vendor/qr/QRErrorCorrectLevel.js';

/** Construct by text nodes only; session labels and questions are user content. */
export function node(tag, cls = '', ...children) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  for (const child of children.flat()) {
    if (child !== undefined && child !== null && child !== false) element.append(child);
  }
  return element;
}

export function button(label, onClick, kind = '') {
  const b = node('button', 'ar-button', label);
  b.type = 'button';
  b.dataset.kind = kind;
  b.addEventListener('click', onClick);
  return b;
}

export function qrCanvas(value, label) {
  const code = new QRCode(0, Level.M);
  code.addData(new URL(value).href);
  code.make();
  const canvas = node('canvas', 'ar-qr');
  const width = code.getModuleCount();
  const scale = 8;
  canvas.width = canvas.height = (width + 8) * scale;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  const draw = canvas.getContext('2d');
  draw.fillStyle = 'white';
  draw.fillRect(0, 0, canvas.width, canvas.height);
  draw.fillStyle = 'black';
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++)
      if (code.isDark(y,x)) draw.fillRect((x+4)*scale,(y+4)*scale,scale,scale);
  return canvas;
}

export function safeColor(value) {
  return /^#[a-f0-9]{6}$/i.test(value || '') ? value : '#9076eb';
}

export function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = node('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Protect text fields when CSV exports open in a spreadsheet. */
export function csv(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) && typeof value !== 'number') text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  }).join(',')).join('\r\n');
}

const sounds = {
  start:[392,523,659], start_match:[392,493], category:[349], card:[440,523],
  warning:[660], locked:[523,659], correct:[523,659,784], incorrect:[330,247],
  expired:[294,220], victory:[392,494,587,784], champion:[392,523,659,784,1046]
};

export function soundboard() {
  let ctx, loop = 0, volume = .22, effects = false;
  function tone(frequency, start, duration, gain) {
    if (!ctx || ctx.state !== 'running') return;
    const wave = ctx.createOscillator(), level = ctx.createGain();
    wave.type = 'sine';
    wave.frequency.value = frequency;
    level.gain.setValueAtTime(.0001,start);
    level.gain.exponentialRampToValueAtTime(Math.max(.0002,gain*volume),start+.015);
    level.gain.exponentialRampToValueAtTime(.0001,start+duration);
    wave.connect(level).connect(ctx.destination);
    wave.start(start);
    wave.stop(start+duration+.01);
    wave.onended = () => { wave.disconnect(); level.disconnect(); };
  }
  return {
    get effects() {return effects;},
    get music() {return Boolean(loop);},
    get volume() {return volume;},
    set volume(v) {volume = Math.max(0,Math.min(1,Number(v)||0));},
    async unlock() {
      try {
        ctx ??= new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume(); return ctx.state === 'running';
      } catch { return false; }
    },
    enable(v) {effects = Boolean(v);},
    play(key) {
      if (!effects || !ctx || !sounds[key]) return;
      for (const [i,pitch] of sounds[key].entries()) tone(pitch,ctx.currentTime+.02+i*.12,.16,.42);
    },
    background(on) {
      clearInterval(loop); loop = 0;
      if (!on || !ctx) return;
      const pattern = [131,196,247,196,147,220,262,220];
      let beat = 0;
      loop = setInterval(() => tone(pattern[beat++ % pattern.length],ctx.currentTime+.02,.36,.12),420);
    },
    stop() {clearInterval(loop); if(ctx) void ctx.close().catch(()=>{});}
  };
}
