import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {buildResidencyPolicyCandidate, residencyBookingPolicyBlockers, residencyBookingCompatibilityMatches, RESIDENCY_BOOKING_COMPATIBILITY, RESIDENCY_TOURNAMENT_COMPATIBILITY, LK_NODE_RED_RESIDENCY_BOOKING_V1, LK_NODE_RED_RESIDENCY_BOOKING_V2, RESIDENCY_PRODUCT_ID} from '../src/subscriptions/residency-booking-policy';
import {assertPolicySupportedByPublicationAdapter,publicationAdapterRuntimeCompatibility} from '../src/subscriptions/subscription-publication-enforcement-adapter';
import {SubscriptionRuntimeContextService} from '../src/subscriptions/subscription-runtime-context.service';
import {CreatePolicyVersionDto} from '../src/subscriptions/dto/create-policy-version.dto';
import {SubscriptionsService} from '../src/subscriptions/subscriptions.service';
import {compileSubscriptionRuntimeProjection} from '../src/subscriptions/subscription-runtime-projection';
import {validateStoredSubscriptionPolicyPublication,computeSubscriptionRuntimeProjectionDigest} from '../src/subscriptions/subscription-runtime-contracts';
import {evaluateSubscriptionShadowQuote} from '../src/subscriptions/subscription-shadow-quote';

