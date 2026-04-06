export interface SupportStationMapping {
  key: string;
  stationId: string;
  stationName: string;
}

export const DEFAULT_SUPPORT_STATION_MAPPINGS: SupportStationMapping[] = [
  { key: 'promo', stationId: 'promo', stationName: 'PROMO' },
  { key: 'yas', stationId: 'Yasenevo', stationName: 'Ясенево' },
  { key: 'nagat', stationId: 'Nagatinskaya', stationName: 'Нагатинская' },
  {
    key: 'nagat_p',
    stationId: 'NagatinskayaP',
    stationName: 'Нагатинская Премиум'
  },
  { key: 'tereh', stationId: 'Terehovo', stationName: 'Терехово' },
  { key: 'kuncev', stationId: 'Skolkovo', stationName: 'Сколково' },
  { key: 'sochi', stationId: 'Sochi', stationName: 'Сочи' },
  { key: 'seleger', stationId: 'seleger', stationName: 'Селигерская' },
  { key: 't-sbora', stationId: 'care_service', stationName: 'Точка сбора' }
];

export function parseSupportStationMappings(
  rawMappings?: string
): SupportStationMapping[] {
  const raw = String(rawMappings ?? '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<
        Partial<SupportStationMapping> & { callbackKey?: string }
      >;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const mappings = parsed
          .map((item) => ({
            key: String(item.key ?? item.callbackKey ?? '')
              .trim()
              .toLowerCase(),
            stationId: String(item.stationId ?? '').trim(),
            stationName: String(item.stationName ?? '').trim()
          }))
          .filter(
            (item) =>
              item.key.length > 0 &&
              item.stationId.length > 0 &&
              item.stationName.length > 0
          );

        if (mappings.length > 0) {
          return mappings;
        }
      }
    } catch (_error) {
      // ignore invalid env and fallback to defaults
    }
  }

  return DEFAULT_SUPPORT_STATION_MAPPINGS.map((mapping) => ({ ...mapping }));
}
