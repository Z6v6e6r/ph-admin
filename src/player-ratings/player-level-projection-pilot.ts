export interface PlayerLevelPilotBinding {
  playerKey: string;
  clientId: string;
}

export function readPlayerLevelPilot(
  env: NodeJS.ProcessEnv = process.env
): readonly PlayerLevelPilotBinding[] | undefined {
  const mode = env.PADLHUB_PLAYER_LEVEL_PROJECTION_MODE;
  const raw = env.PADLHUB_PLAYER_LEVEL_PROJECTION_PILOT_BINDINGS;
  if ((mode === undefined || mode === 'all') && raw === undefined) return undefined;
  if (mode !== 'pilot' || !raw || raw.length > 40_000) {
    throw new Error('Invalid PadlHub level projection mode or pilot bindings');
  }

  let bindings: unknown;
  try {
    bindings = JSON.parse(raw);
  } catch {
    throw new Error('Invalid PadlHub level projection pilot JSON');
  }
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length > 100
    || !bindings.every(isPilotBinding)
    || new Set(bindings.map(binding => binding.playerKey)).size !== bindings.length
    || new Set(bindings.map(binding => binding.clientId)).size !== bindings.length) {
    throw new Error('PadlHub level projection pilot requires 1–100 unique player/client bindings');
  }
  return bindings;
}

function isPilotBinding(value: unknown): value is PlayerLevelPilotBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const binding = value as Partial<PlayerLevelPilotBinding>;
  return Object.keys(binding).length === 2
    && typeof binding.playerKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(binding.playerKey)
    && typeof binding.clientId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.clientId);
}

export function isInPlayerLevelPilot(
  pilot: readonly PlayerLevelPilotBinding[] | undefined,
  state: { playerKey: string; clientId?: string }
): boolean {
  return !pilot || pilot.some(binding => binding.playerKey === state.playerKey && binding.clientId === state.clientId);
}
