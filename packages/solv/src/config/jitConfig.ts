export interface JitoConfig {
  version: string
  tag: string
  commissionBps: number
  relayerUrl: string
  blockEngineUrl: string
  shredReceiverAddr: string
  bamUrl: string
  hasRelayer?: boolean
}

export const JITO_CONFIG: JitoConfig = {
  version: '2.3.10',
  tag: 'v2.3.10',
  commissionBps: 0,
  relayerUrl: 'http://frankfurt.mainnet.relayer.jito.wtf:8100',
  blockEngineUrl: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  shredReceiverAddr: '64.130.50.14:1002',
  bamUrl: 'http://frankfurt.mainnet.bam.jito.wtf'
}

export const JITO_REGIONS = {
  TESTNET: {
    Dallas: {
      BLOCK_ENGINE_URL: 'https://dallas.testnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://dallas.testnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '141.98.218.12:1002',
      BAM_URL: 'http://dallas.testnet.bam.jito.wtf',
    },
    NewYork: {
      BLOCK_ENGINE_URL: 'https://ny.testnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://ny.testnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '64.130.35.224:1002',
      BAM_URL: 'http://ny.testnet.bam.jito.wtf',
    },
    SaltLakeCity: {
      BLOCK_ENGINE_URL: 'https://dallas.testnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://dallas.testnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '141.98.218.12:1002',
      BAM_URL: 'http://slc.testnet.bam.jito.wtf',
    },
  },
  MAINNET: {
    Amsterdam: {
      BLOCK_ENGINE_URL: 'https://amsterdam.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://amsterdam.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '74.118.140.240:1002',
      BAM_URL: 'http://amsterdam.mainnet.bam.jito.wtf',
    },
    London: {
      BLOCK_ENGINE_URL: 'https://london.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://london.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '142.91.127.175:1002',
      BAM_URL: 'http://london.mainnet.bam.jito.wtf',
    },
    Frankfurt: {
      BLOCK_ENGINE_URL: 'https://frankfurt.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://frankfurt.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '64.130.50.14:1002',
      BAM_URL: 'http://frankfurt.mainnet.bam.jito.wtf',
    },
    NewYork: {
      BLOCK_ENGINE_URL: 'https://ny.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://ny.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '141.98.216.96:1002',
      BAM_URL: 'http://ny.mainnet.bam.jito.wtf',
    },
    Tokyo: {
      BLOCK_ENGINE_URL: 'https://tokyo.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://tokyo.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '202.8.9.160:1002',
      BAM_URL: 'http://tokyo.mainnet.bam.jito.wtf',
    },
    SaltLakeCity: {
      BLOCK_ENGINE_URL: 'https://slc.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://slc.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '64.130.53.8:1002',
      BAM_URL: 'http://slc.mainnet.bam.jito.wtf',
    },
    Singapore: {
      BLOCK_ENGINE_URL: 'https://singapore.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://singapore.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '202.8.11.224:1002',
      BAM_URL: 'http://singapore.mainnet.bam.jito.wtf',
    },
    Dublin: {
      BLOCK_ENGINE_URL: 'https://dublin.mainnet.block-engine.jito.wtf',
      RELAYER_URL: 'http://dublin.mainnet.relayer.jito.wtf:8100',
      SHRED_RECEIVER_ADDR: '64.130.61.8:1002',
      BAM_URL: '',
    },
  },
}
