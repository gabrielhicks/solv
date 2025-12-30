# Monitoring Module

This module provides a modular approach to installing and configuring monitoring for Solana validators using Telegraf and InfluxDB. It replaces the ansible-based installation from sv-manager with a native TypeScript implementation.

## Structure

The monitoring module is organized into separate, modular components:

- **`index.ts`** - Main CLI command registration
- **`types.ts`** - TypeScript type definitions
- **`installTelegraf.ts`** - Telegraf installation and repository setup
- **`setupValidatorKeys.ts`** - Validator key symlink creation
- **`generateTelegrafConfig.ts`** - Telegraf configuration generation
- **`configureTelegraf.ts`** - Telegraf configuration file writing
- **`setupDoublezero.ts`** - Doublezero monitoring setup (Python script + config)
- **`installMonitoring.ts`** - Main orchestration function
- **`uninstallMonitoring.ts`** - Monitoring removal
- **`restartMonitoring.ts`** - Service restart utility
- **`statusMonitoring.ts`** - Status checking utility

## Usage

### Install Monitoring

```bash
solv monitoring install
```

Options:
- `--cluster <cluster>` - Cluster: mainnet-beta or testnet (defaults to config or prompts)
- `--validator-name <name>` - Validator name for monitoring (prompts if not provided)
- `--keys-path <path>` - Path to validator keys directory (defaults to /home/solv/.secrets)
- `--user <user>` - User running validator (defaults to solv)
- `--skip-doublezero` - Skip doublezero monitoring setup

### Uninstall Monitoring

```bash
solv monitoring uninstall
```

### Restart Monitoring

```bash
solv monitoring restart
```

### Check Status

```bash
solv monitoring status
```

## Modular Design

Each component can be updated independently:

1. **Telegraf Installation** (`installTelegraf.ts`) - Handles package manager detection and telegraf installation
2. **Key Setup** (`setupValidatorKeys.ts`) - Creates symlinks for validator keys
3. **Config Generation** (`generateTelegrafConfig.ts`) - Generates telegraf.conf content
4. **Config Writing** (`configureTelegraf.ts`) - Writes configuration to disk
5. **Doublezero Setup** (`setupDoublezero.ts`) - Sets up doublezero monitoring (Python script + telegraf.d config)

## Customization

To customize any component:

1. **Change InfluxDB endpoints**: Modify `installMonitoring.ts` where `influxdbVMetrics` and `influxdbDzMetrics` are defined
2. **Change mount points**: Modify `installMonitoring.ts` where `mountPoints` is defined
3. **Change monitoring intervals**: Modify `installMonitoring.ts` where `flushInterval` and `interval` are defined
4. **Add new monitoring inputs**: Modify `generateTelegrafConfig.ts` to add new input sections
5. **Add new outputs**: Modify `generateTelegrafConfig.ts` to add new output sections

## Configuration

The monitoring setup creates:

- `/etc/telegraf/telegraf.conf` - Main telegraf configuration
- `/etc/telegraf/telegraf.d/dz_emitter.conf` - Doublezero input configuration (if enabled)
- `/opt/doublezero/dz_metrics.py` - Python script for doublezero metrics (if enabled)
- `/home/{user}/.secrets/validator-keypair.json` - Symlink to validator key
- `/home/{user}/.secrets/vote-account-keypair.json` - Symlink to vote account key (if exists)

## Notes

- The module assumes Ubuntu/Debian (apt) by default. Yum support can be added to `installTelegraf.ts`
- All file operations use sudo for system directories
- The doublezero setup is optional and can be skipped with `--skip-doublezero`
- The module automatically detects if doublezero config already exists to avoid duplicates

