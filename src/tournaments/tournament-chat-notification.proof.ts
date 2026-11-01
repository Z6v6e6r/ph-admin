import { Injectable } from '@nestjs/common';
import { createHash, createPublicKey, KeyObject, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { denied, keys, unavailable } from './tournament-chat.contract';
import { object, uuid } from './tournament-local-operation.contract';
import { FeedScope, NOTIFICATION_PATH, Operation } from './tournament-chat-notification.contract';
export type FeedProofConfig = {enabled:boolean;tenantId:string;tenantKey:string;ownerTenantKey:string;issuer?:string;kid?:string;publicKey?:KeyObject};
export function notificationProofConfig(env: NodeJS.ProcessEnv): FeedProofConfig {
 const c:FeedProofConfig={enabled:env.TOURNAMENT_CHAT_NOTIFICATION_ENABLED==='true',tenantId:env.TOURNAMENT_CHAT_NOTIFICATION_TENANT_ID??'',tenantKey:env.TOURNAMENT_CHAT_NOTIFICATION_TENANT_KEY??'',ownerTenantKey:env.LK_IDENTITY_EXPECTED_TENANT_KEY??''};
 if(!c.enabled)return c;
 const file=env.TOURNAMENT_CHAT_NOTIFICATION_PUBLIC_KEY_FILE,issuer=env.TOURNAMENT_CHAT_NOTIFICATION_ISSUER,kid=env.TOURNAMENT_CHAT_NOTIFICATION_KEY_ID;
 if(!uuid(c.tenantId)||!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(c.tenantKey)||!/^[A-Za-z0-9_-]{1,200}$/.test(c.ownerTenantKey)||!file||!issuer||issuer.length>200||!kid||!/^[A-Za-z0-9_-]{1,64}$/.test(kid))throw unavailable();
 const bytes=readFileSync(file);if(bytes.length>16384)throw unavailable();const publicKey=createPublicKey(bytes);
 if(publicKey.asymmetricKeyType!=='rsa'||(publicKey.asymmetricKeyDetails?.modulusLength??0)<2048)throw unavailable();return {...c,issuer,kid,publicKey};
}
@Injectable()
export class TournamentChatNotificationProof {
 readonly config=notificationProofConfig(process.env);
 verify(authorization:unknown,operation:Operation,body:string,correlation:unknown,now=Date.now()):FeedScope {
  const c=this.config;if(!c.enabled||!c.publicKey)throw unavailable();
  try {if(typeof authorization!=='string'||authorization.length>8192||!authorization.startsWith('Bearer ')||!uuid(correlation)||Buffer.byteLength(body)>16000)throw denied();
   const parts=authorization.slice(7).split('.');if(parts.length!==3||parts.some(v=>!/^[A-Za-z0-9_-]+$/.test(v)))throw denied();
   const decode=(v:string)=>{const b=Buffer.from(v,'base64url');if(b.toString('base64url')!==v)throw denied();return JSON.parse(b.toString('utf8'));};const h=decode(parts[0]),p=decode(parts[1]);
   if(!object(h)||!keys(h,'alg,kid,typ')||h.alg!=='RS256'||h.typ!=='phub-tournament-chat-notifications+jwt'||h.kid!==c.kid||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),c.publicKey,Buffer.from(parts[2],'base64url')))throw denied();
   if(!object(p)||!keys(p,'aud,contract_version,correlation_id,exp,iat,iss,jti,method,nbf,owner_tenant_key,path,request_sha256,scope,sub,tenant_id,tenant_key')
    ||p.contract_version!==1||p.iss!==c.issuer||p.aud!=='cup-tournament-chat-notifications-v1'||p.sub!=='lk2-tournament-notification-bridge'
    ||p.scope!=='tournaments.chat.notifications.'+operation||p.tenant_id!==c.tenantId||p.tenant_key!==c.tenantKey||p.owner_tenant_key!==c.ownerTenantKey
    ||p.method!=='POST'||p.path!==NOTIFICATION_PATH+'/'+operation||p.request_sha256!==createHash('sha256').update(body).digest('hex')||p.correlation_id!==correlation||!uuid(p.jti)
    ||!Number.isSafeInteger(p.iat)||!Number.isSafeInteger(p.exp)||p.nbf!==p.iat||p.exp<=p.iat||p.exp-p.iat>30||p.iat*1000>now||p.exp*1000<=now)throw denied();
   return {tenantId:c.tenantId,tenantKey:c.tenantKey,ownerTenantKey:c.ownerTenantKey,expiresAt:p.exp*1000,correlationId:correlation};
  }catch{throw denied();}
 }
}
