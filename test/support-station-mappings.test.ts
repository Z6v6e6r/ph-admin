import * as assert from 'node:assert/strict';
import {
  DEFAULT_SUPPORT_STATION_MAPPINGS,
  parseSupportStationMappings
} from '../src/support/support-station-mappings';

const festival = DEFAULT_SUPPORT_STATION_MAPPINGS.find(
  (mapping) => mapping.key === 'festival'
);

assert.deepEqual(festival, {
  key: 'festival',
  stationId: 'FestivalPark',
  stationName: 'Фестивальный парк'
});

const parsed = parseSupportStationMappings(
  JSON.stringify([
    {
      key: 'festival',
      stationId: 'FestivalPark',
      stationName: 'Фестивальный парк'
    }
  ])
);

assert.deepEqual(parsed, [
  {
    key: 'festival',
    stationId: 'FestivalPark',
    stationName: 'Фестивальный парк'
  }
]);

console.log('Support station mappings test passed');
