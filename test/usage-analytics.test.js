const assert = require('assert');
const UsageAnalytics = require('../src/usage-analytics');

describe('UsageAnalytics', function() {
  let analytics;

  beforeEach(function() {
    analytics = new UsageAnalytics();
  });

  describe('constructor', function() {
    it('should initialise with default configuration values', function() {
      assert.strictEqual(analytics.sessionDurationHours, 5);
      assert.strictEqual(analytics.burnRateWindow, 60);
      assert.strictEqual(analytics.currentPlan, 'custom');
    });

    it('should accept custom options', function() {
      const custom = new UsageAnalytics({
        sessionDurationHours: 3,
        burnRateWindow: 30,
        plan: 'pro'
      });
      assert.strictEqual(custom.sessionDurationHours, 3);
      assert.strictEqual(custom.burnRateWindow, 30);
      assert.strictEqual(custom.currentPlan, 'pro');
    });

    it('should initialise activeSessions as empty Map', function() {
      assert(analytics.activeSessions instanceof Map);
      assert.strictEqual(analytics.activeSessions.size, 0);
    });

    it('should initialise currentBurnRate to 0', function() {
      assert.strictEqual(analytics.currentBurnRate, 0);
    });

    it('should initialise velocityTrend to "stable"', function() {
      assert.strictEqual(analytics.velocityTrend, 'stable');
    });
  });

  describe('analyzeTrend', function() {
    it('should remain "stable" when there are fewer than 5 history entries', function() {
      analytics.burnRateHistory = [
        { timestamp: new Date(), rate: 100 },
        { timestamp: new Date(), rate: 120 },
      ];
      analytics.analyzeTrend();
      assert.strictEqual(analytics.velocityTrend, 'stable');
    });

    it('should return "increasing" when newAvg > oldAvg by more than 15%', function() {
      const now = Date.now();
      analytics.burnRateHistory = [
        { timestamp: new Date(now - 5000), rate: 100 },
        { timestamp: new Date(now - 4000), rate: 100 },
        { timestamp: new Date(now - 3000), rate: 100 },
        { timestamp: new Date(now - 2000), rate: 200 },
        { timestamp: new Date(now - 1000), rate: 200 },
        { timestamp: new Date(now),        rate: 200 },
      ];
      analytics.analyzeTrend();
      assert.strictEqual(analytics.velocityTrend, 'increasing');
    });

    it('should return "decreasing" when newAvg < oldAvg by more than 15%', function() {
      const now = Date.now();
      analytics.burnRateHistory = [
        { timestamp: new Date(now - 5000), rate: 200 },
        { timestamp: new Date(now - 4000), rate: 200 },
        { timestamp: new Date(now - 3000), rate: 200 },
        { timestamp: new Date(now - 2000), rate: 100 },
        { timestamp: new Date(now - 1000), rate: 100 },
        { timestamp: new Date(now),        rate: 100 },
      ];
      analytics.analyzeTrend();
      assert.strictEqual(analytics.velocityTrend, 'decreasing');
    });

    it('should return "stable" when values are close (within 15%)', function() {
      const now = Date.now();
      analytics.burnRateHistory = [
        { timestamp: new Date(now - 5000), rate: 100 },
        { timestamp: new Date(now - 4000), rate: 105 },
        { timestamp: new Date(now - 3000), rate: 100 },
        { timestamp: new Date(now - 2000), rate: 103 },
        { timestamp: new Date(now - 1000), rate: 102 },
        { timestamp: new Date(now),        rate: 101 },
      ];
      analytics.analyzeTrend();
      assert.strictEqual(analytics.velocityTrend, 'stable');
    });

    it('should handle oldAvg === 0 without division by zero', function() {
      const now = Date.now();
      // oldRates all zero, newRates non-zero
      analytics.burnRateHistory = [
        { timestamp: new Date(now - 5000), rate: 0 },
        { timestamp: new Date(now - 4000), rate: 0 },
        { timestamp: new Date(now - 3000), rate: 0 },
        { timestamp: new Date(now - 2000), rate: 50 },
        { timestamp: new Date(now - 1000), rate: 50 },
        { timestamp: new Date(now),        rate: 50 },
      ];
      // Should not throw
      analytics.analyzeTrend();
      assert.strictEqual(analytics.velocityTrend, 'increasing');
    });

    it('should return "stable" when oldAvg === 0 and newAvg === 0', function() {
      const now = Date.now();
      analytics.burnRateHistory = [
        { timestamp: new Date(now - 5000), rate: 0 },
        { timestamp: new Date(now - 4000), rate: 0 },
        { timestamp: new Date(now - 3000), rate: 0 },
        { timestamp: new Date(now - 2000), rate: 0 },
        { timestamp: new Date(now - 1000), rate: 0 },
        { timestamp: new Date(now),        rate: 0 },
      ];
      analytics.analyzeTrend();
      assert.strictEqual(analytics.velocityTrend, 'stable');
    });
  });

  describe('getTokenLimit', function() {
    it('should return the fixed token limit for "pro" plan', function() {
      analytics.setPlan('pro');
      assert.strictEqual(analytics.getTokenLimit(), 19000);
    });

    it('should return the fixed token limit for "max5" plan', function() {
      analytics.setPlan('max5');
      assert.strictEqual(analytics.getTokenLimit(), 88000);
    });

    it('should return the fixed token limit for "max20" plan', function() {
      analytics.setPlan('max20');
      assert.strictEqual(analytics.getTokenLimit(), 220000);
    });

    it('should return default p90 fallback for "custom" plan when p90Limit is null', function() {
      analytics.setPlan('custom');
      analytics.p90Limit = null;
      assert.strictEqual(analytics.getTokenLimit(), 188026);
    });

    it('should return p90Limit for "custom" plan when p90Limit is set', function() {
      analytics.setPlan('custom');
      analytics.p90Limit = 150000;
      assert.strictEqual(analytics.getTokenLimit(), 150000);
    });
  });

  describe('calculateP90Limit', function() {
    it('should return null when fewer than 10 sessions are provided', function() {
      const result = analytics.calculateP90Limit([{ totalTokens: 100 }]);
      assert.strictEqual(result, null);
    });

    it('should return null for empty array', function() {
      const result = analytics.calculateP90Limit([]);
      assert.strictEqual(result, null);
    });

    it('should calculate P90 from session token data', function() {
      const sessions = Array.from({ length: 10 }, (_, i) => ({ totalTokens: (i + 1) * 1000 }));
      const result = analytics.calculateP90Limit(sessions);
      // P90 of [1000..10000] sorted: index floor(10*0.9)=9 => 10000
      assert.strictEqual(result, 10000);
      assert.strictEqual(analytics.p90Limit, 10000);
    });
  });

  describe('addUsageData', function() {
    it('should add an entry to recentUsage', function() {
      analytics.addUsageData({ inputTokens: 100, outputTokens: 50, cost: 0.01, model: 'sonnet' });
      assert.strictEqual(analytics.recentUsage.length, 1);
    });

    it('should compute combined token count (input + output only)', function() {
      analytics.addUsageData({ inputTokens: 100, outputTokens: 50, cacheCreationTokens: 200, cost: 0.01 });
      assert.strictEqual(analytics.recentUsage[0].tokens, 150);
    });

    it('should emit a "usage-update" event', function(done) {
      analytics.once('usage-update', (entry) => {
        assert(entry.tokens >= 0);
        done();
      });
      analytics.addUsageData({ inputTokens: 10, outputTokens: 5, cost: 0.001 });
    });
  });

  describe('startSession', function() {
    it('should add session to activeSessions Map', function() {
      analytics.startSession('s1');
      assert(analytics.activeSessions.has('s1'));
    });

    it('should set endTime to startTime + sessionDurationHours', function() {
      const start = new Date('2025-01-01T00:00:00.000Z');
      analytics.startSession('s2', start);
      const session = analytics.activeSessions.get('s2');
      const expectedEnd = new Date(start.getTime() + 5 * 60 * 60 * 1000);
      assert.strictEqual(session.endTime.getTime(), expectedEnd.getTime());
    });

    it('should emit "session-started" event', function(done) {
      analytics.once('session-started', (session) => {
        assert.strictEqual(session.id, 's3');
        done();
      });
      analytics.startSession('s3');
    });
  });

  describe('getSessionTokens', function() {
    it('should return 0 for a session with no usage data', function() {
      analytics.startSession('s-empty');
      assert.strictEqual(analytics.getSessionTokens('s-empty'), 0);
    });

    it('should return 0 for a non-existent session', function() {
      assert.strictEqual(analytics.getSessionTokens('no-such-session'), 0);
    });

    it('should sum tokens from matching usage entries', function() {
      analytics.startSession('s-tokens');
      // Manually inject usage entries for this session
      analytics.recentUsage.push(
        { timestamp: new Date(), tokens: 100, inputTokens: 70, outputTokens: 30, cost: 0, sessionId: 's-tokens' },
        { timestamp: new Date(), tokens: 50, inputTokens: 30, outputTokens: 20, cost: 0, sessionId: 's-tokens' },
        { timestamp: new Date(), tokens: 200, inputTokens: 150, outputTokens: 50, cost: 0, sessionId: 'other-session' },
      );
      assert.strictEqual(analytics.getSessionTokens('s-tokens'), 150);
    });
  });

  describe('setPlan', function() {
    it('should update currentPlan to a known plan type', function() {
      analytics.setPlan('pro');
      assert.strictEqual(analytics.currentPlan, 'pro');
    });

    it('should not update currentPlan for an unknown plan type', function() {
      analytics.setPlan('nonexistent-plan');
      assert.strictEqual(analytics.currentPlan, 'custom'); // unchanged
    });

    it('should emit "plan-changed" event with the new plan name', function(done) {
      analytics.once('plan-changed', (plan) => {
        assert.strictEqual(plan, 'max20');
        done();
      });
      analytics.setPlan('max20');
    });
  });

  describe('cleanup', function() {
    it('should remove expired sessions from activeSessions', function() {
      const past = new Date(Date.now() - 10000);
      analytics.activeSessions.set('expired', {
        id: 'expired',
        startTime: new Date(Date.now() - 20000),
        endTime: past,
        isActive: false
      });
      analytics.cleanup();
      assert(!analytics.activeSessions.has('expired'));
    });

    it('should keep sessions that have not yet expired', function() {
      const future = new Date(Date.now() + 60000);
      analytics.activeSessions.set('active', {
        id: 'active',
        startTime: new Date(),
        endTime: future,
        isActive: true
      });
      analytics.cleanup();
      assert(analytics.activeSessions.has('active'));
    });
  });

  describe('getAnalytics', function() {
    it('should return an object with expected top-level keys', function() {
      const result = analytics.getAnalytics();
      assert('currentSession' in result);
      assert('burnRate' in result);
      assert('predictions' in result);
      assert('plan' in result);
      assert('windows' in result);
      assert('activeSessions' in result);
    });

    it('should return null currentSession when no active sessions exist', function() {
      const result = analytics.getAnalytics();
      assert.strictEqual(result.currentSession, null);
    });
  });
});
