import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onValue, push, ref, runTransaction, serverTimestamp, set } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

import { AVATAR_FALLBACK } from '../../../constants';
import { applyChapterCommentDelta } from '../../../utils/discoveryStats';
import { toRecordList } from '../../../utils/firebaseRecordList';
import { buildPublicProfileFromUsuarioRow } from '../../../utils/publicUserProfile';
import { obterObraIdCapitulo, obraCreatorId } from '../../../config/obras';
import { buildCommentThreads, commentSortTs } from '../leitorUtils';
import { functions } from '../../../services/firebase';

const deleteChapterCommentCallable = httpsCallable(functions, 'deleteChapterComment');

export function useChapterComments({
  db,
  chapterId,
  capitulo,
  creatorUidApoio,
  authorUid,
  adminAccess,
  user,
  perfil,
  onRequireLogin,
}) {
  const [comentarioTexto, setComentarioTexto] = useState('');
  const [listaComentarios, setComentarios] = useState([]);
  const [perfisUsuarios, setPerfis] = useState({});
  const [filtro, setFiltro] = useState('relevantes');
  const [enviando, setEnviando] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [modalLoginComentario, setModalLoginComentario] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyEnviando, setReplyEnviando] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState('');
  const [banModal, setBanModal] = useState(null);
  const unsubPerfis = useRef({});

  const activeBanInfo = useMemo(() => {
    const moderation = perfil?.moderation || {};
    const expiresAt = Number(moderation?.currentBanExpiresAt || 0) || 0;
    const active = moderation?.isBanned === true && (!expiresAt || expiresAt > Date.now());
    return {
      active,
      reason: String(moderation?.lastBanReason || perfil?.banReason || '').trim(),
      expiresAt: expiresAt || null,
      totalBanCount: Number(moderation?.totalBanCount || 0) || 0,
      bansRemaining: Math.max(0, 4 - (Number(moderation?.totalBanCount || 0) || 0)),
    };
  }, [perfil]);

  const openBanModal = useCallback(() => {
    if (!activeBanInfo.active) return false;
    const expiresAt = activeBanInfo.expiresAt;
    const diff = expiresAt ? Math.max(0, expiresAt - Date.now()) : 0;
    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
    const remainingLabel = !expiresAt
      ? 'sem prazo definido'
      : hours > 0
        ? `${hours}h ${minutes}min`
        : `${Math.max(1, minutes)}min`;
    setBanModal({
      reason: activeBanInfo.reason,
      expiresAt,
      remainingLabel,
      totalBanCount: activeBanInfo.totalBanCount,
      bansRemaining: activeBanInfo.bansRemaining,
    });
    return true;
  }, [activeBanInfo]);

  useEffect(() => {
    if (user) setModalLoginComentario(false);
  }, [user]);

  useEffect(() => {
    setComentarios([]);
    setPerfis({});
    setComentarioTexto('');
    setCommentsLoaded(false);
    setReplyingTo(null);
    setReplyDraft('');
    setDeletingCommentId('');
  }, [chapterId]);

  useEffect(() => {
    if (!chapterId) return () => {};
    const unsub = onValue(
      ref(db, `capitulos/${chapterId}/comentarios`),
      (snapshot) => {
        const list = toRecordList(snapshot.exists() ? snapshot.val() : {})
          .sort((a, b) => commentSortTs(b) - commentSortTs(a));
        setComentarios(list);
        setCommentsLoaded(true);
      },
      () => {
        setComentarios([]);
        setCommentsLoaded(true);
      }
    );
    return () => unsub();
  }, [chapterId, db]);

  useEffect(() => {
    const targetIds = new Set(
      listaComentarios
        .map((item) => String(item?.userId || '').trim())
        .filter(Boolean)
    );

    for (const [uid, unsub] of Object.entries(unsubPerfis.current)) {
      if (targetIds.has(uid)) continue;
      try {
        unsub();
      } catch {
        /* noop */
      }
      delete unsubPerfis.current[uid];
      setPerfis((prev) => {
        if (!(uid in prev)) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    }

    targetIds.forEach((uid) => {
      if (unsubPerfis.current[uid]) return;
      unsubPerfis.current[uid] = onValue(
        ref(db, `usuarios/${uid}/publicProfile`),
        (snapshot) => {
          const perfilPublico = snapshot.exists()
            ? buildPublicProfileFromUsuarioRow(snapshot.val() || {}, uid)
            : { uid, userName: 'Leitor', userAvatar: AVATAR_FALLBACK };
          setPerfis((prev) => ({ ...prev, [uid]: perfilPublico }));
        },
        () => {
          setPerfis((prev) => ({ ...prev, [uid]: { uid, userName: 'Leitor', userAvatar: AVATAR_FALLBACK } }));
        }
      );
    });

    return () => {};
  }, [db, listaComentarios]);

  useEffect(() => {
    return () => {
      Object.values(unsubPerfis.current).forEach((unsub) => {
        try {
          unsub();
        } catch {
          /* noop */
        }
      });
      unsubPerfis.current = {};
    };
  }, []);

  const comentariosEmThreads = useMemo(
    () => buildCommentThreads(listaComentarios, filtro),
    [listaComentarios, filtro]
  );

  const openLoginModal = () => {
    if (!user) setModalLoginComentario(true);
  };

  const handleEnviarComentario = async (e) => {
    e?.preventDefault?.();
    if (!user) {
      setModalLoginComentario(true);
      return;
    }
    if (openBanModal()) return;
    if (!comentarioTexto.trim()) return;
    if (enviando) return;

    setEnviando(true);
    const texto = comentarioTexto.trim();
    try {
      await set(push(ref(db, `capitulos/${chapterId}/comentarios`)), {
        texto,
        userId: user.uid,
        data: serverTimestamp(),
        likes: 0,
      });
      setComentarioTexto('');
      await applyChapterCommentDelta(db, {
        chapterId,
        workId: obterObraIdCapitulo(capitulo),
        creatorId: creatorUidApoio || obraCreatorId({ creatorId: capitulo?.creatorId || '' }),
        amount: 1,
      });
    } catch (err) {
      console.error('Erro ao comentar:', err);
    } finally {
      setEnviando(false);
    }
  };

  const handleLikeComment = async (comentId) => {
    if (!user) {
      onRequireLogin?.();
      return;
    }
    if (openBanModal()) return;
    const tx = await runTransaction(ref(db, `capitulos/${chapterId}/comentarios/${comentId}`), (post) => {
      if (!post) return post;
      if (!post.usuariosQueCurtiram) post.usuariosQueCurtiram = {};
      if (post.usuariosQueCurtiram[user.uid]) {
        post.likes = Math.max(0, (post.likes || 1) - 1);
        delete post.usuariosQueCurtiram[user.uid];
      } else {
        post.likes = (post.likes || 0) + 1;
        post.usuariosQueCurtiram[user.uid] = true;
      }
      return post;
    });
    if (!tx.committed) return;
  };

  const handleEnviarResposta = async (parentId) => {
    if (!user) {
      onRequireLogin?.();
      return;
    }
    if (openBanModal()) return;
    const texto = replyDraft.trim();
    if (!texto || replyEnviando || !parentId) return;
    setReplyEnviando(true);
    try {
      await set(push(ref(db, `capitulos/${chapterId}/comentarios`)), {
        texto,
        userId: user.uid,
        data: serverTimestamp(),
        likes: 0,
        parentId,
      });
      setReplyDraft('');
      setReplyingTo(null);
      await applyChapterCommentDelta(db, {
        chapterId,
        workId: obterObraIdCapitulo(capitulo),
        creatorId: creatorUidApoio || obraCreatorId({ creatorId: capitulo?.creatorId || '' }),
        amount: 1,
      });
    } catch (err) {
      console.error('Erro ao responder comentário:', err);
    } finally {
      setReplyEnviando(false);
    }
  };

  const canDeleteComment = (comment) => {
    const commentOwnerUid = String(comment?.userId || '').trim();
    if (!user?.uid || !commentOwnerUid) return false;
    if (commentOwnerUid === user.uid) return true;
    if (String(authorUid || '').trim() === user.uid) return true;
    return adminAccess?.canAccessAdmin === true;
  };

  const handleDeleteComment = async (commentId) => {
    const normalizedCommentId = String(commentId || '').trim();
    if (!normalizedCommentId) return;
    if (!user) {
      onRequireLogin?.();
      return;
    }
    if (openBanModal()) return;
    if (deletingCommentId) return;
    setDeletingCommentId(normalizedCommentId);
    try {
      await deleteChapterCommentCallable({
        chapterId,
        commentId: normalizedCommentId,
      });
      if (replyingTo?.id === normalizedCommentId) {
        setReplyingTo(null);
        setReplyDraft('');
      }
    } catch (err) {
      console.error('Erro ao excluir comentario:', err);
    } finally {
      setDeletingCommentId('');
    }
  };

  return {
    comentarioTexto,
    setComentarioTexto,
    listaComentarios,
    commentsLoaded,
    perfisUsuarios,
    filtro,
    setFiltro,
    enviando,
    modalLoginComentario,
    setModalLoginComentario,
    replyDraft,
    setReplyDraft,
    replyingTo,
    setReplyingTo,
    replyEnviando,
    comentariosEmThreads,
    openLoginModal,
    handleEnviarComentario,
    handleEnviarResposta,
    handleLikeComment,
    canDeleteComment,
    handleDeleteComment,
    deletingCommentId,
    banModal,
    setBanModal,
  };
}
