import {
  BOOK_FORMAT,
  SALE_MODEL,
} from '../../utils/printOnDemandPricingV2';

export const POD_STEPS = [
  { id: 'modelo', label: 'Modelo' },
  { id: 'venda', label: 'Venda' },
  { id: 'quantidade', label: 'Quantidade' },
  { id: 'arquivos', label: 'Arquivos' },
  { id: 'revisao', label: 'Revisão' },
];

export const POD_FORMAT_CARDS = [
  {
    id: BOOK_FORMAT.TANKOBON,
    title: 'tankōbon',
    lines: ['180–220 páginas', 'Mais completo e profissional'],
  },
  {
    id: BOOK_FORMAT.MEIO_TANKO,
    title: 'Meio-tankō',
    lines: ['80–100 páginas', 'Mais rápido e barato'],
  },
];

export function formatLabel(id) {
  return id === BOOK_FORMAT.TANKOBON ? 'tankōbon' : 'Meio-tankō';
}

export function saleModelLabel(m) {
  if (m === SALE_MODEL.PLATFORM) return 'Venda pela plataforma';
  if (m === SALE_MODEL.STORE_PROMO) return 'Vitrine (sem lucro)';
  return 'Produzir para mim';
}

export function fmtCountPt(n) {
  return new Intl.NumberFormat('pt-BR').format(Math.max(0, Math.floor(Number(n) || 0)));
}
