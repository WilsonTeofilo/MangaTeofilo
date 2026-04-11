import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ageFromBirthDateLocal,
  formatBirthDateIsoToBr,
  normalizeBirthDateBrTyping,
  parseBirthDateBr,
  parseBirthDateFlexible,
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
  formatPixCpfDraft,
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
import { SITE_ORIGIN } from '../config/site';
import './CreatorApplicationModal.css';

function absolutizePublicProfileImageUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) return `${SITE_ORIGIN}${u}`;
  return '';
}

function isLikelyExistingProfilePhotoUrl(raw) {
  const u = String(raw || '').trim();
  if (!u || u.length < 2 || u.length > 2048) return false;
  if (/^https:\/\//i.test(u)) return true;
  if (u.startsWith('/') && !u.startsWith('//')) return true;
  return false;
}

/**
 * @callback CreatorApplicationSubmit
 * @param {object} payload
 * @returns {Promise<void | { successTitle?: string, successBody?: string, afterDismiss?: () => void }>}
 */

/**
 * @param {object} props
 * @param {boolean} [props.open]
 * @param {() => void} props.onClose
 * @param {boolean} [props.loading]
 * @param {object} [props.initial]
 * @param {CreatorApplicationSubmit} props.onSubmit
 * @param {'modal'|'page'} [props.variant]
 * @param {'signup'|'mangaka_monetize'} [props.intent]
 */
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
  /** CPF do documento (máscara igual ao campo PIX) — omitido quando chave PIX já é CPF. */
  const [documentCpfDraft, setDocumentCpfDraft] = useState('');
  const [payoutPixType, setPayoutPixType] = useState('cpf');
  const [pixKeyDraft, setPixKeyDraft] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [acceptFinancialTerms, setAcceptFinancialTerms] = useState(false);
  const [underageMonetizationModalOpen, setUnderageMonetizationModalOpen] = useState(false);
  /** @type {React.MutableRefObject<(() => void) | null>} */
  const successAfterDismissRef = useRef(null);
  const [feedbackDialog, setFeedbackDialog] = useState(
    /** @type {null | { kind: 'error'; message: string } | { kind: 'success'; title: string; body: string }} */
    (null)
  );
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
  const mangakaUnderageAutoRef = useRef(false);
  const pageMonetizeMinorAutoRef = useRef(false);

  const showFormError = useCallback((message) => {
    setFeedbackDialog({
      kind: 'error',
      message: String(message || '').trim() || 'Não foi possível continuar.',
    });
  }, []);

  const handleFeedbackErrorOk = useCallback(() => {
    setFeedbackDialog(null);
  }, []);

  const handleFeedbackSuccessOk = useCallback(() => {
    setFeedbackDialog(null);
    const fn = successAfterDismissRef.current;
    successAfterDismissRef.current = null;
    if (typeof fn === 'function') {
      queueMicrotask(() => {
        try {
          fn();
        } catch (e) {
          console.warn('[CreatorApplicationModal] afterDismiss:', e);
        }
      });
    }
    if (variant === 'modal') {
      onClose();
    }
  }, [variant, onClose]);

  const allowImmediateMonetization = intent === 'mangaka_monetize';
  const initialWantsMonetize = useMemo(
    () =>
      allowImmediateMonetization &&
      String(initial.monetizationPreference || 'publish_only').trim().toLowerCase() === 'monetize',
    [allowImmediateMonetization, initial.monetizationPreference]
  );

  useEffect(() => {
    if (variant === 'modal' && !open) return;
    setFeedbackDialog(null);
    successAfterDismissRef.current = null;
    setDisplayName(String(initial.displayName || '').trim().slice(0, 60));
    setBio(String(initial.bio || '').trim().slice(0, CREATOR_BIO_MAX_LENGTH));
    setInstagramUrl(String(initial.instagramUrl || '').trim());
    setYoutubeUrl(String(initial.youtubeUrl || '').trim());
    setMonetizationPreference(
      allowImmediateMonetization &&
        String(initial.monetizationPreference || 'publish_only').toLowerCase() === 'monetize'
        ? 'monetize'
        : 'publish_only'
    );
    const bdInit = String(initial.birthDate || '').trim();
    const isoOk = bdInit && parseBirthDateLocal(bdInit) ? bdInit : '';
    setBirthDate(isoOk);
    setBirthDateDraft(isoOk ? formatBirthDateIsoToBr(isoOk) : '');
    setLegalFullName(sanitizeLegalFullNameInput(String(initial.legalFullName || '').trim()));
    setDocumentCpfDraft(storedPixKeyToDraft('cpf', sanitizeCpfDigitsInput(initial.taxId)));
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
    allowImmediateMonetization,
  ]);

  const pixKeyNormalized = useMemo(
    () => normalizePixKeyForStorage(payoutPixType, pixKeyDraft),
    [payoutPixType, pixKeyDraft]
  );

  const pixKeyFeedback = useMemo(
    () => validateNormalizedPixKey(payoutPixType, pixKeyNormalized),
    [payoutPixType, pixKeyNormalized]
  );

  const documentCpfNormalized = useMemo(
    () => normalizePixKeyForStorage('cpf', documentCpfDraft),
    [documentCpfDraft]
  );
  const documentCpfFeedback = useMemo(
    () => validateNormalizedPixKey('cpf', documentCpfNormalized),
    [documentCpfNormalized]
  );

  const birthIsoEffective = parseBirthDateFlexible(birthDateDraft, birthDate);
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
    if (allowImmediateMonetization) {
      if (!minorInForm) setMonetizationPreference('monetize');
      return;
    }
    if (minorInForm && monetizationPreference === 'monetize') {
      setMonetizationPreference('publish_only');
    }
    if (monetizationPreference !== 'publish_only') {
      setMonetizationPreference('publish_only');
    }
  }, [open, variant, allowImmediateMonetization, minorInForm, monetizationPreference]);

  useEffect(() => {
    if (variant === 'modal' && !open) {
      setUnderageMonetizationModalOpen(false);
      mangakaUnderageAutoRef.current = false;
      pageMonetizeMinorAutoRef.current = false;
    }
  }, [open, variant]);

  /** Fluxo mangaká: abriu pedido de monetização mas já é menor pela data — explica na hora. */
  useEffect(() => {
    if (variant === 'modal' && !open) return;
    if (intent !== 'mangaka_monetize' || !minorInForm) {
      if (!minorInForm) mangakaUnderageAutoRef.current = false;
      return;
    }
    if (mangakaUnderageAutoRef.current) return;
    mangakaUnderageAutoRef.current = true;
    setUnderageMonetizationModalOpen(true);
  }, [open, variant, intent, minorInForm]);

  /** /creators com perfil já em Â«monetizarÂ» e menor — aviso ao entrar. */
  useEffect(() => {
    if (variant !== 'page') {
      pageMonetizeMinorAutoRef.current = false;
      return;
    }
    if (!minorInForm || !initialWantsMonetize) {
      if (!minorInForm) pageMonetizeMinorAutoRef.current = false;
      return;
    }
    if (pageMonetizeMinorAutoRef.current) return;
    pageMonetizeMinorAutoRef.current = true;
    setUnderageMonetizationModalOpen(true);
  }, [variant, minorInForm, initialWantsMonetize]);

  const handleSelectCreatorPhoto = useCallback((file) => {
    if (!file) return;
    const fileError = validateCreatorProfileImageFile(file);
    if (fileError) {
      showFormError(fileError);
      return;
    }
    setFeedbackDialog(null);
    successAfterDismissRef.current = null;
    setCreatorProfileImageAdjustment(normalizeCreatorProfileAdjustment());
    setCreatorProfileImageFile(file);
  }, [showFormError]);

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
        if (e.key !== 'Escape' || loading) return;
        if (feedbackDialog) {
          e.preventDefault();
          if (feedbackDialog.kind === 'error') handleFeedbackErrorOk();
          else handleFeedbackSuccessOk();
          return;
        }
        onClose();
      };
      window.addEventListener('keydown', onKey);
      return () => {
        document.body.style.overflow = prev;
        window.removeEventListener('keydown', onKey);
      };
    }
    const onKey = (e) => {
      if (e.key !== 'Escape' || loading) return;
      if (feedbackDialog) {
        e.preventDefault();
        if (feedbackDialog.kind === 'error') handleFeedbackErrorOk();
        else handleFeedbackSuccessOk();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    open,
    variant,
    loading,
    onClose,
    feedbackDialog,
    handleFeedbackErrorOk,
    handleFeedbackSuccessOk,
  ]);

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
            showFormError(err?.message || 'Não foi possível preparar a foto. Tente outra imagem (JPG/PNG/WebP até 1,5 MB).');
          }
        });

      return () => {
        cancelled = true;
        URL.revokeObjectURL(objectUrl);
        remoteProfileImageElRef.current = null;
      };
    }

    const existingRaw = String(initial.existingProfileImageUrl || '').trim();
    const hasExisting = isLikelyExistingProfilePhotoUrl(existingRaw);
    const loadUrl = absolutizePublicProfileImageUrl(existingRaw);
    if (!hasExisting || !loadUrl) {
      setCreatorProfileImageUrl('');
      setCreatorProfileImageDims(null);
      setCreatorProfilePreviewUrl('');
      setCreatorHeroPreviewUrl('');
      return undefined;
    }

    let cancelled = false;
    setCreatorProfileImageUrl(loadUrl);
    const cropFromInitial = initial.profileImageCrop;
    loadCreatorProfileImageFromUrl(loadUrl)
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
    // creatorProfileImageAdjustment: só leitura inicial ao carregar arquivo; previews atualizam noutro efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps mínimas para não reprocessar imagem a cada zoom
  }, [creatorProfileImageFile, initial.existingProfileImageUrl, initial.profileImageCrop, open, variant, showFormError]);

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
    setFeedbackDialog(null);
    successAfterDismissRef.current = null;
    if (String(displayName || '').trim().length < 3) {
      showFormError('Informe um nome artístico com pelo menos 3 caracteres.');
      return;
    }
    const bioTrim = String(bio || '').trim();
    const bioMin =
      monetizationPreference === 'monetize' ? CREATOR_BIO_MIN_LENGTH : CREATOR_BIO_MIN_LENGTH_PUBLISH_ONLY;
    if (bioTrim.length < bioMin) {
      showFormError(`Escreva uma bio com pelo menos ${bioMin} caracteres.`);
      return;
    }
    if (bioTrim.length > CREATOR_BIO_MAX_LENGTH) {
      showFormError(`A bio pode ter no máximo ${CREATOR_BIO_MAX_LENGTH} caracteres.`);
      return;
    }
    const existingPhotoRaw = String(initial.existingProfileImageUrl || '').trim();
    const hasExistingProfilePhoto = isLikelyExistingProfilePhotoUrl(existingPhotoRaw);
    const existingPhotoAbsUrl = absolutizePublicProfileImageUrl(existingPhotoRaw);
    if (!creatorProfileImageFile && !hasExistingProfilePhoto) {
      showFormError('Selecione a foto que vai virar seu perfil de creator.');
      return;
    }
    const birthIsoFinal = parseBirthDateFlexible(birthDateDraft, birthDate);
    if (!parseBirthDateLocal(birthIsoFinal)) {
      showFormError('Informe sua data de nascimento em dia/mês/ano (ex.: 28/12/2001).');
      return;
    }
    const age = ageFromBirthDateLocal(birthIsoFinal);
    if (age == null) {
      showFormError('Data de nascimento inválida.');
      return;
    }
    const wantsMonetize = monetizationPreference === 'monetize';
    const socialValidation = validateCreatorSocialLinks({
      instagramUrl,
      youtubeUrl,
      requireOne: true,
    });
    if (!socialValidation.ok) {
      showFormError(socialValidation.message);
      return;
    }
    let pixNorm = '';
    let docCpfDigits = '';
    if (wantsMonetize) {
      if (age < 18) {
      showFormError('Menores de 18 anos não podem solicitar monetização nesta plataforma.');
        return;
      }
      if (!legalFullNameHasMinThreeWords(legalFullName)) {
        showFormError(
          'Para monetizar, informe nome completo legal com pelo menos três partes (ex.: Nome Sobrenome Filho).'
        );
        return;
      }
      docCpfDigits =
        payoutPixType === 'cpf'
          ? normalizePixKeyForStorage('cpf', pixKeyDraft)
          : documentCpfNormalized;
      if (payoutPixType !== 'cpf') {
        if (!documentCpfFeedback.ok) {
          showFormError(
            documentCpfNormalized.length === 0
              ? 'Informe o CPF do documento (mesmo formato do PIX).'
              : documentCpfFeedback.message || 'CPF do documento inválido.'
          );
          return;
        }
      }
      if (!isValidBrazilianCpfDigits(docCpfDigits)) {
        showFormError('Para monetizar, informe um CPF válido (documento).');
        return;
      }
      pixNorm = normalizePixKeyForStorage(payoutPixType, pixKeyDraft);
      const pixFb = validateNormalizedPixKey(payoutPixType, pixNorm);
      if (!pixFb.ok) {
        showFormError(pixFb.message || 'Chave PIX inválida.');
        return;
      }
      if (!acceptFinancialTerms) {
      showFormError('Aceite os termos financeiros para solicitar monetização.');
        return;
      }
    }
    if (!termsAccepted) {
      showFormError('Aceite os termos do programa de criadores.');
      return;
    }
    try {
      const submitResult = await onSubmit({
        displayName: String(displayName || '').trim(),
        bioShort: bioTrim,
        birthDate: birthIsoFinal,
        instagramUrl: socialValidation.instagramUrl,
        youtubeUrl: socialValidation.youtubeUrl,
        monetizationPreference,
        acceptTerms: true,
        legalFullName: wantsMonetize ? String(legalFullName || '').trim() : '',
        taxId: wantsMonetize ? docCpfDigits : '',
        payoutInstructions: wantsMonetize ? pixNorm : '',
        payoutPixType: wantsMonetize ? payoutPixType : '',
        acceptFinancialTerms: wantsMonetize ? acceptFinancialTerms === true : false,
        creatorProfileImageFile,
        creatorProfileImageAdjustment,
        profileImageUrl: !creatorProfileImageFile && hasExistingProfilePhoto ? existingPhotoAbsUrl : undefined,
        profileImageCrop:
          !creatorProfileImageFile && hasExistingProfilePhoto
            ? creatorProfileImageDims
              ? serializeCreatorProfileCrop(creatorProfileImageAdjustment, creatorProfileImageDims)
              : initial.profileImageCrop || undefined
            : undefined,
      });
      const r = submitResult && typeof submitResult === 'object' ? submitResult : null;
      const title = String(r?.successTitle || '').trim() || 'Concluído';
      const body =
        String(r?.successBody || '').trim() ||
        'Sua solicitação foi registrada. Você pode fechar esta janela quando quiser.';
      successAfterDismissRef.current = typeof r?.afterDismiss === 'function' ? r.afterDismiss : null;
      setFeedbackDialog({ kind: 'success', title, body });
    } catch (err) {
      showFormError(err?.message || 'Não foi possível enviar agora.');
    }
  }, [
    displayName,
    bio,
    birthDate,
    birthDateDraft,
    legalFullName,
    documentCpfDraft,
    documentCpfNormalized,
    documentCpfFeedback,
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
    showFormError,
  ]);

  if (variant === 'modal' && !open) return null;

  const underageMonetizationLayer =
    underageMonetizationModalOpen &&
    createPortal(
      <div
        className="creator-app-underage-overlay"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) setUnderageMonetizationModalOpen(false);
        }}
      >
        <div
          className="creator-app-underage-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="creator-app-underage-title"
        >
          <h2 id="creator-app-underage-title" className="creator-app-underage-dialog__title">
            Monetização indisponível (idade)
          </h2>
          <div className="creator-app-underage-dialog__body">
            <p>
              Na MangaTeofilo, <strong>os ganhos na plataforma</strong> (CPF, chave PIX e contrato de creator) exigem{' '}
              <strong>maioridade — 18 anos ou mais</strong>, por lei e política da plataforma.
            </p>
            <p>
              Você pode continuar <strong>publicando</strong> e montando seu perfil de criador normalmente. Quando for
              maior de idade, volte e solicite monetização aqui ou no seu perfil.
            </p>
            <p className="creator-app-modal__hint">
              Verifique se a <strong>data de nascimento</strong> do formulário está correta (formato dia/mês/ano). Dados
              errados também impedem liberar esta etapa.
            </p>
          </div>
          <div className="creator-app-underage-dialog__actions">
            <button
              type="button"
              className="creator-app-modal__submit"
              onClick={() => setUnderageMonetizationModalOpen(false)}
            >
              Entendi
            </button>
          </div>
        </div>
      </div>,
      document.body
    );

  const feedbackLayer =
    feedbackDialog &&
    createPortal(
      <div
        className="creator-app-feedback-overlay"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && feedbackDialog.kind === 'error') handleFeedbackErrorOk();
        }}
      >
        <div
          className={`creator-app-feedback-dialog creator-app-feedback-dialog--${feedbackDialog.kind}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="creator-app-feedback-title"
        >
          <h2 id="creator-app-feedback-title" className="creator-app-feedback-dialog__title">
            {feedbackDialog.kind === 'error' ? 'Revise o formulário' : feedbackDialog.title}
          </h2>
          <div className="creator-app-feedback-dialog__body">
            <p>{feedbackDialog.kind === 'error' ? feedbackDialog.message : feedbackDialog.body}</p>
          </div>
          <div className="creator-app-feedback-dialog__actions">
            <button
              type="button"
              className="creator-app-modal__submit"
              onClick={feedbackDialog.kind === 'error' ? handleFeedbackErrorOk : handleFeedbackSuccessOk}
            >
              {feedbackDialog.kind === 'error' ? 'Entendi' : 'Continuar'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );

  const isMangakaMonetizeIntent = allowImmediateMonetization;
  const monetizationAllowed = ageInForm != null && ageInForm >= 18;
  /** Mostrar bloco legal sempre em Â«monetizarÂ», exceto menor confirmado; submit ainda exige 18+ e data válida. */
  const showMonetizationCompliance = monetizationPreference === 'monetize' && !minorInForm;

  const handleMonetizeToggleClick = () => {
    if (!allowImmediateMonetization) return;
    if (minorInForm) {
      setUnderageMonetizationModalOpen(true);
      return;
    }
    setMonetizationPreference('monetize');
  };

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
              ? 'Envie seus dados para análise. Você continua publicando normalmente até a aprovação.'
              : 'Seu perfil de creator pode ser liberado para publicar agora. Os ganhos só entram depois, quando você cumprir as metas e pedir a monetização.'}
          </p>
        </div>
        <button
          type="button"
          className="creator-app-modal__close"
          aria-label="Fechar"
          disabled={loading || !!feedbackDialog}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="creator-app-modal__body">
        <section className="creator-app-photo-card" aria-label="Foto pública do creator">
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
          {isLikelyExistingProfilePhotoUrl(initial.existingProfileImageUrl) && !creatorProfileImageFile ? (
            <p className="creator-app-modal__hint" style={{ marginTop: 8 }}>
              Sua foto atual do perfil será usada neste envio. Use &quot;Escolher foto&quot; só se quiser trocar por outra
              imagem.
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
                    <strong>
                      {isLikelyExistingProfilePhotoUrl(initial.existingProfileImageUrl)
                        ? 'Carregando sua foto do perfil...'
                        : 'Envie uma foto para começar'}
                    </strong>
                    <span>
                      {isLikelyExistingProfilePhotoUrl(initial.existingProfileImageUrl)
                        ? 'Se a prévia não abrir, escolha outra foto — o envio usa a imagem salva no seu perfil.'
                        : 'Retrato 3:4 para o perfil e hero reutilizado no estilo Manga Plus Creators.'}
                    </span>
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
              const raw = String(e.target.value || '');
              const rawTrim = raw.trim();
              if (/^\d{4}-\d{2}-\d{2}$/.test(rawTrim) && parseBirthDateLocal(rawTrim)) {
                setBirthDate(rawTrim);
                setBirthDateDraft(formatBirthDateIsoToBr(rawTrim));
                return;
              }
              const d = normalizeBirthDateBrTyping(raw);
              setBirthDateDraft(d);
              const iso = parseBirthDateBr(d);
              if (iso) setBirthDate(iso);
              else if (!d.replace(/\D/g, '').length) setBirthDate('');
            }}
            onBlur={() => {
              const trimmed = String(birthDateDraft || '').trim();
              if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && parseBirthDateLocal(trimmed)) {
                setBirthDate(trimmed);
                setBirthDateDraft(formatBirthDateIsoToBr(trimmed));
                return;
              }
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
            Monetização na plataforma — os dados legais e a chave PIX abaixo seguem para revisão do time antes de
            liberar seus ganhos.
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
                  onClick={handleMonetizeToggleClick}
                  disabled={!allowImmediateMonetization}
                >
                  Monetizar depois
                </button>
              </div>
              <p className="creator-app-modal__hint">
                {minorInForm
                  ? 'Você pode publicar normalmente, mas a monetização só libera para maiores de 18 anos.'
                  : monetizationPreference === 'monetize' && !monetizationAllowed
                    ? 'Preencha uma data de nascimento válida (18+) para enviar com monetização — os dados legais aparecem abaixo.'
                    : !birthIsoEffective
                      ? 'Informe a data de nascimento para concluir a candidatura.'
                      : allowImmediateMonetization
                        ? 'Para liberar ganhos, precisamos revisar seus dados legais e a chave de recebimento.'
                        : 'Você poderá monetizar ao completar as missões e liberar essa etapa depois. Por enquanto, seu perfil entra no modo só publicar.'}
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
            <div className="creator-app-modal__pix-block">
              <p className="creator-app-modal__section-title" style={{ marginBottom: 8 }}>
                Chave PIX para receber
              </p>
              <label className="creator-app-modal__label">
                Tipo da chave
                <select
                  className="creator-app-modal__select"
                  value={payoutPixType}
                  disabled={loading}
                  onChange={(e) => {
                    const next = e.target.value;
                    const prev = payoutPixType;
                    setFeedbackDialog(null);
                    successAfterDismissRef.current = null;
                    if (next !== prev) {
                      if (next === 'cpf') {
                        const docDigits = normalizePixKeyForStorage('cpf', documentCpfDraft);
                        if (docDigits.length === 11 && isValidBrazilianCpfDigits(docDigits)) {
                          setPixKeyDraft(formatPixCpfDraft(docDigits));
                        } else {
                          setPixKeyDraft('');
                        }
                      } else if (prev === 'cpf') {
                        const pixDigits = normalizePixKeyForStorage('cpf', pixKeyDraft);
                        const docDigits = normalizePixKeyForStorage('cpf', documentCpfDraft);
                        if (pixDigits.length === 11 && docDigits.length === 0) {
                          setDocumentCpfDraft(formatPixCpfDraft(pixDigits));
                        }
                        setPixKeyDraft('');
                      } else {
                        setPixKeyDraft('');
                      }
                      setPayoutPixType(next);
                    }
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
                  <input
                    type="text"
                    className="creator-app-modal__input creator-app-modal__input--pix-random"
                    value={pixKeyDraft}
                    disabled={loading}
                    maxLength={36}
                    inputMode="text"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setPixKeyDraft(applyPixDraftChange('random', e.target.value))}
                    placeholder={pixKeyPlaceholder('random')}
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
                  O valor enviado ao servidor fica normalizado, sem pontuação de CPF ou telefone.
                </p>
              )}
              {payoutPixType === 'cpf' ? (
                <p className="creator-app-modal__hint" style={{ marginTop: 10 }}>
                  Este CPF é o mesmo do documento usado para receber — não pedimos um segundo campo.
                </p>
              ) : null}
              {payoutPixType !== 'cpf' ? (
                <label className="creator-app-modal__label" style={{ marginTop: 14 }}>
                  CPF (documento — mesmo formato do PIX)
                  <input
                    type="text"
                    className="creator-app-modal__input"
                    value={documentCpfDraft}
                    disabled={loading}
                    onChange={(e) => setDocumentCpfDraft(applyPixDraftChange('cpf', e.target.value))}
                    placeholder={pixKeyPlaceholder('cpf')}
                    autoComplete="off"
                    inputMode="numeric"
                  />
                  {documentCpfDraft.replace(/\D/g, '').length > 0 ? (
                    documentCpfFeedback.ok ? (
                      <p className="creator-app-modal__pix-feedback creator-app-modal__pix-feedback--ok" role="status">
                        CPF do documento válido.
                      </p>
                    ) : (
                      <p className="creator-app-modal__pix-feedback creator-app-modal__pix-feedback--err" role="alert">
                        {documentCpfFeedback.message}
                      </p>
                    )
                  ) : (
                    <p className="creator-app-modal__hint">Mesma máscara do CPF na chave PIX (só números).</p>
                  )}
                </label>
              ) : null}
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
            Aceito os termos do programa de criadores e entendo que publicar e monetizar são etapas separadas.
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
              Li e aceito os termos financeiros relacionados à monetização na plataforma.
            </span>
          </label>
        ) : null}

        <button
          type="button"
          className="creator-app-modal__submit"
          disabled={loading || !!feedbackDialog}
          onClick={handleSubmit}
        >
          {loading
            ? 'Enviando...'
            : monetizationPreference === 'monetize'
              ? 'Enviar para revisão'
              : 'Liberar meu perfil de creator'}
        </button>
      </div>
    </div>
  );

  if (variant === 'page') {
    return (
      <>
        <div className="creator-app-modal-page-shell">{modalCard}</div>
        {underageMonetizationLayer}
        {feedbackLayer}
      </>
    );
  }

  return (
    <>
      {createPortal(
        <div
          className="creator-app-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !loading && !feedbackDialog) onClose();
          }}
        >
          {modalCard}
        </div>,
        document.body
      )}
      {underageMonetizationLayer}
      {feedbackLayer}
    </>
  );
}

