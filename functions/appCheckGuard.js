import { HttpsError } from 'firebase-functions/v2/https';

function isEmulatorRuntime() {
  return String(globalThis.process?.env?.FUNCTIONS_EMULATOR || '').trim().toLowerCase() === 'true';
}

function hasLocalDevOrigin(request) {
  const origin = String(
    request?.rawRequest?.headers?.origin ||
    request?.rawRequest?.headers?.referer ||
    ''
  )
    .trim()
    .toLowerCase();
  return (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('https://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('https://127.0.0.1:')
  );
}

function hasTrustedWebOrigin(request) {
  const origin = String(
    request?.rawRequest?.headers?.origin ||
    request?.rawRequest?.headers?.referer ||
    ''
  )
    .trim()
    .toLowerCase();
  const trustedOrigins = [
    'https://shitoproject-ed649.web.app',
    'https://shitoproject-ed649.firebaseapp.com',
  ];
  return trustedOrigins.some((item) => origin.startsWith(item));
}

export function assertTrustedAppRequest(request) {
  if (isEmulatorRuntime()) return;
  if (request?.app?.appId) return;
  if (hasLocalDevOrigin(request)) return;
  if (request?.auth?.uid && hasTrustedWebOrigin(request)) return;
  throw new HttpsError(
    'failed-precondition',
    'Validacao do aplicativo ausente. Atualize a pagina e tente novamente.'
  );
}
