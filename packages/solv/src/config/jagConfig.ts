import { JagRegion } from './enums'

export const JAG_SHRED_ADDRESSES: Record<JagRegion, string> = {
  [JagRegion.LATAM]:
    '--shred-receiver-address sp1-shreds.blxrbdn.com:8888,sp2-shreds.blxrbdn.com:8888 \\',
  [JagRegion.SINGAPORE]:
    '--shred-receiver-address sg1-shreds.blxrbdn.com:8888,sg2-shreds.blxrbdn.com:8888 \\',
  [JagRegion.AFRICA]:
    '--shred-receiver-address sa1-shreds.blxrbdn.com:8888,sa2-shreds.blxrbdn.com:8888 \\',
  [JagRegion.APAC]:
    '--shred-receiver-address sg1-shreds.blxrbdn.com:8888,sg2-shreds.blxrbdn.com:8888 \\',
}
