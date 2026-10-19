import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { CommunitiesPersistenceService } from '../src/communities/communities-persistence.service';
import { COMMUNITY_RATING_CALCULATION_VERSION } from '../src/communities/canonical-rating/contract';

async function main() {
  const persistence = new CommunitiesPersistenceService();
  const impl = persistence as any;
  const generation = '2026-10-15T10:00:00.000Z';
  let snapshotReads = 0;
  let changed = false;
  let missing = false;
  let rows: any[] = [];
  impl.findDocumentWithSourceById = async () => ({document:{id:'synthetic-community',name:'Тест'},dbName:'synthetic-db'});
  impl.database = async (dbName: string) => {
    assert.equal(dbName,'synthetic-db');
    return {collection(name: string) {
      if (name === 'community_rating_snapshots') return {
        async findOne(filter: any, options: any) {
          snapshotReads++;
          assert.equal(filter.communityId,'synthetic-community');
          assert.equal(filter.calculationVersion, COMMUNITY_RATING_CALCULATION_VERSION);
          assert.equal(filter.period,'all'); assert.equal(filter.tab,'overall');
          assert.equal(options.maxTimeMS,5000);
          if (missing) return null;
          return {updatedAt: changed && options.projection ? '2026-10-15T10:01:00.000Z' : generation};
        }
      };
      assert.equal(name,'community_rating_facts');
      return {find(filter: any, options: any) {
        assert.deepEqual(filter,{communityId:'synthetic-community',calculationVersion:COMMUNITY_RATING_CALCULATION_VERSION,collectedAt:generation});
        assert.equal(options.maxTimeMS,5000);
        return {limit(limit: number) { assert.equal(limit,20001); return {toArray: async () => rows}; }};
      }};
    }};
  };
  assert.ok(await persistence.readCommunityRatingExportSource('synthetic-community'));
  assert.equal(snapshotReads,2);
  changed = true;
  await assert.rejects(() => persistence.readCommunityRatingExportSource('synthetic-community'), /RESULTS_EXPORT_RATING_UPDATING/);
  changed = false; rows = Array(20001).fill({});
  await assert.rejects(() => persistence.readCommunityRatingExportSource('synthetic-community'), /RESULTS_EXPORT_TOO_LARGE/);
  rows = []; missing = true;
  assert.equal(await persistence.readCommunityRatingExportSource('synthetic-community'),null);
  console.log('Community results persistence bounded, same-database, read-only generation tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
