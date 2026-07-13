/** Minimal Gmail thread row used by the mail listen UI. */
export type GmailThreadSummary = {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  fromEmail: string;
  date: string;
  unread: boolean;
  labelIds: string[];
};

/** One message body ready for local TTS. */
export type GmailMessageForSpeech = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  date: string;
  htmlBody: string;
  speechText: string;
  labelIds: string[];
};

/** Preset Gmail search queries inspired by Zero's category defaults. */
export type MailMailbox = 'important' | 'updates' | 'promotions' | 'inbox';

export const MAIL_MAILBOX_QUERIES: Record<MailMailbox, string> = {
  important: 'is:important -in:sent -in:draft',
  updates: 'category:updates -in:sent -in:draft',
  promotions: 'category:promotions -in:sent -in:draft',
  inbox: 'in:inbox',
};

export type GmailAuthStatus = {
  connected: boolean;
  email: string | null;
  name: string | null;
  hasClientConfig: boolean;
};

export type GmailClientConfig = {
  clientId: string;
  clientSecret?: string | null;
};

export type GmailAccessToken = {
  accessToken: string;
  email: string;
  expiresAtSec: number;
};

type GmailHeader = {
  name?: string | null;
  value?: string | null;
};

type GmailMessagePart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: {
    data?: string | null;
    size?: number | null;
    attachmentId?: string | null;
  } | null;
  parts?: GmailMessagePart[] | null;
  headers?: GmailHeader[] | null;
};

type GmailApiMessage = {
  id?: string | null;
  threadId?: string | null;
  snippet?: string | null;
  labelIds?: string[] | null;
  payload?: GmailMessagePart | null;
};

type GmailThreadsListResponse = {
  threads?: Array<{ id?: string | null }> | null;
  nextPageToken?: string | null;
};

type GmailThreadResponse = {
  id?: string | null;
  messages?: GmailApiMessage[] | null;
};

export type {
  GmailApiMessage,
  GmailHeader,
  GmailMessagePart,
  GmailThreadResponse,
  GmailThreadsListResponse,
};
