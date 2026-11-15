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
  /** Server-owned immutable object binding. Never accepted from a public DTO. */
  mediaRef?: string;
  mediaScope?: string;
}
