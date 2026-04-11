import React from 'react';

export default function ChapterFollowCallout({
  isSubscribedCurrentWork,
  subscribeCurrentWorkBusy,
  onSubscribe,
}) {
  return (
    <section className="leitor-next-alert">
      <strong>Quer continuar recebendo?</strong>
      <p>Ative o acompanhamento desta obra e os próximos capítulos vão cair automaticamente no seu sino.</p>
      <button
        type="button"
        className="leitor-next-alert-btn"
        disabled={subscribeCurrentWorkBusy}
        onClick={onSubscribe}
      >
        {subscribeCurrentWorkBusy
          ? 'Salvando...'
          : isSubscribedCurrentWork
            ? 'Você já acompanha esta obra'
            : 'Acompanhar obra'}
      </button>
    </section>
  );
}
