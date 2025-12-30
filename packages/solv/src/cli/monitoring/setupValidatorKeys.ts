import { spawnSync } from 'node:child_process'
import { existsSync } from 'fs'
import chalk from 'chalk'

/**
 * Sets up symlinks for validator keys in the monitoring secrets directory
 * Creates /home/{user}/.secrets/ and links validator-keypair.json and vote-account-keypair.json
 */
export const setupValidatorKeys = async (
  user: string,
  validatorKeyPath: string,
  voteKeyPath: string,
): Promise<void> => {
  console.log(chalk.white('🔑 Setting up validator key symlinks...'))

  const secretsDir = `/home/${user}/.secrets`
  const validatorLink = `${secretsDir}/validator-keypair.json`
  const voteLink = `${secretsDir}/vote-account-keypair.json`

  // Verify validator key exists
  if (!existsSync(validatorKeyPath)) {
    throw new Error(
      `Validator key not found at ${validatorKeyPath}. Please verify the path.`,
    )
  }

  // Create secrets directory if it doesn't exist
  if (!existsSync(secretsDir)) {
    spawnSync(`sudo mkdir -p ${secretsDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  // Create symlink for validator key
  if (existsSync(validatorLink)) {
    console.log(chalk.yellow(`Removing existing symlink: ${validatorLink}`))
    spawnSync(`sudo rm -f ${validatorLink}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  spawnSync(`sudo ln -s ${validatorKeyPath} ${validatorLink}`, {
    shell: true,
    stdio: 'inherit',
  })

  // Create symlink for vote account key if it exists
  if (existsSync(voteKeyPath)) {
    if (existsSync(voteLink)) {
      console.log(chalk.yellow(`Removing existing symlink: ${voteLink}`))
      spawnSync(`sudo rm -f ${voteLink}`, {
        shell: true,
        stdio: 'inherit',
      })
    }

    spawnSync(`sudo ln -s ${voteKeyPath} ${voteLink}`, {
      shell: true,
      stdio: 'inherit',
    })
    console.log(chalk.green('✅ Vote account key symlink created'))
  } else {
    console.log(chalk.yellow(`⚠️  Vote account key not found at ${voteKeyPath}, skipping`))
  }

  // Set ownership
  spawnSync(`sudo chown -h ${user}:${user} ${secretsDir}/*`, {
    shell: true,
    stdio: 'inherit',
  })

  console.log(chalk.green('✅ Validator key symlinks created successfully'))
}

