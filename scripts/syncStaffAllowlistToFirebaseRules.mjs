/**
 * Substitui em lote a expressão «chefes» (UIDs + e-mails + auth.token.admin) em:
 * - database.rules.json (Realtime Database)
 * - storage.rules
 *
 * Fonte: shared/platformStaffAllowlist.json
 *
 * Deteção por regex (evita drift manual de cópias longas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const allowPath = path.join(root, 'shared', 'platformStaffAllowlist.json');
const rtdbPath = path.join(root, 'database.rules.json');
const storagePath = path.join(root, 'storage.rules');

function loadAllowlist() {
  const raw = JSON.parse(fs.readFileSync(allowPath, 'utf8'));
  const uids = Array.isArray(raw.uids) ? raw.uids.map((u) => String(u || '').trim()).filter(Boolean) : [];
  const emails = Array.isArray(raw.emails) ? raw.emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean) : [];
  if (!uids.length || !emails.length) {
    throw new Error('platformStaffAllowlist.json precisa de uids e emails nao vazios.');
  }
  return { uids, emails };
}

/** Expressão RTDB: auth.uid === '…' || … || auth.token.email === '…' || auth.token.admin === true */
function buildRtdbChiefAuthOr({ uids, emails }) {
  const uidPart = uids.map((u) => `auth.uid === '${u}'`).join(' || ');
  const emailPart = emails.map((e) => `auth.token.email === '${e}'`).join(' || ');
  return `${uidPart} || ${emailPart} || auth.token.admin === true`;
}

/** Mesma ideia para Storage rules (aspas duplas, ==). */
function buildStorageChiefAuthOr({ uids, emails }) {
  const uidPart = uids.map((u) => `request.auth.uid == "${u}"`).join(' || ');
  const emailPart = emails.map((e) => `request.auth.token.email == "${e}"`).join(' || ');
  return `${uidPart} || ${emailPart} || request.auth.token.admin == true`;
}

/** Bloco RTDB: chefes com pelo menos um uid e um e-mail antes de auth.token.admin. */
const RTDB_CHIEF_RE =
  /auth\.uid === '[^']+'(?: \|\| auth\.uid === '[^']+')* \|\| auth\.token\.email === '[^']+'(?: \|\| auth\.token\.email === '[^']+')* \|\| auth\.token\.admin === true/g;

/** Corpo de `function isShitoAdmin()` no Storage (quebras de linha variáveis). E-mails opcionais no ficheiro antigo. */
const STORAGE_IS_SHITO_ADMIN_FN_RE =
  /function isShitoAdmin\(\) \{\s*return request\.auth != null\s*&&\s*\(\s*request\.auth\.uid == "[^"]+"(?:\s*\|\|\s*request\.auth\.uid == "[^"]+")*(?:\s*\|\|\s*request\.auth\.token\.email == "[^"]+"(?:\s*\|\|\s*request\.auth\.token\.email == "[^"]+")*)?\s*\|\|\s*request\.auth\.token\.admin == true\s*\);\s*\}/s;

function syncFile(filePath, re, replacement, label) {
  const before = fs.readFileSync(filePath, 'utf8');
  const matches = before.match(re);
  if (!matches || matches.length === 0) {
    throw new Error(`[${label}] Nenhuma ocorrencia do padrao chefes — arquivo alterado manualmente?`);
  }
  const after = before.replace(re, replacement);
  fs.writeFileSync(filePath, after, 'utf8');
  return matches.length;
}

function main() {
  const allow = loadAllowlist();
  const rtdbExpr = buildRtdbChiefAuthOr(allow);
  const storageExpr = buildStorageChiefAuthOr(allow);
  const storageFn = `function isShitoAdmin() {\n    return request.auth != null\n      && (${storageExpr});\n  }`;

  const nRtdb = syncFile(rtdbPath, RTDB_CHIEF_RE, rtdbExpr, 'database.rules.json');
  const nSt = syncFile(storagePath, STORAGE_IS_SHITO_ADMIN_FN_RE, storageFn, 'storage.rules');

  console.log('syncStaffAllowlistToFirebaseRules: OK');
  console.log(`  RTDB rules: ${nRtdb} substituicoes`);
  console.log(`  Storage rules: ${nSt} substituicoes (bloco isShitoAdmin)`);
  console.log(`  Fonte: shared/platformStaffAllowlist.json (${allow.uids.length} uids, ${allow.emails.length} emails)`);
}

main();
