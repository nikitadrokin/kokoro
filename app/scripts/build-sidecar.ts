import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, '..');
const repoRoot = resolve(appDir, '..');
const cliManifest = join(repoRoot, 'cli', 'Cargo.toml');
const binariesDir = join(appDir, 'src-tauri', 'binaries');

function getHostTargetTriple(): string {
  const rustcInfo = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = rustcInfo
    .split('\n')
    .find((line) => line.startsWith('host: '))
    ?.replace('host: ', '')
    .trim();

  if (!host) {
    throw new Error('Could not determine Rust host target from `rustc -vV`.');
  }

  return host;
}

const host = getHostTargetTriple();

const extraFeatures: string[] =
  process.platform === 'darwin' ? ['--features', 'coreml'] : [];

execFileSync(
  'cargo',
  ['build', '--manifest-path', cliManifest, '--release', '--bin', 'koko', ...extraFeatures],
  { stdio: 'inherit' },
);

mkdirSync(binariesDir, { recursive: true });

const exe = host.includes('windows') ? '.exe' : '';
const source = join(repoRoot, 'cli', 'target', 'release', `koko${exe}`);
const target = join(binariesDir, `koko-${host}${exe}`);

copyFileSync(source, target);
chmodSync(target, 0o755);

if (process.platform === 'darwin') {
  execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], {
    stdio: 'inherit',
  });
}

console.log(`Sidecar copied to ${target}`);
