import React, { useCallback, useState } from 'react';
import './ChapterShareBar.css';

function buildShareText(title, url) {
  const t = String(title || '').trim();
  return t ? `${t} — ${url}` : url;
}

export default function ChapterShareBar({ shareUrl, chapterTitle }) {
  const [feedback, setFeedback] = useState(null);
  const url = String(shareUrl || (typeof window !== 'undefined' ? window.location.href : '')).trim();
  const text = buildShareText(chapterTitle, url);

  const copyLinkToClipboard = useCallback(async () => {
    if (!url) return false;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  }, [url]);

  const showFeedback = useCallback((kind) => {
    setFeedback(kind);
    window.setTimeout(() => setFeedback(null), kind === 'instagram' ? 4500 : 2200);
  }, []);

  const copyLink = useCallback(async () => {
    const ok = await copyLinkToClipboard();
    if (ok) showFeedback('copy');
  }, [copyLinkToClipboard, showFeedback]);

  const openShare = useCallback((href) => {
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

  /**
   * Instagram não expõe URL de “compartilhar com texto” na web como WhatsApp.
   * Copiamos o link e abrimos instagram.com (PC) ou tentamos o app + site (mobile).
   */
  const shareInstagram = useCallback(async () => {
    await copyLinkToClipboard();
    showFeedback('instagram');

    const instaWeb = 'https://www.instagram.com/';
    window.open(instaWeb, '_blank', 'noopener,noreferrer');

    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (mobile) {
      try {
        const a = document.createElement('a');
        a.href = 'instagram://app';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch {
        /* ignore */
      }
    }
  }, [copyLinkToClipboard, showFeedback]);

  if (!url) return null;

  const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const tw = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  const tg = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(
    String(chapterTitle || '').trim() || 'Capítulo'
  )}`;

  return (
    <section className="chapter-share-bar" aria-label="Compartilhar capítulo">
      <p className="chapter-share-bar__title">Compartilhar este capítulo</p>
      <div className="chapter-share-bar__row">
        <button
          type="button"
          className="chapter-share-bar__btn"
          onClick={() => openShare(wa)}
          aria-label="Compartilhar no WhatsApp"
          title="WhatsApp"
        >
          <i className="fa-brands fa-whatsapp" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chapter-share-bar__btn"
          onClick={() => openShare(fb)}
          aria-label="Compartilhar no Facebook"
          title="Facebook"
        >
          <i className="fa-brands fa-facebook-f" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chapter-share-bar__btn"
          onClick={() => openShare(tw)}
          aria-label="Compartilhar no X"
          title="X (Twitter)"
        >
          <i className="fa-brands fa-x-twitter" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chapter-share-bar__btn"
          onClick={() => openShare(tg)}
          aria-label="Compartilhar no Telegram"
          title="Telegram"
        >
          <i className="fa-brands fa-telegram" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`chapter-share-bar__btn chapter-share-bar__btn--insta${feedback === 'instagram' ? ' is-copied' : ''}`}
          onClick={() => void shareInstagram()}
          aria-label="Copiar link e abrir o Instagram"
          title="Instagram — copia o link e abre o site ou o app"
        >
          <i className="fa-brands fa-instagram" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`chapter-share-bar__btn chapter-share-bar__btn--copy${feedback === 'copy' ? ' is-copied' : ''}`}
          onClick={() => void copyLink()}
          aria-label="Copiar link do capítulo"
          title="Copiar link"
        >
          {feedback === 'copy' ? (
            <i className="fa-solid fa-check" aria-hidden="true" />
          ) : (
            <i className="fa-solid fa-link" aria-hidden="true" />
          )}
        </button>
      </div>
      {feedback === 'copy' ? (
        <p className="chapter-share-bar__copied" role="status">
          Link copiado
        </p>
      ) : null}
      {feedback === 'instagram' ? (
        <p className="chapter-share-bar__copied chapter-share-bar__copied--insta" role="status">
          Link copiado. Abrimos o Instagram no navegador — no celular, o app pode abrir também; se não abrir, cole o link num story ou post.
        </p>
      ) : null}
    </section>
  );
}
