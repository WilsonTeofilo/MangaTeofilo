import { useCallback, useMemo, useState } from 'react';

export function useChapterWizard({
  capaCapitulo,
  capituloCapaUrl,
  totalPaginasAtual,
  titulo,
  numeroCapitulo,
  etapaInicial = 1,
} = {}) {
  const [etapaAtiva, setEtapaAtiva] = useState(etapaInicial);

  const checklistPublicacao = useMemo(() => {
    const etapa1 = Boolean((capaCapitulo || capituloCapaUrl) && totalPaginasAtual > 0);
    const etapa2 = totalPaginasAtual > 0;
    const etapa3 = Boolean(capaCapitulo || capituloCapaUrl);
    const etapa4 = Boolean(String(titulo || '').trim() && Number(numeroCapitulo) > 0);
    const etapa5 = etapa1 && etapa2 && etapa3 && etapa4;
    return [
      { id: 1, label: 'Upload (capa e paginas)', ok: etapa1 },
      { id: 2, label: 'Organizar paginas', ok: etapa2 },
      { id: 3, label: 'Ajustar capa', ok: etapa3 },
      { id: 4, label: 'Revisar metadados', ok: etapa4 },
      { id: 5, label: 'Publicar', ok: etapa5 },
    ];
  }, [capaCapitulo, capituloCapaUrl, numeroCapitulo, titulo, totalPaginasAtual]);

  const etapaUploadCompleta = Boolean((capaCapitulo || capituloCapaUrl) && totalPaginasAtual > 0);
  const etapaOrganizacaoCompleta = totalPaginasAtual > 0;
  const etapaCapaCompleta = Boolean(capaCapitulo || capituloCapaUrl);
  const etapaRevisaoCompleta = Boolean(String(titulo || '').trim() && Number(numeroCapitulo) > 0);
  const tituloNormalizado = String(titulo || '').trim();
  const numeroCapituloNormalizado = Number(numeroCapitulo);

  const etapaLiberadaMax = useMemo(() => {
    if (!etapaUploadCompleta) return 1;
    if (!etapaOrganizacaoCompleta) return 2;
    if (!etapaCapaCompleta) return 3;
    if (!etapaRevisaoCompleta) return 4;
    return 5;
  }, [
    etapaCapaCompleta,
    etapaOrganizacaoCompleta,
    etapaRevisaoCompleta,
    etapaUploadCompleta,
  ]);

  const irParaEtapa = useCallback((etapaDestino) => {
    const destino = Math.max(1, Math.min(5, Number(etapaDestino) || 1));
    setEtapaAtiva(Math.min(destino, etapaLiberadaMax));
  }, [etapaLiberadaMax]);

  const mensagemBloqueioEtapa = useCallback((etapaDestino) => {
    const destino = Math.max(1, Math.min(5, Number(etapaDestino) || 1));
    if (destino <= etapaLiberadaMax) return '';
    if (!etapaUploadCompleta) {
      const temCapa = Boolean(capaCapitulo || capituloCapaUrl);
      const temPaginas = totalPaginasAtual > 0;
      if (!temCapa && !temPaginas) {
        return 'Faltam a capa e as páginas do capítulo.';
      }
      if (!temCapa) {
        return 'Falta enviar a capa do capítulo.';
      }
      if (!temPaginas) {
        return 'Falta enviar pelo menos uma página do capítulo.';
      }
    }
    if (!etapaOrganizacaoCompleta) {
      return 'Adicione e organize ao menos uma página antes de seguir.';
    }
    if (!etapaCapaCompleta) {
      return 'Selecione a capa do capítulo antes de seguir.';
    }
    if (!tituloNormalizado && (!Number.isFinite(numeroCapituloNormalizado) || numeroCapituloNormalizado <= 0)) {
      return 'Faltam o título e o número do capítulo.';
    }
    if (!tituloNormalizado) {
      return 'Falta preencher o título do capítulo.';
    }
    if (!Number.isFinite(numeroCapituloNormalizado) || numeroCapituloNormalizado <= 0) {
      return 'Falta preencher um número de capítulo válido.';
    }
    return 'Complete a etapa atual antes de avançar.';
  }, [
    etapaLiberadaMax,
    etapaUploadCompleta,
    etapaOrganizacaoCompleta,
    etapaCapaCompleta,
    tituloNormalizado,
    numeroCapituloNormalizado,
    capaCapitulo,
    capituloCapaUrl,
    totalPaginasAtual,
  ]);

  const tentarIrParaEtapa = useCallback((etapaDestino, onBlock) => {
    const bloqueio = mensagemBloqueioEtapa(etapaDestino);
    if (bloqueio) {
      if (onBlock) onBlock(bloqueio);
      return false;
    }
    irParaEtapa(etapaDestino);
    return true;
  }, [irParaEtapa, mensagemBloqueioEtapa]);

  return {
    etapaAtiva,
    setEtapaAtiva,
    checklistPublicacao,
    etapaLiberadaMax,
    etapaUploadCompleta,
    etapaOrganizacaoCompleta,
    etapaCapaCompleta,
    etapaRevisaoCompleta,
    tituloNormalizado,
    numeroCapituloNormalizado,
    irParaEtapa,
    mensagemBloqueioEtapa,
    tentarIrParaEtapa,
  };
}
