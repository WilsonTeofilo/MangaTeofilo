import { useCallback, useEffect, useRef, useState } from 'react';

export function useReaderControls({ totalPaginas }) {
  const [modoLeitura, setModoLeitura] = useState(
    () => localStorage.getItem('modoLeitura') || 'vertical'
  );
  const [zoom, setZoom] = useState(
    () => Number(localStorage.getItem('zoom')) || 100
  );
  const [paginaAtual, setPaginaAtual] = useState(0);
  const [verticalFocusIndex, setVerticalFocusIndex] = useState(0);
  const [mostrarConfig, setMostrarConfig] = useState(false);

  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    localStorage.setItem('modoLeitura', modoLeitura);
  }, [modoLeitura]);

  useEffect(() => {
    localStorage.setItem('zoom', zoom);
  }, [zoom]);

  const irProxima = useCallback(
    () => setPaginaAtual((p) => Math.min(p + 1, totalPaginas - 1)),
    [totalPaginas]
  );
  const irAnterior = useCallback(
    () => setPaginaAtual((p) => Math.max(p - 1, 0)),
    []
  );

  useEffect(() => {
    const handleKey = (e) => {
      if (modoLeitura !== 'horizontal') return;
      if (e.key === 'ArrowRight') irProxima();
      if (e.key === 'ArrowLeft') irAnterior();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [irAnterior, irProxima, modoLeitura]);

  const handleTouchStart = (e) => { touchStartX.current = e.changedTouches[0].screenX; };
  const handleTouchMove = (e) => { touchEndX.current = e.changedTouches[0].screenX; };
  const handleTouchEnd = () => {
    const dist = touchStartX.current - touchEndX.current;
    if (dist > 50) irProxima();
    if (dist < -50) irAnterior();
  };

  return {
    modoLeitura,
    setModoLeitura,
    zoom,
    setZoom,
    paginaAtual,
    setPaginaAtual,
    verticalFocusIndex,
    setVerticalFocusIndex,
    mostrarConfig,
    setMostrarConfig,
    irProxima,
    irAnterior,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
