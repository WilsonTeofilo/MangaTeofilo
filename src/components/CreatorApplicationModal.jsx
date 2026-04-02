import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ageFromBirthDateLocal,
  formatBirthDateIsoToBr,
  normalizeBirthDateBrTyping,
  parseBirthDateBr,
  parseBirthDateLocal,
} from '../utils/birthDateAge';
import { CREATOR_BIO_MAX_LENGTH, CREATOR_BIO_MIN_LENGTH } from '../constants';
import { isValidBrazilianCpfDigits } from '../utils/cpfValidate';
import {
  applyPixDraftChange,
  coercePayoutPixType,
  normalizePixKeyForStorage,
  PAYOUT_PIX_TYPE_OPTIONS,
  pixKeyPlaceholder,
  storedPixKeyToDraft,
  validateNormalizedPixKey,
} from '../utils/pixKeyInput';
import {
  legalFullNameHasMinThreeWords,
  sanitizeCpfDigitsInput,
  sanitizeLegalFullNameInput,
} from '../utils/creatorRecord';
import {
  applyResponsiveDragDelta,
  createResponsiveDragSnapshot,
} from '../utils/responsiveCrop';
import {
  buildCreatorProfileEditorStyle,
  getCreatorProfileZoomBounds,
  loadCreatorProfileImageFromFile,
  normalizeCreatorProfileAdjustment,
  renderCreatorHeroPreviewDataUrl,
  renderCreatorProfilePreviewDataUrl,
  validateCreatorProfileImageFile,
} from '../utils/creatorProfileImage';
import './CreatorApplicationModal.css';

