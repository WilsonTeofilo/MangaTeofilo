import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildCommerceFingerprint(payload) {
  return createHash('sha256').update(stableSerialize(payload)).digest('hex').slice(0, 40);
}

function hashRequestSignal(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function normalizeSignalKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return hashRequestSignal(raw);
}

function requestHeader(request, name) {
  const value = request?.rawRequest?.get?.(name);
  return typeof value === 'string' ? value : '';
}

function resolveClientIp(request) {
  const forwarded = requestHeader(request, 'x-forwarded-for')
    .split(',')
    .map((part) => String(part || '').trim())
    .find(Boolean);
  const raw =
    forwarded ||
    String(request?.rawRequest?.ip || request?.rawRequest?.socket?.remoteAddress || '').trim();
  return raw.replace(/^\[|\]$/g, '');
}

export function buildCommerceAbuseActor(request) {
  const uid = String(request?.auth?.uid || '').trim();
  const appId = String(request?.app?.appId || '').trim();
  const userAgent = requestHeader(request, 'user-agent');
  const language = requestHeader(request, 'accept-language');
  const ip = resolveClientIp(request);
  const ipHash = hashRequestSignal(ip);
  const userAgentHash = hashRequestSignal(userAgent);
  const languageHash = hashRequestSignal(language);
  return {
    uid,
    appId,
    ipHash,
    userAgentHash,
    languageHash,
    deviceKey: [appId, userAgentHash, languageHash].filter(Boolean).join(':'),
    networkKey: [ipHash, userAgentHash].filter(Boolean).join(':'),
  };
}

function signalSummaryPath(scope, kind, key) {
  return `security/commerceAbuseSignals/${String(scope || 'default')}/${String(kind || 'actor')}/${String(key || '')}`;
}

async function recordCommerceSignalSummary(db, { scope, kind, key, actor, violation, now }) {
  if (!key) return;
  await db.ref(signalSummaryPath(scope, kind, key)).transaction((current) => {
    const row = current && typeof current === 'object' ? current : {};
    const totals = row.totals && typeof row.totals === 'object' ? row.totals : {};
    const violationKey = String(violation || 'unknown');
    const totalCount = Number(row.totalCount || 0) + 1;
    return {
      kind,
      key,
      actor: {
        uid: actor?.uid || null,
        appId: actor?.appId || null,
        ipHash: actor?.ipHash || null,
        userAgentHash: actor?.userAgentHash || null,
        languageHash: actor?.languageHash || null,
      },
      totalCount,
      totals: {
        ...totals,
        [violationKey]: Number(totals[violationKey] || 0) + 1,
      },
      suspicious:
        totalCount >= (kind === 'ip' ? 8 : 6) ||
        Number(totals.burst || 0) + (violationKey === 'burst' ? 1 : 0) >= 3 ||
        Number(totals.cooldown || 0) + (violationKey === 'cooldown' ? 1 : 0) >= 3,
      firstSeenAt: Number(row.firstSeenAt || 0) > 0 ? Number(row.firstSeenAt) : now,
      lastSeenAt: now,
      lastViolation: violationKey,
    };
  });
}

export async function enforceCommerceRateLimit(
  db,
  {
    scope,
    key,
    minIntervalMs,
    windowMs,
    maxHits,
    message,
  }
) {
  const now = Date.now();
  const path = `rateLimits/commerce/${String(scope || 'default')}/${String(key || 'anon')}`;
  const ref = db.ref(path);
  let violation = null;
  await ref.transaction((current) => {
    const row = current && typeof current === 'object' ? current : {};
    const lastAt = Number(row.lastAt || 0);
    if (minIntervalMs > 0 && lastAt > 0 && now - lastAt < minIntervalMs) {
      violation = 'cooldown';
      return current;
    }
    const hits = Array.isArray(row.hits)
      ? row.hits.map((value) => Number(value || 0)).filter((value) => now - value <= windowMs)
      : [];
    if (maxHits > 0 && hits.length >= maxHits) {
      violation = 'burst';
      return current;
    }
    return {
      lastAt: now,
      hits: [...hits, now].slice(-Math.max(maxHits || 1, 1)),
      updatedAt: now,
    };
  });
  if (violation) {
    logger.warn('commerce rate limit blocked', { scope, key, violation });
    throw new HttpsError('resource-exhausted', message || 'Muitas tentativas. Aguarde alguns segundos.');
  }
}

