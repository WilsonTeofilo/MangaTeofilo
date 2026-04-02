/**
 * Corrige mojibake comum no repo (UTF-8 lido como cp1252 / caracteres trocados).
 * Não altera "â" legítimo em palavras (ex.: relâmpago): só sequências de 2–3 chars conhecidas.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const exts = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.html', '.json']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (exts.has(path.extname(name))) out.push(full);
  }
  return out;
}

function fixMojibake(s) {
  let out = s;

  // "CÓDIGO" corrompido: C + Ã (U+00C3) + “ (U+201C) + DIGO
  out = out.split('C\u00C3\u201CDIGO').join('CÓDIGO');

  // — (U+2014) UTF-8 lido como cp1252: â + € + ”
  out = out.split('\u00E2\u20AC\u201D').join('\u2014');

  // – (U+2013) UTF-8 lido como cp1252: â + € + “
  out = out.split('\u00E2\u20AC\u201C').join('\u2013');

  // ─ (U+2500) box / separador em comentários: â + ” + €
  out = out.split('\u00E2\u201D\u20AC').join('\u2500');

  // → (U+2192) UTF-8 lido como cp1252: â + † + ’
  out = out.split('\u00E2\u2020\u2019').join('\u2192');

  // Latin-1 double-encoding (ex.: cÃ³digo → código)
  const pairs = [
    ['\u00C3\u00A1', '\u00E1'],
    ['\u00C3\u00A0', '\u00E0'],
    ['\u00C3\u00A3', '\u00E3'],
    ['\u00C3\u00A2', '\u00E2'],
    ['\u00C3\u00A9', '\u00E9'],
    ['\u00C3\u00AA', '\u00EA'],
    ['\u00C3\u00AD', '\u00ED'],
    ['\u00C3\u00B3', '\u00F3'],
    ['\u00C3\u00B4', '\u00F4'],
    ['\u00C3\u00B5', '\u00F5'],
    ['\u00C3\u00BA', '\u00FA'],
    ['\u00C3\u00A7', '\u00E7'],
    ['\u00C3\u0093', '\u00D3'],
    ['\u00C3\u0081', '\u00C1'],
    ['\u00C3\u0089', '\u00C9'],
    ['\u00C3\u008D', '\u00CD'],
    ['\u00C3\u009A', '\u00DA'],
    ['\u00C3\u00B2', '\u00F2'],
    ['\u00C3\u00B9', '\u00F9'],
    ['\u00C3\u00A4', '\u00E4'],
    ['\u00C3\u00B6', '\u00F6'],
    ['\u00C3\u00BC', '\u00FC'],
    ['\u00C3\u00B1', '\u00F1'],
  ];
  for (const [bad, good] of pairs) {
    out = out.split(bad).join(good);
  }

  // Comentários: "// ── ..." / "  // ── ..." → "// --- ..." (há espaço após //)
  out = out.replace(/^(\s*)\/\/ (?:\u2500)+\s*/gm, '$1// --- ');

  return out;
}

const dirs = [path.join(root, 'src'), path.join(root, 'functions'), path.join(root, 'public')];
const extra = [path.join(root, 'index.html')];

let changed = 0;
const seen = new Set();

for (const f of extra) {
  if (!fs.existsSync(f)) continue;
  seen.add(path.resolve(f));
  const raw = fs.readFileSync(f, 'utf8');
  const fixed = fixMojibake(raw);
  if (fixed !== raw) {
    fs.writeFileSync(f, fixed, 'utf8');
    console.log('fixed:', path.relative(root, f));
    changed++;
  }
}

for (const dir of dirs) {
  for (const f of walk(dir)) {
    const abs = path.resolve(f);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const raw = fs.readFileSync(f, 'utf8');
    const fixed = fixMojibake(raw);
    if (fixed !== raw) {
      fs.writeFileSync(f, fixed, 'utf8');
      console.log('fixed:', path.relative(root, f));
      changed++;
    }
  }
}

console.log(changed ? `Done, ${changed} file(s) updated.` : 'Done, no changes.');
