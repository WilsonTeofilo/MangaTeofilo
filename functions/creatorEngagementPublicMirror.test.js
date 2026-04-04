import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildPublicEngagementFromCycle } from './creatorEngagementPublicMirror.js';

describe('buildPublicEngagementFromCycle', () => {
  it('returns nulls when state is null', () => {
    const out = buildPublicEngagementFromCycle(null, 1e12);
    assert.deepStrictEqual(out, {
      engagementBoostMul: null,
      engagementBoostUntil: null,
      engagementBadgeTier: null,
    });
  });

  it('exposes boost when until is in the future and mul > 1', () => {
    const now = 1_700_000_000_000;
    const out = buildPublicEngagementFromCycle(
      { activeBoostMul: 2, activeBoostUntil: now + 3600_000, badgeTier: 2 },
      now
    );
    assert.strictEqual(out.engagementBoostMul, 2);
    assert.strictEqual(out.engagementBoostUntil, now + 3600_000);
    assert.strictEqual(out.engagementBadgeTier, 2);
  });

  it('clears boost when expired', () => {
    const now = 1_700_000_000_000;
    const out = buildPublicEngagementFromCycle(
      { activeBoostMul: 2, activeBoostUntil: now - 1, badgeTier: 1 },
      now
    );
    assert.strictEqual(out.engagementBoostMul, null);
    assert.strictEqual(out.engagementBoostUntil, null);
    assert.strictEqual(out.engagementBadgeTier, 1);
  });
});
