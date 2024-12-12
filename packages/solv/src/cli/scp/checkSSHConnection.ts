import { spawnSync } from 'node:child_process'

export function checkSSHConnection(ip: string, user: string) {
  const cmd = `ssh -o BatchMode=yes -o ConnectTimeout=5 ${user}@${ip} exit`
  const result = spawnSync(cmd, { shell: true, stdio: 'inherit' })

  return result.status === 0
}
