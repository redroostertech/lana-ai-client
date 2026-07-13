/* ==========================================================================
   LANA One - Pricing Tiers (client-side source of truth for the plan grid)

   LANA One is the individuals/everyone product. Its plan ladder is
   Free / Pro / Max, gated on Forge (model) access. This mirrors the tier
   ladder in src/shared/entitlements/plan-gate.js, where:

     LANA One  free  -> canonical rank "free"
     LANA One  pro   -> canonical alias "plus"
     LANA One  max   -> canonical rank "max"

   The org/enterprise tiers (business_plus, pro_5x, pro_20x) sit ABOVE Max and
   are intentionally NOT offered here. They are the line to graduate to LANA AI
   proper. Prices below are TUNABLE (finalize with pricing); the mechanism is
   stable. Keep the `key` strings in sync with the backend plan values.

   No em dashes in user-facing copy. Icons come from the Lex icon set (never
   emoji).
   ========================================================================== */

(function () {
  'use strict';

  // Rank ladder used for upgrade-vs-manage decisions. Matches plan-gate's
  // canonical order (free < plus/pro < max). A higher rank than the current
  // plan means "upgrade" (checkout); an equal rank means "current plan"; a
  // lower rank means "manage / downgrade" (portal).
  var TIER_RANK = {
    free: 0,
    solo: 0,   // legacy alias
    demo: 0,   // LANA-AI alias
    spark: 1,
    pro: 2,
    plus: 2,   // canonical name Pro maps to
    edge: 2,   // LANA-AI alias
    max: 3
  };

  // Display labels, normalising legacy/cross-vocabulary values.
  var TIER_LABELS = {
    free: 'Free',
    solo: 'Free',
    demo: 'Free',
    spark: 'Spark',
    pro: 'Pro',
    plus: 'Pro',
    edge: 'Pro',
    max: 'Max'
  };

  // The three LANA One plan cards, in display order. `key` is the exact string
  // the checkout endpoint expects. `priceAmount` is the numeric monthly price
  // used for any live totals. Feature bullets are qualitative and on-brand.
  var TIERS = [
    {
      key: 'free',
      name: 'Free',
      price: '$0',
      priceAmount: 0,
      cadence: 'USD / month',
      tagline: 'Try LANA One.',
      icon: 'sparkles',
      featured: false,
      features: [
        'Standard chat usage',
        '0.5 GB secure storage',
        'Unlimited matters',
        'Prompt redaction, citation verification, tenant isolation',
        'No content in logs guarantee',
        'Community support'
      ]
    },
    {
      key: 'pro',
      name: 'Pro',
      price: '$19.99',
      priceAmount: 19.99,
      cadence: 'USD / month',
      tagline: 'For solo practitioners.',
      icon: 'zap',
      featured: true,
      features: [
        'Higher usage with priority queue',
        '15 GB secure storage',
        'Full Forge model access',
        'Document Studio and export',
        '30 day conversation history',
        'Email support'
      ]
    },
    {
      key: 'max',
      name: 'Max',
      price: '$49.99',
      priceAmount: 49.99,
      cadence: 'USD / month',
      tagline: 'For power users.',
      icon: 'trophy',
      featured: false,
      features: [
        'Highest usage ceiling',
        '75 GB secure storage',
        'Full Forge model access at top priority',
        'Document Studio, export, and advanced tooling',
        'Extended conversation history',
        'Priority support'
      ]
    }
  ];

  function tierRank(tier) {
    if (!tier || typeof tier !== 'string') return 0;
    var r = TIER_RANK[tier.toLowerCase()];
    return r === undefined ? 0 : r;
  }

  // Enumerated grid-key aliases (exact spellings only, NOT the rank ladder).
  // Maps the backend vocabulary for a tier onto the card key that represents
  // it in the grid. Anything not listed here maps to itself, so an unknown
  // tier (e.g. business_plus, professional, enterprise) stays unknown instead
  // of collapsing to a card -> the grid LOCKS to "Managed on LANA AI", the
  // correct outcome for a genuine org/enterprise/business account.
  //
  // A LANA One individual's tier is now AUTHORITATIVE: the profile returns
  // `effective_tier` (Free/Pro/Max) resolved from `organizations.plan_tier`,
  // which cloud-adopt stamps from the account plane. So we no longer mask the
  // LANA-AI default org tier `professional` -> free (that masking would let a
  // real business account see the individual grid and downgrade/double-subscribe).
  // Only genuine free-equivalent legacy vocab is aliased to a card here.
  //   solo / demo  -> free  (legacy / trial free-equivalents)
  //   plus / edge  -> pro   (canonical/legacy names for the Pro card)
  //   professional / enterprise / business_* -> unmapped -> grid locks.
  var TIER_KEY_ALIASES = {
    solo: 'free',          // legacy alias
    demo: 'free',          // LANA-AI trial alias
    plus: 'pro',           // canonical name Pro maps to
    edge: 'pro'            // LANA-AI alias
  };

  function canonicalTierKey(tier) {
    if (!tier || typeof tier !== 'string') return '';
    var k = tier.trim().toLowerCase();
    return TIER_KEY_ALIASES[k] || k;
  }

  // Pure grid-state resolver for the billing page. Membership is decided by
  // EXACT card-key identity (after enumerated alias normalization), never by
  // rank and never by edition. When the account's current tier is not one of
  // the offered cards (e.g. a business_plus org signed into a LANA One
  // binary), the grid must lock: no card is "current" and no plan-change CTA
  // may run, because rank comparison would falsely collapse the unknown tier
  // to free and offer upgrades that could downgrade or double-subscribe.
  //
  // Returns { currentKey: string|null, locked: boolean }:
  //   currentKey  the offered card key that IS the current plan, or null
  //   locked      true when the current tier has no card in the grid
  function resolvePlanGridState(offered, currentTier) {
    var list = Array.isArray(offered) ? offered : [];
    var key = canonicalTierKey(currentTier);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === key) {
        return { currentKey: key, locked: false };
      }
    }
    return { currentKey: null, locked: true };
  }

  function tierLabel(tier) {
    if (!tier || typeof tier !== 'string') return 'Free';
    return TIER_LABELS[tier.toLowerCase()] || (tier.charAt(0).toUpperCase() + tier.slice(1));
  }

  // ── Edition-aware plan offering ───────────────────────────────────────────
  //
  // The EDITION (window.LanaProductEdition; mirror of src/config/product-edition.js)
  // is a FORM FACTOR flag. Here it decides WHICH PLANS ARE OFFERED, and nothing
  // else: under the LANA One edition only the individual ladder (Free/Pro/Max)
  // is purchasable; business/org tiers are the line to graduate to LANA AI.
  // Under the base LANA AI edition the grid is exactly today's list, untouched.
  // Capability gating stays on the account entitlement (resolved tier), never
  // on the edition.

  // The plan keys purchasable under the LANA One edition.
  var LANA_ONE_PLAN_KEYS = ['free', 'pro', 'max'];

  // Where the "Graduate to Business" CTA points.
  // OWNER TODO: placeholder destination. Finalize this URL (business landing /
  // sales contact) before launch; the in-place seats/migrate-export flow is a
  // separate follow-up.
  var GRADUATE_TO_BUSINESS_URL = 'https://lanaai.io/business';

  // Pure filter: the tier cards to OFFER for a given edition.
  //   'lana_one'        -> only the LANA One ladder (Free/Pro/Max), so business
  //                        tiers added to TIERS later are never purchasable here.
  //   anything else     -> the list unchanged (LANA AI keeps today's behavior;
  //                        also the fail-safe for unknown/missing editions).
  function tiersForEdition(edition, tiers) {
    var list = Array.isArray(tiers) ? tiers : TIERS;
    var normalized = (typeof edition === 'string') ? edition.trim().toLowerCase() : '';
    if (normalized !== 'lana_one') return list.slice();
    return list.filter(function (t) {
      return !!t && LANA_ONE_PLAN_KEYS.indexOf(t.key) !== -1;
    });
  }

  var api = {
    TIERS: TIERS,
    TIER_RANK: TIER_RANK,
    TIER_LABELS: TIER_LABELS,
    LANA_ONE_PLAN_KEYS: LANA_ONE_PLAN_KEYS,
    GRADUATE_TO_BUSINESS_URL: GRADUATE_TO_BUSINESS_URL,
    tierRank: tierRank,
    tierLabel: tierLabel,
    canonicalTierKey: canonicalTierKey,
    resolvePlanGridState: resolvePlanGridState,
    tiersForEdition: tiersForEdition
  };

  if (typeof window !== 'undefined') {
    window.LanaPricing = api;
  }

  // Export for module usage (unit tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

})();
