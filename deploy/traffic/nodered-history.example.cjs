'use strict';

// Optional settings.js composition, NOT a replacement settings file or an installer.
// Copy the built dependency-free dist/traffic/history-protection.js to this immutable path.
// Verify Node-RED accepts an Express middleware array and preserve the existing CORS/auth chain.
module.exports = function withHistoryProtection(settings, config = {}) {
  const mode = config.mode || 'off';
  if (mode === 'off') return settings;
  const { createHistoryProtection } = require('/opt/phab-traffic/runtime/history-protection.js');
  const previous = settings.httpNodeMiddleware;
  const chain = previous === undefined ? [] : Array.isArray(previous) ? previous : [previous];
  if (chain.some(item => typeof item !== 'function') || settings.functionGlobalContext?.phabHistoryProtection) {
    throw new Error('Review existing Node-RED middleware/global context before installing history protection');
  }
  const guard = createHistoryProtection({
    mode, // Start with 'shadow'; 'enforce' and enableCache require separate acceptance.
    trustLoopbackProxy: config.trustLoopbackProxy === true,
    // Supply only a verified identity from the preceding authentication middleware, if available.
    // There is NO header, client ID, phone or unsigned JWT fallback.
    verifiedSubject: config.verifiedSubject,
    ratePerMinute: 120, burst: 30,
    distinctThreshold: 100, spikePerMinute: 500,
    enableCache: config.enableCache === true,
    publicHistoryConfirmed: config.publicHistoryConfirmed === true,
    cacheTtlMs: 2000,
  });
  guard.startReporting('/var/lib/phab-history-protection/status.json');
  return {
    ...settings,
    httpNodeMiddleware: [...chain, guard.middleware],
    functionGlobalContext: {
      ...settings.functionGlobalContext,
      phabHistoryProtection: Object.freeze({ invalidate: guard.invalidate }),
    },
  };
};
