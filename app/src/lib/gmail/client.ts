import { invoke } from '@tauri-apps/api/core';
import { optimizePlainTextForSpeech } from '@/lib/tts-text';
import {
  decodeGmailBodyData,
  findHtmlBody,
  findPlainTextBody,
  getHeader,
  htmlToSpeechText,
  parseFromHeader,
} from './decode';
import {
  type GmailAccessToken,
  type GmailApiMessage,
  type GmailAuthStatus,
  type GmailClientConfig,
  type GmailMessageForSpeech,
  type GmailThreadResponse,
  type GmailThreadSummary,
  type GmailThreadsListResponse,
  MAIL_MAILBOX_QUERIES,
  type MailMailbox,
} from './types';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function getAccessToken(): Promise<string> {
  const token = await invoke<GmailAccessToken>('gmail_get_access_token');
  return token.accessToken;
}

async function gmailFetch<T>(
  path: string,
  query?: Record<string, string | number | string[] | undefined>,
): Promise<T> {
  const accessToken = await getAccessToken();
  const url = new URL(`${GMAIL_API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          url.searchParams.append(key, entry);
        }
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gmail API ${response.status}: ${body || response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

function messageToSummary(message: GmailApiMessage): GmailThreadSummary {
  const headers = message.payload?.headers;
  const fromRaw = getHeader(headers, 'From');
  const from = parseFromHeader(fromRaw);
  return {
    id: message.threadId || message.id || '',
    snippet: (message.snippet ?? '').trim(),
    subject:
      getHeader(headers, 'Subject').replace(/"/g, '').trim() || '(no subject)',
    from: from.name,
    fromEmail: from.email,
    date: getHeader(headers, 'Date'),
    unread: message.labelIds?.includes('UNREAD') ?? false,
    labelIds: message.labelIds ?? [],
  };
}

function extractBodies(message: GmailApiMessage): {
  htmlBody: string;
  speechText: string;
} {
  const payload = message.payload;
  if (!payload) {
    return { htmlBody: '', speechText: '' };
  }

  const encodedHtml =
    (payload.mimeType === 'text/html' && payload.body?.data
      ? payload.body.data
      : '') ||
    (payload.parts ? findHtmlBody(payload.parts) : '') ||
    '';

  const encodedPlain =
    (payload.mimeType === 'text/plain' && payload.body?.data
      ? payload.body.data
      : '') ||
    (payload.parts ? findPlainTextBody(payload.parts) : '') ||
    (!encodedHtml ? payload.body?.data || '' : '');

  const htmlBody = encodedHtml ? decodeGmailBodyData(encodedHtml) : '';
  const plainBody = encodedPlain ? decodeGmailBodyData(encodedPlain) : '';

  const speechSource = htmlBody ? htmlToSpeechText(htmlBody) : plainBody.trim();

  return {
    htmlBody,
    speechText: optimizePlainTextForSpeech(speechSource) || speechSource,
  };
}

/** Auth helpers backed by Tauri local OAuth commands. */
export async function getGmailAuthStatus(): Promise<GmailAuthStatus> {
  return invoke<GmailAuthStatus>('gmail_auth_status');
}

export async function getGmailClientConfig(): Promise<GmailClientConfig | null> {
  return invoke<GmailClientConfig | null>('gmail_get_client_config');
}

export async function saveGmailClientConfig(
  clientId: string,
  clientSecret?: string,
): Promise<GmailClientConfig> {
  return invoke<GmailClientConfig>('gmail_save_client_config', {
    clientId,
    clientSecret: clientSecret || null,
  });
}

export async function loginToGmail(): Promise<GmailAuthStatus> {
  return invoke<GmailAuthStatus>('gmail_login');
}

export async function logoutFromGmail(): Promise<void> {
  await invoke('gmail_logout');
}

/**
 * Lists recent threads for a mailbox, then hydrates each with metadata.
 * Mirrors Zero's live `threads.list` + metadata path (no Durable Object cache).
 */
export async function listMailboxThreads(
  mailbox: MailMailbox,
  maxResults = 20,
): Promise<GmailThreadSummary[]> {
  const list = await gmailFetch<GmailThreadsListResponse>('/threads', {
    q: MAIL_MAILBOX_QUERIES[mailbox],
    maxResults,
  });

  const threadIds = (list.threads ?? [])
    .map((thread) => thread.id)
    .filter((id): id is string => Boolean(id));

  const summaries: GmailThreadSummary[] = [];
  for (const threadId of threadIds) {
    const thread = await gmailFetch<GmailThreadResponse>(
      `/threads/${encodeURIComponent(threadId)}`,
      {
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      },
    );
    const latest = [...(thread.messages ?? [])]
      .reverse()
      .find((message) => !(message.labelIds ?? []).includes('DRAFT'));
    if (!latest) {
      continue;
    }
    summaries.push(messageToSummary({ ...latest, threadId }));
  }

  return summaries;
}

/** Loads a full thread and returns the latest non-draft message for TTS. */
export async function getThreadMessageForSpeech(
  threadId: string,
): Promise<GmailMessageForSpeech> {
  const thread = await gmailFetch<GmailThreadResponse>(
    `/threads/${encodeURIComponent(threadId)}`,
    { format: 'full' },
  );

  const latest = [...(thread.messages ?? [])]
    .reverse()
    .find((message) => !(message.labelIds ?? []).includes('DRAFT'));

  if (!latest) {
    throw new Error('This thread has no readable messages.');
  }

  const headers = latest.payload?.headers;
  const from = parseFromHeader(getHeader(headers, 'From'));
  const { htmlBody, speechText } = extractBodies(latest);

  if (!speechText.trim()) {
    throw new Error('Could not extract readable text from this email.');
  }

  return {
    id: latest.id || threadId,
    threadId: latest.threadId || threadId,
    subject:
      getHeader(headers, 'Subject').replace(/"/g, '').trim() || '(no subject)',
    from: from.name,
    fromEmail: from.email,
    date: getHeader(headers, 'Date'),
    htmlBody,
    speechText,
    labelIds: latest.labelIds ?? [],
  };
}
