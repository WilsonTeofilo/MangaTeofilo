import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const functionsRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const selfPath = fileURLToPath(import.meta.url);

function collectJsFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function runModuleChecks(files) {
  for (const file of files) {
    const stat = statSync(file);
    if (!stat.isFile()) {
      throw new Error(`Arquivo invalido no check: ${file}`);
    }
    if (resolve(file) === resolve(selfPath)) continue;
    await import(pathToFileURL(file).href);
  }
}

async function runSmokeImports() {
  const modules = [
    './shared/creatorEngagementMetrics.js',
    './shared/publicUserProfile.js',
    './shared/fixedZoneShipping.js',
    './shared/storeShipping.js',
    './shared/printOnDemandPricing.js',
    './orders/storeCommon.js',
    './creator/publicProfile.js',
    './creator/audience.js',
    './index.js',
  ];

  for (const relativePath of modules) {
    await import(pathToFileURL(join(functionsRoot, relativePath)).href);
  }
}

async function main() {
  const files = collectJsFiles(functionsRoot);
  await runModuleChecks(files);
  await runSmokeImports();
  console.log(`Checked ${files.length} JS files and smoke-imported core modules.`);
  for (const file of files) {
    console.log(` - ${relative(functionsRoot, file)}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