export async function readCommerceIdempotency(db, { scope, key, fingerprint }) {
  const ref = db.ref(
    `rateLimits/commerceIdempotency/${String(scope || 'default')}/${String(key || 'anon')}/${String(fingerprint || '')}`
  );
  const snap = await ref.get();
  if (!snap.exists()) return null;
  const row = snap.val() || {};
  const expiresAt = Number(row.expiresAt || 0);
  if (!expiresAt || expiresAt < Date.now()) return null;
  return row.response && typeof row.response === 'object' ? row.response : null;
}

export async function writeCommerceIdempotency(
  db,
  { scope, key, fingerprint, ttlMs, response }
) {
  const now = Date.now();
  await db
    .ref(
      `rateLimits/commerceIdempotency/${String(scope || 'default')}/${String(key || 'anon')}/${String(fingerprint || '')}`
    )
    .set({
      response,
      createdAt: now,
      expiresAt: now + Math.max(Number(ttlMs || 0), 1000),
    });
}

async function recordCommerceAbuse(db, { scope, actor, violation, policy }) {
  try {
    const safeScope = String(scope || 'default');
    const now = Date.now();
    const actorSummaryKey = createHash('sha256')
      .update(
        stableSerialize({
          uid: actor?.uid || null,
          appId: actor?.appId || null,
          ipHash: actor?.ipHash || null,
          userAgentHash: actor?.userAgentHash || null,
          languageHash: actor?.languageHash || null,
        })
      )
      .digest('hex')
      .slice(0, 32);
    await db.ref(`security/commerceAbuse/${safeScope}`).push({
      actor: {
        uid: actor?.uid || null,
        appId: actor?.appId || null,
        ipHash: actor?.ipHash || null,
        userAgentHash: actor?.userAgentHash || null,
        languageHash: actor?.languageHash || null,
      },
      violation: String(violation || 'unknown'),
      policy: policy && typeof policy === 'object' ? policy : null,
      createdAt: now,
    });
    await db.ref(`security/commerceAbuseSummary/${safeScope}/${actorSummaryKey}`).transaction((current) => {
      const row = current && typeof current === 'object' ? current : {};
      const totals = row.totals && typeof row.totals === 'object' ? row.totals : {};
      const violationKey = String(violation || 'unknown');
      const totalCount = Number(row.totalCount || 0) + 1;
      const burstCount = Number(totals.burst || 0) + (violationKey === 'burst' ? 1 : 0);
      const cooldownCount = Number(totals.cooldown || 0) + (violationKey === 'cooldown' ? 1 : 0);
      const actorCount = Number(totals.actor || 0) + (violationKey === 'actor' ? 1 : 0);
      return {
        actor: {
          uid: actor?.uid || null,
          appId: actor?.appId || null,
          ipHash: actor?.ipHash || null,
          userAgentHash: actor?.userAgentHash || null,
          languageHash: actor?.languageHash || null,
        },
        totalCount,
        totals: {
          ...totals,
          [violationKey]: Number(totals[violationKey] || 0) + 1,
          burst: burstCount,
          cooldown: cooldownCount,
          actor: actorCount,
        },
        suspicious: totalCount >= 5 || burstCount >= 3 || cooldownCount >= 3 || actorCount >= 3,
        firstSeenAt: Number(row.firstSeenAt || 0) > 0 ? Number(row.firstSeenAt) : now,
        lastSeenAt: now,
        lastViolation: violationKey,
      };
    });
    await Promise.all([
      actor?.uid
        ? recordCommerceSignalSummary(db, {
            scope: safeScope,
            kind: 'uid',
            key: actor.uid,
            actor,
            violation,
            now,
          })
        : Promise.resolve(),
      actor?.deviceKey
        ? recordCommerceSignalSummary(db, {
            scope: safeScope,
            kind: 'device',
            key: normalizeSignalKey(actor.deviceKey),
            actor,
            violation,
            now,
          })
        : Promise.resolve(),
      actor?.networkKey
        ? recordCommerceSignalSummary(db, {
            scope: safeScope,
            kind: 'network',
            key: normalizeSignalKey(actor.networkKey),
            actor,
            violation,
            now,
          })
        : Promise.resolve(),
      actor?.ipHash
        ? recordCommerceSignalSummary(db, {
            scope: safeScope,
            kind: 'ip',
            key: actor.ipHash,
            actor,
            violation,
            now,
          })
        : Promise.resolve(),
    ]);
  } catch (error) {
    logger.warn('commerce abuse log failed', {
      scope,
      violation,
      error: error?.message || String(error),
    });
  }
}

