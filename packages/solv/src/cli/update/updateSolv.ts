import { VERSION_NODE } from '@/config/versionConfig'
import { spawnSync } from 'child_process'

const NPM_META_URL = 'https://registry.npmjs.org/@gabrielhicks/solv/latest'

const run = (cmd: string): number => {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`[updateSolv] '${cmd}' exited with status ${r.status ?? 'null'}`)
  }
  return r.status ?? 1
}

type LatestMeta = {
  version: string | null // null means "fall back to @latest"
  targetNode: string
}

// Pull the LATEST published version + its declared targetNode straight from the
// npm registry. We use this so `solv update`:
//   1. Pins the install to an explicit version (no @latest cache ambiguity), and
//   2. Installs the Node version the published package wants in the same cycle.
const fetchLatestMeta = async (): Promise<LatestMeta> => {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(NPM_META_URL, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as {
      version?: string
      solv?: { targetNode?: string }
    }
    return {
      version: data.version ?? null,
      targetNode: data?.solv?.targetNode ?? VERSION_NODE,
    }
  } catch (err) {
    console.warn(
      `[updateSolv] could not fetch latest meta from npm, falling back to defaults: ${(err as Error).message}`,
    )
    return { version: null, targetNode: VERSION_NODE }
  }
}

export const updateSolv = async (): Promise<void> => {
  // 1. Upgrade pnpm to latest.
  run('pnpm self-update')

  const meta = await fetchLatestMeta()

  // 2. Set Node to whatever the LATEST published solv wants — NOT the local
  //    config, which is stale on long-lived nodes.
  //    Note: we deliberately use the (deprecated) `pnpm env use … --global`
  //    instead of `pnpm runtime set node … -g`. The latter has a bug where it
  //    still requires a project manifest even with `-g`, erroring with
  //    ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND when run from $HOME. `env use` is
  //    deprecated but functional and is the only form that works for a
  //    truly global runtime install without a package.json.
  run(`pnpm env use ${meta.targetNode} --global`)

  // 3. Install the latest solv. Pin to an explicit version when we know it —
  //    pnpm's `@latest` resolution is cached and will silently keep an
  //    already-installed version (we saw `+ ... 5.8.21 (5.8.22 is available)`
  //    with `added 0`). Pinning bypasses that cache entirely.
  const versionSpec = meta.version ? `@${meta.version}` : '@latest'
  run(`pnpm add -g @gabrielhicks/solv${versionSpec}`)
}