async function main() {
  const dto=buildResidencyPolicyCandidate({effectiveAt:'2026-11-10T00:00:00.000Z',
    gameEventTypeIds:['viva:direction:4588:type:1613'],groupTrainingEventTypeIds:['viva:direction:6307:type:2349']});
  assert.deepEqual(await validate(plainToInstance(CreatePolicyVersionDto,dto)),[]);
  // Exercise the actual catalog normalization/validation without any persistence.
  const service=Object.create(SubscriptionsService.prototype) as any;
  service.validateRawPolicyControls(dto);
  const normalized=service.normalizePolicy(dto);
  service.validatePolicy(normalized);
  assert.equal(normalized.benefitRules[0].allStations,true);
  const projection=compileSubscriptionRuntimeProjection({...normalized,subscriptionTypeId:'type:residency',version:1,status:'PUBLISHED'});
  const publication:any={schemaVersion:3,publicationId:'publication:residency',subscriptionTypeId:'type:residency',policyVersion:1,
    policyDigest:computeSubscriptionRuntimeProjectionDigest(projection),mappingId:'mapping:residency',dictionaryRevision:'dictionary:fixture',runtimeProjection:projection,
    state:'PUBLISHED',effectiveAt:dto.effectiveAt,publishedAt:dto.effectiveAt,publishedBy:'admin:fixture',supersededAt:null,supersededBy:null,
    impactPreviewRef:'impact:fixture',approvalAuditRef:'audit:fixture',runtimeCompatibility:{adapterId:'LK1_RESIDENCY_BOOKING',contractVersion:1,capabilityDigest:'sha256:'+'a'.repeat(64)},
    idempotency:{actorId:'admin:fixture',key:'fixture-key',requestHash:'a'.repeat(64),correlationId:'corr:fixture'}};
  validateStoredSubscriptionPolicyPublication(publication);
  assert.deepEqual(residencyBookingPolicyBlockers(projection),[]);
  for(const stationId of ['station:first','station:newly-added']) for(const action of ['CREATE_GAME','JOIN_GAME','BOOK_GROUP_TRAINING'] as const) for(const durationMinutes of [60,90,120]) {
    const category=action==='BOOK_GROUP_TRAINING'?'GROUP_TRAINING':'GAME';
    const result=evaluateSubscriptionShadowQuote({evaluatedAt:'2026-11-10T10:00:00.000Z',publication,
      instance:{subscriptionInstanceId:'instance:fixture',subscriptionTypeId:'type:residency',policyVersion:1,state:'ACTIVE',activeFrom:dto.effectiveAt,activeTo:'2026-12-10T00:00:00.000Z'} as any,
      aggregate:{subscriptionInstanceId:'instance:fixture',revision:1,activeServiceCount:0,activeServices:[],remainingUnits:0,dailyUsage:{},weeklyUsage:{},monthlyUsage:{},futureBookingCount:0} as any,
      action,target:{resolutionSource:'SERVER',targetId:'target:fixture',stationId,category,externalEventTypeId:category==='GAME'?'viva:direction:4588:type:1613':'viva:direction:6307:type:2349',productTypeId:null,durationMinutes,startsAt:'2026-11-11T10:00:00.000Z',basePriceMinor:12345,currency:'RUB',dictionaryRevision:'dictionary:fixture',evidenceRef:'evidence:fixture',priceEvidenceRef:'evidence:price',resolvedAt:'2026-11-10T10:00:00.000Z'}});
    assert.equal(result.eligible,true,JSON.stringify(result.blockers));
    assert.equal(result.usageUnits,0);
    assert.equal(result.benefit!.finalPriceMinor,category==='GAME'?8642:6173);
  }
  const tournamentDto=buildResidencyPolicyCandidate({effectiveAt:dto.effectiveAt,
    gameEventTypeIds:['viva:direction:4588:type:1613'],groupTrainingEventTypeIds:['viva:direction:6307:type:2349'],
    tournamentEventTypeIds:['viva:direction:5280:type:1013','viva:direction:5278:type:839']});
  assert.deepEqual(await validate(plainToInstance(CreatePolicyVersionDto,tournamentDto)),[]);
  const tournamentPolicy=service.normalizePolicy(tournamentDto);service.validatePolicy(tournamentPolicy);
  const nextProjection=compileSubscriptionRuntimeProjection({...tournamentPolicy,subscriptionTypeId:'type:residency',version:2,status:'PUBLISHED'});
  assert.deepEqual(residencyBookingPolicyBlockers(nextProjection),[]);
  assert.equal(RESIDENCY_TOURNAMENT_COMPATIBILITY.capabilityDigest,'sha256:63be8d476b73583c8b80f55cf7016abe571a2b8159dbb7e8db2f07010f614104');
  assert.equal(residencyBookingCompatibilityMatches(projection,RESIDENCY_BOOKING_COMPATIBILITY),true);
  assert.equal(residencyBookingCompatibilityMatches(projection,RESIDENCY_TOURNAMENT_COMPATIBILITY),false);
  assert.equal(residencyBookingCompatibilityMatches(nextProjection,RESIDENCY_BOOKING_COMPATIBILITY),false);
  assert.equal(residencyBookingCompatibilityMatches(nextProjection,RESIDENCY_TOURNAMENT_COMPATIBILITY),true);
  assert.deepEqual(publicationAdapterRuntimeCompatibility(LK_NODE_RED_RESIDENCY_BOOKING_V2),RESIDENCY_TOURNAMENT_COMPATIBILITY);
  assertPolicySupportedByPublicationAdapter(LK_NODE_RED_RESIDENCY_BOOKING_V1,{...normalized,providerBinding:dto.providerBinding} as any);
  assertPolicySupportedByPublicationAdapter(LK_NODE_RED_RESIDENCY_BOOKING_V2,{...tournamentPolicy,providerBinding:tournamentDto.providerBinding} as any);
  assert.throws(()=>assertPolicySupportedByPublicationAdapter(LK_NODE_RED_RESIDENCY_BOOKING_V1,{...tournamentPolicy,providerBinding:tournamentDto.providerBinding} as any));
  assert.throws(()=>assertPolicySupportedByPublicationAdapter(LK_NODE_RED_RESIDENCY_BOOKING_V2,{...normalized,providerBinding:dto.providerBinding} as any));
  for(const mutate of [
    (p:any)=>{p.benefitRules[2].percentage=100;},(p:any)=>{p.benefitRules[2].actions=['BOOK_GROUP_TRAINING'];},
    (p:any)=>{p.benefitRules[2].allStations=false;},(p:any)=>{p.benefitRules[2].stationIds=['station:unexpected'];},
    (p:any)=>{p.benefitRules.push({...p.benefitRules[2]});},(p:any)=>{p.benefitRules[2].externalEventTypeIds=[];}
  ]) {const invalid=structuredClone(nextProjection);mutate(invalid);assert.equal(residencyBookingCompatibilityMatches(invalid,RESIDENCY_TOURNAMENT_COMPATIBILITY),false);}
  const nextPublication={...publication,policyVersion:2,runtimeProjection:nextProjection,runtimeCompatibility:RESIDENCY_TOURNAMENT_COMPATIBILITY,
    policyDigest:computeSubscriptionRuntimeProjectionDigest(nextProjection)};
  for(const minutes of [60,90,120]){
    const result=evaluateSubscriptionShadowQuote({evaluatedAt:'2026-11-10T10:00:00.000Z',publication:nextPublication,
      instance:{subscriptionInstanceId:'instance:fixture',subscriptionTypeId:'type:residency',policyVersion:2,state:'ACTIVE',activeFrom:dto.effectiveAt,activeTo:'2026-12-10T00:00:00.000Z'} as any,
      aggregate:{subscriptionInstanceId:'instance:fixture',revision:1,activeServiceCount:0,activeServices:[],remainingUnits:0,dailyUsage:{},weeklyUsage:{},monthlyUsage:{},futureBookingCount:0} as any,
      action:'BOOK_TOURNAMENT',target:{resolutionSource:'SERVER',targetId:'target:fixture',stationId:'station:any',category:'TOURNAMENT',
        externalEventTypeId:'viva:direction:5280:type:1013',productTypeId:null,durationMinutes:minutes,startsAt:'2026-11-11T10:00:00.000Z',basePriceMinor:400000,currency:'RUB',dictionaryRevision:'dictionary:fixture',evidenceRef:'evidence:fixture',priceEvidenceRef:'evidence:price',resolvedAt:'2026-11-10T10:00:00.000Z'}});
    assert.equal(result.eligible,true,JSON.stringify(result.blockers));assert.equal(result.usageUnits,0);assert.equal(result.benefit!.finalPriceMinor,200000);
  }
  const resolver=Object.create(SubscriptionRuntimeContextService.prototype) as any;
  resolver.flag=()=>true;resolver.now=()=>new Date('2026-11-11T10:00:00.000Z');
  const context={schemaVersion:1,policy:nextProjection,instance:{subscriptionInstanceId:'instance:fixture',subscriptionTypeId:'type:residency',policyVersion:2,
    state:'ACTIVE',activeFrom:dto.effectiveAt,activeTo:'2026-12-10T00:00:00.000Z',frozenUntil:null},
    evidence:{mappingVerifiedAt:'2026-11-11T10:00:00.000Z',instanceAsOf:'2026-11-11T10:00:00.000Z'}};
  resolver.resolveValidated=async()=>({context,providerProductId:RESIDENCY_PRODUCT_ID,publication:nextPublication,purchasedAt:dto.effectiveAt});
  const previousStaleness=process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS;
  process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS='60';
  assert.deepEqual((await resolver.resolveResidency(undefined,undefined,{} as any)).runtimeCompatibility,RESIDENCY_TOURNAMENT_COMPATIBILITY);
  nextPublication.runtimeCompatibility={...RESIDENCY_BOOKING_COMPATIBILITY};
  await assert.rejects(()=>resolver.resolveResidency(undefined,undefined,{} as any));
  if(previousStaleness===undefined)delete process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS;
  else process.env.SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS=previousStaleness;
  const ambiguous=structuredClone(publication);
  ambiguous.runtimeProjection.benefitRules[0].stationIds=['station:also-listed'];
  ambiguous.policyDigest=computeSubscriptionRuntimeProjectionDigest(ambiguous.runtimeProjection);
  assert.throws(()=>validateStoredSubscriptionPolicyPublication(ambiguous));
  const free=structuredClone(publication);
  free.runtimeProjection.benefitRules[0].kind='FREE_ENTITLEMENT';
  free.runtimeProjection.benefitRules[0].percentage=null;
  free.policyDigest=computeSubscriptionRuntimeProjectionDigest(free.runtimeProjection);
  assert.throws(()=>validateStoredSubscriptionPolicyPublication(free));
  console.log('Residency catalog, wildcard stations, zero-visits and monetary quote checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
