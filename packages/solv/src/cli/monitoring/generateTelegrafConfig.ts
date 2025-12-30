import { TelegrafConfig } from './types'

/**
 * Generates the telegraf.conf content based on the provided configuration
 */
export const generateTelegrafConfig = (config: TelegrafConfig): string => {
  const { hostname, flushInterval, interval, mountPoints, validatorUser } = config

  const mountPointsStr = mountPoints.map((mp) => `"${mp}"`).join(', ')

  return `[agent]
  hostname = "${hostname}"
  flush_interval = "${flushInterval}"
  interval = "${interval}"

##INPUTS
[[inputs.cpu]]
  ## Whether to report per-cpu stats or not
  percpu = false
  ## Whether to report total system cpu stats or not
  totalcpu = true
  ## If true, collect raw CPU time metrics.
  collect_cpu_time = false
  ## If true, compute and report the sum of all non-idle CPU states.
  report_active = false

[[inputs.disk]]
  ## By default stats will be gathered for all mount points.
  ## Set mount_points will restrict the stats to only the specified mount points.
  mount_points = [${mountPointsStr}]

  ## Ignore mount points by filesystem type.
  ignore_fs = ["devtmpfs", "devfs", "iso9660", "overlay", "aufs", "squashfs"]

[[inputs.diskio]]

[[inputs.net]]

[[inputs.nstat]]

[[inputs.procstat]]
 pattern="${validatorUser === 'solv' ? 'solv' : 'solana'}"

[[inputs.system]]

[[inputs.systemd_units]]
    [inputs.systemd_units.tagpass]
    name = ["${validatorUser === 'solv' ? 'solv*' : 'solana*'}"]

[[inputs.mem]]

[[inputs.swap]]

[[inputs.exec]]
  commands = [
               "sudo -u ${validatorUser} /home/${validatorUser}/monitoring/output_starter.sh output_validator_measurements"
             ]
  interval = "${interval}"
  timeout = "${interval}"
  json_name_key = "measurement"
  json_time_key = "time"
  tag_keys = ["tags_validator_name",
              "tags_validator_identity_pubkey",
              "tags_validator_vote_pubkey",
              "tags_cluster_environment",
              "validator_id",
              "validator_name"]

  json_string_fields = [
            "monitoring_version",
            "solana_version",
            "validator_identity_pubkey",
            "validator_vote_pubkey",
            "cluster_environment",
            "cpu_model"]

  json_time_format = "unix_ms"

##OUTPUTS
[[outputs.influxdb]]
  database = "${config.influxdbVMetrics.database}"
  urls = ${JSON.stringify(config.influxdbVMetrics.urls)}
  username = "${config.influxdbVMetrics.username}"
  password = "${config.influxdbVMetrics.password}"
  [outputs.influxdb.tagdrop]
    pipeline = ["doublezero"]
[[outputs.http]]
  url          = "https://influxdb.apps.ra.latentfree.llc/write?db=${config.influxdbVMetrics.database}&u=${config.influxdbVMetrics.username}&p=${config.influxdbVMetrics.password}"
  method       = "POST"
  data_format  = "influx"
  timeout      = "10s"
  [outputs.http.tagdrop]
    pipeline = ["doublezero"]
${config.influxdbDzMetrics ? `
[[outputs.influxdb]]
  urls     = ${JSON.stringify(config.influxdbDzMetrics.urls)}
  database = "${config.influxdbDzMetrics.database}"
  username = "${config.influxdbDzMetrics.username}"
  password = "${config.influxdbDzMetrics.password}"
  [outputs.influxdb.tagpass]
    pipeline = ["doublezero"]
` : ''}
`
}