async function enforceSuspiciousActorLock(db, { scope, actor, message }) {
  const lockWindowMs = 15 * 60 * 1000;
  const checks = [
    actor?.uid
      ? { kind: 'uid', key: actor.uid, threshold: 6 }
      : null,
    actor?.deviceKey
      ? { kind: 'device', key: normalizeSignalKey(actor.deviceKey), threshold: 6 }
      : null,
    actor?.networkKey
      ? { kind: 'network', key: normalizeSignalKey(actor.networkKey), threshold: 6 }
      : null,
    actor?.ipHash
      ? { kind: 'ip', key: actor.ipHash, threshold: 8 }
      : null,
  ].filter(Boolean);
  if (!checks.length) return;

  const snaps = await Promise.all(
    checks.map((entry) => db.ref(signalSummaryPath(scope, entry.kind, entry.key)).get())
  );
  const now = Date.now();
  for (let i = 0; i < checks.length; i += 1) {
    const row = snaps[i].exists() ? snaps[i].val() || {} : {};
    const recent = Number(row.lastSeenAt || 0) > 0 && now - Number(row.lastSeenAt || 0) <= lockWindowMs;
    const suspicious = row.suspicious === true || Number(row.totalCount || 0) >= checks[i].threshold;
    if (recent && suspicious) {
      logger.warn('commerce suspicious actor locked', {
        scope,
        kind: checks[i].kind,
        totalCount: Number(row.totalCount || 0),
        uid: actor?.uid || null,
        ipHash: actor?.ipHash || null,
      });
      throw new HttpsError(
        'resource-exhausted',
        message || 'Atividade suspeita detectada. Aguarde alguns minutos antes de tentar de novo.'
      );
    }
  }
}

async function enforceRateLimitWithLogging(db, { scope, key, actor, policy, violationLabel, message }) {
  try {
    await enforceCommerceRateLimit(db, {
      scope,
      key,
      minIntervalMs: policy.minIntervalMs,
      windowMs: policy.windowMs,
      maxHits: policy.maxHits,
      message,
    });
  } catch (error) {
    if (error?.code === 'resource-exhausted') {
      await recordCommerceAbuse(db, {
        scope,
        actor,
        violation: violationLabel,
        policy,
      });
    }
    throw error;
  }
}

export async function enforceCommerceAbuseShield(
  db,
  {
    request,
    scope,
    key,
    minIntervalMs,
    windowMs,
    maxHits,
    message,
    networkMinIntervalMs = 0,
    networkWindowMs = windowMs,
    networkMaxHits = 0,
    actorMinIntervalMs = 0,
    actorWindowMs = windowMs,
    actorMaxHits = 0,
    ipMinIntervalMs = 0,
    ipWindowMs = windowMs,
    ipMaxHits = 0,
  }
) {
  const actor = buildCommerceAbuseActor(request);
  await enforceSuspiciousActorLock(db, {
    scope,
    actor,
    message: message || 'Atividade suspeita detectada. Aguarde alguns minutos antes de tentar de novo.',
  });
  await enforceRateLimitWithLogging(db, {
    scope,
    key,
    actor,
    policy: { minIntervalMs, windowMs, maxHits },
    violationLabel: 'uid',
    message,
  });
  if (networkMaxHits > 0 && actor.networkKey) {
    await enforceRateLimitWithLogging(db, {
      scope: `${String(scope || 'default')}:network`,
      key: actor.networkKey,
      actor,
      policy: {
        minIntervalMs: networkMinIntervalMs,
        windowMs: networkWindowMs,
        maxHits: networkMaxHits,
      },
      violationLabel: 'network',
      message: message || 'Muitas tentativas desta origem. Aguarde alguns segundos.',
    });
  }
  if (actorMaxHits > 0 && actor.deviceKey) {
    await enforceRateLimitWithLogging(db, {
      scope: `${String(scope || 'default')}:actor`,
      key: actor.deviceKey,
      actor,
      policy: {
        minIntervalMs: actorMinIntervalMs,
        windowMs: actorWindowMs,
        maxHits: actorMaxHits,
      },
      violationLabel: 'actor',
      message: message || 'Muitas tentativas deste dispositivo. Aguarde alguns segundos.',
    });
  }
  if (ipMaxHits > 0 && actor.ipHash) {
    await enforceRateLimitWithLogging(db, {
      scope: `${String(scope || 'default')}:ip`,
      key: actor.ipHash,
      actor,
      policy: {
        minIntervalMs: ipMinIntervalMs,
        windowMs: ipWindowMs,
        maxHits: ipMaxHits,
      },
      violationLabel: 'ip',
      message: message || 'Muitas tentativas desta origem. Aguarde alguns segundos.',
    });
  }
  return actor;
}
