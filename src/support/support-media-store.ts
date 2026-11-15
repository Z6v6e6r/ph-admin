import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export interface SupportMediaObjectStore {
  put(key: string, body: Buffer, sha256: string, signal: AbortSignal): Promise<string>;
  deliveryUrl(key: string, version: string): Promise<string>;
}

/** Uses an existing private bucket. No create-bucket, ACL, lifecycle or versioning writes. */
export class S3SupportMediaStore implements SupportMediaObjectStore {
  private readonly client: S3Client;
  constructor(private readonly bucket: string, options: {
    endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
  }) {
    this.client = new S3Client({ endpoint: options.endpoint, region: options.region,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      forcePathStyle: options.forcePathStyle, maxAttempts: 1,
      requestHandler: new NodeHttpHandler({ connectionTimeout: 3000, socketTimeout: 5000 }) });
  }
  async put(key: string, body: Buffer, sha256: string, signal: AbortSignal): Promise<string> {
    try {
      const result = await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key,
        Body: body, ContentType: 'image/jpeg', ContentLength: body.length, IfNoneMatch: '*',
        Metadata: { sha256 }, CacheControl: 'private, max-age=300' }), { abortSignal: signal });
      if (!result.VersionId || result.VersionId === 'null') throw new Error('SUPPORT_MEDIA_VERSIONING_REQUIRED');
      return result.VersionId;
    } catch (error) {
      // A lost PUT response may have committed the content-addressed object. Resolve by HEAD;
      // never overwrite it or retry the write with another key.
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal }).catch(() => undefined);
      if (!result || result.Metadata?.sha256 !== sha256 || result.ContentLength !== body.length ||
          result.ContentType !== 'image/jpeg' || !result.VersionId || result.VersionId === 'null') throw error;
      return result.VersionId;
    }
  }
  deliveryUrl(key: string, version: string): Promise<string> {
    if (!version || version === 'null') throw new Error('SUPPORT_MEDIA_VERSIONING_REQUIRED');
    // Static server credentials: this is local signing, with no S3/STS request on a queue claim.
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key,
      VersionId: version, ResponseContentType: 'image/jpeg',
      ResponseCacheControl: 'private, max-age=300' }), { expiresIn: 300,
      signingDate: new Date(Math.floor(Date.now() / 120000) * 120000) });
  }
}
