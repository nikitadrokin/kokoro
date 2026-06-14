#!/usr/bin/env bun
/**
 * Build a Tauri release, optionally bump patch version, and publish a GitHub
 * release by default. Pass `--dry-run` to skip publishing and print manual
 * steps instead.
 *
 * Homebrew cask update scaffolding is kept below but intentionally disabled
 * until this project is wired to a tap.
 */

import { Glob } from 'bun';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import readline from 'node:readline/promises';

type TauriConf = {
  version: string;
  bundle?: {
    createUpdaterArtifacts?: boolean | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const GREEN = '\x1b[0;32m';
const RED = '\x1b[0;31m';
const CYAN = '\x1b[0;36m';
const YELLOW = '\x1b[0;33m';
const NC = '\x1b[0m';

/** Parsed CLI flags for `release.ts`. */
type ReleaseCliArgs = {
  /** When true, build only and print manual publish steps (no git/gh). */
  dryRun: boolean;
};

const scriptDir = import.meta.dir;
const projectRoot = join(scriptDir, '..');
const tauriConfPath = join(projectRoot, 'src-tauri/tauri.conf.json');
const packageJsonPath = join(projectRoot, 'package.json');
const cargoTomlPath = join(projectRoot, 'src-tauri/Cargo.toml');
const dmgDir = join(projectRoot, 'src-tauri/target/release/bundle/dmg');
const macosBundleDir = join(
  projectRoot,
  'src-tauri/target/release/bundle/macos',
);
const latestUpdaterJsonPath = join(macosBundleDir, 'latest.json');
const defaultUpdaterSigningKeyPath = join(
  homedir(),
  '.tauri/kokoro-updater.key',
);

// Homebrew support is intentionally disabled for now. To enable it later:
// 1. Point this at the cask file in your tap.
// 2. Uncomment updateHomebrewCaskIfConfigured(...) in main().
// 3. Update updateCaskFile(...) with the release URL for this repo/tap.
// const caskFilePath = join(projectRoot, '../homebrew-tap/Casks/kokoro.rb');

function parseArgs(argv: string[]): ReleaseCliArgs {
  return { dryRun: argv.includes('--dry-run') };
}

async function readTauriVersion(path: string): Promise<string> {
  const raw = await Bun.file(path).text();
  const parsed = JSON.parse(raw) as TauriConf;
  if (typeof parsed.version !== 'string' || !parsed.version) {
    throw new Error(`Invalid or missing version in ${path}`);
  }
  return parsed.version;
}

function nextPatchVersion(current: string): string {
  const parts = current.split('.');
  if (parts.length !== 3) {
    throw new Error(`Expected semver x.y.z, got: ${current}`);
  }
  const patch = Number.parseInt(parts[2], 10);
  if (Number.isNaN(patch)) {
    throw new Error(`Invalid patch segment in version: ${current}`);
  }
  return `${parts[0]}.${parts[1]}.${patch + 1}`;
}

async function replaceVersionInFile(
  path: string,
  fromVersion: string,
  toVersion: string,
  kind: 'tauri-json' | 'package-json' | 'cargo',
): Promise<void> {
  let content = await Bun.file(path).text();
  switch (kind) {
    case 'tauri-json':
    case 'package-json':
      content = content.replace(
        new RegExp(`"version": "${escapeRegExp(fromVersion)}"`, 'g'),
        `"version": "${toVersion}"`,
      );
      break;
    case 'cargo':
      content = content.replace(
        new RegExp(`^version = "${escapeRegExp(fromVersion)}"`, 'm'),
        `version = "${toVersion}"`,
      );
      break;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
  await Bun.write(path, content);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await Bun.file(filePath).bytes();
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(buf);
  return hasher.digest('hex');
}

async function findDmgForVersion(version: string): Promise<string | undefined> {
  try {
    const st = await stat(dmgDir);
    if (!st.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const glob = new Glob(`*_${version}_*.dmg`);
  for await (const rel of glob.scan({ cwd: dmgDir, onlyFiles: true })) {
    return join(dmgDir, rel);
  }
  return undefined;
}

async function findMacUpdaterArchive(): Promise<string | undefined> {
  try {
    const st = await stat(macosBundleDir);
    if (!st.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const matches: string[] = [];
  const glob = new Glob('*.app.tar.gz');
  for await (const rel of glob.scan({ cwd: macosBundleDir, onlyFiles: true })) {
    matches.push(join(macosBundleDir, rel));
  }

  return matches.sort()[0];
}

// GitHub normalizes asset names by replacing spaces with dots. Kokoro does not
// currently have spaces, but this keeps the Homebrew scaffolding future-proof.
function githubReleaseAssetBasename(localBasename: string): string {
  return localBasename.replace(/ /g, '.');
}

function githubReleaseDmgBasename(localBasename: string): string {
  return githubReleaseAssetBasename(localBasename);
}

function updaterPlatformKeyFromDmg(dmgPath: string): string {
  const match = basename(dmgPath).match(/_([^_]+)\.dmg$/);
  const rawArch = match?.[1] ?? process.arch;
  const arch =
    rawArch === 'arm64' || rawArch === 'aarch64'
      ? 'aarch64'
      : rawArch === 'x64' || rawArch === 'amd64' || rawArch === 'x86_64'
        ? 'x86_64'
        : rawArch;

  return `darwin-${arch}`;
}

async function writeLatestUpdaterJson(
  version: string,
  dmgPath: string,
  updaterArchivePath: string,
): Promise<string> {
  const signaturePath = `${updaterArchivePath}.sig`;
  if (!(await Bun.file(signaturePath).exists())) {
    throw new Error(`Updater signature not found: ${signaturePath}`);
  }

  const signature = (await Bun.file(signaturePath).text()).trim();
  const updaterAssetName = githubReleaseAssetBasename(
    basename(updaterArchivePath),
  );
  const platformKey = updaterPlatformKeyFromDmg(dmgPath);
  const latestJson = {
    version,
    pub_date: new Date().toISOString(),
    platforms: {
      [platformKey]: {
        signature,
        url: `https://github.com/nikitadrokin/kokoro/releases/download/v${version}/${updaterAssetName}`,
      },
    },
  };

  await Bun.write(
    latestUpdaterJsonPath,
    `${JSON.stringify(latestJson, null, 2)}\n`,
  );
  return latestUpdaterJsonPath;
}

async function ensureUpdaterSigningKey(): Promise<void> {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    return;
  }

  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    process.env.TAURI_SIGNING_PRIVATE_KEY = (
      await Bun.file(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH).text()
    ).trim();
    return;
  }

  if (await Bun.file(defaultUpdaterSigningKeyPath).exists()) {
    process.env.TAURI_SIGNING_PRIVATE_KEY = (
      await Bun.file(defaultUpdaterSigningKeyPath).text()
    ).trim();
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
    return;
  }

  throw new Error(
    [
      'Updater signing key not found.',
      `Generate one with: bunx tauri signer generate -w ${defaultUpdaterSigningKeyPath}`,
      'Then keep the private key secret and rerun this release command.',
    ].join('\n'),
  );
}

async function withUpdaterArtifactsEnabled(
  build: () => boolean,
): Promise<boolean> {
  const original = await Bun.file(tauriConfPath).text();
  const parsed = JSON.parse(original) as TauriConf;
  parsed.bundle ??= {};
  parsed.bundle.createUpdaterArtifacts = true;

  await Bun.write(tauriConfPath, `${JSON.stringify(parsed, null, 2)}\n`);

  try {
    return build();
  } finally {
    await Bun.write(tauriConfPath, original);
  }
}

// async function updateCaskFile(
//   version: string,
//   sha256: string,
//   dmgPath: string,
// ): Promise<void> {
//   const localBasename = basename(dmgPath);
//   if (!localBasename) {
//     throw new Error(`Could not get DMG basename from: ${dmgPath}`);
//   }
//   const urlFilename = githubReleaseDmgBasename(localBasename).replace(
//     version,
//     '#{version}',
//   );
//   let content = await Bun.file(caskFilePath).text();
//   content = content.replace(/^(\s*version\s+")[^"]*(")/m, `$1${version}$2`);
//   content = content.replace(/^(\s*sha256\s+")[^"]*(")/m, `$1${sha256}$2`);
//   content = content.replace(
//     /^(\s*url\s+")[^"]+(")/m,
//     `$1https://github.com/nikitadrokin/kokoro/releases/download/v#{version}/${urlFilename}$2`,
//   );
//   await Bun.write(caskFilePath, content);
// }

// async function updateHomebrewCaskIfConfigured(
//   version: string,
//   sha256: string,
//   dmgPath: string,
// ): Promise<void> {
//   if (await Bun.file(caskFilePath).exists()) {
//     console.log(`${CYAN}Updating Homebrew cask...${NC}`);
//     await updateCaskFile(version, sha256, dmgPath);
//     console.log(`${GREEN}Cask file updated!${NC}`);
//   } else {
//     console.log(`${YELLOW}Homebrew cask not configured: ${caskFilePath}${NC}`);
//   }
// }

async function deleteBunBuildArtifacts(root: string): Promise<void> {
  const glob = new Glob('**/*.bun-build');
  for await (const abs of glob.scan({
    cwd: root,
    absolute: true,
    onlyFiles: true,
  })) {
    await Bun.file(abs).delete();
  }
}

function runTauriBuild(): boolean {
  const r = Bun.spawnSync(['bunx', 'tauri', 'build'], {
    cwd: projectRoot,
    env: { ...process.env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return r.success;
}

function tryExecFile(
  file: string,
  args: string[],
  cwd: string,
): { ok: boolean; stderr: string } {
  const r = Bun.spawnSync([file, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (r.success) {
    return { ok: true, stderr: '' };
  }
  const stderr = r.stderr ? r.stderr.toString() : '';
  return { ok: false, stderr };
}

function gitQuiet(args: string[]): boolean {
  const r = Bun.spawnSync(['git', ...args], {
    cwd: projectRoot,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return r.success;
}

function gitStagedDiffQuiet(): boolean {
  const r = Bun.spawnSync(
    ['git', '-C', projectRoot, 'diff', '--cached', '--quiet'],
    {
      cwd: projectRoot,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  return r.success;
}

function currentGitBranch(): string {
  const r = Bun.spawnSync(['git', 'branch', '--show-current'], {
    cwd: projectRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const branch = r.stdout ? r.stdout.toString().trim() : '';
  return branch || 'master';
}

function spawnGitInherit(args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], {
    cwd: projectRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (!r.success) {
    process.exit(r.exitCode === 0 ? 1 : r.exitCode);
  }
}

function spawnGhInherit(args: string[]): void {
  const r = Bun.spawnSync(['gh', ...args], {
    cwd: projectRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (!r.success) {
    process.exit(r.exitCode === 0 ? 1 : r.exitCode);
  }
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));

  const currentVersion = await readTauriVersion(tauriConfPath);
  const nextVersion = nextPatchVersion(currentVersion);
  const branch = currentGitBranch();

  console.log(`${YELLOW}Current version: ${currentVersion}${NC}`);
  console.log(`${GREEN}Next version:    ${nextVersion}${NC}`);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const reply = await rl.question(
    `Bump version to ${nextVersion} before building? (y/N) `,
  );
  rl.close();
  console.log('');
  console.log('');

  let versionToBuild: string;
  let sameVersionRelease = false;

  if (/^[Yy]$/.test(reply.trim())) {
    versionToBuild = nextVersion;
    console.log(`${CYAN}Updating version numbers to ${nextVersion}...${NC}`);

    await replaceVersionInFile(
      tauriConfPath,
      currentVersion,
      nextVersion,
      'tauri-json',
    );
    console.log('  ✓ Updated tauri.conf.json');

    await replaceVersionInFile(
      packageJsonPath,
      currentVersion,
      nextVersion,
      'package-json',
    );
    console.log('  ✓ Updated package.json');

    await replaceVersionInFile(
      cargoTomlPath,
      currentVersion,
      nextVersion,
      'cargo',
    );
    console.log('  ✓ Updated Cargo.toml');
  } else {
    versionToBuild = currentVersion;
    sameVersionRelease = true;
    console.log(`${YELLOW}Keeping current version ${currentVersion}${NC}`);
  }

  console.log('');
  console.log(`${CYAN}Building release v${versionToBuild}...${NC}`);
  await ensureUpdaterSigningKey();
  if (!(await withUpdaterArtifactsEnabled(runTauriBuild))) {
    console.log(`${RED}Build failed!${NC}`);
    process.exit(1);
  }

  console.log(`${GREEN}Build complete!${NC}`);

  const dmgCandidate = await findDmgForVersion(versionToBuild);
  if (dmgCandidate === undefined || !(await Bun.file(dmgCandidate).exists())) {
    console.log(
      `${RED}Error: DMG not found for version ${versionToBuild} in ${dmgDir}${NC}`,
    );
    process.exit(1);
  }
  const dmgPath = dmgCandidate;
  const sha256 = await sha256File(dmgPath);

  const localDmgName = basename(dmgPath);
  const githubDmgName = githubReleaseDmgBasename(localDmgName);
  const updaterArchivePath = await findMacUpdaterArchive();
  if (
    updaterArchivePath === undefined ||
    !(await Bun.file(updaterArchivePath).exists())
  ) {
    console.log(
      `${RED}Error: updater archive not found in ${macosBundleDir}${NC}`,
    );
    process.exit(1);
  }
  const updaterSignaturePath = `${updaterArchivePath}.sig`;
  if (!(await Bun.file(updaterSignaturePath).exists())) {
    console.log(
      `${RED}Error: updater signature not found at ${updaterSignaturePath}${NC}`,
    );
    process.exit(1);
  }
  const latestUpdaterPath = await writeLatestUpdaterJson(
    versionToBuild,
    dmgPath,
    updaterArchivePath,
  );

  // Homebrew is not wired up for Kokoro yet.
  // await updateHomebrewCaskIfConfigured(versionToBuild, sha256, dmgPath);

  try {
    await deleteBunBuildArtifacts(projectRoot);
  } catch {
    // best-effort cleanup
  }

  console.log('');
  console.log(
    `${GREEN}═══════════════════════════════════════════════════════════════${NC}`,
  );
  console.log(`${GREEN}SUCCESS! Release Ready${NC}`);
  console.log(
    `${GREEN}═══════════════════════════════════════════════════════════════${NC}`,
  );
  console.log(`Version:          ${CYAN}${versionToBuild}${NC}`);
  console.log(`DMG Path:         ${CYAN}${dmgPath}${NC}`);
  console.log(`GitHub DMG Name:  ${CYAN}${githubDmgName}${NC}`);
  console.log(`Updater Archive:  ${CYAN}${updaterArchivePath}${NC}`);
  console.log(`Updater Sig:      ${CYAN}${updaterSignaturePath}${NC}`);
  console.log(`Updater JSON:     ${CYAN}${latestUpdaterPath}${NC}`);
  console.log(`SHA256:           ${CYAN}${sha256}${NC}`);
  console.log(
    `${GREEN}═══════════════════════════════════════════════════════════════${NC}`,
  );

  if (!dryRun) {
    console.log('');
    console.log(`${CYAN}Publishing release...${NC}`);

    if (sameVersionRelease) {
      console.log('');
      console.log(
        `${YELLOW}Same version release — cleaning up any existing tag/release...${NC}`,
      );
      const ghDel = tryExecFile(
        'gh',
        ['release', 'delete', `v${versionToBuild}`, '--yes'],
        projectRoot,
      );
      if (ghDel.ok) {
        console.log(`${GREEN}  ✓ Deleted existing GitHub release${NC}`);
      } else {
        console.log(`${YELLOW}  ⏭ No existing GitHub release to delete${NC}`);
      }
      if (
        gitQuiet([
          '-C',
          projectRoot,
          'push',
          'origin',
          '--delete',
          `v${versionToBuild}`,
        ])
      ) {
        console.log(`${GREEN}  ✓ Deleted remote tag${NC}`);
      } else {
        console.log(`${YELLOW}  ⏭ No remote tag to delete${NC}`);
      }
      if (gitQuiet(['-C', projectRoot, 'tag', '-d', `v${versionToBuild}`])) {
        console.log(`${GREEN}  ✓ Deleted local tag${NC}`);
      } else {
        console.log(`${YELLOW}  ⏭ No local tag to delete${NC}`);
      }
      console.log('');
    }

    console.log(`${CYAN}Step 1: Committing changes...${NC}`);
    spawnGitInherit(['-C', projectRoot, 'add', '-A']);
    if (gitStagedDiffQuiet()) {
      console.log(`${YELLOW}  ⏭ Nothing to commit${NC}`);
    } else {
      spawnGitInherit([
        '-C',
        projectRoot,
        'commit',
        '-m',
        `Release v${versionToBuild}`,
      ]);
      console.log(`${GREEN}  ✓ Changes committed${NC}`);
    }

    console.log(`${CYAN}Step 2: Creating tag and pushing...${NC}`);
    spawnGitInherit(['-C', projectRoot, 'tag', `v${versionToBuild}`]);
    spawnGitInherit(['-C', projectRoot, 'push', 'origin', branch, '--tags']);
    console.log(`${GREEN}  ✓ Tag v${versionToBuild} pushed${NC}`);

    console.log(`${CYAN}Step 3: Creating GitHub release...${NC}`);
    spawnGhInherit([
      'release',
      'create',
      `v${versionToBuild}`,
      dmgPath,
      updaterArchivePath,
      updaterSignaturePath,
      latestUpdaterPath,
      '--title',
      `v${versionToBuild}`,
      '--generate-notes',
    ]);
    console.log(`${GREEN}  ✓ GitHub release created${NC}`);

    console.log('');
    console.log(`${GREEN}Release v${versionToBuild} published!${NC}`);
  } else {
    console.log('');
    console.log(`${CYAN}To publish this release:${NC}`);
    console.log('');

    if (sameVersionRelease) {
      console.log(
        '  0. Clean up existing tag/release (errors are safe to ignore):',
      );
      console.log(`     gh release delete v${versionToBuild} --yes`);
      console.log(`     git push origin --delete v${versionToBuild}`);
      console.log(`     git tag -d v${versionToBuild}`);
      console.log('');
    }

    console.log('  1. Commit changes:');
    console.log(
      `     git add -A && git commit -m "Release v${versionToBuild}"`,
    );
    console.log('');
    console.log('  2. Create tag:');
    console.log(`     git tag v${versionToBuild}`);
    console.log(`     git push origin ${branch} --tags`);
    console.log('');
    console.log('  3. Create GitHub release:');
    console.log(
      `     gh release create v${versionToBuild} "${dmgPath}" "${updaterArchivePath}" "${updaterSignaturePath}" "${latestUpdaterPath}" --title "v${versionToBuild}" --generate-notes`,
    );
    console.log('');
    console.log(`${YELLOW}Tip: Omit --dry-run to publish automatically.${NC}`);
    console.log('');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
