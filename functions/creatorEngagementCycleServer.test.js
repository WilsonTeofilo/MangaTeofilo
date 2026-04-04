import assert from 'node:assert';
import { describe, it } from 'node:test';
import { processEngagementCycleTick } from './creatorEngagementCycleServer.js';

describe('processEngagementCycleTick (server)', () => {
  it('does not keep fake completedIds from stored state', () => {
    const engagementCycle = {
      v: 1,
      cycleLevel: 1,
      cycleStartedAt: 1,
      baselines: { followers: 0, views: 0, likes: 0 },
      completedIds: { likes_20: true, views_100: true, fake_mission: true },
      repliesInCycle: 0,
      streakCount: 0,
      lastStreakKey: '',
      activeBoostMul: null,
      activeBoostUntil: null,
      spotlightUntil: null,
      badgeTier: 0,
    };
    const tick = processEngagementCycleTick({
      engagementCycle,
      metrics: { followers: 0, views: 0, likes: 0 },
      caps: [],
      uid: 'testuidxxxxxxxxxxxxxxxxxx',
      now: 1e12,
    });
    assert.strictEqual(tick.state.completedIds?.fake_mission, undefined);
  });
});
