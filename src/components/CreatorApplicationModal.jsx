import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ageFromBirthDateLocal,
  formatBirthDateIsoToBr,
  normalizeBirthDateBrTyping,
  parseBirthDateBr,
  parseBirthDateLocal,
} from '../utils/birthDateAge';
import {
  CREATOR_BIO_MAX_LENGTH,
  CREATOR_BIO_MIN_LENGTH,
  CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY,
} from '../constants';
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
import { validateCreatorSocialLinks } from '../utils/creatorSocialLinks';
import {
  applyResponsiveDragDelta,
  createResponsiveDragSnapshot,
} from '../utils/responsiveCrop';
import {
  buildCreatorProfileEditorStyle,
  getCreatorProfileZoomBounds,
  loadCreatorProfileImageFromFile,
  loadCreatorProfileImageFromUrl,
  normalizeCreatorProfileAdjustment,
  renderCreatorHeroPreviewDataUrl,
  renderCreatorProfilePreviewDataUrl,
  serializeCreatorProfileCrop,
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
  intent = 'signup',
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
  const remoteProfileImageElRef = useRef(null);

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
    initial.existingProfileImageUrl,
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
    if (intent === 'mangaka_monetize') {
      if (!minorInForm) setMonetizationPreference('monetize');
      return;
    }
    if (minorInForm && monetizationPreference === 'monetize') {
      setMonetizationPreference('publish_only');
    }
  }, [open, variant, intent, minorInForm, monetizationPreference]);

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
    if (variant === 'modal' && !open) return undefined;
    remoteProfileImageElRef.current = null;

    if (creatorProfileImageFile) {
      const objectUrl = URL.createObjectURL(creatorProfileImageFile);
      setCreatorProfileImageUrl(objectUrl);

      let cancelled = false;
      loadCreatorProfileImageFromFile(creatorProfileImageFile)
        .then((img) => {
          if (cancelled) return;
          remoteProfileImageElRef.current = img;
          const dims = {
            w: Number(img.naturalWidth || img.width || 0),
            h: Number(img.naturalHeight || img.height || 0),
          };
          const normalizedAdjustment = normalizeCreatorProfileAdjustment(
            creatorProfileImageAdjustment,
            dims
          );
          setCreatorProfileImageDims(dims);
          setCreatorProfileImageAdjustment(normalizedAdjustment);
          setCreatorProfilePreviewUrl(renderCreatorProfilePreviewDataUrl(img, normalizedAdjustment));
          setCreatorHeroPreviewUrl(renderCreatorHeroPreviewDataUrl(img, normalizedAdjustment));
        })
        .catch((err) => {
          if (!cancelled) {
            setLocalError(err?.message || 'Nao foi possivel preparar a foto do creator.');
          }
        });

      return () => {
        cancelled = true;
        URL.revokeObjectURL(objectUrl);
        remoteProfileImageElRef.current = null;
      };
    }

    const existing = String(initial.existingProfileImageUrl || '').trim();
    const hasExisting =
      /^https:\/\//i.test(existing) && existing.length >= 12 && existing.length <= 2048;
    if (!hasExisting) {
      setCreatorProfileImageUrl('');
      setCreatorProfileImageDims(null);
      setCreatorProfilePreviewUrl('');
      setCreatorHeroPreviewUrl('');
      return undefined;
    }

    let cancelled = false;
    setCreatorProfileImageUrl(existing);
    const cropFromInitial = initial.profileImageCrop;
    loadCreatorProfileImageFromUrl(existing)
      .then((img) => {
        if (cancelled) return;
        remoteProfileImageElRef.current = img;
        const dims = {
          w: Number(img.naturalWidth || img.width || 0),
          h: Number(img.naturalHeight || img.height || 0),
        };
        const normalizedAdjustment = normalizeCreatorProfileAdjustment(cropFromInitial, dims);
        setCreatorProfileImageDims(dims);
        setCreatorProfileImageAdjustment(normalizedAdjustment);
        setCreatorProfilePreviewUrl(renderCreatorProfilePreviewDataUrl(img, normalizedAdjustment));
        setCreatorHeroPreviewUrl(renderCreatorHeroPreviewDataUrl(img, normalizedAdjustment));
      })
      .catch(() => {
        if (cancelled) return;
        setCreatorProfileImageDims(null);
        setCreatorProfilePreviewUrl('');
        setCreatorHeroPreviewUrl('');
      });

    return () => {
      cancelled = true;
      remoteProfileImageElRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorProfileImageFile, initial.existingProfileImageUrl, initial.profileImageCrop, open, variant]);

  useEffect(() => {
    if (creatorProfileImageFile) {
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
    }
    const img = remoteProfileImageElRef.current;
    if (!img) return undefined;
    setCreatorProfilePreviewUrl(renderCreatorProfilePreviewDataUrl(img, creatorProfileImageAdjustment));
    setCreatorHeroPreviewUrl(renderCreatorHeroPreviewDataUrl(img, creatorProfileImageAdjustment));
    return undefined;
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
    const bioMin =
      monetizationPreference === 'monetize' ? CREATOR_BIO_MIN_LENGTH : CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY;
    if (bioTrim.length < bioMin) {
      setLocalError(`Escreva uma bio com pelo menos ${bioMin} caracteres.`);
      return;
    }
    if (bioTrim.length > CREATOR_BIO_MAX_LENGTH) {
      setLocalError(`A bio pode ter no máximo ${CREATOR_BIO_MAX_LENGTH} caracteres.`);
      return;
    }
    const existingPhotoUrl = String(initial.existingProfileImageUrl || '').trim();
    const hasExistingHttpsPhoto =
      /^https:\/\//i.test(existingPhotoUrl) &&
      existingPhotoUrl.length >= 12 &&
      existingPhotoUrl.length <= 2048;
    if (!creatorProfileImageFile && !hasExistingHttpsPhoto) {
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
    const socialValidation = validateCreatorSocialLinks({
      instagramUrl,
      youtubeUrl,
      requireOne: true,
    });
    if (!socialValidation.ok) {
      setLocalError(socialValidation.message);
      return;
    }
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
        instagramUrl: socialValidation.instagramUrl,
        youtubeUrl: socialValidation.youtubeUrl,
        monetizationPreference,
        acceptTerms: true,
        legalFullName: wantsMonetize ? String(legalFullName || '').trim() : '',
        taxId: wantsMonetize ? sanitizeCpfDigitsInput(taxId) : '',
        payoutInstructions: wantsMonetize ? pixNorm : '',
        payoutPixType: wantsMonetize ? payoutPixType : '',
        acceptFinancialTerms: wantsMonetize ? acceptFinancialTerms === true : false,
        creatorProfileImageFile,
        creatorProfileImageAdjustment,
        profileImageUrl: !creatorProfileImageFile && hasExistingHttpsPhoto ? existingPhotoUrl : undefined,
        profileImageCrop:
          !creatorProfileImageFile && hasExistingHttpsPhoto
            ? creatorProfileImageDims
              ? serializeCreatorProfileCrop(creatorProfileImageAdjustment, creatorProfileImageDims)
              : initial.profileImageCrop || undefined
            : undefined,
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
    initial.existingProfileImageUrl,
    initial.profileImageCrop,
    creatorProfileImageDims,
  ]);

  if (variant === 'modal' && !open) return null;

  const isMangakaMonetizeIntent = intent === 'mangaka_monetize';
  const monetizationAllowed = ageInForm != null && ageInForm >= 18;
  const showMonetizationCompliance = monetizationPreference === 'monetize' && monetizationAllowed;
  const monetizeToggleDisabled = minorInForm;

  const modalCard = (
    <div
      className={`creator-app-modal${variant === 'page' ? ' creator-app-modal--page' : ''}`}
      role={variant === 'modal' ? 'dialog' : 'region'}
      aria-modal={variant === 'modal' ? true : undefined}
      aria-labelledby="creator-app-modal-title"
    >
      <div className="creator-app-modal__head">
        <div>
          <h2 id="creator-app-modal-title">
            {isMangakaMonetizeIntent ? 'Solicitar monetização' : 'Virar criador'}
          </h2>
          <p>
            {isMangakaMonetizeIntent
              ? 'Envie nome legal, CPF e chave PIX para a equipe analisar. Você continua publicando normalmente até a aprovação.'
              : 'Publicar sem monetizacao entra direto. Se quiser monetizar, seus dados legais e de repasse vao para revisao humana.'}
          </p>
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
                accept="image/jpeg,image/jpg,image/png,image/webp,image/pjpeg,.jpg,.jpeg,.png,.webp"
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
            <span>Maximo 1,5 MB (entrada)</span>
            <span>Saida WebP comprimida (~250 a 400 KB)</span>
            <span>Vai para o ar junto com o perfil de creator aprovado</span>
          </div>
          {String(initial.existingProfileImageUrl || '').trim() && !creatorProfileImageFile ? (
            <p className="creator-app-modal__hint" style={{ marginTop: 8 }}>
              Sua foto já enviada ao perfil foi carregada abaixo. Use &quot;Escolher foto&quot; só se quiser trocar por
              outra imagem.
            </p>
          ) : null}

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
          {isMangakaMonetizeIntent ? 'Pedido' : 'Objetivo'}
          {isMangakaMonetizeIntent ? (
            <p className="creator-app-modal__hint" style={{ marginTop: 6 }}>
              Monetização na plataforma — dados legais e PIX abaixo seguem para revisão do time antes de liberar
              repasses.
            </p>
          ) : (
            <>
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
                  disabled={monetizeToggleDisabled}
                  onClick={() => setMonetizationPreference('monetize')}
                >
                  Quero monetizar
                </button>
              </div>
              <p className="creator-app-modal__hint">
                {minorInForm
                  ? 'Você pode publicar, mas não pode monetizar devido à idade. Conteúdo e repasse financeiro ficam separados por segurança jurídica.'
                  : monetizationPreference === 'monetize' && !monetizationAllowed
                    ? 'Preencha uma data de nascimento válida (18+) para enviar com monetização — os dados legais aparecem abaixo.'
                    : !parseBirthDateLocal(birthDate)
                      ? 'Informe a data de nascimento para concluir a candidatura.'
                      : monetizationPreference === 'monetize'
                        ? 'Publicar e receber via plataforma são caminhos diferentes: com monetização, pedimos dados legais e de repasse.'
                        : 'Modo apenas publicar: seu perfil de criador pode ser liberado na hora, sem repasses até você solicitar monetização depois.'}
              </p>
            </>
          )}
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
          <p className="creator-app-modal__hint">
            Mínimo{' '}
            {monetizationPreference === 'monetize' ? CREATOR_BIO_MIN_LENGTH : CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY}{' '}
            caracteres
            {monetizationPreference === 'monetize' ? ' (com monetização).' : ' (só publicar).'}
          </p>
        </label>

        <p className="creator-app-modal__section-title">Redes sociais (pelo menos uma válida)</p>
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
            Aceito os termos do programa de criadores e entendo que publicar e monetizar sao etapas separadas.
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
          {loading
            ? 'Enviando...'
            : monetizationPreference === 'monetize'
              ? 'Enviar para revisao'
              : 'Liberar meu perfil de creator'}
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
