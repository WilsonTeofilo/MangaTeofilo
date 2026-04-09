const DEFAULT_FUNCTIONS_REGION = 'us-central1';
const DEFAULT_FIREBASE_PROJECT_ID = 'shitoproject-ed649';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

const functionsRegion =
  String(import.meta.env.VITE_FUNCTIONS_REGION || DEFAULT_FUNCTIONS_REGION).trim() ||
  DEFAULT_FUNCTIONS_REGION;
const firebaseProjectId =
  String(
    import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID
  ).trim() || DEFAULT_FIREBASE_PROJECT_ID;

export const FUNCTIONS_PUBLIC_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    `https://${functionsRegion}-${firebaseProjectId}.cloudfunctions.net`
);

export function buildPublicFunctionUrl(functionName) {
  const normalizedName = String(functionName || '').trim();
  if (!normalizedName) {
    throw new Error('functionName obrigatorio para montar a URL publica da function.');
  }
  return `${FUNCTIONS_PUBLIC_BASE_URL}/${normalizedName}`;
}
