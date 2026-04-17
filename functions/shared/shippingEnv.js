export const SHIPPING_MODE = {
  API: 'api',
  REGION: 'region',
  FIXED: 'fixed',
};

export const SHIPPING_REGION_LABELS = {
  norte: 'Norte',
  nordeste: 'Nordeste',
  'centro-oeste': 'Centro-Oeste',
  sudeste: 'Sudeste',
  sul: 'Sul',
};

/**
 * UF fictícia «WT» e frete de teste (R$ 0,50): em produção fica desligado salvo opt-in explícito.
 *
 * Cloud Functions: `STORE_WT_SHIPPING_ENABLED=1` ou `true`
 * Vite (browser): `VITE_STORE_WT_SHIPPING_ENABLED=1` ou `true`
 *
 * Fora de produção (NODE_ENV !== production / import.meta.env.PROD === false), WT continua permitido
 * para desenvolvimento local.
 */
export function isStoreWtShippingAllowed() {
  try {
    if (globalThis.process?.env) {
      const e = String(globalThis.process.env.STORE_WT_SHIPPING_ENABLED || '').toLowerCase();
      if (e === '1' || e === 'true' || e === 'yes') return true;
      const nodeEnv = String(globalThis.process.env.NODE_ENV || '').toLowerCase();
      if (nodeEnv === 'production') return false;
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      const v = String(import.meta.env.VITE_STORE_WT_SHIPPING_ENABLED || '').toLowerCase();
      if (v === '1' || v === 'true' || v === 'yes') return true;
      if (import.meta.env.PROD) return false;
      return true;
    }
  } catch {
    /* ignore */
  }
  return true;
}
