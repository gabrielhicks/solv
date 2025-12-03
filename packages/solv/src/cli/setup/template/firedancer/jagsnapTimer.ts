const jagsnapTimer = (region: string) => {
  const filePath = '/etc/systemd/system/jag-snap-fw.timer'
  const body = `[Unit]
Description=Run jag snap firewall update periodically

[Timer]
OnCalendar=*:0/1
Persistent=true

[Install]
WantedBy=timers.target
`

  return {
    filePath,
    body,
  }
}

export default jagsnapTimer
