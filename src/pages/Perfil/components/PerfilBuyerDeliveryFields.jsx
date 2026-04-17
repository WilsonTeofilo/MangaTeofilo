import React from 'react';

import { BRAZILIAN_STATES } from '../../../utils/brazilianStates';

export default function PerfilBuyerDeliveryFields({
  buyerFullName,
  setBuyerFullName,
  buyerCpf,
  setBuyerCpf,
  buyerPhone,
  setBuyerPhone,
  buyerPostalCode,
  setBuyerPostalCode,
  buyerState,
  setBuyerState,
  buyerCity,
  setBuyerCity,
  buyerNeighborhood,
  setBuyerNeighborhood,
  buyerAddressLine1,
  setBuyerAddressLine1,
  buyerAddressLine2,
  setBuyerAddressLine2,
}) {
  return (
    <>
      <div className="input-group">
        <label>Nome completo (entrega)</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerFullName}
          onChange={(e) => setBuyerFullName(e.target.value)}
          placeholder="Nome que vai na nota de entrega da loja"
        />
      </div>
      <div className="input-group">
        <label>CPF</label>
        <input
          type="text"
          inputMode="numeric"
          className="perfil-input"
          value={buyerCpf}
          onChange={(e) => setBuyerCpf(e.target.value.replace(/\D+/g, '').slice(0, 11))}
          placeholder="Apenas numeros"
        />
      </div>
      <div className="input-group">
        <label>Telefone</label>
        <input
          type="text"
          inputMode="tel"
          className="perfil-input"
          value={buyerPhone}
          onChange={(e) => setBuyerPhone(e.target.value.replace(/\D+/g, '').slice(0, 11))}
          placeholder="DDD + numero (so digitos)"
        />
      </div>
      <div className="input-group">
        <label>CEP</label>
        <input
          type="text"
          inputMode="numeric"
          className="perfil-input"
          value={buyerPostalCode}
          onChange={(e) => setBuyerPostalCode(e.target.value.replace(/\D+/g, '').slice(0, 8))}
          placeholder="8 digitos, sem traco"
        />
      </div>
      <div className="input-group">
        <label>Estado</label>
        <select
          className="perfil-input"
          value={buyerState}
          onChange={(e) => setBuyerState(e.target.value)}
          aria-label="Estado (UF)"
        >
          <option value="">Selecione o estado</option>
          {BRAZILIAN_STATES.map(({ uf, name }) => (
            <option key={uf} value={uf}>
              {uf} - {name}
            </option>
          ))}
        </select>
      </div>
      <div className="input-group">
        <label>Cidade</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerCity}
          onChange={(e) => setBuyerCity(e.target.value)}
          placeholder="Sua cidade"
        />
      </div>
      <div className="input-group">
        <label>Bairro</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerNeighborhood}
          onChange={(e) => setBuyerNeighborhood(e.target.value)}
          placeholder="Seu bairro"
        />
      </div>
      <div className="input-group">
        <label>Endereco</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerAddressLine1}
          onChange={(e) => setBuyerAddressLine1(e.target.value)}
          placeholder="Rua, numero e complemento"
        />
      </div>
      <div className="input-group">
        <label>Complemento</label>
        <input
          type="text"
          className="perfil-input"
          value={buyerAddressLine2}
          onChange={(e) => setBuyerAddressLine2(e.target.value)}
          placeholder="Opcional"
        />
      </div>
    </>
  );
}
