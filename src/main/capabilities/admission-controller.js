'use strict';

const { CapabilityError } = require('./errors');

class AdmissionController {
  constructor({ clock = () => Date.now(), limits = {} } = {}) {
    this.clock = clock;
    this.limits = { perClientConcurrency: 4, globalConcurrency: 8, searchConcurrency: 2, maxQueued: 20, ...limits };
    this.globalActive = 0; this.searchActive = 0; this.clientActive = new Map(); this.buckets = new Map(); this.budgets = new Map();
  }

  enter({ registrationId, capability, ratePerMinute }) {
    if (this.globalActive >= this.limits.globalConcurrency || (this.clientActive.get(registrationId) || 0) >= this.limits.perClientConcurrency ||
        (capability === 'lana.document.search' && this.searchActive >= this.limits.searchConcurrency)) throw new CapabilityError('RATE_LIMITED');
    this.takeToken(`${registrationId}:${capability}`, ratePerMinute);
    this.globalActive += 1; this.clientActive.set(registrationId, (this.clientActive.get(registrationId) || 0) + 1);
    if (capability === 'lana.document.search') this.searchActive += 1;
    let left = false;
    return () => {
      if (left) return; left = true; this.globalActive -= 1;
      this.clientActive.set(registrationId, Math.max(0, (this.clientActive.get(registrationId) || 1) - 1));
      if (capability === 'lana.document.search') this.searchActive -= 1;
    };
  }

  takeToken(key, limit) {
    const now = this.clock(); const current = this.buckets.get(key) || { startedAt: now, count: 0 };
    if (now - current.startedAt >= 60_000) { current.startedAt = now; current.count = 0; }
    if (current.count >= limit) throw new CapabilityError('RATE_LIMITED');
    current.count += 1; this.buckets.set(key, current);
  }

  chargeBudget({ tenantId, itemCount, characterCount, itemLimit = 5000, characterLimit = 1000000 }) {
    const day = Math.floor(this.clock() / 86_400_000); const key = `${tenantId}:${day}`;
    const current = this.budgets.get(key) || { items: 0, characters: 0 };
    if (current.items + itemCount > itemLimit || current.characters + characterCount > characterLimit) throw new CapabilityError('RATE_LIMITED');
    current.items += itemCount; current.characters += characterCount; this.budgets.set(key, current);
  }
}
module.exports = { AdmissionController };
