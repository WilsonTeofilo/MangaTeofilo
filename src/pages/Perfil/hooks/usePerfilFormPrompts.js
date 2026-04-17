import { useEffect } from 'react';

import {
  parseBirthDateFlexible,
  parseBirthDateLocal,
} from '../../../utils/birthDateAge';
import { normalizeUsernameInput } from '../../../utils/usernameValidation';
import { PERFIL_LOJA_DADOS_HASH } from '../../../utils/brazilianStates';

export function usePerfilFormPrompts({
  location,
  birthDate,
  birthDateDraft,
  perfilDbHandle,
  userHandleDraft,
  setMensagem,
  setBuyerProfileExpanded,
  mangakaBirthInputRef,
  usernameInputRef,
}) {
  const mustCompleteBirthDate =
    new URLSearchParams(location.search || '').get('required') === 'birthDate';
  const mustCompleteUsername =
    new URLSearchParams(location.search || '').get('required') === 'username';

  useEffect(() => {
    const hash = String(location.hash || '').replace(/^#/, '');
    if (hash !== PERFIL_LOJA_DADOS_HASH) return undefined;
    setBuyerProfileExpanded(true);
    const timeoutId = window.setTimeout(() => {
      document.getElementById(PERFIL_LOJA_DADOS_HASH)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 220);
    return () => window.clearTimeout(timeoutId);
  }, [location.hash, location.pathname, setBuyerProfileExpanded]);

  useEffect(() => {
    if (!mustCompleteBirthDate) return undefined;
    const iso = parseBirthDateFlexible(birthDateDraft, birthDate);
    if (parseBirthDateLocal(iso)) return undefined;
    setMensagem({
      texto: 'Preencha sua data de nascimento para continuar usando a conta.',
      tipo: 'erro',
    });
    const timeoutId = window.setTimeout(() => {
      mangakaBirthInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mangakaBirthInputRef.current?.focus?.();
    }, 220);
    return () => window.clearTimeout(timeoutId);
  }, [mustCompleteBirthDate, birthDate, birthDateDraft, setMensagem, mangakaBirthInputRef]);

  useEffect(() => {
    if (!mustCompleteUsername) return undefined;
    const locked = String(perfilDbHandle || '').trim().toLowerCase();
    const wanted = normalizeUsernameInput(userHandleDraft);
    if (locked || wanted) return undefined;
    setMensagem({ texto: 'Defina um @username para continuar.', tipo: 'erro' });
    const timeoutId = window.setTimeout(() => {
      usernameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      usernameInputRef.current?.focus?.();
    }, 220);
    return () => window.clearTimeout(timeoutId);
  }, [mustCompleteUsername, perfilDbHandle, userHandleDraft, setMensagem, usernameInputRef]);
}
