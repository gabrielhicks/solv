import { SERVICE_PATHS } from '@/config/config'
import { spawnSync } from 'child_process'
import { setupLogrotate } from '@/cli/setup/setupLogrotate'
import { rmLogs } from '@/cli/setup/rmLogs'
import { restartLogrotate } from '@/cli/setup/restartLogrotate'

export const updateLogrotate = (isFiredancer: boolean) => {
  rmLogs()
  const cmd = `sudo rm -rf ${SERVICE_PATHS.SOL_LOGROTATE} && sudo rm -rf ${SERVICE_PATHS.FRANKENDANCER_LOGROTATE}`
  spawnSync(cmd, { shell: true, stdio: 'inherit' })
  setupLogrotate(isFiredancer)
  restartLogrotate()
}
