import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

const SW_FILE = 'sw.js'
const RUNTIME_ONLY = /\.(woff2?|map)$/

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

export function serviceWorker(): Plugin {
  let root = ''
  let publicDir = ''

  return {
    name: 'sereno-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root
      publicDir = config.publicDir
    },
    generateBundle(_, bundle) {
      // index.html is emitted by Vite after this hook runs, so it is added by name.
      const files = ['index.html', ...Object.keys(bundle), ...(publicDir ? listFiles(publicDir) : [])]
      const precache = [...new Set(files)]
        .filter((file) => file !== SW_FILE && !RUNTIME_ONLY.test(file))
        .sort()
        .map((file) => `/${file}`)
      const hash = createHash('sha256')
      for (const file of Object.keys(bundle).sort()) {
        const output = bundle[file]
        hash.update(file).update(output.type === 'chunk' ? output.code : output.source)
      }
      for (const file of publicDir ? listFiles(publicDir).sort() : []) {
        hash.update(file).update(readFileSync(join(publicDir, file)))
      }
      const version = hash.digest('hex').slice(0, 12)
      const source = readFileSync(join(root, 'pwa', SW_FILE), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache))
      this.emitFile({ type: 'asset', fileName: SW_FILE, source })
    },
  }
}
