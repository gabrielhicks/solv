import { spawnSync } from 'child_process'

export const formatDisk = (fileSystem: string) => {
  // Check if the disk is already formatted
  const checkDisk = spawnSync(`sudo blkid ${fileSystem}`, {
    shell: true,
    encoding: 'utf8',
  })

  // If the output is empty, the disk is not formatted
  if (!checkDisk.stdout.trim()) {
    const cmd = `sudo mkfs.ext4 ${fileSystem}`
    spawnSync(cmd, { shell: true, stdio: 'inherit' })
    spawnSync(`sudo udevadm trigger --action=change`, { shell: true })
    spawnSync(`sudo udevadm settle`, { shell: true })
    console.log(`${fileSystem} has been formatted.`)
    return true
  } else {
    spawnSync(`sudo udevadm trigger --action=change`, { shell: true })
    spawnSync(`sudo udevadm settle`, { shell: true })
    console.log(`${fileSystem} is already formatted.`)
    return false
  }
}
