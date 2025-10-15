import { logRotates } from '@/template/logRotates'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { SERVICE_PATHS } from '@/config/config'

export function setupLogrotate(frankendancer = false): void {
  console.log('Creating logrotate configuration for solana')

  if (!frankendancer && existsSync(SERVICE_PATHS.SOL_LOGROTATE)) {
    console.log(
      'SOL_LOGROTATE_PATH already exists. Skipping logrotate configuration.',
    )
  } 
  if (!frankendancer && !existsSync(SERVICE_PATHS.SOL_LOGROTATE)) {
    const body = logRotates('solv', frankendancer)
    // Use sudo tee to write the file with superuser privileges
    execSync(
      `echo "${body}" | sudo tee ${SERVICE_PATHS.SOL_LOGROTATE} > /dev/null`,
    )
    console.log('Logrotate configuration created.')
  }
  // if (frankendancer && existsSync(SERVICE_PATHS.SOL_LOGROTATE)) {
  //   console.log(
  //     'SOL_LOGROTATE already exists. Skipping logrotate configuration.',
  //   )
  // }
  if (frankendancer) {
    const body = logRotates('solv', frankendancer)
    // Use sudo tee to write the file with superuser privileges
    execSync(
      `echo "${body}" | sudo tee ${SERVICE_PATHS.SOL_LOGROTATE} > /dev/null`,
    )
    console.log('Logrotate configuration created.')
  }
}
