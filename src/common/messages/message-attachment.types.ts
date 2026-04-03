export enum MessageAttachmentType {
  IMAGE = 'IMAGE'
}

export interface MessageAttachment {
  id: string;
  type: MessageAttachmentType;
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
}
