import { STORE_CATEGORY_KEYS, STORE_TYPE_KEYS } from '../config/store';

/** Ordenação no topo da lista (timestamp fictício alto). */
const DEMO_SORT = 2000000000000;

/**
 * Produtos só para visualizar layout (dev ou `VITE_SHITO_STORE_DEMO=true`).
 * Não geram pedido real — `isStoreDemo` bloqueia checkout/carrinho.
 */
export const STORE_DEMO_PRODUCTS = [
  {
    id: 'demo-manga-01',
    title: 'Mangá genérico — Arco I',
    description: 'Volume de demonstração. Capa e lombada no estilo seinen; texto placeholder.',
    price: 49.9,
    stock: 24,
    images: [
      'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: false,
    promoPrice: 0,
    isVIPDiscountEnabled: true,
    type: STORE_TYPE_KEYS.MANGA,
    category: STORE_CATEGORY_KEYS.MANGA,
    obra: 'demo',
    collection: '',
    dropLabel: '',
    sizes: [],
    isNew: true,
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
  {
    id: 'demo-manga-02',
    title: 'Mangá genérico — Arco II',
    description: 'Segundo volume demo. Batalha urbana, traço forte, capa escura.',
    price: 52.0,
    stock: 18,
    images: [
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: true,
    promoPrice: 44.9,
    isVIPDiscountEnabled: true,
    type: STORE_TYPE_KEYS.MANGA,
    category: STORE_CATEGORY_KEYS.MANGA,
    obra: 'demo',
    collection: '',
    dropLabel: 'Oferta demo',
    sizes: [],
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
  {
    id: 'demo-manga-03',
    title: 'Mangá genérico — Edição colecionador',
    description: 'Encadernação premium (mock). Extras: capa alternativa fictícia.',
    price: 89.0,
    stock: 6,
    images: [
      'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: false,
    promoPrice: 0,
    isVIPDiscountEnabled: true,
    type: STORE_TYPE_KEYS.MANGA,
    category: STORE_CATEGORY_KEYS.MANGA,
    obra: 'demo',
    collection: 'COLEÇÃO DEMO — VINJETAS',
    dropLabel: '',
    sizes: [],
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
  {
    id: 'demo-manga-04',
    title: 'Mangá genérico — Antologia',
    description: 'Vários one-shots em preto e branco; layout de painéis denso.',
    price: 64.5,
    stock: 12,
    images: [
      'https://images.unsplash.com/photo-1524578271613-d550eacf60c7?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: false,
    promoPrice: 0,
    isVIPDiscountEnabled: false,
    type: STORE_TYPE_KEYS.MANGA,
    category: STORE_CATEGORY_KEYS.MANGA,
    obra: 'demo',
    collection: '',
    dropLabel: '',
    sizes: [],
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
  {
    id: 'demo-camiseta-01',
    title: 'Camiseta minimal — símbolo',
    description: 'Algodão 180g (texto demo). Estampa pequena, vibe streetwear clean.',
    price: 119.0,
    stock: 40,
    images: [
      'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&w=720&h=900&fit=crop&q=80',
      'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: false,
    promoPrice: 0,
    isVIPDiscountEnabled: true,
    type: STORE_TYPE_KEYS.ROUPA,
    category: STORE_CATEGORY_KEYS.VESTUARIO,
    obra: 'shito',
    collection: 'DROP DEMO — STREET',
    dropLabel: 'Limited demo',
    sizes: ['P', 'M', 'G', 'GG'],
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
  {
    id: 'demo-camiseta-02',
    title: 'Camiseta painel — PB',
    description: 'Gráfico grande estilo painel de mangá (placeholder visual).',
    price: 129.0,
    stock: 32,
    images: [
      'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: false,
    promoPrice: 0,
    isVIPDiscountEnabled: true,
    type: STORE_TYPE_KEYS.ROUPA,
    category: STORE_CATEGORY_KEYS.VESTUARIO,
    obra: 'shito',
    collection: 'DROP DEMO — STREET',
    dropLabel: '',
    sizes: ['P', 'M', 'G', 'GG'],
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
  {
    id: 'demo-camiseta-03',
    title: 'Camiseta essencial — cinza',
    description: 'Peça neutra, logo discreto (mock). Combine com o resto do drop.',
    price: 99.0,
    stock: 50,
    images: [
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: false,
    promoPrice: 0,
    isVIPDiscountEnabled: true,
    type: STORE_TYPE_KEYS.ROUPA,
    category: STORE_CATEGORY_KEYS.VESTUARIO,
    obra: 'shito',
    collection: '',
    dropLabel: '',
    sizes: ['P', 'M', 'G', 'GG'],
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
  {
    id: 'demo-camiseta-04',
    title: 'Camiseta experimental — glitch',
    description: 'Corte oversized (descrição demo). Estampa abstrata colorida.',
    price: 149.0,
    stock: 15,
    images: [
      'https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&w=720&h=900&fit=crop&q=80',
    ],
    isActive: true,
    isOnSale: false,
    promoPrice: 0,
    isVIPDiscountEnabled: true,
    type: STORE_TYPE_KEYS.ROUPA,
    category: STORE_CATEGORY_KEYS.VESTUARIO,
    obra: 'shito',
    collection: 'DROP DEMO — LAB',
    dropLabel: 'Edição limitada',
    sizes: ['P', 'M', 'G', 'GG', 'XG'],
    isStoreDemo: true,
    createdAt: DEMO_SORT,
    updatedAt: DEMO_SORT,
  },
];

const DEMO_BY_ID = Object.fromEntries(STORE_DEMO_PRODUCTS.map((p) => [p.id, { ...p }]));

export function isStoreDemoMode() {
  return import.meta.env.DEV === true || import.meta.env.VITE_SHITO_STORE_DEMO === 'true';
}

export function getStoreDemoProductById(id) {
  if (!isStoreDemoMode() || !id) return null;
  const p = DEMO_BY_ID[id];
  return p ? { ...p } : null;
}

/** Mescla lista do Firebase com demos (IDs do Firebase sobrescrevem o mesmo id). */
export function mergeFirebaseListWithDemos(firebaseList) {
  if (!isStoreDemoMode()) return firebaseList;
  const ids = new Set(firebaseList.map((p) => p.id));
  const extra = STORE_DEMO_PRODUCTS.filter((d) => !ids.has(d.id));
  return [...extra, ...firebaseList].sort(
    (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
  );
}

export function getStoreDemoProductsRecord() {
  if (!isStoreDemoMode()) return {};
  return { ...DEMO_BY_ID };
}
