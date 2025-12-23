#!/bin/bash

# main pid of solana-validator
solana_pid=$(pgrep -f "^agave-validator --identity")
if [ -z "$solana_pid" ]; then
    logger "set_affinity: solana_validator_404"
    exit 1
fi

# find thread id for poh
thread_poh_pid=$(ps -T -p $solana_pid -o spid,comm | grep 'solPohTickProd' | awk '{print $1}')
if [ -z "$thread_poh_pid" ]; then
    logger "set_affinity: solPohTickProd_404"
    exit 1
fi

current_poh_affinity=$(taskset -cp $thread_poh_pid 6>&1 | awk '{print $NF}')
if [ "$current_poh_affinity" == "6" ]; then
    logger "set_affinity: solPohTickProd_already_set"
    exit 1
else
    # set poh to cpu6
    sudo taskset -cp 6 $thread_poh_pid
    logger "set_affinity: set_done"
     # $thread_poh_pid
fi

# find thread id for xdp
thread_xdp_pid=$(ps -T -p $solana_pid -o spid,comm | grep 'solRetransmIO00' | awk '{print $1}')
if [ -z "$thread_xdp_pid" ]; then
    logger "set_affinity: solRetransmIO00_404"
    exit 1
fi

current_xdp_affinity=$(taskset -cp $thread_xdp_pid 6>&1 | awk '{print $NF}')
if [ "$current_xdp_affinity" == "2" ]; then
    logger "set_affinity: solRetransmIO00_already_set"
    exit 1
else
    # set xdp to cpu2
    sudo taskset -cp 2 $thread_xdp_pid
    logger "set_affinity: set_done"
     # $thread_xdp_pid
fi
