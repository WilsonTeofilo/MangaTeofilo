function asString(value) {
  return String(value || '').trim();
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeHandle(value) {
  return asString(value).toLowerCase().replace(/^@+/, '');
}

export function resolveCanonicalPublicHandleParts(row = {}) {
  const root = asObject(row);
  const publicProfile = asObject(root.publicProfile);
  const creator = asObject(root.creator);
  const creatorProfile = asObject(creator.profile);
  const publicCreatorProfile = asObject(publicProfile.creatorProfile);

  const userHandle = normalizeHandle(
    root.userHandle ||
      publicProfile.userHandle
  );

  const legacyCreatorUsername = normalizeHandle(
    publicCreatorProfile.username ||
      creatorProfile.username ||
      root.creatorUsername ||
      publicProfile.creatorUsername
  );

  const canonicalHandle = userHandle || legacyCreatorUsername;

  return {
    canonicalHandle,
    userHandle,
    legacyCreatorUsername,
  };
}

export function resolveCanonicalPublicHandle(row = {}) {
  return resolveCanonicalPublicHandleParts(row).canonicalHandle;
}
