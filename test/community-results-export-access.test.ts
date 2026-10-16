import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { CommunitiesController } from '../src/communities/communities.controller';
import { CommunitiesService } from '../src/communities/communities.service';
import { Role } from '../src/common/rbac/role.enum';
import { RequestUser } from '../src/common/rbac/request-user.interface';
import { CommunitiesPersistenceService } from '../src/communities/communities-persistence.service';
import { buildCommunityRatingSnapshot } from '../src/communities/canonical-rating/aggregates';

async function main() {
  let reads = 0;
  const user: RequestUser = {id:'synthetic-admin', roles:[Role.MANAGER], stationIds:['station-a'], connectorRoutes:[]};
  const persistence = {
    isEnabled: () => true,
    findCommunityById: async () => ({id:'synthetic-community', name:'Тест', stationId:'station-b'}),
    readCommunityRatingExportSource: async () => { reads++; throw new Error('Unexpected read'); }
  };
  const service = new CommunitiesService({} as any, persistence as any);
  const controller = new CommunitiesController(service);
  assert.throws(() => controller.resultsExport('synthetic-community', {period:'week'}), /User context/);
  await assert.rejects(() => service.getResultsExport('synthetic-community', {period:'week'}, user), /RESULTS_EXPORT_ACCESS_DENIED/);
  assert.equal(reads, 0);
  await assert.rejects(() => service.getResultsExport('synthetic-community', {period:'bad'}, {...user, stationIds:[]}), /RESULTS_EXPORT_INVALID_PERIOD/);
  await assert.rejects(() => service.getResultsExport('synthetic-community', {period:'all'}, {...user, roles:[Role.CLIENT]}), /RESULTS_EXPORT_ACCESS_DENIED/);
  assert.equal(reads, 0);
  const headers = Reflect.getMetadata('__headers__', CommunitiesController.prototype.resultsExport);
  assert.ok(headers.some((entry: any) => entry.name === 'Cache-Control' && entry.value.includes('no-store')));
  const actualMapper = new CommunitiesPersistenceService() as any;
  const mapped = actualMapper.toCommunity({id:'synthetic-community',name:'Тест',stationId:'station-a'});
  assert.equal(mapped.stationId,undefined, 'exercise the existing mapper, not an invented station field');
  persistence.findCommunityById = async () => mapped;
  const snapshot = buildCommunityRatingSnapshot({communityId:'synthetic-community',facts:[],members:[],period:'all'});
  let exportedCommunity = mapped;
  (persistence as any).readCommunityRatingExportSource = async () => { reads++; return {community:exportedCommunity,snapshot,facts:[]}; };
  assert.deepEqual((await controller.resultsExport('synthetic-community',{period:'all',details:'templates-v1'},user)).rows,[]);
  assert.equal(reads,1);
  exportedCommunity = actualMapper.toCommunity({id:'synthetic-community',name:'Тест',stationId:'station-b'});
  await assert.rejects(() => service.getResultsExport('synthetic-community',{period:'all',details:'templates-v1'},user),/RESULTS_EXPORT_ACCESS_DENIED/);
  persistence.findCommunityById = async () => actualMapper.toCommunity({id:'synthetic-community',name:'Тест'});
  await assert.rejects(() => service.getResultsExport('synthetic-community',{period:'all'},user),/RESULTS_EXPORT_ACCESS_DENIED/);
  console.log('Community results export auth, station scope and no-store tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
