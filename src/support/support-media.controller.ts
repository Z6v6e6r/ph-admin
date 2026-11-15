import { Body, Controller, Header, Headers, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { authorizeSupportMedia } from './support-media-auth';
import { MessageAttachmentDto } from '../common/messages/message-attachment.dto';
import { MessageAttachmentType } from '../common/messages/message-attachment.types';
import { SupportMediaService } from './support-media.service';

export class PrepareSupportMediaDto {
  /** Server-generated Node-RED ingress nonce, never the user-supplied identity or a storage key. */
  @IsString() @Matches(/^WEB_LK:[a-f0-9]{16,64}$/)
  owner!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MessageAttachmentDto)
  attachments!: MessageAttachmentDto[];
}
export class ResolveSupportMediaItem {
  @IsInt() @Min(0) @Max(299) index!: number;
  @IsString() @MaxLength(120) id!: string;
  @IsString() @MaxLength(3000) mediaRef!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) mediaScope!: string;
}
export class ResolveSupportMediaDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ResolveSupportMediaItem)
  items!: ResolveSupportMediaItem[];
}

/** Internal Node-RED media bridge, not an end-user upload or arbitrary-key signing endpoint. */
@Controller('support/media')
export class SupportMediaController {
  constructor(private readonly media: SupportMediaService) {}
  private authorize(token?: string): void {
    authorizeSupportMedia(token);
  }
  @Post('prepare')
  @Header('Cache-Control', 'private, no-store')
  async prepare(@Headers('x-integration-token') token: string | undefined, @Body() dto: PrepareSupportMediaDto) {
    this.authorize(token);
    return { attachments: await this.media.prepare(dto.attachments, dto.owner) };
  }
  @Post('resolve')
  @Header('Cache-Control', 'private, no-store')
  async resolve(@Headers('x-integration-token') token: string | undefined, @Body() dto: ResolveSupportMediaDto) {
    this.authorize(token);
    const projected = await this.media.present({ attachments: dto.items.map(x => ({ id: x.id,
      type: MessageAttachmentType.IMAGE, url: x.mediaRef, mediaRef: x.mediaRef, mediaScope: x.mediaScope })) });
    return { items: projected.attachments.map((x, i) => ({ index: dto.items[i].index, id: x.id, url: x.url })) };
  }
}
