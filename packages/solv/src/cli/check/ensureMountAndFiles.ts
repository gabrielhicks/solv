import { MT_PATHS } from '@/config/config'
import sleep from '@/lib/sleep'
import { spawnSync } from 'child_process'

/**
 * Helper to get UUID for a given device path
 */

export async function getUUID(devicePath: string): Promise<string> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const blkid = spawnSync(`sudo blkid -s UUID -o value ${devicePath}`, {
      shell: true,
      encoding: 'utf8',
    })

    const uuid = blkid.stdout.trim()

    if (uuid) {
      console.log(`[SUCCESS] Found UUID for ${devicePath}: ${uuid}`)
      return `UUID=${uuid}`
    }

    console.warn(
      `[WARN] Attempt ${attempt}: Failed to get UUID for ${devicePath}`,
    )
    await sleep(5000) // wait 1 second before retrying
  }

  console.error(`[ERROR] Giving up: No UUID for ${devicePath}, using raw path`)
  return devicePath
}


export const ensureFstabEntries = async (
  fileSystem: string,
  fileSystem2 = '',
  fileSystem3 = '',
  isDouble = false,
  isTriple = false
) => {
  const fs1 = await getUUID(fileSystem);
  const fs2 = await getUUID(fileSystem2);
  const fs3 = await getUUID(fileSystem3);

  let mtLine = `${fs1}        ${MT_PATHS.ROOT}     ext4 defaults 0 0`

  if (isDouble) {
    mtLine = `${fs1}        ${MT_PATHS.LEDGER}     ext4 defaults 0 0
${fs2}        ${MT_PATHS.ACCOUNTS}     ext4 defaults 0 0`
  }

  if (isTriple) {
    mtLine = `${fs1}        ${MT_PATHS.LEDGER}     ext4 defaults 0 0
${fs2}        ${MT_PATHS.ACCOUNTS}     ext4 defaults 0 0
${fs3}        ${MT_PATHS.SNAPSHOTS}     ext4 defaults 0 0`
  }

  const lines = [mtLine]
  const output = spawnSync(`cat /etc/fstab`, {
    shell: true,
    encoding: 'utf8',
  })

  const fstabContent = output.stdout

  const linesToAdd: string[] = []

  for (const line of lines) {
    if (!fstabContent.includes(line)) {
      console.log(`[INFO] Line to add: ${line}`)
      linesToAdd.push(line)
    }
  }

  if (linesToAdd.length) {
    console.log(`[INFO] Lines to add all: ${linesToAdd}`)
    const addCmd = `echo "${linesToAdd.join('\n')}" | sudo tee -a /etc/fstab`
    spawnSync(addCmd, {
      shell: true,
      encoding: 'utf8',
    })
    const reloadCmd = `sudo mount --all --verbose`
    spawnSync(reloadCmd, {
      shell: true,
      encoding: 'utf8',
    })
    console.log(`Added lines to /etc/fstab: \n${linesToAdd.join('\n')}`)
  } else {
    console.log('All lines are already present in /etc/fstab')
  }
}
