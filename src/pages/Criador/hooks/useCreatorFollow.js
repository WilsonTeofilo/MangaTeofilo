import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';

export function useCreatorFollow({
  db,
  functions,
  creatorUid,
  profileMode,
  user,
  onLogin,
  onFollowChange,
  onRefetchFollowers,
}) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followMessage, setFollowMessage] = useState('');
  const [followersModalOpen, setFollowersModalOpen] = useState(false);
  const [followersBusy, setFollowersBusy] = useState(false);
  const [followersError, setFollowersError] = useState('');
  const [followersList, setFollowersList] = useState([]);
  const [privateFollowerModal, setPrivateFollowerModal] = useState(null);
  const [followBrowserPushModalOpen, setFollowBrowserPushModalOpen] = useState(false);
  const [followBrowserPushPermission, setFollowBrowserPushPermission] = useState('default');

  const toggleCreatorFollow = useMemo(() => httpsCallable(functions, 'toggleCreatorFollow'), [functions]);
  const getCreatorFollowers = useMemo(() => httpsCallable(functions, 'getCreatorFollowers'), [functions]);

  useEffect(() => {
    if (!user?.uid || !creatorUid) {
      setIsFollowing(false);
      return () => {};
    }
    const unsub = onValue(ref(db, `usuarios/${user.uid}/followingCreators/${creatorUid}`), (snapshot) => {
      setIsFollowing(snapshot.exists());
    });
    return () => unsub();
  }, [creatorUid, db, user?.uid]);

  async function handleToggleFollow() {
    if (!user?.uid) {
      onLogin?.();
      return;
    }
    setFollowBusy(true);
    setFollowMessage('');
    try {
      const { data } = await toggleCreatorFollow({ creatorId: creatorUid });
      setIsFollowing(data?.isFollowing === true);
      onFollowChange?.(data?.isFollowing === true);
      if (data?.isFollowing === true) {
        const perm =
          typeof window === 'undefined' || typeof Notification === 'undefined'
            ? 'unsupported'
            : Notification.permission;
        setFollowBrowserPushPermission(perm);
        setFollowBrowserPushModalOpen(true);
      }
      if (followersModalOpen) {
        onRefetchFollowers?.();
      }
    } catch (err) {
      setFollowMessage(err?.message || 'Nao foi possivel atualizar o follow agora.');
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleOpenFollowersModal({ force = false } = {}) {
    if (!creatorUid || profileMode !== 'writer') return;
    setFollowersModalOpen(true);
    if (!force && followersList.length) return;
    setFollowersBusy(true);
    setFollowersError('');
    try {
      const { data } = await getCreatorFollowers({ creatorId: creatorUid });
      setFollowersList(Array.isArray(data?.followers) ? data.followers : []);
    } catch (err) {
      setFollowersError(err?.message || 'Nao foi possivel carregar os seguidores agora.');
    } finally {
      setFollowersBusy(false);
    }
  }

  function closeFollowersModal() {
    setFollowersModalOpen(false);
  }

  return {
    isFollowing,
    followBusy,
    followMessage,
    followersModalOpen,
    followersBusy,
    followersError,
    followersList,
    privateFollowerModal,
    setPrivateFollowerModal,
    followBrowserPushModalOpen,
    followBrowserPushPermission,
    setFollowBrowserPushModalOpen,
    closeFollowersModal,
    handleToggleFollow,
    handleOpenFollowersModal,
  };
}
