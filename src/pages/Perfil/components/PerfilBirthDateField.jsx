import React from 'react';

import {
  formatBirthDateIsoToBr,
  normalizeBirthDateBrTyping,
  parseBirthDateBr,
  parseBirthDateLocal,
} from '../../../utils/birthDateAge';

export default function PerfilBirthDateField({
  birthDate,
  setBirthDate,
  birthDateDraft,
  setBirthDateDraft,
  birthInputRef,
  restorePreviousOnInvalidBlur = false,
}) {
  return (
    <div className="input-group">
      <label>DATA DE NASCIMENTO</label>
      <input
        ref={birthInputRef}
        type="text"
        inputMode="numeric"
        autoComplete="bday"
        placeholder="28/12/2001"
        className="perfil-input"
        value={birthDateDraft}
        onChange={(e) => {
          const nextDraft = normalizeBirthDateBrTyping(e.target.value);
          setBirthDateDraft(nextDraft);
          const iso = parseBirthDateBr(nextDraft);
          if (iso) setBirthDate(iso);
          else if (!nextDraft.replace(/\D/g, '').length) setBirthDate('');
        }}
        onBlur={() => {
          const iso = parseBirthDateBr(birthDateDraft);
          if (iso) {
            setBirthDate(iso);
            setBirthDateDraft(formatBirthDateIsoToBr(iso));
          } else if (!birthDateDraft.replace(/\D/g, '').length) {
            setBirthDate('');
            setBirthDateDraft('');
          } else if (restorePreviousOnInvalidBlur) {
            setBirthDateDraft(
              birthDate && parseBirthDateLocal(birthDate) ? formatBirthDateIsoToBr(birthDate) : ''
            );
          }
        }}
      />
    </div>
  );
}
