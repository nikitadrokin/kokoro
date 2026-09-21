#!/usr/bin/env node
/**
 * Builds an unsigned PDF to Audio.shortcut from the Cherri source + JS optimizer.
 *
 * Usage: node build.cjs
 * Requires: cherri on PATH, or CHERRI=/path/to/cherri
 *
 * After building, sign on macOS:
 *   shortcuts sign --mode anyone \
 *     --input "PDF to Audio.shortcut" \
 *     --output "PDF to Audio signed.shortcut"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const jsPath = path.join(root, 'optimize-for-speech.js');
const templatePath = path.join(root, 'pdf-to-audio.cherri.in');
const cherriPath = path.join(root, 'pdf-to-audio.cherri');
const shortcutPath = path.join(root, 'PDF to Audio.shortcut');

const jsSource = fs.readFileSync(jsPath, 'utf8');

if (jsSource.includes('#')) {
  console.error(
    'optimize-for-speech.js must not contain hash characters (breaks data: URIs on iOS).',
  );
  process.exit(1);
}

const jsForShortcut = jsSource
  .replace(/\nif \(typeof module[\s\S]*$/, '\n')
  .trim();

const optimizerB64 = Buffer.from(jsForShortcut, 'utf8').toString('base64');

const template = fs.readFileSync(templatePath, 'utf8');
if (!template.includes('__OPTIMIZER_B64__')) {
  console.error('Cherri template missing __OPTIMIZER_B64__ placeholder.');
  process.exit(1);
}

fs.writeFileSync(
  cherriPath,
  template.replace('__OPTIMIZER_B64__', optimizerB64),
  'utf8',
);

const cherriBin = process.env.CHERRI || 'cherri';
const result = spawnSync(
  cherriBin,
  [cherriPath, '--skip-sign', '--derive-uuids', '-o', shortcutPath],
  { encoding: 'utf8', cwd: root },
);

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status !== 0) {
  console.error(`cherri failed with exit ${String(result.status)}`);
  process.exit(result.status ?? 1);
}

const unsignedPath = path.join(root, 'PDF to Audio_unsigned.shortcut');
if (fs.existsSync(unsignedPath)) {
  fs.renameSync(unsignedPath, shortcutPath);
}

if (!fs.existsSync(shortcutPath)) {
  console.error(`Expected shortcut at ${shortcutPath}`);
  process.exit(1);
}

const size = fs.statSync(shortcutPath).size;
console.log(`Built ${shortcutPath} (${size} bytes, unsigned)`);
