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

// Read what Node version the LATEST published solv expects, so a Node bump
// rolls out in the same `solv update` cycle as the solv bump. Falls back to
// the running solv's source constant if the registry can't be reached.
const fetchLatestTargetNode = async (): Promise<string> => {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(NPM_META_URL, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { solv?: { targetNode?: string } }
    if (data?.solv?.targetNode) {
      return data.solv.targetNode
    }
  } catch (err) {
    console.warn(
      `[updateSolv] could not fetch latest target Node from npm, using source default: ${(err as Error).message}`,
    )
  }
  return VERSION_NODE
}

export const updateSolv = async (): Promise<void> => {
  // 1. Upgrade pnpm to latest.
  run('pnpm self-update')

  // 2. Set Node to whatever the LATEST published solv wants — NOT the local
  //    config, which is stale on long-lived nodes.
  const targetNode = await fetchLatestTargetNode()
  run(`pnpm runtime set node ${targetNode} -g`)

  // 3. Install the latest solv.
  run('pnpm add -g @gabrielhicks/solv@latest')
}
