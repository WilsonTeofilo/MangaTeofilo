/**
 * IDs dos planos (iguais às chaves em functions/mercadoPagoApoio.js).
 * O checkout deve sempre vir da Cloud Function canonica.
 */
export const APOIO_PLANOS_UI = [
  {
    id: 'cafe',
    badge: 'P',
    titulo: 'CAFÉ DO AUTOR',
    precoLabel: 'R$ 7,99',
    descricao: 'Café e energia garantidos para mais uma página!',
  },
  {
    id: 'marmita',
    badge: 'M',
    titulo: 'MARMITA DO GUERREIRO',
    precoLabel: 'R$ 19,00',
    descricao: 'Fazer a boa para o autor comer uma marmita de respeito!',
  },
  {
    id: 'lendario',
    badge: 'G',
    titulo: 'O LENDÁRIO MORTAL',
    precoLabel: 'R$ 35,00',
    descricao: 'Nesse valor, o autor gira 3 mortais pra trás de felicidade!',
  },
];
