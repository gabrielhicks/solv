import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'fs'
import chalk from 'chalk'

/**
 * Sets up doublezero monitoring by:
 * 1. Creating the Python script to scrape metrics
 * 2. Creating the telegraf.d configuration for doublezero
 * 3. Updating the main telegraf.conf to include dz_metrics output
 */
export const setupDoublezero = async (): Promise<void> => {
  console.log(chalk.white('🔵 Setting up doublezero monitoring...'))

  // Create doublezero directory
  const dzDir = '/opt/doublezero'
  if (!existsSync(dzDir)) {
    spawnSync(`sudo mkdir -p ${dzDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  // Create Python script
  const pythonScript = `#!/usr/bin/env python3
import os
import re
import urllib.request

# Prometheus endpoint exposed by doublezero
METRICS_URL = os.environ.get("DZ_METRICS_URL", "http://localhost:2113/metrics")


def fetch_metrics(url: str) -> str:
    with urllib.request.urlopen(url, timeout=5) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_metrics(text: str):
    version = None
    session_is_up = None

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        # doublezero_build_info{...,version="0.6.10"} 1
        if line.startswith("doublezero_build_info{"):
            m = re.search(r'version="([^"]+)"', line)
            if m:
                version = m.group(1)

        # doublezero_session_is_up 1
        elif line.startswith("doublezero_session_is_up"):
            parts = line.split()
            if len(parts) >= 2:
                try:
                    session_is_up = int(float(parts[1]))
                except ValueError:
                    pass

    return version, session_is_up


def esc_string_field(val: str) -> str:
    # escape for string fields in Influx line protocol
    return val.replace("\\\\", "\\\\\\\\").replace('"', r'\\"')


def main():
    try:
        text = fetch_metrics(METRICS_URL)
        version, session_is_up = parse_metrics(text)

        if version is None and session_is_up is None:
            # No metrics found, output empty measurement
            print("doublezero version=\"unknown\",session_is_up=0i")
            return

        parts = []
        if version is not None:
            parts.append(f'version="{esc_string_field(version)}"')
        if session_is_up is not None:
            parts.append(f'session_is_up={session_is_up}i')

        if parts:
            print(f"doublezero {','.join(parts)}")
    except Exception as e:
        # On error, output a safe default
        print("doublezero version=\"error\",session_is_up=0i")


if __name__ == "__main__":
    main()
`

  const scriptPath = `${dzDir}/dz_metrics.py`
  // Write Python script to temp file first, then move with sudo
  const tempScriptPath = '/tmp/dz_metrics.py'
  writeFileSync(tempScriptPath, pythonScript, 'utf-8')
  spawnSync(`sudo mv ${tempScriptPath} ${scriptPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  // Make script executable
  spawnSync(`sudo chmod +x ${scriptPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  console.log(chalk.green('✅ Doublezero Python script created'))

  // Create telegraf.d directory if it doesn't exist
  const telegrafDDir = '/etc/telegraf/telegraf.d'
  if (!existsSync(telegrafDDir)) {
    spawnSync(`sudo mkdir -p ${telegrafDDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  // Create dz_emitter config
  const dzEmitterConfig = `# --- INPUT: scrape doublezero metrics via small Python helper
[[inputs.exec]]
  commands    = ["python3 /opt/doublezero/dz_metrics.py"]
  timeout     = "5s"
  data_format = "influx"

  # Force measurement name, just to be explicit
  name_override = "doublezero"

  # Add a pipeline tag, like fd_emitter does
  [inputs.exec.tags]
    pipeline = "doublezero"


# If you ever add more numeric fields later and want to cast them:
[[processors.converter]]
  namepass = ["doublezero"]
  [processors.converter.fields]
    integer = ["session_is_up"]   # redundant now since we use "1i", but future-proof
`

  const dzEmitterPath = `${telegrafDDir}/dz_emitter.conf`
  // Write config to temp file first, then move with sudo
  const tempConfigPath = '/tmp/dz_emitter.conf'
  writeFileSync(tempConfigPath, dzEmitterConfig, 'utf-8')
  spawnSync(`sudo mv ${tempConfigPath} ${dzEmitterPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  console.log(chalk.green('✅ Doublezero telegraf.d configuration created'))

  // Update main telegraf.conf to add dz_metrics output
  await updateTelegrafForDoublezero()

  console.log(chalk.green('✅ Doublezero monitoring setup complete'))
}

/**
 * Updates telegraf.conf to add the dz_metrics output block
 * This uses a Node.js script to intelligently insert the configuration
 */
const updateTelegrafForDoublezero = async (): Promise<void> => {
  const telegrafConfigPath = '/etc/telegraf/telegraf.conf'

  if (!existsSync(telegrafConfigPath)) {
    throw new Error('telegraf.conf not found. Please install monitoring first.')
  }

  // Read current config using sudo
  const readResult = spawnSync(`sudo cat ${telegrafConfigPath}`, {
    shell: true,
    stdio: 'pipe',
    encoding: 'utf-8',
  })

  if (readResult.status !== 0) {
    throw new Error('Failed to read telegraf config')
  }

  let currentConfig = readResult.stdout.toString()

  // Check if dz_metrics already exists
  if (currentConfig.includes('database = "dz_metrics"')) {
    console.log(chalk.yellow('⚠️  dz_metrics output already exists in config'))
    return
  }

  // Check if we need to add tagdrop sections
  let updatedConfig = currentConfig

  // Check for v_metrics influxdb output and add tagdrop if missing
  const vMetricsInfluxRegex = /(\[\[outputs\.influxdb\]\]\s+[^\[]*?database\s*=\s*"v_metrics"[^\[]*?)(?=\[\[|$)/
  const vMetricsMatch = currentConfig.match(vMetricsInfluxRegex)
  if (vMetricsMatch && !vMetricsMatch[0].includes('[outputs.influxdb.tagdrop]')) {
    updatedConfig = updatedConfig.replace(
      vMetricsInfluxRegex,
      (match) => {
        // Add tagdrop before the closing of the section or next section
        return match.trim() + '\n  [outputs.influxdb.tagdrop]\n    pipeline = ["doublezero"]'
      },
    )
  }

  // Check for http output with v_metrics and add tagdrop if missing
  const httpVMetricsRegex = /(\[\[outputs\.http\]\]\s+[^\[]*?url\s*=\s*"[^"]*db=v_metrics[^"]*"[^\[]*?)(?=\[\[|$)/
  const httpMatch = currentConfig.match(httpVMetricsRegex)
  if (httpMatch && !httpMatch[0].includes('[outputs.http.tagdrop]')) {
    updatedConfig = updatedConfig.replace(
      httpVMetricsRegex,
      (match) => {
        // Add tagdrop before the closing of the section or next section
        return match.trim() + '\n  [outputs.http.tagdrop]\n    pipeline = ["doublezero"]'
      },
    )
  }

  // Add dz_metrics output block at the end
  const dzMetricsBlock = `\n\n[[outputs.influxdb]]
  urls     = ["https://influxdb.apps.ra.latentfree.llc"]
  database = "dz_metrics"
  username = "dz_user"
  password = "1b91CP@44b3c"
  [outputs.influxdb.tagpass]
    pipeline = ["doublezero"]
`

  updatedConfig = updatedConfig.trim() + dzMetricsBlock

  // Write updated config to temp file
  const tempPath = '/tmp/telegraf.conf.new'
  writeFileSync(tempPath, updatedConfig, 'utf-8')

  // Move to final location with sudo
  spawnSync(`sudo mv ${tempPath} ${telegrafConfigPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  // Set proper permissions
  spawnSync(`sudo chown root:root ${telegrafConfigPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  spawnSync(`sudo chmod 644 ${telegrafConfigPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  console.log(chalk.green('✅ Telegraf config updated for doublezero'))
}

