import React from 'react';

export default function PerfilBuyerDisclosure({
  buyerProfileExpanded,
  setBuyerProfileExpanded,
  children,
  title = 'Dados para compra na loja',
  hint = 'Opcional - so para compras na loja (entrega fisica). Pode salvar o perfil com tudo em branco; na hora de pagar, o checkout exige endereco e documentos validos.',
}) {
  return (
    <>
      <div className="input-group perfil-creator-section-title">
        <label>{title}</label>
        <p className="perfil-loja-dados-hint">{hint}</p>
      </div>
      <button
        type="button"
        className="perfil-loja-dados-toggle"
        aria-expanded={buyerProfileExpanded}
        onClick={() => setBuyerProfileExpanded((v) => !v)}
      >
        {buyerProfileExpanded ? 'Ocultar dados de entrega' : 'Preencher dados de entrega (opcional)'}
      </button>
      {buyerProfileExpanded ? <div className="perfil-loja-dados-fields">{children}</div> : null}
    </>
  );
}
