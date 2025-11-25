const modDiff = () => {
  const filePath = '/home/solv/firedancer/mod.diff'
  const body = String.raw`diff --git a/src/app/fdctl/commands/run_agave.c b/src/app/fdctl/commands/run_agave.c
index 1cfd98e148a..e2a347164c4 100644
--- a/src/app/fdctl/commands/run_agave.c
+++ b/src/app/fdctl/commands/run_agave.c
@@ -37,7 +37,8 @@ clone_labs_memory_space_tiles( config_t * config ) {
                           !strcmp( wksp->name, "metric_in" ) ||
                           !strcmp( wksp->name, "bank" ) ||
                           !strcmp( wksp->name, "poh" ) ||
-                          !strcmp( wksp->name, "store" ) ) ) {
+                          !strcmp( wksp->name, "store" ) ||
+                          !strcmp( wksp->name, "leader_state" ) ) ) {
       fd_topo_join_workspace( &config->topo, wksp, FD_SHMEM_JOIN_MODE_READ_WRITE );
     }
   }
diff --git a/src/app/fdctl/config/default.toml b/src/app/fdctl/config/default.toml
index 9c3c5ed0a9b..475f4958f75 100644
--- a/src/app/fdctl/config/default.toml
+++ b/src/app/fdctl/config/default.toml
@@ -814,6 +814,21 @@ dynamic_port_range = "8900-9000"
     # very high TPS rates because the cluster size will be very small.
     shred_tile_count = 1
 
+    # Enable low power mode for tiles to reduce CPU usage when idle.
+    #
+    # By default, Firedancer is designed to maximize performance by
+    # dedicating CPU cores exclusively to each tile, spinning continuously
+    # to minimize latency. This ensures the fastest possible response to
+    # incoming work and is optimal for low-latency, high-throughput environments.
+    #
+    # In contrast, this option allows tiles to sleep after detecting inactivity
+    # rather than continuously spinning for new work.  This significantly reduces
+    # power consumption and CPU usage but introduces a slight latency overhead.
+    # Enable this if power efficiency is a priority.
+    #
+    # The default is false to maintain optimal performance.
+    low_power_mode = false
+
 # All memory that will be used in Firedancer is pre-allocated in two
 # kinds of pages: huge and gigantic.  Huge pages are 2 MiB and gigantic
 # pages are 1 GiB.  This is done to prevent TLB misses which can have a
diff --git a/src/app/fdctl/topology.c b/src/app/fdctl/topology.c
index 64b77824372..3598a9a580f 100644
--- a/src/app/fdctl/topology.c
+++ b/src/app/fdctl/topology.c
@@ -42,6 +42,7 @@ fd_topo_initialize( config_t * config ) {
   fd_topo_t * topo = { fd_topob_new( &config->topo, config->name ) };
   topo->max_page_size = fd_cstr_to_shmem_page_sz( config->hugetlbfs.max_page_size );
   topo->gigantic_page_threshold = config->hugetlbfs.gigantic_page_threshold_mib << 20;
+  topo->low_power_mode = config->layout.low_power_mode;
 
   /*             topo, name */
   fd_topob_wksp( topo, "metric_in"    );
@@ -352,6 +353,26 @@ fd_topo_initialize( config_t * config ) {
     }
   }
 
+   /* Leader state fseq for low-power mode.
+      Signals whether validator is currently leader (1) or not (0). PoH tile
+      writes when leader status changes; other tiles read to determine if they
+      should sleep when idle. Enables power savings while maintaining peak
+      performance during leader slots. */
+
+  if( FD_UNLIKELY( topo->low_power_mode ) ) {
+    fd_topob_wksp( topo, "leader_state" );
+    fd_topo_obj_t * leader_state_obj = fd_topob_obj( topo, "fseq", "leader_state" );
+    for( ulong i=0UL; i<topo->tile_cnt; i++ ) {
+      if( FD_UNLIKELY( topo->tiles[i].idle_sleep ) ) {
+        if( FD_UNLIKELY( !strcmp(topo->tiles[i].name, "poh") ) )
+          fd_topob_tile_uses(topo, &topo->tiles[i], leader_state_obj, FD_SHMEM_JOIN_MODE_READ_WRITE);
+        else
+          fd_topob_tile_uses(topo, &topo->tiles[i], leader_state_obj, FD_SHMEM_JOIN_MODE_READ_ONLY);
+      }
+    }
+    FD_TEST( fd_pod_insertf_ulong( topo->props, leader_state_obj->id, "leader_state" ));
+  }
+
   /* There is a special fseq that sits between the pack, bank, and poh
      tiles to indicate when the bank/poh tiles are done processing a
      microblock.  Pack uses this to determine when to "unlock" accounts
diff --git a/src/app/shared/commands/monitor/monitor.c b/src/app/shared/commands/monitor/monitor.c
index 790befe9c83..7c646562e3a 100644
--- a/src/app/shared/commands/monitor/monitor.c
+++ b/src/app/shared/commands/monitor/monitor.c
@@ -362,8 +362,8 @@ run_monitor( config_t const * config,
     char now_cstr[ FD_LOG_WALLCLOCK_CSTR_BUF_SZ ];
     if( !monitor_pane ) {
       PRINT( "snapshot for %s | Use TAB to switch panes" TEXT_NEWLINE, fd_log_wallclock_cstr( now, now_cstr ) );
-      PRINT( "    tile |     pid |      stale | heart | nivcsw              | nvcsw               | in backp |           backp cnt |  %% hkeep |  %% wait  |  %% backp | %% finish" TEXT_NEWLINE );
-      PRINT( "---------+---------+------------+-------+---------------------+---------------------+----------+---------------------+----------+----------+----------+----------" TEXT_NEWLINE );
+      PRINT( "    tile |     pid |      stale | heart | nivcsw              | nvcsw               | in backp |           backp cnt |  %% hkeep |  %% wait  |  %% backp | %% finish |  %% sleep" TEXT_NEWLINE );
+      PRINT( "---------+---------+------------+-------+---------------------+---------------------+----------+---------------------+----------+----------+----------+----------+-----------" TEXT_NEWLINE );
       for( ulong tile_idx=0UL; tile_idx<topo->tile_cnt; tile_idx++ ) {
         tile_snap_t * prv = &tile_snap_prv[ tile_idx ];
         tile_snap_t * cur = &tile_snap_cur[ tile_idx ];
@@ -385,6 +385,9 @@ run_monitor( config_t const * config,
         ulong cur_backp_ticks      = cur->regime_ticks[5];
         ulong prv_backp_ticks      = prv->regime_ticks[5];
 
+        ulong cur_sleeping_ticks   = cur->regime_ticks[8];
+        ulong prv_sleeping_ticks   = prv->regime_ticks[8];
+
         ulong cur_processing_ticks = cur->regime_ticks[4]+cur->regime_ticks[7];
         ulong prv_processing_ticks = prv->regime_ticks[4]+prv->regime_ticks[7];
 
@@ -392,6 +395,7 @@ run_monitor( config_t const * config,
         PRINT( " | " ); printf_pct( &buf, &buf_sz, cur_wait_ticks,       prv_wait_ticks,       0., tile_total_ticks( cur ), tile_total_ticks( prv ), DBL_MIN );
         PRINT( " | " ); printf_pct( &buf, &buf_sz, cur_backp_ticks,      prv_backp_ticks,      0., tile_total_ticks( cur ), tile_total_ticks( prv ), DBL_MIN );
         PRINT( " | " ); printf_pct( &buf, &buf_sz, cur_processing_ticks, prv_processing_ticks, 0., tile_total_ticks( cur ), tile_total_ticks( prv ), DBL_MIN );
+        PRINT( " | " ); printf_pct( &buf, &buf_sz, cur_sleeping_ticks,   prv_sleeping_ticks,   0., tile_total_ticks( cur ), tile_total_ticks( prv ), DBL_MIN );
         PRINT( TEXT_NEWLINE );
       }
     } else {
diff --git a/src/app/shared/commands/monitor/monitor.seccomppolicy b/src/app/shared/commands/monitor/monitor.seccomppolicy
index 0054eefaf15..2984e700c09 100644
--- a/src/app/shared/commands/monitor/monitor.seccomppolicy
+++ b/src/app/shared/commands/monitor/monitor.seccomppolicy
@@ -33,8 +33,10 @@ fsync: (eq (arg 0) logfile_fd)
 #
 # The monitor calls fd_log_wait_until() to wait until the diagnostic
 # output screen should be refreshed, and that function can call
-# nanosleep depending on the amount of time left to wait.
-nanosleep
+# clock_nanosleep (syscall used by glibc's nanosleep) depending
+# on the amount of time left to wait.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
 
 # monitor: wait until we need to print again
 #
diff --git a/src/app/shared/fd_config.h b/src/app/shared/fd_config.h
index 57412457518..f6b34830e6b 100644
--- a/src/app/shared/fd_config.h
+++ b/src/app/shared/fd_config.h
@@ -259,6 +259,7 @@ struct fd_config {
     uint verify_tile_count;
     uint bank_tile_count;
     uint shred_tile_count;
+    int  low_power_mode;
   } layout;
 
   struct {
diff --git a/src/app/shared/fd_config_parse.c b/src/app/shared/fd_config_parse.c
index 3cdf8e40820..9124448e31c 100644
--- a/src/app/shared/fd_config_parse.c
+++ b/src/app/shared/fd_config_parse.c
@@ -162,6 +162,7 @@ fd_config_extract_pod( uchar *       pod,
   CFG_POP      ( uint,   layout.verify_tile_count                         );
   CFG_POP      ( uint,   layout.bank_tile_count                           );
   CFG_POP      ( uint,   layout.shred_tile_count                          );
+  CFG_POP      ( bool,   layout.low_power_mode                            );
 
   CFG_POP      ( cstr,   hugetlbfs.mount_path                             );
   CFG_POP      ( cstr,   hugetlbfs.max_page_size                          );
diff --git a/src/app/shared_dev/commands/pktgen/pktgen.c b/src/app/shared_dev/commands/pktgen/pktgen.c
index 347a9a5fd28..47cb549bce9 100644
--- a/src/app/shared_dev/commands/pktgen/pktgen.c
+++ b/src/app/shared_dev/commands/pktgen/pktgen.c
@@ -130,6 +130,7 @@ render_status( ulong volatile const * net_metrics ) {
     /* */ cum_tick_now += net_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_PROCESSING_PREFRAG        ) ];
     /* */ cum_tick_now += net_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_BACKPRESSURE_PREFRAG      ) ];
     /* */ cum_tick_now += net_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_PROCESSING_POSTFRAG       ) ];
+    /* */ cum_tick_now += net_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_SLEEPING                  ) ];
     ulong rx_ok_now     = net_metrics[ MIDX( COUNTER, NET, RX_PKT_CNT           ) ];
     ulong rx_byte_now   = net_metrics[ MIDX( COUNTER, NET, RX_BYTES_TOTAL       ) ];
     ulong rx_drop_now   = net_metrics[ MIDX( COUNTER, NET, RX_FILL_BLOCKED_CNT  ) ];
diff --git a/src/app/shared_dev/commands/quic_trace/fd_quic_trace_log_tile.c b/src/app/shared_dev/commands/quic_trace/fd_quic_trace_log_tile.c
index 2ebdf453673..0afb7022de2 100644
--- a/src/app/shared_dev/commands/quic_trace/fd_quic_trace_log_tile.c
+++ b/src/app/shared_dev/commands/quic_trace/fd_quic_trace_log_tile.c
@@ -70,19 +70,21 @@ fd_quic_trace_log_tile( fd_frag_meta_t const * in_mcache ) {
 
   uchar scratch[ sizeof(fd_stem_tile_in_t)+128 ] __attribute__((aligned(FD_STEM_SCRATCH_ALIGN)));
 
-  stem_run1( /* in_cnt     */ 1UL,
-             /* in_mcache  */ in_mcache_tbl,
-             /* in_fseq    */ fseq_tbl,
-             /* out_cnt    */ 0UL,
-             /* out_mcache */ NULL,
-             /* cons_cnt   */ 0UL,
-             /* cons_out   */ NULL,
-             /* cons_fseq  */ NULL,
-             /* stem_burst */ 1UL,
-             /* stem_lazy  */ 0L,
-             /* rng        */ rng,
-             /* scratch    */ scratch,
-             /* ctx        */ NULL );
+  stem_run1( /* in_cnt       */ 1UL,
+             /* in_mcache    */ in_mcache_tbl,
+             /* in_fseq      */ fseq_tbl,
+             /* out_cnt      */ 0UL,
+             /* out_mcache   */ NULL,
+             /* cons_cnt     */ 0UL,
+             /* cons_out     */ NULL,
+             /* cons_fseq    */ NULL,
+             /* idle_sleep   */ 0,
+             /* stem_burst   */ 1UL,
+             /* stem_lazy    */ 0L,
+             /* rng          */ rng,
+             /* leader_state */ NULL,
+             /* scratch      */ scratch,
+             /* ctx          */ NULL );
 
   fd_fseq_delete( fd_fseq_leave( fseq ) );
 }
diff --git a/src/app/shared_dev/commands/quic_trace/fd_quic_trace_rx_tile.c b/src/app/shared_dev/commands/quic_trace/fd_quic_trace_rx_tile.c
index a8463e4423e..cd570bd345c 100644
--- a/src/app/shared_dev/commands/quic_trace/fd_quic_trace_rx_tile.c
+++ b/src/app/shared_dev/commands/quic_trace/fd_quic_trace_rx_tile.c
@@ -539,19 +539,21 @@ fd_quic_trace_rx_tile( fd_quic_trace_ctx_t *  trace_ctx,
 
   fd_frag_meta_t const * in_mcache_tbl[2] = { rx_mcache, tx_mcache };
 
-  stem_run1( /* in_cnt     */ 2UL,
-             /* in_mcache  */ in_mcache_tbl,
-             /* in_fseq    */ fseq_tbl,
-             /* out_cnt    */ 0UL,
-             /* out_mcache */ NULL,
-             /* cons_cnt   */ 0UL,
-             /* cons_out   */ NULL,
-             /* cons_fseq  */ NULL,
-             /* stem_burst */ 1UL,
-             /* stem_lazy  */ 0L,
-             /* rng        */ rng,
-             /* scratch    */ scratch,
-             /* ctx        */ trace_ctx );
+  stem_run1( /* in_cnt       */ 2UL,
+             /* in_mcache    */ in_mcache_tbl,
+             /* in_fseq      */ fseq_tbl,
+             /* out_cnt      */ 0UL,
+             /* out_mcache   */ NULL,
+             /* cons_cnt     */ 0UL,
+             /* cons_out     */ NULL,
+             /* cons_fseq    */ NULL,
+             /* idle_sleep   */ 0,
+             /* stem_burst   */ 1UL,
+             /* stem_lazy    */ 0L,
+             /* rng          */ rng,
+             /* leader_state */ NULL,
+             /* scratch      */ scratch,
+             /* ctx          */ trace_ctx );
 
   for( int j = 0; j < 2; ++j ){
     fd_fseq_delete( fd_fseq_leave( fseq_tbl[j] ) );
diff --git a/src/disco/cswtch/fd_cswtch_tile.c b/src/disco/cswtch/fd_cswtch_tile.c
index 6332d01594c..af9b2bec5fd 100644
--- a/src/disco/cswtch/fd_cswtch_tile.c
+++ b/src/disco/cswtch/fd_cswtch_tile.c
@@ -228,6 +228,7 @@ populate_allowed_fds( fd_topo_t const *      topo,
 
 #define STEM_BURST (1UL)
 #define STEM_LAZY  ((long)10e6) /* 10ms */
+#define STEM_IDLE_SLEEP_ENABLED (0)
 
 #define STEM_CALLBACK_CONTEXT_TYPE  fd_cswtch_ctx_t
 #define STEM_CALLBACK_CONTEXT_ALIGN alignof(fd_cswtch_ctx_t)
diff --git a/src/disco/dedup/fd_dedup_tile.seccomppolicy b/src/disco/dedup/fd_dedup_tile.seccomppolicy
index a5880d7c085..adcf27ca3f1 100644
--- a/src/disco/dedup/fd_dedup_tile.seccomppolicy
+++ b/src/disco/dedup/fd_dedup_tile.seccomppolicy
@@ -16,3 +16,19 @@ write: (or (eq (arg 0) 2)
 #
 # arg 0 is the file descriptor to fsync.
 fsync: (eq (arg 0) logfile_fd)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/gui/fd_gui.c b/src/disco/gui/fd_gui.c
index 7a493dd5b08..11ff0207cae 100644
--- a/src/disco/gui/fd_gui.c
+++ b/src/disco/gui/fd_gui.c
@@ -229,6 +229,7 @@ fd_gui_tile_timers_snap( fd_gui_t * gui ) {
     cur[ i ].backpressure_prefrag_ticks      = tile_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_BACKPRESSURE_PREFRAG ) ];
     cur[ i ].caughtup_postfrag_ticks         = tile_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_CAUGHT_UP_POSTFRAG ) ];
     cur[ i ].processing_postfrag_ticks       = tile_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_PROCESSING_POSTFRAG ) ];
+    cur[ i ].sleeping_ticks                  = tile_metrics[ MIDX( COUNTER, TILE, REGIME_DURATION_NANOS_SLEEPING ) ];
   }
 }
 
diff --git a/src/disco/gui/fd_gui.h b/src/disco/gui/fd_gui.h
index 948b0050d3b..4f6a8aeba2a 100644
--- a/src/disco/gui/fd_gui.h
+++ b/src/disco/gui/fd_gui.h
@@ -155,6 +155,7 @@ struct fd_gui_tile_timers {
 
   ulong caughtup_postfrag_ticks;
   ulong processing_postfrag_ticks;
+  ulong sleeping_ticks;
 };
 
 typedef struct fd_gui_tile_timers fd_gui_tile_timers_t;
diff --git a/src/disco/gui/fd_gui_printf.c b/src/disco/gui/fd_gui_printf.c
index ec2e9f30fda..5f40aaee194 100644
--- a/src/disco/gui/fd_gui_printf.c
+++ b/src/disco/gui/fd_gui_printf.c
@@ -675,7 +675,8 @@ fd_gui_printf_tile_timers( fd_gui_t *                   gui,
                                 + cur[ i ].processing_prefrag_ticks
                                 + cur[ i ].backpressure_prefrag_ticks
                                 + cur[ i ].caughtup_postfrag_ticks
-                                + cur[ i ].processing_postfrag_ticks);
+                                + cur[ i ].processing_postfrag_ticks
+                                + cur[ i ].sleeping_ticks);
 
     double prev_total = (double)(prev[ i ].caughtup_housekeeping_ticks
                                   + prev[ i ].processing_housekeeping_ticks
@@ -684,7 +685,8 @@ fd_gui_printf_tile_timers( fd_gui_t *                   gui,
                                   + prev[ i ].processing_prefrag_ticks
                                   + prev[ i ].backpressure_prefrag_ticks
                                   + prev[ i ].caughtup_postfrag_ticks
-                                  + prev[ i ].processing_postfrag_ticks);
+                                  + prev[ i ].processing_postfrag_ticks
+                                  + prev[ i ].sleeping_ticks);
 
     double idle;
     if( FD_UNLIKELY( cur_total==prev_total ) ) {
diff --git a/src/disco/gui/fd_gui_tile.seccomppolicy b/src/disco/gui/fd_gui_tile.seccomppolicy
index 9b1186782da..28a04f01536 100644
--- a/src/disco/gui/fd_gui_tile.seccomppolicy
+++ b/src/disco/gui/fd_gui_tile.seccomppolicy
@@ -64,6 +64,20 @@ close: (not (or (eq (arg 0) 2)
                 (eq (arg 0) gui_socket_fd)))
 
 # server: serving pages over HTTP requires polling connections
-#
-# arg 2 is the timeout.
 poll: (eq (arg 2) 0)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/metrics/fd_metric_tile.c b/src/disco/metrics/fd_metric_tile.c
index f4df88a5fd8..ec317297434 100644
--- a/src/disco/metrics/fd_metric_tile.c
+++ b/src/disco/metrics/fd_metric_tile.c
@@ -163,6 +163,7 @@ populate_allowed_fds( fd_topo_t const *      topo,
 
 #define STEM_BURST (1UL)
 #define STEM_LAZY ((long)10e6) /* 10ms */
+#define STEM_IDLE_SLEEP_ENABLED (0)
 
 #define STEM_CALLBACK_CONTEXT_TYPE  fd_metric_ctx_t
 #define STEM_CALLBACK_CONTEXT_ALIGN alignof(fd_metric_ctx_t)
diff --git a/src/disco/metrics/metrics.xml b/src/disco/metrics/metrics.xml
index 7997eb311fe..0c1a36e05d9 100644
--- a/src/disco/metrics/metrics.xml
+++ b/src/disco/metrics/metrics.xml
@@ -37,6 +37,8 @@ metric introduced.
 
     <int value="6" name="CaughtUpPostfrag" label="Caught up + Postfrag" />
     <int value="7" name="ProcessingPostfrag" label="Processing + Postfrag" />
+
+    <int value="8" name="Sleeping" label="Sleeping" />
 </enum>
 
 <common>
diff --git a/src/disco/net/sock/sock.seccomppolicy b/src/disco/net/sock/sock.seccomppolicy
index c3a9afb7dd8..5f2d87363c7 100644
--- a/src/disco/net/sock/sock.seccomppolicy
+++ b/src/disco/net/sock/sock.seccomppolicy
@@ -32,3 +32,19 @@ write: (or (eq (arg 0) 2)
 # arg 0 is the file descriptor to fsync.  The boot process ensures that
 # descriptor 3 is always the logfile.
 fsync: (eq (arg 0) logfile_fd)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/net/xdp/xdp.seccomppolicy b/src/disco/net/xdp/xdp.seccomppolicy
index e4622dc1394..8120b8fc1a7 100644
--- a/src/disco/net/xdp/xdp.seccomppolicy
+++ b/src/disco/net/xdp/xdp.seccomppolicy
@@ -67,3 +67,19 @@ getsockopt: (and (or (eq (arg 0) xsk_fd)
                      (eq (arg 0) lo_xsk_fd))
                  (eq (arg 1) SOL_XDP)
                  (eq (arg 2) XDP_STATISTICS))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/netlink/fd_netlink_tile.c b/src/disco/netlink/fd_netlink_tile.c
index c765a0fbbc1..5f0d578fc07 100644
--- a/src/disco/netlink/fd_netlink_tile.c
+++ b/src/disco/netlink/fd_netlink_tile.c
@@ -414,6 +414,7 @@ after_frag( fd_netlink_tile_ctx_t * ctx,
 
 #define STEM_BURST (1UL)
 #define STEM_LAZY ((ulong)13e6) /* 13ms */
+#define STEM_IDLE_SLEEP_ENABLED 0
 
 #define STEM_CALLBACK_CONTEXT_TYPE  fd_netlink_tile_ctx_t
 #define STEM_CALLBACK_CONTEXT_ALIGN alignof(fd_netlink_tile_ctx_t)
diff --git a/src/disco/pack/fd_pack_tile.seccomppolicy b/src/disco/pack/fd_pack_tile.seccomppolicy
index efb7dec4f42..e7062f56515 100644
--- a/src/disco/pack/fd_pack_tile.seccomppolicy
+++ b/src/disco/pack/fd_pack_tile.seccomppolicy
@@ -16,3 +16,19 @@ write: (or (eq (arg 0) 2)
 #
 # arg 0 is the file descriptor to fsync.
 fsync: (eq (arg 0) logfile_fd)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/plugin/fd_plugin_tile.seccomppolicy b/src/disco/plugin/fd_plugin_tile.seccomppolicy
index a5880d7c085..adcf27ca3f1 100644
--- a/src/disco/plugin/fd_plugin_tile.seccomppolicy
+++ b/src/disco/plugin/fd_plugin_tile.seccomppolicy
@@ -16,3 +16,19 @@ write: (or (eq (arg 0) 2)
 #
 # arg 0 is the file descriptor to fsync.
 fsync: (eq (arg 0) logfile_fd)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/quic/quic.seccomppolicy b/src/disco/quic/quic.seccomppolicy
index 2f1a9d90ddc..0c4eaa7dd53 100644
--- a/src/disco/quic/quic.seccomppolicy
+++ b/src/disco/quic/quic.seccomppolicy
@@ -20,3 +20,19 @@ fsync: (eq (arg 0) logfile_fd)
 
 # QUIC uses getrandom for cryptographically secure randomness.
 getrandom
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/quic/test_quic_metrics.txt b/src/disco/quic/test_quic_metrics.txt
index 76627b5dc82..86bdfa27e1e 100644
--- a/src/disco/quic/test_quic_metrics.txt
+++ b/src/disco/quic/test_quic_metrics.txt
@@ -1,75 +1,76 @@
 # HELP quic_txns_overrun Count of txns overrun before reassembled (too small txn_reassembly_count).
 # TYPE quic_txns_overrun counter
-quic_txns_overrun{kind="quic",kind_id="0"} 16
+quic_txns_overrun{kind="quic",kind_id="0"} 17
 
 # HELP quic_txn_reasms_started Count of fragmented txn receive ops started.
 # TYPE quic_txn_reasms_started counter
-quic_txn_reasms_started{kind="quic",kind_id="0"} 17
+quic_txn_reasms_started{kind="quic",kind_id="0"} 18
 
 # HELP quic_txn_reasms_active Number of fragmented txn receive ops currently active.
 # TYPE quic_txn_reasms_active gauge
-quic_txn_reasms_active{kind="quic",kind_id="0"} 18
+quic_txn_reasms_active{kind="quic",kind_id="0"} 19
 
 # HELP quic_frags_ok Count of txn frags received
 # TYPE quic_frags_ok counter
-quic_frags_ok{kind="quic",kind_id="0"} 19
+quic_frags_ok{kind="quic",kind_id="0"} 20
 
 # HELP quic_frags_gap Count of txn frags dropped due to data gap
 # TYPE quic_frags_gap counter
-quic_frags_gap{kind="quic",kind_id="0"} 20
+quic_frags_gap{kind="quic",kind_id="0"} 21
 
 # HELP quic_frags_dup Count of txn frags dropped due to dup (stream already completed)
 # TYPE quic_frags_dup counter
-quic_frags_dup{kind="quic",kind_id="0"} 21
+quic_frags_dup{kind="quic",kind_id="0"} 22
 
 # HELP quic_txns_received Count of txns received via TPU.
 # TYPE quic_txns_received counter
-quic_txns_received{kind="quic",kind_id="0",tpu_recv_type="udp"} 22
-quic_txns_received{kind="quic",kind_id="0",tpu_recv_type="quic_fast"} 23
-quic_txns_received{kind="quic",kind_id="0",tpu_recv_type="quic_frag"} 24
+quic_txns_received{kind="quic",kind_id="0",tpu_recv_type="udp"} 23
+quic_txns_received{kind="quic",kind_id="0",tpu_recv_type="quic_fast"} 24
+quic_txns_received{kind="quic",kind_id="0",tpu_recv_type="quic_frag"} 25
 
 # HELP quic_txns_abandoned Count of txns abandoned because a conn was lost.
 # TYPE quic_txns_abandoned counter
-quic_txns_abandoned{kind="quic",kind_id="0"} 25
+quic_txns_abandoned{kind="quic",kind_id="0"} 26
 
 # HELP quic_txn_undersz Count of txns received via QUIC dropped because they were too small.
 # TYPE quic_txn_undersz counter
-quic_txn_undersz{kind="quic",kind_id="0"} 26
+quic_txn_undersz{kind="quic",kind_id="0"} 27
 
 # HELP quic_txn_oversz Count of txns received via QUIC dropped because they were too large.
 # TYPE quic_txn_oversz counter
-quic_txn_oversz{kind="quic",kind_id="0"} 27
+quic_txn_oversz{kind="quic",kind_id="0"} 28
 
 # HELP quic_legacy_txn_undersz Count of packets received on the non-QUIC port that were too small to be a valid IP packet.
 # TYPE quic_legacy_txn_undersz counter
-quic_legacy_txn_undersz{kind="quic",kind_id="0"} 28
+quic_legacy_txn_undersz{kind="quic",kind_id="0"} 29
 
 # HELP quic_legacy_txn_oversz Count of packets received on the non-QUIC port that were too large to be a valid transaction.
 # TYPE quic_legacy_txn_oversz counter
-quic_legacy_txn_oversz{kind="quic",kind_id="0"} 29
+quic_legacy_txn_oversz{kind="quic",kind_id="0"} 30
 
 # HELP quic_received_packets Number of IP packets received.
 # TYPE quic_received_packets counter
-quic_received_packets{kind="quic",kind_id="0"} 30
+quic_received_packets{kind="quic",kind_id="0"} 31
 
 # HELP quic_received_bytes Total bytes received (including IP, UDP, QUIC headers).
 # TYPE quic_received_bytes counter
-quic_received_bytes{kind="quic",kind_id="0"} 31
+quic_received_bytes{kind="quic",kind_id="0"} 32
 
 # HELP quic_sent_packets Number of IP packets sent.
 # TYPE quic_sent_packets counter
-quic_sent_packets{kind="quic",kind_id="0"} 32
+quic_sent_packets{kind="quic",kind_id="0"} 33
 
 # HELP quic_sent_bytes Total bytes sent (including IP, UDP, QUIC headers).
 # TYPE quic_sent_bytes counter
-quic_sent_bytes{kind="quic",kind_id="0"} 33
+quic_sent_bytes{kind="quic",kind_id="0"} 34
 
 # HELP quic_connections_alloc The number of currently allocated QUIC connections.
 # TYPE quic_connections_alloc gauge
-quic_connections_alloc{kind="quic",kind_id="0"} 34
+quic_connections_alloc{kind="quic",kind_id="0"} 35
 
 # HELP quic_connections_state The number of QUIC connections in each state.
 # TYPE quic_connections_state gauge
+<<<<<<< HEAD
 quic_connections_state{kind="quic",kind_id="0",quic_conn_state="invalid"} 35
 quic_connections_state{kind="quic",kind_id="0",quic_conn_state="handshake"} 36
 quic_connections_state{kind="quic",kind_id="0",quic_conn_state="handshake_complete"} 37
@@ -263,3 +264,207 @@ quic_retry_sent{kind="quic",kind_id="0"} 137
 # HELP quic_pkt_retransmissions Number of QUIC packets that retransmitted.
 # TYPE quic_pkt_retransmissions counter
 quic_pkt_retransmissions{kind="quic",kind_id="0"} 138
+=======
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="invalid"} 36
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="handshake"} 37
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="handshake_complete"} 38
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="active"} 39
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="peer_close"} 40
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="abort"} 41
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="close_pending"} 42
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="dead"} 43
+quic_connections_state{kind="quic",kind_id="0",quic_conn_state="timeout"} 44
+
+# HELP quic_connections_created The total number of connections that have been created.
+# TYPE quic_connections_created counter
+quic_connections_created{kind="quic",kind_id="0"} 45
+
+# HELP quic_connections_closed Number of connections gracefully closed.
+# TYPE quic_connections_closed counter
+quic_connections_closed{kind="quic",kind_id="0"} 46
+
+# HELP quic_connections_aborted Number of connections aborted.
+# TYPE quic_connections_aborted counter
+quic_connections_aborted{kind="quic",kind_id="0"} 47
+
+# HELP quic_connections_timed_out Number of connections timed out.
+# TYPE quic_connections_timed_out counter
+quic_connections_timed_out{kind="quic",kind_id="0"} 48
+
+# HELP quic_connections_timeout_revived Number of connections revived after timing out.
+# TYPE quic_connections_timeout_revived counter
+quic_connections_timeout_revived{kind="quic",kind_id="0"} 49
+
+# HELP quic_connections_timeout_freed Number of connections freed after timing out.
+# TYPE quic_connections_timeout_freed counter
+quic_connections_timeout_freed{kind="quic",kind_id="0"} 50
+
+# HELP quic_connections_retried Number of connections established with retry.
+# TYPE quic_connections_retried counter
+quic_connections_retried{kind="quic",kind_id="0"} 51
+
+# HELP quic_connection_error_no_slots Number of connections that failed to create due to lack of slots.
+# TYPE quic_connection_error_no_slots counter
+quic_connection_error_no_slots{kind="quic",kind_id="0"} 52
+
+# HELP quic_connection_error_retry_fail Number of connections that failed during retry (e.g. invalid token).
+# TYPE quic_connection_error_retry_fail counter
+quic_connection_error_retry_fail{kind="quic",kind_id="0"} 53
+
+# HELP quic_pkt_no_conn Number of packets with an unknown connection ID.
+# TYPE quic_pkt_no_conn counter
+quic_pkt_no_conn{kind="quic",kind_id="0"} 54
+
+# HELP quic_frame_tx_alloc Results of attempts to acquire QUIC frame metadata.
+# TYPE quic_frame_tx_alloc counter
+quic_frame_tx_alloc{kind="quic",kind_id="0",frame_tx_alloc_result="success"} 55
+quic_frame_tx_alloc{kind="quic",kind_id="0",frame_tx_alloc_result="fail_empty_pool"} 56
+quic_frame_tx_alloc{kind="quic",kind_id="0",frame_tx_alloc_result="fail_conn_max"} 57
+
+# HELP quic_initial_token_len Number of Initial packets grouped by token length.
+# TYPE quic_initial_token_len counter
+quic_initial_token_len{kind="quic",kind_id="0",quic_initial_token_len="zero"} 58
+quic_initial_token_len{kind="quic",kind_id="0",quic_initial_token_len="fd_quic_len"} 59
+quic_initial_token_len{kind="quic",kind_id="0",quic_initial_token_len="invalid_len"} 60
+
+# HELP quic_handshakes_created Number of handshake flows created.
+# TYPE quic_handshakes_created counter
+quic_handshakes_created{kind="quic",kind_id="0"} 61
+
+# HELP quic_handshake_error_alloc_fail Number of handshakes dropped due to alloc fail.
+# TYPE quic_handshake_error_alloc_fail counter
+quic_handshake_error_alloc_fail{kind="quic",kind_id="0"} 62
+
+# HELP quic_handshake_evicted Number of handshakes dropped due to eviction.
+# TYPE quic_handshake_evicted counter
+quic_handshake_evicted{kind="quic",kind_id="0"} 63
+
+# HELP quic_stream_received_events Number of stream RX events.
+# TYPE quic_stream_received_events counter
+quic_stream_received_events{kind="quic",kind_id="0"} 64
+
+# HELP quic_stream_received_bytes Total stream payload bytes received.
+# TYPE quic_stream_received_bytes counter
+quic_stream_received_bytes{kind="quic",kind_id="0"} 65
+
+# HELP quic_received_frames Number of QUIC frames received.
+# TYPE quic_received_frames counter
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="unknown"} 66
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="ack"} 67
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="reset_stream"} 68
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="stop_sending"} 69
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="crypto"} 70
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="new_token"} 71
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="stream"} 72
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="max_data"} 73
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="max_stream_data"} 74
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="max_streams"} 75
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="data_blocked"} 76
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="stream_data_blocked"} 77
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="streams_blocked"} 78
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="new_conn_id"} 79
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="retire_conn_id"} 80
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="path_challenge"} 81
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="path_response"} 82
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="conn_close_quic"} 83
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="conn_close_app"} 84
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="handshake_done"} 85
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="ping"} 86
+quic_received_frames{kind="quic",kind_id="0",quic_frame_type="padding"} 87
+
+# HELP quic_ack_tx ACK events
+# TYPE quic_ack_tx counter
+quic_ack_tx{kind="quic",kind_id="0",quic_ack_tx="noop"} 88
+quic_ack_tx{kind="quic",kind_id="0",quic_ack_tx="new"} 89
+quic_ack_tx{kind="quic",kind_id="0",quic_ack_tx="merged"} 90
+quic_ack_tx{kind="quic",kind_id="0",quic_ack_tx="drop"} 91
+quic_ack_tx{kind="quic",kind_id="0",quic_ack_tx="cancel"} 92
+
+# HELP quic_service_duration_seconds Duration spent in service
+# TYPE quic_service_duration_seconds histogram
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="8.9999999999999995e-09"} 93
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1e-08"} 187
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="9.9999999999999995e-08"} 282
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1800000000000002e-07"} 378
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="1.0070000000000001e-06"} 475
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1839999999999999e-06"} 573
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="1.0063e-05"} 672
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1798999999999998e-05"} 772
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="0.000100479"} 873
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="0.00031749099999999999"} 975
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="0.001003196"} 1078
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="0.003169856"} 1182
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="0.010015971"} 1287
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="0.031648018999999999"} 1393
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="0.099999999000000006"} 1500
+quic_service_duration_seconds_bucket{kind="quic",kind_id="0",le="+Inf"} 1608
+quic_service_duration_seconds_sum{kind="quic",kind_id="0"} 1.09e-07
+quic_service_duration_seconds_count{kind="quic",kind_id="0"} 1608
+
+# HELP quic_receive_duration_seconds Duration spent processing packets
+# TYPE quic_receive_duration_seconds histogram
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="8.9999999999999995e-09"} 110
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1e-08"} 221
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="9.9999999999999995e-08"} 333
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1800000000000002e-07"} 446
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="1.0070000000000001e-06"} 560
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1839999999999999e-06"} 675
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="1.0063e-05"} 791
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="3.1798999999999998e-05"} 908
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="0.000100479"} 1026
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="0.00031749099999999999"} 1145
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="0.001003196"} 1265
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="0.003169856"} 1386
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="0.010015971"} 1508
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="0.031648018999999999"} 1631
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="0.099999999000000006"} 1755
+quic_receive_duration_seconds_bucket{kind="quic",kind_id="0",le="+Inf"} 1880
+quic_receive_duration_seconds_sum{kind="quic",kind_id="0"} 1.2599999999999999e-07
+quic_receive_duration_seconds_count{kind="quic",kind_id="0"} 1880
+
+# HELP quic_frame_fail_parse Number of QUIC frames failed to parse.
+# TYPE quic_frame_fail_parse counter
+quic_frame_fail_parse{kind="quic",kind_id="0"} 127
+
+# HELP quic_pkt_crypto_failed Number of packets that failed decryption.
+# TYPE quic_pkt_crypto_failed counter
+quic_pkt_crypto_failed{kind="quic",kind_id="0",quic_enc_level="initial"} 128
+quic_pkt_crypto_failed{kind="quic",kind_id="0",quic_enc_level="early"} 129
+quic_pkt_crypto_failed{kind="quic",kind_id="0",quic_enc_level="handshake"} 130
+quic_pkt_crypto_failed{kind="quic",kind_id="0",quic_enc_level="app"} 131
+
+# HELP quic_pkt_no_key Number of packets that failed decryption due to missing key.
+# TYPE quic_pkt_no_key counter
+quic_pkt_no_key{kind="quic",kind_id="0",quic_enc_level="initial"} 132
+quic_pkt_no_key{kind="quic",kind_id="0",quic_enc_level="early"} 133
+quic_pkt_no_key{kind="quic",kind_id="0",quic_enc_level="handshake"} 134
+quic_pkt_no_key{kind="quic",kind_id="0",quic_enc_level="app"} 135
+
+# HELP quic_pkt_net_header_invalid Number of packets dropped due to weird IP or UDP header.
+# TYPE quic_pkt_net_header_invalid counter
+quic_pkt_net_header_invalid{kind="quic",kind_id="0"} 136
+
+# HELP quic_pkt_quic_header_invalid Number of packets dropped due to weird QUIC header.
+# TYPE quic_pkt_quic_header_invalid counter
+quic_pkt_quic_header_invalid{kind="quic",kind_id="0"} 137
+
+# HELP quic_pkt_undersz Number of QUIC packets dropped due to being too small.
+# TYPE quic_pkt_undersz counter
+quic_pkt_undersz{kind="quic",kind_id="0"} 138
+
+# HELP quic_pkt_oversz Number of QUIC packets dropped due to being too large.
+# TYPE quic_pkt_oversz counter
+quic_pkt_oversz{kind="quic",kind_id="0"} 139
+
+# HELP quic_pkt_verneg Number of QUIC version negotiation packets received.
+# TYPE quic_pkt_verneg counter
+quic_pkt_verneg{kind="quic",kind_id="0"} 140
+
+# HELP quic_retry_sent Number of QUIC Retry packets sent.
+# TYPE quic_retry_sent counter
+quic_retry_sent{kind="quic",kind_id="0"} 141
+
+# HELP quic_pkt_retransmissions Number of QUIC packets that retransmitted.
+# TYPE quic_pkt_retransmissions counter
+quic_pkt_retransmissions{kind="quic",kind_id="0"} 142
+>>>>>>> bf98b9a50 (bz)
diff --git a/src/disco/shred/fd_shred_tile.seccomppolicy b/src/disco/shred/fd_shred_tile.seccomppolicy
index efb7dec4f42..e7062f56515 100644
--- a/src/disco/shred/fd_shred_tile.seccomppolicy
+++ b/src/disco/shred/fd_shred_tile.seccomppolicy
@@ -16,3 +16,19 @@ write: (or (eq (arg 0) 2)
 #
 # arg 0 is the file descriptor to fsync.
 fsync: (eq (arg 0) logfile_fd)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/sign/fd_sign_tile.seccomppolicy b/src/disco/sign/fd_sign_tile.seccomppolicy
index efb7dec4f42..e7062f56515 100644
--- a/src/disco/sign/fd_sign_tile.seccomppolicy
+++ b/src/disco/sign/fd_sign_tile.seccomppolicy
@@ -16,3 +16,19 @@ write: (or (eq (arg 0) 2)
 #
 # arg 0 is the file descriptor to fsync.
 fsync: (eq (arg 0) logfile_fd)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/disco/stem/fd_stem.c b/src/disco/stem/fd_stem.c
index 4bcfa0675b5..d00f7ff5721 100644
--- a/src/disco/stem/fd_stem.c
+++ b/src/disco/stem/fd_stem.c
@@ -190,6 +190,16 @@
 #define STEM_LAZY (0L)
 #endif
 
+#define STEM_SHUTDOWN_SEQ (ULONG_MAX-1UL)
+
+#ifndef STEM_IDLE_SLEEP_ENABLED
+#define STEM_IDLE_SLEEP_ENABLED (1)
+#endif
+
+#ifndef STEM_IDLE_THRESHOLD
+#define STEM_IDLE_THRESHOLD (2048UL)
+#endif
+
 static inline void
 STEM_(in_update)( fd_stem_tile_in_t * in ) {
   fd_fseq_update( in->fseq, in->seq );
@@ -239,16 +249,19 @@ STEM_(run1)( ulong                        in_cnt,
              ulong                        cons_cnt,
              ulong *                      _cons_out,
              ulong **                     _cons_fseq,
+             int                          idle_sleep,
              ulong                        burst,
              long                         lazy,
              fd_rng_t *                   rng,
+             ulong *                      leader_state,
              void *                       scratch,
              STEM_CALLBACK_CONTEXT_TYPE * ctx ) {
   /* in frag stream state */
-  ulong               in_seq; /* current position in input poll sequence, in [0,in_cnt) */
-  fd_stem_tile_in_t * in;     /* in[in_seq] for in_seq in [0,in_cnt) has information about input fragment stream currently at
-                                 position in_seq in the in_idx polling sequence.  The ordering of this array is continuously
-                                 shuffled to avoid lighthousing effects in the output fragment stream at extreme fan-in and load */
+  ulong               in_seq;        /* current position in input poll sequence, in [0,in_cnt) */
+  fd_stem_tile_in_t * in;            /* in[in_seq] for in_seq in [0,in_cnt) has information about input fragment stream currently at
+                                        position in_seq in the in_idx polling sequence.  The ordering of this array is continuously
+                                        shuffled to avoid lighthousing effects in the output fragment stream at extreme fan-in and load */
+  ulong               idle_iter_cnt; /* consecutive iterations without processing any fragments, tile can sleep when threshold is exceeded */
 
   /* out frag stream state */
   ulong *        out_depth; /* ==fd_mcache_depth( out_mcache[out_idx] ) for out_idx in [0, out_cnt) */
@@ -263,10 +276,12 @@ STEM_(run1)( ulong                        in_cnt,
   ulong *        cons_seq;     /* cons_seq [cons_idx] is the most recent observation of cons_fseq[cons_idx] */
 
   /* housekeeping state */
-  ulong    event_cnt; /* ==in_cnt+cons_cnt+1, total number of housekeeping events */
-  ulong    event_seq; /* current position in housekeeping event sequence, in [0,event_cnt) */
-  ushort * event_map; /* current mapping of event_seq to event idx, event_map[ event_seq ] is next event to process */
-  ulong    async_min; /* minimum number of ticks between processing a housekeeping event, positive integer power of 2 */
+  ulong    event_cnt;    /* ==in_cnt+cons_cnt+1, total number of housekeeping events */
+  ulong    event_seq;    /* current position in housekeeping event sequence, in [0,event_cnt) */
+  ushort * event_map;    /* current mapping of event_seq to event idx, event_map[ event_seq ] is next event to process */
+  ulong    async_min;    /* minimum number of ticks between processing a housekeeping event, positive integer power of 2 */
+  double   ticks_per_ns; /* ticks per nanosecond for timing calculations */
+  ulong    is_leader;    /* leader state flag (0/1), read from leader_state fseq; disables idle sleep when non-zero */
 
   /* performance metrics */
   ulong metric_in_backp;  /* is the run loop currently backpressured by one or more of the outs, in [0,1] */
@@ -314,6 +329,15 @@ STEM_(run1)( ulong                        in_cnt,
     this_in->accum[3] = 0U; this_in->accum[4] = 0U; this_in->accum[5] = 0U;
   }
 
+  idle_iter_cnt = 0;
+  is_leader     = 0;
+#if !STEM_IDLE_SLEEP_ENABLED
+  (void)idle_sleep;
+  (void)idle_iter_cnt;
+  (void)leader_state;
+  (void)is_leader;
+#endif
+
   /* out frag stream init */
 
   cr_avail     = (ulong *)FD_SCRATCH_ALLOC_APPEND( l, alignof(ulong), out_cnt*sizeof(ulong) );
@@ -365,7 +389,8 @@ STEM_(run1)( ulong                        in_cnt,
   for( ulong cons_idx=0UL; cons_idx<cons_cnt; cons_idx++ ) event_map[ event_seq++ ] = (ushort)cons_idx;
   event_seq = 0UL;
 
-  async_min = fd_tempo_async_min( lazy, event_cnt, (float)fd_tempo_tick_per_ns( NULL ) );
+  ticks_per_ns = fd_tempo_tick_per_ns( NULL );
+  async_min    = fd_tempo_async_min( lazy, event_cnt, (float)ticks_per_ns );
   if( FD_UNLIKELY( !async_min ) ) FD_LOG_ERR(( "bad lazy %lu %lu", (ulong)lazy, event_cnt ));
 
   FD_LOG_INFO(( "Running stem, cr_max = %lu", cr_max ));
@@ -445,6 +470,10 @@ STEM_(run1)( ulong                        in_cnt,
           }
         }
 
+#if STEM_IDLE_SLEEP_ENABLED
+        if ( FD_UNLIKELY( idle_sleep ) ) is_leader = fd_fseq_query(leader_state);
+#endif
+
 #ifdef STEM_CALLBACK_DURING_HOUSEKEEPING
         STEM_CALLBACK_DURING_HOUSEKEEPING( ctx );
 #else
@@ -489,6 +518,24 @@ STEM_(run1)( ulong                        in_cnt,
       now = next;
     }
 
+    idle_iter_cnt++;
+
+#if STEM_IDLE_SLEEP_ENABLED
+    if ( FD_UNLIKELY( idle_sleep && idle_iter_cnt>STEM_IDLE_THRESHOLD ) ) {
+      if ( FD_UNLIKELY( !is_leader ) ) {
+        long ticks_until_deadline = then - now;
+        long ns_until_deadline    = (long)((double)ticks_until_deadline / ticks_per_ns);
+        fd_log_sleep( ns_until_deadline );
+
+        metric_regime_ticks[0] += housekeeping_ticks;
+        housekeeping_ticks      = 0;
+        long next = fd_tickcount();
+        metric_regime_ticks[8] += (ulong)(next - now);
+        now = next;
+      } else idle_iter_cnt = 0;
+    }
+#endif
+
 #if defined(STEM_CALLBACK_BEFORE_CREDIT) || defined(STEM_CALLBACK_AFTER_CREDIT) || defined(STEM_CALLBACK_AFTER_FRAG) || defined(STEM_CALLBACK_RETURNABLE_FRAG)
     fd_stem_context_t stem = {
       .mcaches             = out_mcache,
@@ -548,6 +595,7 @@ STEM_(run1)( ulong                        in_cnt,
       if( FD_UNLIKELY( was_busy ) ) metric_regime_ticks[3] += (ulong)(next - now);
       else                          metric_regime_ticks[6] += (ulong)(next - now);
       now = next;
+      if( FD_UNLIKELY( was_busy ) ) idle_iter_cnt = 0;
       continue;
     }
 
@@ -564,6 +612,7 @@ STEM_(run1)( ulong                        in_cnt,
       long prefrag_next = fd_tickcount();
       prefrag_ticks = (ulong)(prefrag_next - now);
       now = prefrag_next;
+      idle_iter_cnt = 0;
     }
 #endif
 
@@ -694,6 +743,7 @@ STEM_(run1)( ulong                        in_cnt,
 #endif
 
     /* Windup for the next in poll and accumulate diagnostics */
+    idle_iter_cnt  = 0;
 
     this_in_seq    = fd_seq_inc( this_in_seq, 1UL );
     this_in->seq   = this_in_seq;
@@ -757,6 +807,16 @@ STEM_(run)( fd_topo_t *      topo,
   fd_rng_t rng[1];
   FD_TEST( fd_rng_join( fd_rng_new( rng, 0, 0UL ) ) );
 
+  ulong * leader_state = NULL;
+#if STEM_IDLE_SLEEP_ENABLED
+  if( FD_UNLIKELY( tile->idle_sleep ) ) {
+    ulong leader_state_obj_id = fd_pod_query_ulong( topo->props, "leader_state", ULONG_MAX );
+    FD_TEST( leader_state_obj_id!=ULONG_MAX );
+    leader_state = fd_fseq_join( fd_topo_obj_laddr(topo, leader_state_obj_id) );
+    FD_TEST( leader_state );
+  }
+#endif
+
   STEM_CALLBACK_CONTEXT_TYPE * ctx = (STEM_CALLBACK_CONTEXT_TYPE*)fd_ulong_align_up( (ulong)fd_topo_obj_laddr( topo, tile->tile_obj_id ), STEM_CALLBACK_CONTEXT_ALIGN );
 
   STEM_(run1)( polled_in_cnt,
@@ -767,9 +827,11 @@ STEM_(run)( fd_topo_t *      topo,
                reliable_cons_cnt,
                cons_out,
                cons_fseq,
+               tile->idle_sleep,
                STEM_BURST,
                STEM_LAZY,
                rng,
+               leader_state,
                fd_alloca( FD_STEM_SCRATCH_ALIGN, STEM_(scratch_footprint)( polled_in_cnt, tile->out_cnt, reliable_cons_cnt ) ),
                ctx );
 
diff --git a/src/disco/stem/fd_stem.h b/src/disco/stem/fd_stem.h
index d8e9777fab8..2d57e883a75 100644
--- a/src/disco/stem/fd_stem.h
+++ b/src/disco/stem/fd_stem.h
@@ -2,6 +2,7 @@
 #define HEADER_fd_src_disco_stem_fd_stem_h
 
 #include "../fd_disco_base.h"
+#include "../../util/pod/fd_pod.h"
 
 #define FD_STEM_SCRATCH_ALIGN (128UL)
 
diff --git a/src/disco/topo/fd_topo.h b/src/disco/topo/fd_topo.h
index 900f5529c51..2b0a720efc0 100644
--- a/src/disco/topo/fd_topo.h
+++ b/src/disco/topo/fd_topo.h
@@ -121,6 +121,7 @@ struct fd_topo_tile {
   ulong kind_id;                /* The ID of this tile within its name.  If there are n tile of a particular name, they have IDs [0, N).  The pair (name, kind_id) uniquely identifies a tile, as does "id" on its own. */
   int   is_agave;               /* If the tile needs to run in the Agave (Anza) address space or not. */
   int   allow_shutdown;         /* If the tile is allowed to shutdown gracefully.  If false, when the tile exits it will tear down the entire application. */
+  int   idle_sleep;             /* If the tile should sleep when idle. */
 
   ulong cpu_idx;                /* The CPU index to pin the tile on.  A value of ULONG_MAX or more indicates the tile should be floating and not pinned to a core. */
 
@@ -522,6 +523,8 @@ struct fd_topo {
 
   ulong          max_page_size; /* 2^21 or 2^30 */
   ulong          gigantic_page_threshold; /* see [hugetlbfs.gigantic_page_threshold_mib]*/
+
+  int            low_power_mode;
 };
 typedef struct fd_topo fd_topo_t;
 
diff --git a/src/disco/topo/fd_topob.c b/src/disco/topo/fd_topob.c
index 11a122a5b3e..4c33028b087 100644
--- a/src/disco/topo/fd_topob.c
+++ b/src/disco/topo/fd_topob.c
@@ -142,6 +142,7 @@ fd_topob_tile( fd_topo_t *    topo,
   tile->id                  = topo->tile_cnt;
   tile->kind_id             = kind_id;
   tile->is_agave            = is_agave;
+  tile->idle_sleep          = topo->low_power_mode;
   tile->cpu_idx             = cpu_idx;
   tile->in_cnt              = 0UL;
   tile->out_cnt             = 0UL;
@@ -340,11 +341,17 @@ fd_topob_auto_layout( fd_topo_t * topo,
      tiles to CPU cores in NUMA sequential order, except for a few tiles
      which should be floating. */
 
+  fd_topo_cpus_t cpus[1];
+  fd_topo_cpus_init( cpus );
+
   char const * FLOATING[] = {
     "netlnk",
     "metric",
     "cswtch",
     "bencho",
+    "plugin",
+    "gui",
+    "store"
   };
 
   char const * ORDERED[] = {
@@ -391,29 +398,26 @@ fd_topob_auto_layout( fd_topo_t * topo,
     tile->cpu_idx = ULONG_MAX;
   }
 
-  fd_topo_cpus_t cpus[1];
-  fd_topo_cpus_init( cpus );
-
   ulong cpu_ordering[ FD_TILE_MAX ] = { 0UL };
-  int   pairs_assigned[ FD_TILE_MAX ] = { 0 };
+  // int   pairs_assigned[ FD_TILE_MAX ] = { 0 };
 
   ulong next_cpu_idx   = 0UL;
   for( ulong i=0UL; i<cpus->numa_node_cnt; i++ ) {
     for( ulong j=0UL; j<cpus->cpu_cnt; j++ ) {
-      fd_topo_cpu_t * cpu = &cpus->cpu[ j ];
+      // fd_topo_cpu_t * cpu = &cpus->cpu[ j ];
 
-      if( FD_UNLIKELY( pairs_assigned[ j ] || cpu->numa_node!=i ) ) continue;
+      // if( FD_UNLIKELY( pairs_assigned[ j ] || cpu->numa_node!=i ) ) continue;
 
       FD_TEST( next_cpu_idx<FD_TILE_MAX );
       cpu_ordering[ next_cpu_idx++ ] = j;
 
-      if( FD_UNLIKELY( cpu->sibling!=ULONG_MAX ) ) {
-        /* If the CPU has a HT pair, place it immediately after so they
-           are sequentially assigned. */
-        FD_TEST( next_cpu_idx<FD_TILE_MAX );
-        cpu_ordering[ next_cpu_idx++ ] = cpu->sibling;
-        pairs_assigned[ cpu->sibling ] = 1;
-      }
+      // if( FD_UNLIKELY( cpu->sibling!=ULONG_MAX ) ) {
+      //   /* If the CPU has a HT pair, place it immediately after so they
+      //      are sequentially assigned. */
+      //   FD_TEST( next_cpu_idx<FD_TILE_MAX );
+      //   cpu_ordering[ next_cpu_idx++ ] = cpu->sibling;
+      //   pairs_assigned[ cpu->sibling ] = 1;
+      // }
     }
   }
 
@@ -484,8 +488,9 @@ fd_topob_auto_layout( fd_topo_t * topo,
   }
 
   if( FD_UNLIKELY( reserve_agave_cores ) ) {
-    for( ulong i=cpu_idx; i<cpus->cpu_cnt; i++ ) {
+    for( ulong i=1UL; i<cpus->cpu_cnt; i++ ) {
       if( FD_UNLIKELY( !cpus->cpu[ cpu_ordering[ i ] ].online ) ) continue;
+      if( FD_UNLIKELY( cpu_assigned[ cpu_ordering[ i ] ] ) ) continue;
 
       if( FD_LIKELY( topo->agave_affinity_cnt<sizeof(topo->agave_affinity_cpu_idx)/sizeof(topo->agave_affinity_cpu_idx[0]) ) ) {
         topo->agave_affinity_cpu_idx[ topo->agave_affinity_cnt++ ] = cpu_ordering[ i ];
diff --git a/src/disco/verify/fd_verify_tile.seccomppolicy b/src/disco/verify/fd_verify_tile.seccomppolicy
index efb7dec4f42..e7062f56515 100644
--- a/src/disco/verify/fd_verify_tile.seccomppolicy
+++ b/src/disco/verify/fd_verify_tile.seccomppolicy
@@ -16,3 +16,19 @@ write: (or (eq (arg 0) 2)
 #
 # arg 0 is the file descriptor to fsync.
 fsync: (eq (arg 0) logfile_fd)
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls clock_nanosleep; glibc's nanosleep uses the
+# clock_nanosleep syscall. arg 0 is the clock (CLOCK_REALTIME),
+# arg 1 is flags (0), arg2 is requested time, arg3 is remainder pointer.
+clock_nanosleep: (and (eq (arg 0) CLOCK_REALTIME)
+                      (eq (arg 1) 0))
+
+# low_power_mode: stem calls fd_log_sleep to reduce CPU usage when
+#                 the tile is idle. Can be enabled by configuration.
+#
+# fd_log_sleep calls sched_yield depending on the amount of time.
+# This syscall takes no arguments.
+sched_yield
diff --git a/src/discoh/poh/fd_poh_tile.c b/src/discoh/poh/fd_poh_tile.c
index 304965ac8ab..7eb08a64ff4 100644
--- a/src/discoh/poh/fd_poh_tile.c
+++ b/src/discoh/poh/fd_poh_tile.c
@@ -528,6 +528,12 @@ typedef struct {
      so that they can resume the replay stage if it was suspended waiting. */
   void * signal_leader_change;
 
+  /* Leader fseq for low power mode. When non-NULL, the PoH tile updates
+     this fseq to 1 when it becomes leader and to 0 when it stops being
+     leader. When leader, all tiles busy spin regardless of low-power settings
+     to ensure peak performance when leader. */
+  ulong * leader_state;
+
   /* These are temporarily set in during_frag so they can be used in
      after_frag once the frag has been validated as not overrun. */
   uchar _txns[ USHORT_MAX ];
@@ -1764,6 +1770,15 @@ during_housekeeping( fd_poh_ctx_t * ctx ) {
     FD_COMPILER_MFENCE();
     fd_ext_poh_signal_leader_change( ctx->signal_leader_change );
   }
+
+  if ( FD_UNLIKELY( ctx->leader_state ) ) {
+    ulong is_leader = ctx->slot+1UL>=ctx->next_leader_slot;
+    ulong current   = fd_fseq_query( ctx->leader_state );
+    if ( FD_UNLIKELY( current!=is_leader) ) {
+      fd_fseq_update( ctx->leader_state, is_leader );
+      FD_LOG_WARNING(( "fd_poh_leader_state_changed, is_leader=%lu, current=%lu, slot=%lu, next_leader_slot=%lu", is_leader, current, ctx->slot, ctx->next_leader_slot ));
+    }
+  }
 }
 
 static inline void
@@ -2230,6 +2245,7 @@ unprivileged_init( fd_topo_t *      topo,
   ctx->sha256   = NONNULL( fd_sha256_join( fd_sha256_new( sha256 ) ) );
   ctx->current_leader_bank = NULL;
   ctx->signal_leader_change = NULL;
+  ctx->leader_state = NULL;
 
   ctx->shred_seq = ULONG_MAX;
   ctx->halted_switching_key = 0;
@@ -2268,6 +2284,14 @@ unprivileged_init( fd_topo_t *      topo,
   fd_shred_version = fd_fseq_join( fd_topo_obj_laddr( topo, poh_shred_obj_id ) );
   FD_TEST( fd_shred_version );
 
+  if( FD_UNLIKELY( tile->idle_sleep ) ) {
+    ulong leader_state_obj_id = fd_pod_query_ulong( topo->props, "leader_state", ULONG_MAX );
+    FD_TEST( leader_state_obj_id!=ULONG_MAX );
+    ctx->leader_state = fd_fseq_join( fd_topo_obj_laddr(topo, leader_state_obj_id) );
+    FD_TEST( ctx->leader_state );
+    fd_fseq_update( ctx->leader_state, 0UL );
+  }
+
   poh_link_init( &gossip_dedup,          topo, tile, out1( topo, tile, "gossip_dedup" ).idx );
   poh_link_init( &stake_out,             topo, tile, out1( topo, tile, "stake_out"    ).idx );
   poh_link_init( &crds_shred,            topo, tile, out1( topo, tile, "crds_shred"   ).idx );
diff --git a/src/util/log/fd_log.c b/src/util/log/fd_log.c
index d13bbe900c8..be02c243711 100644
--- a/src/util/log/fd_log.c
+++ b/src/util/log/fd_log.c
@@ -31,7 +31,6 @@
 #include <unistd.h>
 #include <signal.h>
 #include <sched.h>
-#include <time.h>
 #if defined(__linux__)
 #include <syscall.h>
 #endif
diff --git a/src/util/log/fd_log.h b/src/util/log/fd_log.h
index 479e0f18299..a97f5778d47 100644
--- a/src/util/log/fd_log.h
+++ b/src/util/log/fd_log.h
@@ -142,6 +142,7 @@
 
 #include "../env/fd_env.h"
 #include "../io/fd_io.h"
+#include <time.h>
 
 /* FD_LOG_NOTICE(( ... printf style arguments ... )) will send a message
    at the NOTICE level to the logger.  E.g. for a typical fd_log
`


  return { filePath, body }
}

export default modDiff
