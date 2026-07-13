import { describe, expect, it } from 'vitest';
import {
  decodeGmailBodyData,
  findHtmlBody,
  htmlToSpeechText,
  parseFromHeader,
} from './decode';

describe('gmail decode helpers', () => {
  it('decodes Gmail base64url bodies', () => {
    const encoded = btoa('Hello newsletter')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    expect(decodeGmailBodyData(encoded)).toBe('Hello newsletter');
  });

  it('finds nested HTML parts like Zero', () => {
    const data = findHtmlBody([
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: 'cGxhaW4=' } },
          { mimeType: 'text/html', body: { data: 'PGgxPkhpPC9oMT4=' } },
        ],
      },
    ]);
    expect(data).toBe('PGgxPkhpPC9oMT4=');
  });

  it('parses From headers', () => {
    expect(parseFromHeader('"Zero Digest" <news@example.com>')).toEqual({
      name: 'Zero Digest',
      email: 'news@example.com',
    });
  });

  it('strips HTML for speech', () => {
    expect(
      htmlToSpeechText(
        '<html><body><style>.x{}</style><p>Hello&nbsp;world</p></body></html>',
      ),
    ).toBe('Hello world');
  });
});
