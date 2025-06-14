import { CONFIG, startupScriptPaths } from '@/config/config'

export const logRotates = (username = CONFIG.USERNAME, frankendancer: boolean) => {
  const { log } = startupScriptPaths()
  const service = frankendancer ? 'frankendancer' : 'agave'
  let body = `${log} {
    su ${username} ${username} 
    daily
    rotate 1
    size 4G
    missingok
    compress
    postrotate
      systemctl kill -s USR1 solv.service
    endscript
  }
  `
  if (service === 'agave') {
    body = `${log} {
    su ${username} ${username} 
    daily
    rotate 1
    size 4G
    missingok
    compress
    postrotate
      systemctl kill -s USR1 solv.service
    endscript
  }
  `
    return body
  }
  if (service === 'frankendancer') {
    body = `${log} {
    su ${username} ${username} 
    daily
    size 4G
    rotate 1
    missingok
    compress
    copytruncate
  }
  `
    return body
  }
  return body
}