export default function CreatorApplicationModal({
  open,
  onClose,
  loading = false,
  initial = {},
  onSubmit,
  variant = 'modal',
}) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [monetizationPreference, setMonetizationPreference] = useState('publish_only');
  const [birthDate, setBirthDate] = useState('');
  const [birthDateDraft, setBirthDateDraft] = useState('');
  const [legalFullName, setLegalFullName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [payoutPixType, setPayoutPixType] = useState('cpf');
  const [pixKeyDraft, setPixKeyDraft] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [acceptFinancialTerms, setAcceptFinancialTerms] = useState(false);
  const [localError, setLocalError] = useState('');
  const [creatorProfileImageFile, setCreatorProfileImageFile] = useState(null);
  const [creatorProfileImageUrl, setCreatorProfileImageUrl] = useState('');
  const [creatorProfileImageDims, setCreatorProfileImageDims] = useState(null);
  const [creatorProfileImageAdjustment, setCreatorProfileImageAdjustment] = useState(
    normalizeCreatorProfileAdjustment()
  );
  const [creatorProfilePreviewUrl, setCreatorProfilePreviewUrl] = useState('');
  const [creatorHeroPreviewUrl, setCreatorHeroPreviewUrl] = useState('');
  const editorRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (variant === 'modal' && !open) return;
    setLocalError('');
    setDisplayName(String(initial.displayName || '').trim().slice(0, 60));
    setBio(String(initial.bio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH));
    setInstagramUrl(String(initial.instagramUrl || '').trim());
    setYoutubeUrl(String(initial.youtubeUrl || '').trim());
    setMonetizationPreference(
      String(initial.monetizationPreference || 'publish_only').toLowerCase() === 'monetize'
        ? 'monetize'
        : 'publish_only'
    );
    const bdInit = String(initial.birthDate || '').trim();
    const isoOk = bdInit && parseBirthDateLocal(bdInit) ? bdInit : '';
    setBirthDate(isoOk);
    setBirthDateDraft(isoOk ? formatBirthDateIsoToBr(isoOk) : '');
    setLegalFullName(sanitizeLegalFullNameInput(String(initial.legalFullName || '').trim()));
    setTaxId(sanitizeCpfDigitsInput(initial.taxId));
    const storedKey = String(initial.payoutInstructions || '').trim();
    const declared = String(initial.payoutPixType || '').trim().toLowerCase();
    let t = coercePayoutPixType(declared, storedKey);
    if (!storedKey && !declared) t = 'cpf';
    setPayoutPixType(t);
    setPixKeyDraft(storedKey ? storedPixKeyToDraft(t, storedKey) : '');
    setTermsAccepted(Boolean(initial.termsAccepted));
    setAcceptFinancialTerms(false);
    setCreatorProfileImageFile(null);
    setCreatorProfileImageUrl('');
    setCreatorProfileImageDims(null);
    setCreatorProfileImageAdjustment(normalizeCreatorProfileAdjustment(initial.profileImageCrop));
    setCreatorProfilePreviewUrl('');
    setCreatorHeroPreviewUrl('');
  }, [
    open,
    variant,
    initial.displayName,
    initial.bio,
    initial.instagramUrl,
    initial.youtubeUrl,
    initial.monetizationPreference,
    initial.termsAccepted,
    initial.birthDate,
    initial.legalFullName,
    initial.taxId,
    initial.payoutInstructions,
    initial.payoutPixType,
    initial.profileImageCrop,
  ]);

  const pixKeyNormalized = useMemo(
    () => normalizePixKeyForStorage(payoutPixType, pixKeyDraft),
    [payoutPixType, pixKeyDraft]
  );

  const pixKeyFeedback = useMemo(
    () => validateNormalizedPixKey(payoutPixType, pixKeyNormalized),
    [payoutPixType, pixKeyNormalized]
  );

  const birthIsoEffective =
    parseBirthDateBr(birthDateDraft) || (parseBirthDateLocal(birthDate) ? birthDate : '');
  const ageInForm = birthIsoEffective ? ageFromBirthDateLocal(birthIsoEffective) : null;
  const minorInForm = ageInForm != null && ageInForm < 18;
  const creatorImageZoomBounds = useMemo(
    () => getCreatorProfileZoomBounds(creatorProfileImageDims),
    [creatorProfileImageDims]
  );
  const creatorImageEditorStyle = useMemo(
    () => buildCreatorProfileEditorStyle(creatorProfileImageDims, creatorProfileImageAdjustment),
    [creatorProfileImageDims, creatorProfileImageAdjustment]
  );

  useEffect(() => {
    if (variant === 'modal' && !open) return;
    if (minorInForm && monetizationPreference === 'monetize') {
      setMonetizationPreference('publish_only');
    }
  }, [open, variant, minorInForm, monetizationPreference]);

  const handleSelectCreatorPhoto = useCallback((file) => {
    if (!file) return;
    const fileError = validateCreatorProfileImageFile(file);
    if (fileError) {
      setLocalError(fileError);
      return;
    }
    setLocalError('');
    setCreatorProfileImageAdjustment(normalizeCreatorProfileAdjustment());
    setCreatorProfileImageFile(file);
  }, []);

  const handleStartImageDrag = useCallback((event) => {
    if (!creatorProfileImageDims || !editorRef.current || !creatorProfileImageUrl) return;
    event.preventDefault();
    const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
    const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
    const box = editorRef.current.getBoundingClientRect();
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      adjustment: creatorProfileImageAdjustment,
      maxZoom: creatorImageZoomBounds.maxZoom,
      snapshot: createResponsiveDragSnapshot(
        creatorProfileImageDims.w,
        creatorProfileImageDims.h,
        Math.max(1, box.width),
        Math.max(1, box.height),
        creatorProfileImageAdjustment,
        { maxZoomCap: creatorImageZoomBounds.maxZoom }
      ),
    };
    document.body.style.userSelect = 'none';
  }, [
    creatorProfileImageAdjustment,
    creatorProfileImageDims,
    creatorImageZoomBounds.maxZoom,
    creatorProfileImageUrl,
  ]);

  useEffect(() => {
    if (variant === 'modal' && !open) return undefined;
    if (variant === 'modal') {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const onKey = (e) => {
        if (e.key === 'Escape' && !loading) onClose();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        document.body.style.overflow = prev;
        window.removeEventListener('keydown', onKey);
      };
    }
    const onKey = (e) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, variant, loading, onClose]);

  useEffect(() => {
    if (!creatorProfileImageFile) {
      setCreatorProfileImageUrl('');
      setCreatorProfileImageDims(null);
      setCreatorProfilePreviewUrl('');
      setCreatorHeroPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(creatorProfileImageFile);
    setCreatorProfileImageUrl(objectUrl);

    let cancelled = false;
    loadCreatorProfileImageFromFile(creatorProfileImageFile)
      .then((img) => {
        if (cancelled) return;
        const dims = {
          w: Number(img.naturalWidth || img.width || 0),
          h: Number(img.naturalHeight || img.height || 0),
        };
        setCreatorProfileImageDims(dims);
        setCreatorProfileImageAdjustment((prev) => normalizeCreatorProfileAdjustment(prev, dims));
        setCreatorProfilePreviewUrl(renderCreatorProfilePreviewDataUrl(img, creatorProfileImageAdjustment));
        setCreatorHeroPreviewUrl(renderCreatorHeroPreviewDataUrl(img, creatorProfileImageAdjustment));
      })
      .catch((err) => {
        if (!cancelled) {
          setLocalError(err?.message || 'Nao foi possivel preparar a foto do creator.');
        }
      });

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorProfileImageFile]);

  useEffect(() => {
    if (!creatorProfileImageFile) return undefined;
    let cancelled = false;
    loadCreatorProfileImageFromFile(creatorProfileImageFile)
      .then((img) => {
        if (cancelled) return;
        setCreatorProfilePreviewUrl(renderCreatorProfilePreviewDataUrl(img, creatorProfileImageAdjustment));
        setCreatorHeroPreviewUrl(renderCreatorHeroPreviewDataUrl(img, creatorProfileImageAdjustment));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [creatorProfileImageAdjustment, creatorProfileImageFile]);

  useEffect(() => {
    const onMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const clientX = event.clientX ?? event.touches?.[0]?.clientX ?? 0;
      const clientY = event.clientY ?? event.touches?.[0]?.clientY ?? 0;
      const deltaX = clientX - drag.startX;
      const deltaY = clientY - drag.startY;
      setCreatorProfileImageAdjustment(
        applyResponsiveDragDelta(drag.adjustment, drag.snapshot, deltaX, deltaY, {
          maxZoomCap: drag.maxZoom,
        })
      );
    };

    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      document.body.style.userSelect = '';
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    setLocalError('');
    if (String(displayName || '').trim().length < 3) {
      setLocalError('Informe um nome artístico com pelo menos 3 caracteres.');
      return;
    }
    const bioTrim = String(bio || '').trim();
    if (bioTrim.length < CREATOR_BIO_MIN_LENGTH) {
      setLocalError(`Escreva uma bio com pelo menos ${CREATOR_BIO_MIN_LENGTH} caracteres.`);
      return;
    }
    if (bioTrim.length > CREATOR_BIO_MAX_LENGTH) {
      setLocalError(`A bio pode ter no máximo ${CREATOR_BIO_MAX_LENGTH} caracteres.`);
      return;
    }
    if (!creatorProfileImageFile) {
      setLocalError('Selecione a foto que vai virar seu perfil de creator.');
      return;
    }
    const birthIsoFinal =
      parseBirthDateBr(birthDateDraft) || (parseBirthDateLocal(birthDate) ? birthDate : '');
    if (!parseBirthDateLocal(birthIsoFinal)) {
      setLocalError('Informe sua data de nascimento em dia/mês/ano (ex.: 28/12/2001).');
      return;
    }
    const age = ageFromBirthDateLocal(birthIsoFinal);
    if (age == null) {
      setLocalError('Data de nascimento inválida.');
      return;
    }
    const wantsMonetize = monetizationPreference === 'monetize';
    let pixNorm = '';
    if (wantsMonetize) {
      if (age < 18) {
        setLocalError('Menores de 18 anos não podem solicitar monetização nesta plataforma.');
        return;
      }
      if (!legalFullNameHasMinThreeWords(legalFullName)) {
        setLocalError('Para monetizar, informe nome completo legal com pelo menos três partes (ex.: Nome Sobrenome Filho).');
        return;
      }
      const cpfDigits = sanitizeCpfDigitsInput(taxId);
      if (!isValidBrazilianCpfDigits(cpfDigits)) {
        setLocalError('Para monetizar, informe um CPF válido (documento).');
        return;
      }
      pixNorm = normalizePixKeyForStorage(payoutPixType, pixKeyDraft);
      const pixFb = validateNormalizedPixKey(payoutPixType, pixNorm);
      if (!pixFb.ok) {
        setLocalError(pixFb.message || 'Chave PIX inválida.');
        return;
      }
      if (!acceptFinancialTerms) {
        setLocalError('Aceite os termos financeiros e de repasse para solicitar monetização.');
        return;
      }
    }
    if (!termsAccepted) {
      setLocalError('Aceite os termos do programa de criadores.');
      return;
    }
    try {
      await onSubmit({
        displayName: String(displayName || '').trim(),
        bioShort: bioTrim,
        birthDate: birthIsoFinal,
        instagramUrl: String(instagramUrl || '').trim(),
        youtubeUrl: String(youtubeUrl || '').trim(),
        monetizationPreference,
        acceptTerms: true,
        legalFullName: wantsMonetize ? String(legalFullName || '').trim() : '',
        taxId: wantsMonetize ? sanitizeCpfDigitsInput(taxId) : '',
        payoutInstructions: wantsMonetize ? pixNorm : '',
        payoutPixType: wantsMonetize ? payoutPixType : '',
        acceptFinancialTerms: wantsMonetize ? acceptFinancialTerms === true : false,
        creatorProfileImageFile,
        creatorProfileImageAdjustment,
      });
    } catch (err) {
      setLocalError(err?.message || 'Não foi possível enviar agora.');
    }
  }, [
    displayName,
    bio,
    birthDate,
    birthDateDraft,
    legalFullName,
    taxId,
    payoutPixType,
    pixKeyDraft,
    monetizationPreference,
    acceptFinancialTerms,
    termsAccepted,
    instagramUrl,
    youtubeUrl,
    creatorProfileImageFile,
    creatorProfileImageAdjustment,
    onSubmit,
  ]);

  if (variant === 'modal' && !open) return null;

  const monetizationAllowed = ageInForm != null && ageInForm >= 18;
  const showMonetizationCompliance = monetizationPreference === 'monetize' && monetizationAllowed;

  const modalCard = (
    <div
      className={`creator-app-modal${variant === 'page' ? ' creator-app-modal--page' : ''}`}
      role={variant === 'modal' ? 'dialog' : 'region'}
      aria-modal={variant === 'modal' ? true : undefined}
      aria-labelledby="creator-app-modal-title"
    >
      <div className="creator-app-modal__head">
        <div>
          <h2 id="creator-app-modal-title">Virar criador</h2>
          <p>Seu perfil vai para revisao humana antes de entrar no ar. A foto abaixo so ativa quando a equipe aprovar.</p>
        </div>
        <button
          type="button"
          className="creator-app-modal__close"
          aria-label="Fechar"
          disabled={loading}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="creator-app-modal__body">
        {localError ? (
          <p className="creator-app-modal__hint" style={{ color: '#fca5a5' }}>
            {localError}
          </p>
        ) : null}

        <section className="creator-app-photo-card" aria-label="Foto publica do creator">
          <div className="creator-app-photo-card__head">
            <div>
              <p className="creator-app-modal__section-title">Identidade visual do creator</p>
              <p className="creator-app-modal__hint">
                Escolha uma foto sua ou da marca do autor. Ela vira o retrato 3:4 e reaparece no topo 16:9 com blur leve.
              </p>
            </div>
            <label className="creator-app-photo-upload">
              <span>Escolher foto</span>
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                hidden
                disabled={loading}
                onChange={(e) => {
                  handleSelectCreatorPhoto(e.target.files?.[0] || null);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          <div className="creator-app-photo-meta">
            <span>Maximo 1,2MB</span>
            <span>Saida otimizada em WebP (~300KB)</span>
            <span>Ativa so depois da aprovacao do admin</span>
          </div>

          <div className="creator-app-photo-grid">
            <div className="creator-app-photo-editor-shell">
              <div
                ref={editorRef}
                className={`creator-app-photo-editor${creatorProfileImageUrl ? ' is-editable' : ''}`}
                onMouseDown={handleStartImageDrag}
                onTouchStart={handleStartImageDrag}
              >
                {creatorProfileImageUrl ? (
                  <>
                    <img
                      src={creatorProfileImageUrl}
                      alt=""
                      aria-hidden="true"
                      className="creator-app-photo-editor__img creator-app-photo-editor__img--bg"
                    />
                    <img
                      src={creatorProfileImageUrl}
                      alt="Ajuste da foto do creator"
                      className="creator-app-photo-editor__img creator-app-photo-editor__img--fg"
                      style={creatorImageEditorStyle}
                    />
                  </>
                ) : (
                  <div className="creator-app-photo-empty">
                    <strong>Envie uma foto para comecar</strong>
                    <span>Retrato 3:4 para o perfil e hero reutilizado no estilo Manga Plus Creators.</span>
                  </div>
                )}
              </div>

              <div className="creator-app-photo-controls">
                <label>
                  Zoom ({creatorProfileImageAdjustment.zoom.toFixed(2)}x)
                  <input
                    type="range"
                    min={creatorImageZoomBounds.coverZoom || 1}
                    max={creatorImageZoomBounds.maxZoom}
                    step="0.01"
                    value={creatorProfileImageAdjustment.zoom}
                    disabled={!creatorProfileImageUrl || loading}
                    onChange={(e) =>
                      setCreatorProfileImageAdjustment((prev) =>
                        normalizeCreatorProfileAdjustment(
                          { ...prev, zoom: Number(e.target.value) },
                          creatorProfileImageDims
                        )
                      )
                    }
                  />
                </label>
                <label>
                  Horizontal ({Math.round(creatorProfileImageAdjustment.x)}%)
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={creatorProfileImageAdjustment.x}
                    disabled={!creatorProfileImageUrl || loading}
                    onChange={(e) =>
                      setCreatorProfileImageAdjustment((prev) =>
                        normalizeCreatorProfileAdjustment(
                          { ...prev, x: Number(e.target.value) },
                          creatorProfileImageDims
                        )
                      )
                    }
                  />
                </label>
                <label>
                  Vertical ({Math.round(creatorProfileImageAdjustment.y)}%)
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={creatorProfileImageAdjustment.y}
                    disabled={!creatorProfileImageUrl || loading}
                    onChange={(e) =>
                      setCreatorProfileImageAdjustment((prev) =>
                        normalizeCreatorProfileAdjustment(
                          { ...prev, y: Number(e.target.value) },
                          creatorProfileImageDims
                        )
                      )
                    }
                  />
                </label>
              </div>
            </div>

            <div className="creator-app-photo-preview-shell">
              <div className="creator-app-photo-preview creator-app-photo-preview--hero">
                {creatorHeroPreviewUrl ? (
                  <div
                    className="creator-app-hero-mock"
                    style={{ backgroundImage: `linear-gradient(180deg, rgba(7, 10, 14, 0.16), rgba(7, 10, 14, 0.92)), url('${creatorHeroPreviewUrl}')` }}
                  >
                    <div className="creator-app-hero-mock__blur" style={{ backgroundImage: `url('${creatorHeroPreviewUrl}')` }} />
                    <div className="creator-app-hero-mock__content">
                      <div className="creator-app-hero-mock__avatar">
                        {creatorProfilePreviewUrl ? <img src={creatorProfilePreviewUrl} alt="Previa do avatar do creator" /> : null}
                      </div>
                      <div className="creator-app-hero-mock__text">
                        <span className="creator-app-hero-mock__pill">creator preview</span>
                        <strong>{displayName || 'Nome artistico'}</strong>
                        <p>{bio || 'Sua bio curta aparece aqui para o leitor ter contexto imediato.'}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="creator-app-photo-placeholder">A capa 16:9 aparece aqui em tempo real.</div>
                )}
              </div>

              <div className="creator-app-photo-preview creator-app-photo-preview--profile">
                {creatorProfilePreviewUrl ? (
                  <img src={creatorProfilePreviewUrl} alt="Previa final do perfil do creator" />
                ) : (
                  <div className="creator-app-photo-placeholder">O retrato 3:4 aparece aqui.</div>
                )}
              </div>
            </div>
          </div>
        </section>

        <label className="creator-app-modal__label">
          Data de nascimento
          <input
            type="text"
            inputMode="numeric"
            autoComplete="bday"
            placeholder="28/12/2001"
            className="creator-app-modal__input"
            value={birthDateDraft}
            disabled={loading}
            onChange={(e) => {
              const d = normalizeBirthDateBrTyping(e.target.value);
              setBirthDateDraft(d);
              const iso = parseBirthDateBr(d);
              if (iso) setBirthDate(iso);
              else if (!d.replace(/\D/g, '').length) setBirthDate('');
            }}
            onBlur={() => {
              const iso = parseBirthDateBr(birthDateDraft);
              if (iso) {
                setBirthDate(iso);
                setBirthDateDraft(formatBirthDateIsoToBr(iso));
              } else if (!birthDateDraft.replace(/\D/g, '').length) {
                setBirthDate('');
                setBirthDateDraft('');
              } else {
                setBirthDateDraft(
                  birthDate && parseBirthDateLocal(birthDate) ? formatBirthDateIsoToBr(birthDate) : ''
                );
              }
            }}
          />
        </label>

        <label className="creator-app-modal__label">
          Objetivo
          <div className="creator-app-modal__toggles">
            <button
              type="button"
              className={`creator-app-modal__toggle${monetizationPreference === 'publish_only' ? ' is-on' : ''}`}
              onClick={() => setMonetizationPreference('publish_only')}
            >
              Apenas publicar
            </button>
            <button
              type="button"
              className={`creator-app-modal__toggle${monetizationPreference === 'monetize' ? ' is-on' : ''}`}
              disabled={!monetizationAllowed}
              onClick={() => setMonetizationPreference('monetize')}
            >
              Quero monetizar
            </button>
          </div>
          <p className="creator-app-modal__hint">
            {!parseBirthDateLocal(birthDate)
              ? 'Informe a data de nascimento para liberar a opção de monetização.'
              : !monetizationAllowed
                ? 'Você pode publicar, mas não pode monetizar devido à idade. Conteúdo e repasse financeiro ficam separados por segurança jurídica.'
                : 'Publicar e receber via plataforma são caminhos diferentes: com monetização, pedimos dados legais e de repasse.'}
          </p>
        </label>

        {showMonetizationCompliance ? (
          <div className="creator-app-modal__compliance">
            <p className="creator-app-modal__section-title">Dados para monetização (maiores de 18)</p>
            <label className="creator-app-modal__label">
              Nome completo (documento)
              <input
                className="creator-app-modal__input"
                value={legalFullName}
                onChange={(e) => setLegalFullName(sanitizeLegalFullNameInput(e.target.value))}
                placeholder="Como consta no CPF"
                autoComplete="name"
              />
            </label>
            <label className="creator-app-modal__label">
              CPF (11 dígitos, só números)
              <input
                className="creator-app-modal__input"
                value={taxId}
                onChange={(e) => setTaxId(sanitizeCpfDigitsInput(e.target.value))}
                placeholder="00000000000"
                autoComplete="off"
                inputMode="numeric"
                maxLength={11}
              />
            </label>
            <div className="creator-app-modal__pix-block">
              <p className="creator-app-modal__section-title" style={{ marginBottom: 8 }}>
                Chave PIX (repasse manual)
              </p>
              <label className="creator-app-modal__label">
                Tipo da chave
                <select
                  className="creator-app-modal__select"
                  value={payoutPixType}
                  disabled={loading}
                  onChange={(e) => {
                    setPayoutPixType(e.target.value);
                    setPixKeyDraft('');
                    setLocalError('');
                  }}
                >
                  {PAYOUT_PIX_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="creator-app-modal__label">
                {payoutPixType === 'cpf'
                  ? 'CPF (chave PIX)'
                  : payoutPixType === 'email'
                    ? 'E-mail'
                    : payoutPixType === 'phone'
                      ? 'Telefone (com DDD)'
                      : 'Chave aleatória (UUID)'}
                {payoutPixType === 'random' ? (
                  <textarea
                    className="creator-app-modal__textarea creator-app-modal__textarea--pix-random"
                    value={pixKeyDraft}
                    disabled={loading}
                    onChange={(e) => setPixKeyDraft(e.target.value)}
                    placeholder={pixKeyPlaceholder('random')}
                    rows={2}
                    spellCheck={false}
                    autoComplete="off"
                  />
                ) : (
                  <input
                    type="text"
                    className="creator-app-modal__input"
                    value={pixKeyDraft}
                    disabled={loading}
                    inputMode={payoutPixType === 'email' ? 'email' : 'numeric'}
                    autoComplete="off"
                    placeholder={pixKeyPlaceholder(payoutPixType)}
                    onChange={(e) => setPixKeyDraft(applyPixDraftChange(payoutPixType, e.target.value))}
                  />
                )}
              </label>
              {pixKeyDraft.length > 0 ? (
                pixKeyFeedback.ok ? (
                  <p className="creator-app-modal__pix-feedback creator-app-modal__pix-feedback--ok" role="status">
                    Chave válida — será salva sem máscara.
                  </p>
                ) : (
                  <p className="creator-app-modal__pix-feedback creator-app-modal__pix-feedback--err" role="alert">
                    {pixKeyFeedback.message}
                  </p>
                )
              ) : (
                <p className="creator-app-modal__hint">
                  O valor enviado ao servidor fica normalizado (sem pontuação de CPF/telefone).
                </p>
              )}
            </div>
          </div>
        ) : null}

        <label className="creator-app-modal__label">
          Nome artístico
          <input
            className="creator-app-modal__input"
            value={displayName}
            maxLength={60}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Como você quer aparecer publicamente"
          />
        </label>

        <label className="creator-app-modal__label">
          Bio curta do criador
          <textarea
            className="creator-app-modal__textarea"
            value={bio}
            maxLength={CREATOR_BIO_MAX_LENGTH}
            onChange={(e) => setBio(e.target.value.slice(0, CREATOR_BIO_MAX_LENGTH))}
            placeholder="Explique em 1 ou 2 linhas quem você é e o que cria."
            rows={3}
          />
        </label>

        <p className="creator-app-modal__section-title">Redes sociais (opcional)</p>
        <div className="creator-app-modal__row">
          <label className="creator-app-modal__label">
            Instagram
            <input
              className="creator-app-modal__input"
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              placeholder="instagram.com/seuperfil"
            />
          </label>
          <label className="creator-app-modal__label">
            YouTube
            <input
              className="creator-app-modal__input"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="youtube.com/@seucanal"
            />
          </label>
        </div>

        <label className="creator-app-modal__check">
          <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
          <span>
            Aceito os termos do programa de criadores e entendo que a aprovação não substitui o onboarding.
          </span>
        </label>

        {showMonetizationCompliance ? (
          <label className="creator-app-modal__check">
            <input
              type="checkbox"
              checked={acceptFinancialTerms}
              onChange={(e) => setAcceptFinancialTerms(e.target.checked)}
            />
            <span>
              Li e aceito os termos financeiros e de repasse relacionados à monetização na plataforma.
            </span>
          </label>
        ) : null}

        <button type="button" className="creator-app-modal__submit" disabled={loading} onClick={handleSubmit}>
          {loading ? 'Enviando...' : 'Enviar solicitação'}
        </button>
      </div>
    </div>
  );

  if (variant === 'page') {
    return <div className="creator-app-modal-page-shell">{modalCard}</div>;
  }

  return createPortal(
    <div
      className="creator-app-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      {modalCard}
    </div>,
    document.body
  );
}
