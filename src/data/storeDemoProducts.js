// Loja demo removida. Mantido apenas como stub vazio para evitar import residual acidental.
export const STORE_DEMO_PRODUCTS = [];
export function isStoreDemoMode() {
  return false;
}
export function getStoreDemoProductById() {
  return null;
}
export function mergeFirebaseListWithDemos(firebaseList) {
  return Array.isArray(firebaseList) ? firebaseList : [];
}
export function getStoreDemoProductsRecord() {
  return {};
}
