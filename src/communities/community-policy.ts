/**
 * Community policy v1. Kept byte-identical in LK and CUP; no runtime/provider access.
 * Missing types are FRIENDS. Configuration never grants membership or payment rights.
 */
export const COMMUNITY_TYPES = ["FRIENDS", "STATION", "CORPORATE", "LEAGUE"] as const;
export type CommunityType = typeof COMMUNITY_TYPES[number];
export interface LeagueDivision { id: string; name: string; minLevel: number; maxLevel: number }
export interface CommunityTypeSettings {
  stationId?: string;
  directionIds?: string[];
  exerciseTypeIds?: string[];
  categories?: string[];
  vivaSubscriptionId?: string;
  divisions?: LeagueDivision[];
}
export const DEFAULT_LEAGUE_DIVISIONS: readonly LeagueDivision[] = [
  { id: "d-d-plus", name: "D–D+", minLevel: 1.5, maxLevel: 2 },
  { id: "d-plus-c", name: "D+–C", minLevel: 2, maxLevel: 3 },
  { id: "c-c-plus", name: "C–C+", minLevel: 3, maxLevel: 3.5 },
];
export function communityType(value: unknown): CommunityType {
  return COMMUNITY_TYPES.includes(value as CommunityType) ? value as CommunityType : "FRIENDS";
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function fail(code: string): never { throw new Error("COMMUNITY_POLICY_" + code); }
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail("INVALID_VALUE");
  return (value as string).trim();
}
function ids(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) fail("INVALID_IDS");
  return [...new Set((value as unknown[]).map(item => {
    const id = text(item, 120);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail("INVALID_ID");
    return id;
  }))];
}
export function parseCommunityTypeSettings(type: unknown, input: unknown): CommunityTypeSettings {
  if (!COMMUNITY_TYPES.includes(type as CommunityType)) fail("INVALID_TYPE");
  if (!record(input)) fail("INVALID_SETTINGS");
  const value = input as Record<string, unknown>;
  const keys: Record<CommunityType, string[]> = {
    FRIENDS: [], STATION: ["stationId"],
    CORPORATE: ["directionIds", "exerciseTypeIds", "categories", "vivaSubscriptionId"],
    LEAGUE: ["divisions"],
  };
  if (Object.keys(value).some(key => !keys[type as CommunityType].includes(key))) fail("UNKNOWN_SETTING");
  if (type === "FRIENDS") return {};
  if (type === "STATION") {
    const stationId = text(value.stationId, 120);
    if (!/^[a-zA-Z0-9_-]+$/.test(stationId)) fail("INVALID_STATION");
    return { stationId };
  }
  if (type === "CORPORATE") {
    const directionIds = ids(value.directionIds), exerciseTypeIds = ids(value.exerciseTypeIds);
    const categories = ids(value.categories);
    if (categories.some(item => !["open_game", "court_rental", "group_training", "tournament"].includes(item))) fail("INVALID_CATEGORY");
    if (!directionIds.length && !exerciseTypeIds.length && !categories.length) fail("CATEGORY_REQUIRED");
    const result: CommunityTypeSettings = { directionIds, exerciseTypeIds, categories };
    if (value.vivaSubscriptionId !== undefined && value.vivaSubscriptionId !== "") {
      const id = text(value.vivaSubscriptionId, 120);
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail("INVALID_SUBSCRIPTION");
      result.vivaSubscriptionId = id;
    }
    return result;
  }
  if (!Array.isArray(value.divisions) || !value.divisions.length || value.divisions.length > 12) fail("INVALID_DIVISIONS");
  const divisions: LeagueDivision[] = (value.divisions as unknown[]).map(raw => {
    if (!record(raw) || Object.keys(raw).some(key => !["id", "name", "minLevel", "maxLevel"].includes(key))) fail("INVALID_DIVISION");
    const item = raw as Record<string, unknown>, id = text(item.id, 64), name = text(item.name, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail("INVALID_DIVISION_ID");
    const minLevel = item.minLevel, maxLevel = item.maxLevel;
    if (typeof minLevel !== "number" || typeof maxLevel !== "number" || !Number.isFinite(minLevel) || !Number.isFinite(maxLevel) ||
        minLevel < 0 || maxLevel > 10 || minLevel >= maxLevel) fail("INVALID_RANGE");
    return { id, name, minLevel: minLevel as number, maxLevel: maxLevel as number };
  }).sort((a, b) => a.minLevel - b.minLevel);
  if (new Set(divisions.map(item => item.id)).size !== divisions.length) fail("DUPLICATE_DIVISION");
  if (divisions.some((item, index) => index > 0 && item.minLevel < divisions[index - 1].maxLevel)) fail("OVERLAPPING_DIVISIONS");
  return { divisions };
}
export function resolveLeagueDivision(divisions: readonly LeagueDivision[], level: unknown): LeagueDivision | null {
  if (typeof level !== "number" || !Number.isFinite(level)) return null;
  return divisions.find((division, index) => level >= division.minLevel &&
    (level < division.maxLevel || (index === divisions.length - 1 && level === division.maxLevel))) ?? null;
}
