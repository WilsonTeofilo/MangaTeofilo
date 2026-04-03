import React, { useCallback, useState } from 'react';
import './ChapterShareBar.css';

function buildShareText(title, url) {
  const t = String(title || '').trim();
  return t ? `${t} — ${url}` : url;
}

export default function ChapterShareBar({ shareUrl, chapterTitle }) {
  const [copied, setCopied] = useState(false);
  const url = String(shareUrl || (typeof window !== 'undefined' ? window.location.href : '')).trim();
  const text = buildShareText(chapterTitle, url);

  const openShare = useCallback(
    (href) => {
      if (!href) return;
      window.open(href, '_blank', 'noopener,noreferrer');
    },
    []
  );

  const copyLink = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
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
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2200);
      } catch {
        /* ignore */
      }
    }
  }, [url]);

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
          className="chapter-share-bar__btn chapter-share-bar__btn--insta"
          onClick={copyLink}
          aria-label="Copiar link para colar no Instagram ou outros apps"
          title="Copiar link (Instagram e outros)"
        >
          <i className="fa-brands fa-instagram" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`chapter-share-bar__btn chapter-share-bar__btn--copy${copied ? ' is-copied' : ''}`}
          onClick={copyLink}
          aria-label="Copiar link do capítulo"
          title="Copiar link"
        >
          {copied ? <i className="fa-solid fa-check" aria-hidden="true" /> : <i className="fa-solid fa-link" aria-hidden="true" />}
        </button>
      </div>
      {copied ? (
        <p className="chapter-share-bar__copied" role="status">
          Link copiado
        </p>
      ) : null}
    </section>
  );
}
