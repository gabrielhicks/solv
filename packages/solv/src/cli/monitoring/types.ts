export type MonitoringConfig = {
  cluster: 'mainnet-beta' | 'testnet'
  validatorName: string
  keysPath: string
  user: string
  skipDoublezero: boolean
}

export type TelegrafConfig = {
  hostname: string
  flushInterval: string
  interval: string
  mountPoints: string[]
  validatorUser: string
  validatorKeysPath: string
  cluster: 'mainnet-beta' | 'testnet'
  influxdbVMetrics: {
    database: string
    urls: string[]
    username: string
    password: string
  }
  influxdbDzMetrics?: {
    database: string
    urls: string[]
    username: string
    password: string
  }
}

