import React, { useRef } from 'react';

/**
 * Só exibe dd/mm/aaaa no texto; calendário nativo fica oculto.
 */
export default function DashboardDateInput({
  brValue,
  isoValue,
  onBrInputChange,
  onIsoPicked,
  id,
  ariaLabelCalendar,
}) {
  const dateRef = useRef(null);
  const openCalendar = () => {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker?.();
    } catch {
      el.focus();
      el.click();
    }
  };
  return (
    <div className="dashboard-date-row">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        autoComplete="off"
        value={brValue}
        onChange={onBrInputChange}
        lang="pt-BR"
      />
      <input
        ref={dateRef}
        type="date"
        className="dashboard-date-native-hidden"
        value={isoValue || ''}
        onChange={(e) => onIsoPicked(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className="dashboard-date-calendar-btn"
        onClick={openCalendar}
        aria-label={ariaLabelCalendar}
        title="Abrir calendário"
      >
        <span aria-hidden="true">📅</span>
      </button>
    </div>
  );
}
