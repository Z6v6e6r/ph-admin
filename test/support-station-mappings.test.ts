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

const expectedNewStations = [
  { key: 'piter', stationId: 'Piter', stationName: 'Питер' },
  { key: 'kotelniki', stationId: 'Kotelniki', stationName: 'Котельники' },
  { key: 'shcherbinka', stationId: 'Shcherbinka', stationName: 'Щербинка' },
  { key: 'lyubertsy', stationId: 'Lyubertsy', stationName: 'Люберцы' },
  { key: 'kolomna', stationId: 'Kolomna', stationName: 'Коломна' }
];

for (const expected of expectedNewStations) {
  assert.deepEqual(
    DEFAULT_SUPPORT_STATION_MAPPINGS.find((mapping) => mapping.key === expected.key),
    expected
  );
}

const parsed = parseSupportStationMappings(
  JSON.stringify([
    {
      key: 'festival',
      stationId: 'ConfiguredFestival',
      stationName: 'Фестивальный парк из env'
    }
  ])
);

assert.deepEqual(parsed[0], {
  key: 'festival',
  stationId: 'ConfiguredFestival',
  stationName: 'Фестивальный парк из env'
});
assert.equal(
  parsed.filter((mapping) => mapping.key === 'festival').length,
  1
);
for (const expected of expectedNewStations) {
  assert.deepEqual(
    parsed.find((mapping) => mapping.key === expected.key),
    expected
  );
}

const custom = parseSupportStationMappings(
  JSON.stringify([
    {
      key: 'custom',
      stationId: 'CustomStation',
      stationName: 'Своя станция'
    }
  ])
);
assert.deepEqual(custom[0], {
  key: 'custom',
  stationId: 'CustomStation',
  stationName: 'Своя станция'
});
assert.equal(custom.length, DEFAULT_SUPPORT_STATION_MAPPINGS.length + 1);

console.log('Support station mappings test passed');
