const jagsnapService = (region: string) => {
  const filePath = '/etc/systemd/system/jag-snap-fw.service'
  const body = `[Unit]
Description=Update jag snap firewall rules
After=network-online.target

[Service]
Type=oneshot
User=jag-snap-fw
ExecStart=/usr/local/bin/jag-snap-fw.sh ${region} 18899
`

  return {
    filePath,
    body,
  }
}

export default jagsnapService
