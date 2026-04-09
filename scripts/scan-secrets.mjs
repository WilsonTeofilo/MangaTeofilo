import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const IGNORE_DIRS = new Set([
  '.git',
  'dist',
  'node_modules',
  'functions/node_modules',
  '.firebase',
]);
const IGNORE_FILES = new Set([
  '.env.example',
  'package-lock.json',
  'functions/package-lock.json',
]);
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.html',
  '.css',
  '.rules',
]);
const PATTERNS = [
  { name: 'Mercado Pago access token', regex: /\b(APP_USR|TEST)-[A-Za-z0-9-]{20,}\b/g },
  { name: 'Generic secret assignment', regex: /\b(ACCESS[_-]?TOKEN|WEBHOOK[_-]?SECRET|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|SECRET_KEY)\b\s*[:=]\s*['"`][^'"`\n]{8,}['"`]/gi },
  { name: 'Bearer token literal', regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
  { name: 'Private key header', regex: /-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----/g },
];

function shouldSkip(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (IGNORE_FILES.has(normalized)) return true;
  if (/\.test\.[cm]?[jt]sx?$/i.test(normalized)) return true;
  return normalized.split('/').some((part, index, parts) => {
    const joined = parts.slice(0, index + 1).join('/');
    return IGNORE_DIRS.has(part) || IGNORE_DIRS.has(joined);
  });
}

function walk(dir, relativeBase = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeBase, entry.name);
    if (shouldSkip(relativePath)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, relativePath));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && !entry.name.endsWith('.rules')) continue;
    files.push({ fullPath, relativePath: relativePath.replace(/\\/g, '/') });
  }
  return files;
}

const hits = [];
for (const file of walk(ROOT)) {
  const content = fs.readFileSync(file.fullPath, 'utf8');
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(content);
    if (!match) continue;
    hits.push({
      file: file.relativePath,
      pattern: pattern.name,
      sample: match[0].slice(0, 120),
    });
    pattern.regex.lastIndex = 0;
  }
}

if (hits.length) {
  console.error('Possiveis segredos encontrados:');
  for (const hit of hits) {
    console.error(`- ${hit.file} :: ${hit.pattern} :: ${hit.sample}`);
  }
  process.exit(1);
}

console.log('Nenhum segredo literal suspeito encontrado.');
