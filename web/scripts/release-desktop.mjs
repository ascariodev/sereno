import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const USAGE = `Usage: npm run release:desktop -- [<version>|patch|minor|major] [options]

Without a version, publishes the version already in src-tauri/tauri.conf.json.

Options:
  --notes <text>   Release notes for latest.json (default: "Sereno <version>").
  --skip-build     Reuse the installer already built for the current version.
  --dry-run        Build (needs the signing key) and write latest.json, but upload nothing
                   and leave the versions in tauri.conf.json and package.json unchanged.
  --help           Show this help.

Environment:
  TAURI_SIGNING_PRIVATE_KEY_PATH or TAURI_SIGNING_PRIVATE_KEY   Updater signing key (required to build).
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD                            Key password, if it has one.
  SERENO_DESKTOP_SCP_TARGET   scp destination, e.g. user@host:/var/www/html/workspace/prod/web/desktop/
  SERENO_DESKTOP_BASE_URL     Public URL of that folder (default: https://sereno.ascario.dev/desktop/).`

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = join(webDir, 'src-tauri')
const tauriConfPath = join(tauriDir, 'tauri.conf.json')
const packageJsonPath = join(webDir, 'package.json')
const tauriCli = join(webDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const nsisDir = join(tauriDir, 'target', 'release', 'bundle', 'nsis')
const releaseDir = join(tauriDir, 'target', 'release', 'desktop-release')
const updaterPlatforms = ['windows-x86_64-nsis', 'windows-x86_64']

function fail(message) {
  console.error(`release-desktop: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { version: null, notes: null, skipBuild: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    } else if (arg === '--skip-build') {
      options.skipBuild = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--notes') {
      if (i + 1 >= argv.length) fail('--notes needs a value.')
      options.notes = argv[++i]
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}.\n\n${USAGE}`)
    } else if (options.version === null) {
      options.version = arg
    } else {
      fail(`unexpected argument ${arg}.\n\n${USAGE}`)
    }
  }
  return options
}

function parseSemver(text) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text)
  return match ? match.slice(1).map(Number) : null
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function resolveVersion(requested, current) {
  const [major, minor, patch] = current
  if (requested === null) return current.join('.')
  if (requested === 'patch') return `${major}.${minor}.${patch + 1}`
  if (requested === 'minor') return `${major}.${minor + 1}.0`
  if (requested === 'major') return `${major + 1}.0.0`
  const parsed = parseSemver(requested.replace(/^v/, ''))
  if (!parsed) fail(`"${requested}" is not a version like 1.2.3 (or patch, minor, major).`)
  if (compareSemver(parsed, current) <= 0) {
    fail(`version ${parsed.join('.')} must be greater than the current ${current.join('.')}.`)
  }
  return parsed.join('.')
}

function setTopLevelVersion(path, version) {
  const text = readFileSync(path, 'utf8')
  const pattern = /^( {2}"version": ")[^"]*(")/m
  if (!pattern.test(text)) fail(`no top-level "version" field in ${path}.`)
  const updated = text.replace(pattern, `$1${version}$2`)
  if (updated !== text) writeFileSync(path, updated, 'utf8')
}

function signingEnv() {
  const env = { ...process.env }
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    const keyPath = env.TAURI_SIGNING_PRIVATE_KEY_PATH
    if (!keyPath) {
      fail(
        'set TAURI_SIGNING_PRIVATE_KEY_PATH (path to the updater private key) or TAURI_SIGNING_PRIVATE_KEY before building.',
      )
    }
    if (!existsSync(keyPath)) fail(`TAURI_SIGNING_PRIVATE_KEY_PATH points to a missing file: ${keyPath}`)
    env.TAURI_SIGNING_PRIVATE_KEY = keyPath
  }
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= ''
  return env
}

function run(command, args, cwd, env = process.env) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) fail(`could not run ${command}: ${result.error.message}`)
  return result.status === 0
}

const options = parseArgs(process.argv.slice(2))
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
const currentVersion = parseSemver(String(tauriConf.version))
if (!currentVersion) fail(`the version in tauri.conf.json (${tauriConf.version}) is not a plain x.y.z version.`)
if (options.skipBuild && options.version !== null) {
  fail('--skip-build publishes the current version; do not pass a new one.')
}

const version = resolveVersion(options.version, currentVersion)
const scpTarget = process.env.SERENO_DESKTOP_SCP_TARGET
if (!options.dryRun && !scpTarget) {
  fail('set SERENO_DESKTOP_SCP_TARGET (e.g. user@host:/var/www/html/workspace/prod/web/desktop/) or use --dry-run.')
}
const buildEnv = options.skipBuild ? null : signingEnv()
const baseUrl = (process.env.SERENO_DESKTOP_BASE_URL ?? 'https://sereno.ascario.dev/desktop/').replace(/\/?$/, '/')

if (options.dryRun) {
  console.log(`Dry run: building ${version} without changing tauri.conf.json or package.json.`)
} else {
  setTopLevelVersion(tauriConfPath, version)
  setTopLevelVersion(packageJsonPath, version)
  console.log(`Version ${version} in tauri.conf.json and package.json.`)
}

const buildConfigOverride = { bundle: { createUpdaterArtifacts: true } }
if (options.dryRun) buildConfigOverride.version = version

if (!options.skipBuild) {
  if (!existsSync(tauriCli)) fail('the Tauri CLI is not installed on the host; run npm install in web/.')
  const built = run(
    process.execPath,
    [tauriCli, 'build', '--bundles', 'nsis', '--config', JSON.stringify(buildConfigOverride)],
    webDir,
    buildEnv,
  )
  if (!built) {
    fail(
      options.dryRun
        ? 'the build failed. The versions in the files were not changed.'
        : `the build failed. Version ${version} stays in the files; rerun without a version to retry.`,
    )
  }
}

const builtInstaller = join(nsisDir, `${tauriConf.productName}_${version}_x64-setup.exe`)
const builtSignature = `${builtInstaller}.sig`
if (!existsSync(builtInstaller)) fail(`installer not found: ${builtInstaller}`)
if (!existsSync(builtSignature)) {
  fail(`signature not found: ${builtSignature} (was it built with createUpdaterArtifacts and a signing key?)`)
}

const installerName = `${tauriConf.productName}-${version}-x64-setup.exe`
mkdirSync(releaseDir, { recursive: true })
copyFileSync(builtInstaller, join(releaseDir, installerName))

const platform = {
  signature: readFileSync(builtSignature, 'utf8').trim(),
  url: new URL(installerName, baseUrl).href,
}
const manifest = {
  version,
  notes: options.notes ?? `${tauriConf.productName} ${version}`,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: Object.fromEntries(updaterPlatforms.map((key) => [key, platform])),
}
writeFileSync(join(releaseDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Release files in ${releaseDir}: ${installerName}, latest.json`)

if (options.dryRun) {
  console.log('Dry run: nothing uploaded.')
  process.exit(0)
}

if (!run('scp', [installerName, scpTarget], releaseDir)) fail('uploading the installer failed; latest.json was not uploaded.')
if (!run('scp', ['latest.json', scpTarget], releaseDir)) fail('uploading latest.json failed.')
console.log(`Published ${version}: ${new URL('latest.json', baseUrl).href}`)
