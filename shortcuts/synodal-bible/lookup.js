/**
 * Synodal Bible verse helpers for the iOS/macOS Shortcut.
 * Embedded via data:text/html (same pattern as pdf-to-audio).
 * Avoid hash characters — they break data URIs on iOS.
 *
 * Modes (set global __mode before eval):
 *   parse  — __t is a Russian reference like "Ин 3:16"
 *   extract — __t is "CODE\tCHAP\tV1\tV2\t" + raw TeX book text
 *
 * ABBR_MAP is injected by build.py as a JSON object literal.
 */

function normalizeAbbr(raw) {
  return String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReference(ref, abbrMap) {
  var cleaned = normalizeAbbr(ref)
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-');

  var m = cleaned.match(/^(\d{1,2}\s*)?([A-Za-zА-Яа-яЁё]+)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!m) {
    return { error: 'Не разобрал ссылку. Пример: Ин 3:16 или 1 Ин 4:8' };
  }

  var prefix = m[1] ? m[1].replace(/\s+/g, ' ').trim() + ' ' : '';
  var name = m[2];
  var abbr = normalizeAbbr(prefix + name);
  var compact = abbr.replace(/ /g, '');
  var meta = abbrMap[abbr] || abbrMap[compact];
  if (!meta) {
    return { error: 'Неизвестная книга: ' + abbr };
  }

  var chap = parseInt(m[3], 10);
  var v1 = parseInt(m[4], 10);
  var v2 = m[5] ? parseInt(m[5], 10) : v1;
  if (!(chap > 0) || !(v1 > 0) || v2 < v1) {
    return { error: 'Неверный номер главы или стиха' };
  }

  var display = abbr + ' ' + chap + ':' + v1 + (v2 > v1 ? '-' + v2 : '');
  return {
    code: meta.code,
    file: meta.file,
    title: meta.title,
    chap: chap,
    v1: v1,
    v2: v2,
    display: display,
  };
}

function stripTex(s) {
  var out = String(s || '');
  out = out.replace(/\\bibemph\{([^{}]*)\}/g, '$1');
  out = out.replace(/\\acc\{([^{}]*)\}/g, '$1');
  out = out.replace(/\\fns\{([^{}]*)\}/g, '');
  out = out.replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1');
  out = out.replace(/~---/g, '—');
  out = out.replace(/~--/g, '–');
  out = out.replace(/~/g, ' ');
  out = out.replace(/\\[a-zA-Z]+/g, '');
  out = out.replace(/[{}]/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function extractVerses(code, chap, v1, v2, tex) {
  var verses = [];
  var v;
  for (v = v1; v <= v2; v++) {
    var escCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp(
      '(?:\\\\rsbpar)?\\\\vs\\s+' + escCode + '\\s+' + chap + ':' + v + '\\s+([\\s\\S]*?)(?=(?:\\\\rsbpar)?\\\\vs\\s|$)',
    );
    var m = tex.match(re);
    if (!m) {
      verses.push(chap + ':' + v + ' — стих не найден');
    } else {
      verses.push(chap + ':' + v + ' ' + stripTex(m[1]));
    }
  }
  return verses.join('\n');
}

function runParse(ref, abbrMap) {
  var parsed = parseReference(ref, abbrMap);
  if (parsed.error) {
    return 'ERROR|' + parsed.error;
  }
  return [
    parsed.code,
    parsed.file,
    parsed.title,
    String(parsed.chap),
    String(parsed.v1),
    String(parsed.v2),
    parsed.display,
  ].join('|');
}

function runExtract(payload) {
  var parts = String(payload || '').split('\t');
  if (parts.length < 5) {
    return 'ERROR|Внутренняя ошибка извлечения';
  }
  var code = parts[0];
  var chap = parseInt(parts[1], 10);
  var v1 = parseInt(parts[2], 10);
  var v2 = parseInt(parts[3], 10);
  var tex = parts.slice(4).join('\t');
  var body = extractVerses(code, chap, v1, v2, tex);
  return body;
}

function main() {
  var mode = typeof __mode === 'undefined' ? 'parse' : __mode;
  var input = typeof __t === 'undefined' ? '' : __t;
  var abbrMap = typeof ABBR_MAP === 'undefined' ? {} : ABBR_MAP;
  if (mode === 'extract') {
    return runExtract(input);
  }
  return runParse(input, abbrMap);
}

var __result = main();
if (typeof document !== 'undefined' && document.body) {
  document.body.textContent = encodeURIComponent(__result);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseReference: parseReference,
    stripTex: stripTex,
    extractVerses: extractVerses,
    runParse: runParse,
    runExtract: runExtract,
  };
}
