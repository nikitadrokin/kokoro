import type { GmailMessagePart } from './types';

/**
 * Converts Gmail's base64url payload into a UTF-8 string.
 * Ported from Zero's `fromBinary` helper.
 */
export function decodeGmailBodyData(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );

  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/** Recursively finds the first `text/html` part body, matching Zero's `findHtmlBody`. */
export function findHtmlBody(parts: GmailMessagePart[]): string {
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return part.body.data;
    }
    if (part.parts && part.parts.length > 0) {
      const found = findHtmlBody(part.parts);
      if (found) {
        return found;
      }
    }
  }
  return '';
}

/** Recursively finds the first `text/plain` part body as a TTS fallback. */
export function findPlainTextBody(parts: GmailMessagePart[]): string {
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return part.body.data;
    }
    if (part.parts && part.parts.length > 0) {
      const found = findPlainTextBody(part.parts);
      if (found) {
        return found;
      }
    }
  }
  return '';
}

/**
 * Extracts readable speech text from an HTML email body.
 * Inspired by Zero's `htmlToText` — DOM-free so it works in Node tests and the webview.
 */
export function htmlToSpeechText(html: string): string {
  if (!html.trim()) {
    return '';
  }

  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const withBreaks = withoutNoise
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeBasicEntities(withBreaks)
    .replace(/\u00a0/g, ' ')
    .replace(/\r?\n|\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Decodes the HTML entities most commonly found in email bodies. */
function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    });
}

/** Parses a From header into display name + email without extra deps. */
export function parseFromHeader(fromHeader: string): {
  name: string;
  email: string;
} {
  const trimmed = fromHeader.trim();
  const angleMatch = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (angleMatch) {
    const name = (angleMatch[1] ?? '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .trim();
    const email = (angleMatch[2] ?? '').trim();
    return {
      name: name || email,
      email: email || 'unknown@unknown',
    };
  }

  if (trimmed.includes('@')) {
    return { name: trimmed, email: trimmed };
  }

  return { name: trimmed || 'Unknown', email: 'unknown@unknown' };
}

/** Reads a case-insensitive header value from a Gmail payload. */
export function getHeader(
  headers:
    | Array<{ name?: string | null; value?: string | null }>
    | null
    | undefined,
  name: string,
): string {
  if (!headers) {
    return '';
  }
  const lower = name.toLowerCase();
  return (
    headers.find((header) => header.name?.toLowerCase() === lower)?.value ?? ''
  );
}
