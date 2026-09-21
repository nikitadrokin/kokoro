/**
 * Port of app/src/lib/tts-text.ts `optimizePlainTextForSpeech` for Shortcuts.
 * Keep in sync with the TypeScript source when speech normalization changes.
 *
 * Designed to run inside a Shortcuts data-URI HTML render (iOS/macOS).
 * Avoid literal hash characters — they break data:text/html URIs on iOS 17+.
 */

'use strict';

var TABLE_DIVIDER_PATTERN = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
var ORDERED_LIST_PATTERN = /^\s*\d+[.)]\s+/;
var UNORDERED_LIST_PATTERN = /^\s*[-*+]\s+/;
var BLOCKQUOTE_PATTERN = /^\s{0,3}>\s?/;
var HEADING_PATTERN = new RegExp('^\\s{0,3}\\u0023{1,6}\\s+');
var TERMINAL_PUNCTUATION_PATTERN = /[.!?:;](?:["')\]]+)?$/;
var TRAILING_COMMA_PATTERN = /,+(?:["')\]]+)?$/;
var TABLE_ROW_PATTERN = /^\|/;
var STANDALONE_REFERENCE_LINE_PATTERN = /^(?=[\s[\],.]*\d)[\s[\]\d,.]+$/;
var HYPHEN_BREAK_PATTERN = /(\p{L})[-‐­]$/u;
var CONTINUES_LOWERCASE_PATTERN = /^\p{Ll}/u;

var ABBREVIATION_EXPANSIONS = [
  [/\be\.\s?g\.(?=\s|$|[,;:])/gi, 'for example'],
  [/\bi\.\s?e\.(?=\s|$|[,;:])/gi, 'that is'],
  [/\betc\.(?=\s|$|[,;:])/gi, 'et cetera'],
  [/\bet al\.(?=\s|$|[,;:])/gi, 'and others'],
  [/\bvs\.?(?=\s|$|[,;:])/gi, 'versus'],
  [/\bcf\.(?=\s|$|[,;:])/gi, 'compare'],
  [/\bca\.(?=\s*\d)/gi, 'circa '],
  [/\bNo\.(?=\s*\d)/g, 'number '],
  [/\bpp\.(?=\s*\d)/gi, 'pages '],
  [/\bp\.(?=\s*\d)/gi, 'page '],
  [/\bFig\.(?=\s|$|\s*\d)/gi, 'Figure '],
  [/\bDr\.(?=\s)/g, 'Doctor'],
  [/\bMr\.(?=\s)/g, 'Mister'],
  [/\bMrs\.(?=\s)/g, 'Missus'],
  [/\bMs\.(?=\s)/g, 'Miss'],
  [/\bProf\.(?=\s)/g, 'Professor'],
];

function startsNewBlock(line) {
  return (
    UNORDERED_LIST_PATTERN.test(line) ||
    ORDERED_LIST_PATTERN.test(line) ||
    BLOCKQUOTE_PATTERN.test(line) ||
    TABLE_ROW_PATTERN.test(line) ||
    TABLE_DIVIDER_PATTERN.test(line)
  );
}

function reflowWrappedText(text) {
  var lines = text.replace(/\r\n?/g, '\n').split('\n');
  var output = [];
  var current = '';

  function flush() {
    if (current) {
      output.push(current);
      current = '';
    }
  }

  for (var i = 0; i < lines.length; i += 1) {
    var trimmed = lines[i].trim();

    if (!trimmed) {
      flush();
      output.push('');
      continue;
    }

    if (HEADING_PATTERN.test(trimmed)) {
      flush();
      output.push(trimmed);
      continue;
    }

    if (startsNewBlock(trimmed)) {
      flush();
      current = trimmed;
      continue;
    }

    if (!current) {
      current = trimmed;
      continue;
    }

    if (
      HYPHEN_BREAK_PATTERN.test(current) &&
      CONTINUES_LOWERCASE_PATTERN.test(trimmed)
    ) {
      current = current.replace(/[-‐­]$/, '') + trimmed;
    } else {
      current = current + ' ' + trimmed;
    }
  }

  flush();

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function expandAbbreviations(text) {
  var result = text;
  for (var i = 0; i < ABBREVIATION_EXPANSIONS.length; i += 1) {
    result = result.replace(
      ABBREVIATION_EXPANSIONS[i][0],
      ABBREVIATION_EXPANSIONS[i][1],
    );
  }
  return result;
}

function pluralize(word, count) {
  return count === 1 ? word : word + 's';
}

function formatCurrencyForSpeech(amount) {
  var normalized = amount.replace(/,/g, '');
  var parts = normalized.split('.');
  var dollarsPart = parts[0] || '0';
  var centsPart = parts[1] || '';
  var dollars = Number.parseInt(dollarsPart || '0', 10);
  var cents = Number.parseInt(centsPart.padEnd(2, '0') || '0', 10);

  if (dollars === 0 && cents > 0) {
    return cents + ' ' + pluralize('cent', cents);
  }

  if (cents > 0) {
    return (
      dollars +
      ' ' +
      pluralize('dollar', dollars) +
      ' and ' +
      cents +
      ' ' +
      pluralize('cent', cents)
    );
  }

  return dollars + ' ' + pluralize('dollar', dollars);
}

function formatUrlForSpeech(url) {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(new RegExp('[?\\u0023].*$'), '')
    .replace(/\/$/, '')
    .replace(/\./g, ' dot ')
    .replace(/\//g, ' slash ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSpeechText(text) {
  return expandAbbreviations(
    text
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~]+/g, '')
      .replace(/\^\[([^\]]+)\]/g, '$1')
      .replace(/\[\^?[\w-]+\]/g, ''),
  )
    .replace(/https?:\/\/[^\s)]+/gi, formatUrlForSpeech)
    .replace(
      /(^|[^\w])\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})(?=\b|[^\d])/g,
      function (_match, prefix, amount) {
        return prefix + formatCurrencyForSpeech(amount);
      },
    )
    .replace(/(\d+(?:\.\d+)?)%/g, '$1 percent')
    .replace(/(\d)\s*[–—-]\s*(?=\d)/g, '$1 to ')
    .replace(/&amp;/gi, ' and ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;|&ndash;/gi, ', ')
    .replace(/&/g, ' and ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\.{3,}/g, '. ')
    .replace(/[–—]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function punctuateLine(line) {
  if (TERMINAL_PUNCTUATION_PATTERN.test(line.text)) {
    return line.text;
  }

  if (TRAILING_COMMA_PATTERN.test(line.text)) {
    return line.text.replace(TRAILING_COMMA_PATTERN, ';');
  }

  if (line.kind === 'heading') {
    return line.text + ':';
  }

  if (line.kind === 'list') {
    return line.text + ';';
  }

  return line.text + '.';
}

function pushBlankLine(lines) {
  if (lines.length === 0 || lines[lines.length - 1] === '') {
    return;
  }
  lines.push('');
}

/**
 * @param {string} text
 * @returns {string}
 */
function optimizePlainTextForSpeech(text) {
  var withoutOrphanedReferences = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(function (line) {
      return !STANDALONE_REFERENCE_LINE_PATTERN.test(line.trim());
    })
    .join('\n');
  var normalized = reflowWrappedText(withoutOrphanedReferences)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00a0/g, ' ');
  var output = [];

  var rawLines = normalized.split('\n');
  for (var i = 0; i < rawLines.length; i += 1) {
    var cleaned = normalizeSpeechText(rawLines[i].trim());
    if (!cleaned) {
      pushBlankLine(output);
      continue;
    }

    output.push(
      punctuateLine({
        kind: 'body',
        text: cleaned,
      }),
    );
  }

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    optimizePlainTextForSpeech: optimizePlainTextForSpeech,
    reflowWrappedText: reflowWrappedText,
  };
}
