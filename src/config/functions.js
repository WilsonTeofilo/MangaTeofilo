const DEFAULT_FUNCTIONS_REGION = 'us-central1';
const DEFAULT_FIREBASE_PROJECT_ID = 'shitoproject-ed649';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export const FUNCTIONS_PUBLIC_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    `https://${DEFAULT_FUNCTIONS_REGION}-${DEFAULT_FIREBASE_PROJECT_ID}.cloudfunctions.net`
);

export function buildPublicFunctionUrl(functionName) {
  const normalizedName = String(functionName || '').trim();
  if (!normalizedName) {
    throw new Error('functionName obrigatorio para montar a URL publica da function.');
  }
  return `${FUNCTIONS_PUBLIC_BASE_URL}/${normalizedName}`;
}
