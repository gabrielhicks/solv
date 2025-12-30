import { defineConfig } from 'tsup'
import { readFile, writeFile, appendFile, cp } from 'fs/promises'
import { join } from 'path'

const writer = async (file: string) => {
  try {
    const currentFile = await readFile(file)
    const currentFileString = String(currentFile)
    await writeFile(file, '#!/usr/bin/env node\n', { flag: 'w' })
    await appendFile(file, currentFileString)
  } catch (e) {
    console.log(e)
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  bundle: true,
  minify: true,
  sourcemap: true,
  clean: true,
  dts: true,
  onSuccess: async () => {
    // Copy Python monitoring scripts to dist
    try {
      await cp(
        join('src', 'cli', 'monitoring', 'scripts'),
        join('dist', 'cli', 'monitoring', 'scripts'),
        { recursive: true }
      )
    } catch (e) {
      console.log('Note: Could not copy monitoring scripts:', e)
    }
    // Copy chrony config files to dist
    try {
      await cp(
        join('src', 'cli', 'chrony'),
        join('dist', 'cli', 'chrony'),
        { recursive: true }
      )
    } catch (e) {
      console.log('Note: Could not copy chrony configs:', e)
    }
  },
  external: [
    'child_process',
    'os',
    'fs',
    'inquirer',
    'chalk',
    'fs/promises',
    '@solana/web3.js',
    '@metaplex-foundation/mpl-token-metadata',
    '@metaplex-foundation/umi',
    '@metaplex-foundation/umi-bundle-defaults',
    '@skeet-framework/utils',
    '@solana/spl-stake-pool',
    '@solana/spl-token',
    'bs58',
    'commander',
    'dotenv',
    'node-cron',
    'node-fetch',
    'prompt',
    'cli-progress',
    'cli-spinner',
    'cli-table3',
  ],
})
