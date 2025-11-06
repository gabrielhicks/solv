const modDiff = () => {
  const filePath = '/home/solv/firedancer/mod.diff'
  const body = String.raw`diff --git a/book/api/metrics-generated.md b/book/api/metrics-generated.md
index a0c631ee9f..048b118660 100644
--- a/book/api/metrics-generated.md
+++ b/book/api/metrics-generated.md
@@ -40,6 +40,7 @@
 | <span class="metrics-name">tile_&#8203;regime_&#8203;duration_&#8203;nanos</span><br/>{tile_&#8203;regime="<span class="metrics-enum">backpressure_&#8203;prefrag</span>"} | counter | Mutually exclusive and exhaustive duration of time the tile spent in each of the regimes. (Backpressure + Prefrag) |
 | <span class="metrics-name">tile_&#8203;regime_&#8203;duration_&#8203;nanos</span><br/>{tile_&#8203;regime="<span class="metrics-enum">caught_&#8203;up_&#8203;postfrag</span>"} | counter | Mutually exclusive and exhaustive duration of time the tile spent in each of the regimes. (Caught up + Postfrag) |
 | <span class="metrics-name">tile_&#8203;regime_&#8203;duration_&#8203;nanos</span><br/>{tile_&#8203;regime="<span class="metrics-enum">processing_&#8203;postfrag</span>"} | counter | Mutually exclusive and exhaustive duration of time the tile spent in each of the regimes. (Processing + Postfrag) |
+| <span class="metrics-name">tile_&#8203;regime_&#8203;duration_&#8203;nanos</span><br/>{tile_&#8203;regime="<span class="metrics-enum">sleeping</span>"} | counter | Mutually exclusive and exhaustive duration of time the tile spent in each of the regimes. (Sleeping) |
 
 </div>
 
diff --git a/src/app/fdctl/commands/run_agave.c b/src/app/fdctl/commands/run_agave.c
index 1cfd98e148..e2a347164c 100644
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
index 9c3c5ed0a9..475f4958f7 100644
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
index 64b7782437..3598a9a580 100644
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
diff --git a/src/app/firedancer/topology.c b/src/app/firedancer/topology.c
index f8918eaceb..54ea76d24f 100644
--- a/src/app/firedancer/topology.c
+++ b/src/app/firedancer/topology.c
@@ -232,6 +232,7 @@ fd_topo_initialize( config_t * config ) {
   fd_topo_t * topo = { fd_topob_new( &config->topo, config->name ) };
   topo->max_page_size = fd_cstr_to_shmem_page_sz( config->hugetlbfs.max_page_size );
   topo->gigantic_page_threshold = config->hugetlbfs.gigantic_page_threshold_mib << 20;
+  topo->low_power_mode = config->layout.low_power_mode;
 
   /*             topo, name */
   fd_topob_wksp( topo, "metric_in"  );
@@ -445,7 +446,7 @@ fd_topo_initialize( config_t * config ) {
   /**/                             fd_topob_tile( topo, "sign",    "sign",    "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,        1 );
   /**/                             fd_topob_tile( topo, "metric",  "metric",  "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,        0 );
   fd_topo_tile_t * pack_tile =     fd_topob_tile( topo, "pack",    "pack",    "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,        0 );
-  /**/                             fd_topob_tile( topo, "poh",     "poh",     "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,          1 );
+  /**/                             fd_topob_tile( topo, "poh",     "poh",     "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,        1 );
   /**/                             fd_topob_tile( topo, "gossip",  "gossip",  "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,        0 );
   fd_topo_tile_t * repair_tile =   fd_topob_tile( topo, "repair",  "repair",  "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,        0 );
   /**/                             fd_topob_tile( topo, "send",    "send",    "metric_in",  tile_to_cpu[ topo->tile_cnt ], 0,        0 );
diff --git a/src/app/shared/commands/monitor/generated/monitor_seccomp.h b/src/app/shared/commands/monitor/generated/monitor_seccomp.h
index c374b8cf95..eb7a17dcf4 100644
--- a/src/app/shared/commands/monitor/generated/monitor_seccomp.h
+++ b/src/app/shared/commands/monitor/generated/monitor_seccomp.h
@@ -21,75 +21,83 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_monitor_instr_cnt = 36;
+static const unsigned int sock_filter_policy_monitor_instr_cnt = 40;
 
 static void populate_sock_filter_policy_monitor( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd, unsigned int drain_output_fd) {
-  FD_TEST( out_cnt >= 36 );
-  struct sock_filter filter[36] = {
+  FD_TEST( out_cnt >= 40 );
+  struct sock_filter filter[40] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 32 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 36 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
     BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 8, 0 ),
     /* allow fsync based on expression */
     BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 13, 0 ),
-    /* simply allow nanosleep */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_nanosleep, /* RET_ALLOW */ 29, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 14, 0 ),
     /* simply allow sched_yield */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 28, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 32, 0 ),
     /* simply allow exit_group */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_exit_group, /* RET_ALLOW */ 27, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_exit_group, /* RET_ALLOW */ 31, 0 ),
     /* allow read based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_read, /* check_read */ 11, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_read, /* check_read */ 15, 0 ),
     /* allow ioctl based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_ioctl, /* check_ioctl */ 14, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_ioctl, /* check_ioctl */ 18, 0 ),
     /* allow pselect6 based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_pselect6, /* check_pselect6 */ 19, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_pselect6, /* check_pselect6 */ 23, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 22 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 26 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 1, /* RET_ALLOW */ 21, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 1, /* RET_ALLOW */ 25, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 19, /* lbl_2 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 23, /* lbl_2 */ 0 ),
 //  lbl_2:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 17, /* RET_KILL_PROCESS */ 16 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 21, /* RET_KILL_PROCESS */ 20 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 15, /* RET_KILL_PROCESS */ 14 ),
-//  check_read:
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 19, /* RET_KILL_PROCESS */ 18 ),
+//  check_clock_nanosleep:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, drain_output_fd, /* RET_ALLOW */ 13, /* lbl_3 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_3 */ 0, /* RET_KILL_PROCESS */ 16 ),
 //  lbl_3:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 15, /* RET_KILL_PROCESS */ 14 ),
+//  check_read:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, drain_output_fd, /* RET_ALLOW */ 13, /* lbl_4 */ 0 ),
+//  lbl_4:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
     BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 11, /* RET_KILL_PROCESS */ 10 ),
 //  check_ioctl:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_4 */ 0, /* RET_KILL_PROCESS */ 8 ),
-//  lbl_4:
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_5 */ 0, /* RET_KILL_PROCESS */ 8 ),
+//  lbl_5:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, TCGETS, /* RET_ALLOW */ 7, /* lbl_5 */ 0 ),
-//  lbl_5:
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, TCGETS, /* RET_ALLOW */ 7, /* lbl_6 */ 0 ),
+//  lbl_6:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
     BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, TCSETS, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
 //  check_pselect6:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 1, /* lbl_6 */ 0, /* RET_KILL_PROCESS */ 2 ),
-//  lbl_6:
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 1, /* lbl_7 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_7:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
     BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
diff --git a/src/app/shared/commands/monitor/monitor.c b/src/app/shared/commands/monitor/monitor.c
index 790befe9c8..7c646562e3 100644
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
index 0054eefaf1..2984e700c0 100644
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
index 5741245751..f6b34830e6 100644
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
index 3cdf8e4082..9124448e31 100644
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
index 347a9a5fd2..47cb549bce 100644
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
index 2ebdf45367..0afb7022de 100644
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
index a8463e4423..cd570bd345 100644
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
diff --git a/src/disco/bundle/fd_bundle_tile.seccomppolicy b/src/disco/bundle/fd_bundle_tile.seccomppolicy
index 645e63a964..13e8a87312 100644
--- a/src/disco/bundle/fd_bundle_tile.seccomppolicy
+++ b/src/disco/bundle/fd_bundle_tile.seccomppolicy
@@ -119,3 +119,19 @@ lseek: (and (or (eq (arg 0) etc_resolv_conf)
                 (eq (arg 0) etc_hosts_fd))
             (eq (arg 1) 0)
             (eq (arg 2) "SEEK_SET"))
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
diff --git a/src/disco/bundle/generated/fd_bundle_tile_seccomp.h b/src/disco/bundle/generated/fd_bundle_tile_seccomp.h
index a4459a5b31..8261274a81 100644
--- a/src/disco/bundle/generated/fd_bundle_tile_seccomp.h
+++ b/src/disco/bundle/generated/fd_bundle_tile_seccomp.h
@@ -21,92 +21,96 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_bundle_tile_instr_cnt = 95;
+static const unsigned int sock_filter_policy_fd_bundle_tile_instr_cnt = 101;
 
 static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct sock_filter * out, uint logfile_fd, uint keylog_fd, uint etc_hosts_fd, uint etc_resolv_conf) {
-  FD_TEST( out_cnt >= 95 );
-  struct sock_filter filter[95] = {
+  FD_TEST( out_cnt >= 101 );
+  struct sock_filter filter[101] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 91 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 97 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* simply allow read */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_read, /* RET_ALLOW */ 90, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_read, /* RET_ALLOW */ 96, 0 ),
     /* allow recvmsg based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_recvmsg, /* check_recvmsg */ 18, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_recvmsg, /* check_recvmsg */ 20, 0 ),
     /* simply allow write */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* RET_ALLOW */ 88, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* RET_ALLOW */ 94, 0 ),
     /* allow writev based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_writev, /* check_writev */ 20, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_writev, /* check_writev */ 22, 0 ),
     /* allow sendmsg based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendmsg, /* check_sendmsg */ 23, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendmsg, /* check_sendmsg */ 25, 0 ),
     /* allow sendto based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendto, /* check_sendto */ 28, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendto, /* check_sendto */ 30, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 29, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 31, 0 ),
     /* allow socket based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_socket, /* check_socket */ 30, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_socket, /* check_socket */ 32, 0 ),
     /* simply allow connect */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_connect, /* RET_ALLOW */ 82, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_connect, /* RET_ALLOW */ 88, 0 ),
     /* allow shutdown based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_shutdown, /* check_shutdown */ 46, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_shutdown, /* check_shutdown */ 48, 0 ),
     /* simply allow close */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_close, /* RET_ALLOW */ 80, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_close, /* RET_ALLOW */ 86, 0 ),
     /* allow fcntl based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fcntl, /* check_fcntl */ 46, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fcntl, /* check_fcntl */ 48, 0 ),
     /* allow bind based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_bind, /* check_bind */ 49, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_bind, /* check_bind */ 51, 0 ),
     /* simply allow poll */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_poll, /* RET_ALLOW */ 77, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_poll, /* RET_ALLOW */ 83, 0 ),
     /* allow setsockopt based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_setsockopt, /* check_setsockopt */ 51, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_setsockopt, /* check_setsockopt */ 53, 0 ),
     /* simply allow getsockname */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getsockname, /* RET_ALLOW */ 75, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getsockname, /* RET_ALLOW */ 81, 0 ),
     /* simply allow getpid */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getpid, /* RET_ALLOW */ 74, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getpid, /* RET_ALLOW */ 80, 0 ),
     /* simply allow getrandom */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getrandom, /* RET_ALLOW */ 73, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getrandom, /* RET_ALLOW */ 79, 0 ),
     /* allow lseek based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_lseek, /* check_lseek */ 63, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_lseek, /* check_lseek */ 65, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 72, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 76, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 70 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 74 },
 //  check_recvmsg:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL|MSG_DONTWAIT, /* RET_ALLOW */ 69, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL|MSG_DONTWAIT, /* RET_ALLOW */ 73, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 67, /* RET_KILL_PROCESS */ 66 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 71, /* RET_KILL_PROCESS */ 70 ),
 //  check_writev:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, keylog_fd, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 64 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, keylog_fd, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 68 ),
 //  lbl_2:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 63, /* RET_KILL_PROCESS */ 62 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 67, /* RET_KILL_PROCESS */ 66 ),
 //  check_sendmsg:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL|MSG_DONTWAIT, /* RET_ALLOW */ 61, /* lbl_3 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL|MSG_DONTWAIT, /* RET_ALLOW */ 65, /* lbl_3 */ 0 ),
 //  lbl_3:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_FASTOPEN|MSG_NOSIGNAL, /* RET_ALLOW */ 59, /* lbl_4 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_FASTOPEN|MSG_NOSIGNAL, /* RET_ALLOW */ 63, /* lbl_4 */ 0 ),
 //  lbl_4:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL, /* RET_ALLOW */ 57, /* RET_KILL_PROCESS */ 56 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL, /* RET_ALLOW */ 61, /* RET_KILL_PROCESS */ 60 ),
 //  check_sendto:
     /* load syscall argument 3 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[3])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL, /* RET_ALLOW */ 55, /* RET_KILL_PROCESS */ 54 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_NOSIGNAL, /* RET_ALLOW */ 59, /* RET_KILL_PROCESS */ 58 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 53, /* RET_KILL_PROCESS */ 52 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 57, /* RET_KILL_PROCESS */ 56 ),
 //  check_socket:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
@@ -114,7 +118,7 @@ static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct so
 //  lbl_6:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, AF_INET6, /* lbl_5 */ 0, /* RET_KILL_PROCESS */ 48 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, AF_INET6, /* lbl_5 */ 0, /* RET_KILL_PROCESS */ 52 ),
 //  lbl_5:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
@@ -126,7 +130,7 @@ static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct so
 //  lbl_8:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 43, /* lbl_7 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 47, /* lbl_7 */ 0 ),
 //  lbl_7:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
@@ -134,35 +138,35 @@ static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct so
 //  lbl_11:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 39, /* lbl_10 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 43, /* lbl_10 */ 0 ),
 //  lbl_10:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SOCK_DGRAM|SOCK_CLOEXEC, /* lbl_12 */ 0, /* RET_KILL_PROCESS */ 36 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SOCK_DGRAM|SOCK_CLOEXEC, /* lbl_12 */ 0, /* RET_KILL_PROCESS */ 40 ),
 //  lbl_12:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, IPPROTO_UDP, /* RET_ALLOW */ 35, /* RET_KILL_PROCESS */ 34 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, IPPROTO_UDP, /* RET_ALLOW */ 39, /* RET_KILL_PROCESS */ 38 ),
 //  check_shutdown:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SHUT_WR, /* RET_ALLOW */ 33, /* RET_KILL_PROCESS */ 32 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SHUT_WR, /* RET_ALLOW */ 37, /* RET_KILL_PROCESS */ 36 ),
 //  check_fcntl:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, F_SETFL, /* lbl_13 */ 0, /* RET_KILL_PROCESS */ 30 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, F_SETFL, /* lbl_13 */ 0, /* RET_KILL_PROCESS */ 34 ),
 //  lbl_13:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, O_NONBLOCK, /* RET_ALLOW */ 29, /* RET_KILL_PROCESS */ 28 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, O_NONBLOCK, /* RET_ALLOW */ 33, /* RET_KILL_PROCESS */ 32 ),
 //  check_bind:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, sizeof(struct sockaddr_in), /* RET_ALLOW */ 27, /* lbl_14 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, sizeof(struct sockaddr_in), /* RET_ALLOW */ 31, /* lbl_14 */ 0 ),
 //  lbl_14:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, sizeof(struct sockaddr_in6), /* RET_ALLOW */ 25, /* RET_KILL_PROCESS */ 24 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, sizeof(struct sockaddr_in6), /* RET_ALLOW */ 29, /* RET_KILL_PROCESS */ 28 ),
 //  check_setsockopt:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
@@ -170,7 +174,7 @@ static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct so
 //  lbl_16:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SO_RCVBUF, /* RET_ALLOW */ 21, /* lbl_15 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SO_RCVBUF, /* RET_ALLOW */ 25, /* lbl_15 */ 0 ),
 //  lbl_15:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
@@ -178,7 +182,7 @@ static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct so
 //  lbl_18:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, TCP_NODELAY, /* RET_ALLOW */ 17, /* lbl_17 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, TCP_NODELAY, /* RET_ALLOW */ 21, /* lbl_17 */ 0 ),
 //  lbl_17:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
@@ -186,15 +190,15 @@ static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct so
 //  lbl_20:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, TCP_FASTOPEN_CONNECT, /* RET_ALLOW */ 13, /* lbl_19 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, TCP_FASTOPEN_CONNECT, /* RET_ALLOW */ 17, /* lbl_19 */ 0 ),
 //  lbl_19:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, IPPROTO_IPV6, /* lbl_21 */ 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, IPPROTO_IPV6, /* lbl_21 */ 0, /* RET_KILL_PROCESS */ 14 ),
 //  lbl_21:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, IPV6_V6ONLY, /* RET_ALLOW */ 9, /* RET_KILL_PROCESS */ 8 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, IPV6_V6ONLY, /* RET_ALLOW */ 13, /* RET_KILL_PROCESS */ 12 ),
 //  check_lseek:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
@@ -202,15 +206,23 @@ static void populate_sock_filter_policy_fd_bundle_tile( ulong out_cnt, struct so
 //  lbl_23:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, etc_hosts_fd, /* lbl_22 */ 0, /* RET_KILL_PROCESS */ 4 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, etc_hosts_fd, /* lbl_22 */ 0, /* RET_KILL_PROCESS */ 8 ),
 //  lbl_22:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_24 */ 0, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_24 */ 0, /* RET_KILL_PROCESS */ 6 ),
 //  lbl_24:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SEEK_SET, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SEEK_SET, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_25 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_25:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/cswtch/fd_cswtch_tile.c b/src/disco/cswtch/fd_cswtch_tile.c
index 6332d01594..af9b2bec5f 100644
--- a/src/disco/cswtch/fd_cswtch_tile.c
+++ b/src/disco/cswtch/fd_cswtch_tile.c
@@ -228,6 +228,7 @@ populate_allowed_fds( fd_topo_t const *      topo,
 
 #define STEM_BURST (1UL)
 #define STEM_LAZY  ((long)10e6) /* 10ms */
+#define STEM_IDLE_SLEEP_ENABLED (0)
 
 #define STEM_CALLBACK_CONTEXT_TYPE  fd_cswtch_ctx_t
 #define STEM_CALLBACK_CONTEXT_ALIGN alignof(fd_cswtch_ctx_t)
diff --git a/src/disco/dedup/fd_dedup_tile.seccomppolicy b/src/disco/dedup/fd_dedup_tile.seccomppolicy
index a5880d7c08..adcf27ca3f 100644
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
diff --git a/src/disco/dedup/generated/fd_dedup_tile_seccomp.h b/src/disco/dedup/generated/fd_dedup_tile_seccomp.h
index 164375a06d..4073dee8b7 100644
--- a/src/disco/dedup/generated/fd_dedup_tile_seccomp.h
+++ b/src/disco/dedup/generated/fd_dedup_tile_seccomp.h
@@ -21,34 +21,46 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_dedup_tile_instr_cnt = 14;
+static const unsigned int sock_filter_policy_fd_dedup_tile_instr_cnt = 20;
 
 static void populate_sock_filter_policy_fd_dedup_tile( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd) {
-  FD_TEST( out_cnt >= 14 );
-  struct sock_filter filter[14] = {
+  FD_TEST( out_cnt >= 20 );
+  struct sock_filter filter[20] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 16 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 2, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 4, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 7, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 8, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 12, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 6 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 10 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 5, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 9, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_2:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/gui/fd_gui.c b/src/disco/gui/fd_gui.c
index 7a493dd5b0..11ff0207ca 100644
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
index 948b0050d3..4f6a8aeba2 100644
--- a/src/disco/gui/fd_gui.h
+++ b/src/disco/gui/fd_gui.h
@@ -155,6 +155,7 @@ struct fd_gui_tile_timers {
 
   ulong caughtup_postfrag_ticks;
   ulong processing_postfrag_ticks;
+  ulong sleeping_ticks;
 };
 
 typedef struct fd_gui_tile_timers fd_gui_tile_timers_t;
diff --git a/src/disco/gui/fd_gui_printf.c b/src/disco/gui/fd_gui_printf.c
index ec2e9f30fd..5f40aaee19 100644
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
index 9b1186782d..28a04f0153 100644
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
diff --git a/src/disco/gui/generated/fd_gui_tile_seccomp.h b/src/disco/gui/generated/fd_gui_tile_seccomp.h
index 096e69a69e..75b0a79209 100644
--- a/src/disco/gui/generated/fd_gui_tile_seccomp.h
+++ b/src/disco/gui/generated/fd_gui_tile_seccomp.h
@@ -21,99 +21,111 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_gui_tile_instr_cnt = 47;
+static const unsigned int sock_filter_policy_fd_gui_tile_instr_cnt = 53;
 
 static void populate_sock_filter_policy_fd_gui_tile( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd, unsigned int gui_socket_fd) {
-  FD_TEST( out_cnt >= 47 );
-  struct sock_filter filter[47] = {
+  FD_TEST( out_cnt >= 53 );
+  struct sock_filter filter[53] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 43 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 49 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 7, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 9, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 10, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 12, 0 ),
     /* allow accept4 based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_accept4, /* check_accept4 */ 11, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_accept4, /* check_accept4 */ 13, 0 ),
     /* allow read based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_read, /* check_read */ 18, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_read, /* check_read */ 20, 0 ),
     /* allow sendto based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendto, /* check_sendto */ 23, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendto, /* check_sendto */ 25, 0 ),
     /* allow close based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_close, /* check_close */ 28, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_close, /* check_close */ 30, 0 ),
     /* allow poll based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_poll, /* check_poll */ 33, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_poll, /* check_poll */ 35, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 36, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 40, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 34 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 38 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 33, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 37, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 31, /* RET_KILL_PROCESS */ 30 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 35, /* RET_KILL_PROCESS */ 34 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 29, /* RET_KILL_PROCESS */ 28 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 33, /* RET_KILL_PROCESS */ 32 ),
 //  check_accept4:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 26 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 30 ),
 //  lbl_2:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_3 */ 0, /* RET_KILL_PROCESS */ 24 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_3 */ 0, /* RET_KILL_PROCESS */ 28 ),
 //  lbl_3:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_4 */ 0, /* RET_KILL_PROCESS */ 22 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_4 */ 0, /* RET_KILL_PROCESS */ 26 ),
 //  lbl_4:
     /* load syscall argument 3 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[3])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SOCK_CLOEXEC|SOCK_NONBLOCK, /* RET_ALLOW */ 21, /* RET_KILL_PROCESS */ 20 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SOCK_CLOEXEC|SOCK_NONBLOCK, /* RET_ALLOW */ 25, /* RET_KILL_PROCESS */ 24 ),
 //  check_read:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_KILL_PROCESS */ 18, /* lbl_5 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_KILL_PROCESS */ 22, /* lbl_5 */ 0 ),
 //  lbl_5:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_KILL_PROCESS */ 16, /* lbl_6 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_KILL_PROCESS */ 20, /* lbl_6 */ 0 ),
 //  lbl_6:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* RET_KILL_PROCESS */ 14, /* RET_ALLOW */ 15 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* RET_KILL_PROCESS */ 18, /* RET_ALLOW */ 19 ),
 //  check_sendto:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_KILL_PROCESS */ 12, /* lbl_7 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_KILL_PROCESS */ 16, /* lbl_7 */ 0 ),
 //  lbl_7:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_KILL_PROCESS */ 10, /* lbl_8 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_KILL_PROCESS */ 14, /* lbl_8 */ 0 ),
 //  lbl_8:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* RET_KILL_PROCESS */ 8, /* RET_ALLOW */ 9 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* RET_KILL_PROCESS */ 12, /* RET_ALLOW */ 13 ),
 //  check_close:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_KILL_PROCESS */ 6, /* lbl_9 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_KILL_PROCESS */ 10, /* lbl_9 */ 0 ),
 //  lbl_9:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_KILL_PROCESS */ 4, /* lbl_10 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_KILL_PROCESS */ 8, /* lbl_10 */ 0 ),
 //  lbl_10:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* RET_KILL_PROCESS */ 2, /* RET_ALLOW */ 3 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, gui_socket_fd, /* RET_KILL_PROCESS */ 6, /* RET_ALLOW */ 7 ),
 //  check_poll:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_11 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_11:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
     BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
diff --git a/src/disco/metrics/fd_metric_tile.c b/src/disco/metrics/fd_metric_tile.c
index f4df88a5fd..ec31729743 100644
--- a/src/disco/metrics/fd_metric_tile.c
+++ b/src/disco/metrics/fd_metric_tile.c
@@ -163,6 +163,7 @@ populate_allowed_fds( fd_topo_t const *      topo,
 
 #define STEM_BURST (1UL)
 #define STEM_LAZY ((long)10e6) /* 10ms */
+#define STEM_IDLE_SLEEP_ENABLED (0)
 
 #define STEM_CALLBACK_CONTEXT_TYPE  fd_metric_ctx_t
 #define STEM_CALLBACK_CONTEXT_ALIGN alignof(fd_metric_ctx_t)
diff --git a/src/disco/metrics/generated/fd_metrics_all.c b/src/disco/metrics/generated/fd_metrics_all.c
index 739137b449..ea0d1bfa7b 100644
--- a/src/disco/metrics/generated/fd_metrics_all.c
+++ b/src/disco/metrics/generated/fd_metrics_all.c
@@ -18,6 +18,7 @@ const fd_metrics_meta_t FD_METRICS_ALL[FD_METRICS_ALL_TOTAL] = {
     DECLARE_METRIC_ENUM( TILE_REGIME_DURATION_NANOS, COUNTER, TILE_REGIME, BACKPRESSURE_PREFRAG ),
     DECLARE_METRIC_ENUM( TILE_REGIME_DURATION_NANOS, COUNTER, TILE_REGIME, CAUGHT_UP_POSTFRAG ),
     DECLARE_METRIC_ENUM( TILE_REGIME_DURATION_NANOS, COUNTER, TILE_REGIME, PROCESSING_POSTFRAG ),
+    DECLARE_METRIC_ENUM( TILE_REGIME_DURATION_NANOS, COUNTER, TILE_REGIME, SLEEPING ),
 };
 
 const fd_metrics_meta_t FD_METRICS_ALL_LINK_IN[FD_METRICS_ALL_LINK_IN_TOTAL] = {
diff --git a/src/disco/metrics/generated/fd_metrics_all.h b/src/disco/metrics/generated/fd_metrics_all.h
index c51d94ed88..e383fd384d 100644
--- a/src/disco/metrics/generated/fd_metrics_all.h
+++ b/src/disco/metrics/generated/fd_metrics_all.h
@@ -137,7 +137,7 @@
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_DESC "Mutually exclusive and exhaustive duration of time the tile spent in each of the regimes."
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_CVT  (FD_METRICS_CONVERTER_NANOSECONDS)
-#define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_CNT  (8UL)
+#define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_CNT  (9UL)
 
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_CAUGHT_UP_HOUSEKEEPING_OFF (8UL)
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_PROCESSING_HOUSEKEEPING_OFF (9UL)
@@ -147,9 +147,10 @@
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_BACKPRESSURE_PREFRAG_OFF (13UL)
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_CAUGHT_UP_POSTFRAG_OFF (14UL)
 #define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_PROCESSING_POSTFRAG_OFF (15UL)
+#define FD_METRICS_COUNTER_TILE_REGIME_DURATION_NANOS_SLEEPING_OFF (16UL)
 
 
-#define FD_METRICS_ALL_TOTAL (16UL)
+#define FD_METRICS_ALL_TOTAL (17UL)
 extern const fd_metrics_meta_t FD_METRICS_ALL[FD_METRICS_ALL_TOTAL];
 
 #define FD_METRICS_ALL_LINK_IN_TOTAL (8UL)
@@ -158,7 +159,7 @@ extern const fd_metrics_meta_t FD_METRICS_ALL_LINK_IN[FD_METRICS_ALL_LINK_IN_TOT
 #define FD_METRICS_ALL_LINK_OUT_TOTAL (1UL)
 extern const fd_metrics_meta_t FD_METRICS_ALL_LINK_OUT[FD_METRICS_ALL_LINK_OUT_TOTAL];
 
-#define FD_METRICS_TOTAL_SZ (8UL*253UL)
+#define FD_METRICS_TOTAL_SZ (8UL*254UL)
 
 #define FD_METRICS_TILE_KIND_CNT 22
 extern const char * FD_METRICS_TILE_KIND_NAMES[FD_METRICS_TILE_KIND_CNT];
diff --git a/src/disco/metrics/generated/fd_metrics_bank.h b/src/disco/metrics/generated/fd_metrics_bank.h
index bb0bbe1681..535f71a27b 100644
--- a/src/disco/metrics/generated/fd_metrics_bank.h
+++ b/src/disco/metrics/generated/fd_metrics_bank.h
@@ -3,117 +3,117 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_SANITIZE_FAILURE_OFF  (16UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_SANITIZE_FAILURE_OFF  (17UL)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_SANITIZE_FAILURE_NAME "bank_transaction_sanitize_failure"
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_SANITIZE_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_SANITIZE_FAILURE_DESC "Number of transactions that failed to sanitize."
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_SANITIZE_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_NOT_EXECUTED_FAILURE_OFF  (17UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_NOT_EXECUTED_FAILURE_OFF  (18UL)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_NOT_EXECUTED_FAILURE_NAME "bank_transaction_not_executed_failure"
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_NOT_EXECUTED_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_NOT_EXECUTED_FAILURE_DESC "Number of transactions that did not execute. This is different than transactions which fail to execute, which make it onto the chain."
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_NOT_EXECUTED_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_OFF  (18UL)
+#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_OFF  (19UL)
 #define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_NAME "bank_slot_acquire"
 #define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_DESC "Result of acquiring a slot."
 #define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_SUCCESS_OFF (18UL)
-#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_TOO_HIGH_OFF (19UL)
-#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_TOO_LOW_OFF (20UL)
+#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_SUCCESS_OFF (19UL)
+#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_TOO_HIGH_OFF (20UL)
+#define FD_METRICS_COUNTER_BANK_SLOT_ACQUIRE_TOO_LOW_OFF (21UL)
 
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_OFF  (21UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_OFF  (22UL)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_NAME "bank_transaction_load_address_tables"
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_DESC "Result of loading address lookup tables for a transaction. If there are multiple errors for the transaction, only the first one is reported."
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_CNT  (6UL)
 
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_SUCCESS_OFF (21UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_SLOT_HASHES_SYSVAR_NOT_FOUND_OFF (22UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_ACCOUNT_NOT_FOUND_OFF (23UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_INVALID_ACCOUNT_OWNER_OFF (24UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_INVALID_ACCOUNT_DATA_OFF (25UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_INVALID_INDEX_OFF (26UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_SUCCESS_OFF (22UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_SLOT_HASHES_SYSVAR_NOT_FOUND_OFF (23UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_ACCOUNT_NOT_FOUND_OFF (24UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_INVALID_ACCOUNT_OWNER_OFF (25UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_INVALID_ACCOUNT_DATA_OFF (26UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_LOAD_ADDRESS_TABLES_INVALID_INDEX_OFF (27UL)
 
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_OFF  (27UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_OFF  (28UL)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_NAME "bank_transaction_result"
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_DESC "Result of loading and executing a transaction."
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_CNT  (41UL)
 
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_SUCCESS_OFF (27UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_IN_USE_OFF (28UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_LOADED_TWICE_OFF (29UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_NOT_FOUND_OFF (30UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_PROGRAM_ACCOUNT_NOT_FOUND_OFF (31UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INSUFFICIENT_FUNDS_FOR_FEE_OFF (32UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ACCOUNT_FOR_FEE_OFF (33UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ALREADY_PROCESSED_OFF (34UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_BLOCKHASH_NOT_FOUND_OFF (35UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INSTRUCTION_ERROR_OFF (36UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_CALL_CHAIN_TOO_DEEP_OFF (37UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_MISSING_SIGNATURE_FOR_FEE_OFF (38UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ACCOUNT_INDEX_OFF (39UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_SIGNATURE_FAILURE_OFF (40UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_PROGRAM_FOR_EXECUTION_OFF (41UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_SANITIZE_FAILURE_OFF (42UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_CLUSTER_MAINTENANCE_OFF (43UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_BORROW_OUTSTANDING_OFF (44UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_MAX_BLOCK_COST_LIMIT_OFF (45UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_UNSUPPORTED_VERSION_OFF (46UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_WRITABLE_ACCOUNT_OFF (47UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_MAX_ACCOUNT_COST_LIMIT_OFF (48UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_ACCOUNT_DATA_BLOCK_LIMIT_OFF (49UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_TOO_MANY_ACCOUNT_LOCKS_OFF (50UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ADDRESS_LOOKUP_TABLE_NOT_FOUND_OFF (51UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ADDRESS_LOOKUP_TABLE_OWNER_OFF (52UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ADDRESS_LOOKUP_TABLE_DATA_OFF (53UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ADDRESS_LOOKUP_TABLE_INDEX_OFF (54UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_RENT_PAYING_ACCOUNT_OFF (55UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_MAX_VOTE_COST_LIMIT_OFF (56UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_ACCOUNT_DATA_TOTAL_LIMIT_OFF (57UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_DUPLICATE_INSTRUCTION_OFF (58UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INSUFFICIENT_FUNDS_FOR_RENT_OFF (59UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_MAX_LOADED_ACCOUNTS_DATA_SIZE_EXCEEDED_OFF (60UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_OFF (61UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_RESANITIZATION_NEEDED_OFF (62UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_PROGRAM_EXECUTION_TEMPORARILY_RESTRICTED_OFF (63UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_UNBALANCED_TRANSACTION_OFF (64UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_PROGRAM_CACHE_HIT_MAX_LIMIT_OFF (65UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_COMMIT_CANCELLED_OFF (66UL)
-#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_BUNDLE_PEER_OFF (67UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_SUCCESS_OFF (28UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_IN_USE_OFF (29UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_LOADED_TWICE_OFF (30UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_NOT_FOUND_OFF (31UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_PROGRAM_ACCOUNT_NOT_FOUND_OFF (32UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INSUFFICIENT_FUNDS_FOR_FEE_OFF (33UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ACCOUNT_FOR_FEE_OFF (34UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ALREADY_PROCESSED_OFF (35UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_BLOCKHASH_NOT_FOUND_OFF (36UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INSTRUCTION_ERROR_OFF (37UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_CALL_CHAIN_TOO_DEEP_OFF (38UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_MISSING_SIGNATURE_FOR_FEE_OFF (39UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ACCOUNT_INDEX_OFF (40UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_SIGNATURE_FAILURE_OFF (41UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_PROGRAM_FOR_EXECUTION_OFF (42UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_SANITIZE_FAILURE_OFF (43UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_CLUSTER_MAINTENANCE_OFF (44UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ACCOUNT_BORROW_OUTSTANDING_OFF (45UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_MAX_BLOCK_COST_LIMIT_OFF (46UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_UNSUPPORTED_VERSION_OFF (47UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_WRITABLE_ACCOUNT_OFF (48UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_MAX_ACCOUNT_COST_LIMIT_OFF (49UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_ACCOUNT_DATA_BLOCK_LIMIT_OFF (50UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_TOO_MANY_ACCOUNT_LOCKS_OFF (51UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_ADDRESS_LOOKUP_TABLE_NOT_FOUND_OFF (52UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ADDRESS_LOOKUP_TABLE_OWNER_OFF (53UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ADDRESS_LOOKUP_TABLE_DATA_OFF (54UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_ADDRESS_LOOKUP_TABLE_INDEX_OFF (55UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_RENT_PAYING_ACCOUNT_OFF (56UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_MAX_VOTE_COST_LIMIT_OFF (57UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_WOULD_EXCEED_ACCOUNT_DATA_TOTAL_LIMIT_OFF (58UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_DUPLICATE_INSTRUCTION_OFF (59UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INSUFFICIENT_FUNDS_FOR_RENT_OFF (60UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_MAX_LOADED_ACCOUNTS_DATA_SIZE_EXCEEDED_OFF (61UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_INVALID_LOADED_ACCOUNTS_DATA_SIZE_LIMIT_OFF (62UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_RESANITIZATION_NEEDED_OFF (63UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_PROGRAM_EXECUTION_TEMPORARILY_RESTRICTED_OFF (64UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_UNBALANCED_TRANSACTION_OFF (65UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_PROGRAM_CACHE_HIT_MAX_LIMIT_OFF (66UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_COMMIT_CANCELLED_OFF (67UL)
+#define FD_METRICS_COUNTER_BANK_TRANSACTION_RESULT_BUNDLE_PEER_OFF (68UL)
 
-#define FD_METRICS_COUNTER_BANK_PROCESSING_FAILED_OFF  (68UL)
+#define FD_METRICS_COUNTER_BANK_PROCESSING_FAILED_OFF  (69UL)
 #define FD_METRICS_COUNTER_BANK_PROCESSING_FAILED_NAME "bank_processing_failed"
 #define FD_METRICS_COUNTER_BANK_PROCESSING_FAILED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_PROCESSING_FAILED_DESC "Count of transactions for which the processing stage failed and won't land on chain"
 #define FD_METRICS_COUNTER_BANK_PROCESSING_FAILED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BANK_FEE_ONLY_TRANSACTIONS_OFF  (69UL)
+#define FD_METRICS_COUNTER_BANK_FEE_ONLY_TRANSACTIONS_OFF  (70UL)
 #define FD_METRICS_COUNTER_BANK_FEE_ONLY_TRANSACTIONS_NAME "bank_fee_only_transactions"
 #define FD_METRICS_COUNTER_BANK_FEE_ONLY_TRANSACTIONS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_FEE_ONLY_TRANSACTIONS_DESC "Count of transactions that will land on chain but without executing"
 #define FD_METRICS_COUNTER_BANK_FEE_ONLY_TRANSACTIONS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BANK_EXECUTED_FAILED_TRANSACTIONS_OFF  (70UL)
+#define FD_METRICS_COUNTER_BANK_EXECUTED_FAILED_TRANSACTIONS_OFF  (71UL)
 #define FD_METRICS_COUNTER_BANK_EXECUTED_FAILED_TRANSACTIONS_NAME "bank_executed_failed_transactions"
 #define FD_METRICS_COUNTER_BANK_EXECUTED_FAILED_TRANSACTIONS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_EXECUTED_FAILED_TRANSACTIONS_DESC "Count of transactions that execute on chain but failed"
 #define FD_METRICS_COUNTER_BANK_EXECUTED_FAILED_TRANSACTIONS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BANK_SUCCESSFUL_TRANSACTIONS_OFF  (71UL)
+#define FD_METRICS_COUNTER_BANK_SUCCESSFUL_TRANSACTIONS_OFF  (72UL)
 #define FD_METRICS_COUNTER_BANK_SUCCESSFUL_TRANSACTIONS_NAME "bank_successful_transactions"
 #define FD_METRICS_COUNTER_BANK_SUCCESSFUL_TRANSACTIONS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_SUCCESSFUL_TRANSACTIONS_DESC "Count of transactions that execute on chain and succeed"
 #define FD_METRICS_COUNTER_BANK_SUCCESSFUL_TRANSACTIONS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BANK_COST_MODEL_UNDERCOUNT_OFF  (72UL)
+#define FD_METRICS_COUNTER_BANK_COST_MODEL_UNDERCOUNT_OFF  (73UL)
 #define FD_METRICS_COUNTER_BANK_COST_MODEL_UNDERCOUNT_NAME "bank_cost_model_undercount"
 #define FD_METRICS_COUNTER_BANK_COST_MODEL_UNDERCOUNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BANK_COST_MODEL_UNDERCOUNT_DESC "Count of transactions that used more CUs than the cost model should have permitted them to"
diff --git a/src/disco/metrics/generated/fd_metrics_bundle.h b/src/disco/metrics/generated/fd_metrics_bundle.h
index 66e45eb899..92f585d7cf 100644
--- a/src/disco/metrics/generated/fd_metrics_bundle.h
+++ b/src/disco/metrics/generated/fd_metrics_bundle.h
@@ -3,86 +3,86 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_BUNDLE_TRANSACTION_RECEIVED_OFF  (16UL)
+#define FD_METRICS_COUNTER_BUNDLE_TRANSACTION_RECEIVED_OFF  (17UL)
 #define FD_METRICS_COUNTER_BUNDLE_TRANSACTION_RECEIVED_NAME "bundle_transaction_received"
 #define FD_METRICS_COUNTER_BUNDLE_TRANSACTION_RECEIVED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BUNDLE_TRANSACTION_RECEIVED_DESC "Total count of transactions received, including transactions within bundles"
 #define FD_METRICS_COUNTER_BUNDLE_TRANSACTION_RECEIVED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BUNDLE_PACKET_RECEIVED_OFF  (17UL)
+#define FD_METRICS_COUNTER_BUNDLE_PACKET_RECEIVED_OFF  (18UL)
 #define FD_METRICS_COUNTER_BUNDLE_PACKET_RECEIVED_NAME "bundle_packet_received"
 #define FD_METRICS_COUNTER_BUNDLE_PACKET_RECEIVED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BUNDLE_PACKET_RECEIVED_DESC "Total count of packets received"
 #define FD_METRICS_COUNTER_BUNDLE_PACKET_RECEIVED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BUNDLE_BUNDLE_RECEIVED_OFF  (18UL)
+#define FD_METRICS_COUNTER_BUNDLE_BUNDLE_RECEIVED_OFF  (19UL)
 #define FD_METRICS_COUNTER_BUNDLE_BUNDLE_RECEIVED_NAME "bundle_bundle_received"
 #define FD_METRICS_COUNTER_BUNDLE_BUNDLE_RECEIVED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BUNDLE_BUNDLE_RECEIVED_DESC "Total count of bundles received"
 #define FD_METRICS_COUNTER_BUNDLE_BUNDLE_RECEIVED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BUNDLE_ERRORS_OFF  (19UL)
+#define FD_METRICS_COUNTER_BUNDLE_ERRORS_OFF  (20UL)
 #define FD_METRICS_COUNTER_BUNDLE_ERRORS_NAME "bundle_errors"
 #define FD_METRICS_COUNTER_BUNDLE_ERRORS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BUNDLE_ERRORS_DESC "Number of gRPC errors encountered"
 #define FD_METRICS_COUNTER_BUNDLE_ERRORS_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_BUNDLE_ERRORS_CNT  (5UL)
 
-#define FD_METRICS_COUNTER_BUNDLE_ERRORS_PROTOBUF_OFF (19UL)
-#define FD_METRICS_COUNTER_BUNDLE_ERRORS_TRANSPORT_OFF (20UL)
-#define FD_METRICS_COUNTER_BUNDLE_ERRORS_TIMEOUT_OFF (21UL)
-#define FD_METRICS_COUNTER_BUNDLE_ERRORS_NO_FEE_INFO_OFF (22UL)
-#define FD_METRICS_COUNTER_BUNDLE_ERRORS_SSL_ALLOC_OFF (23UL)
+#define FD_METRICS_COUNTER_BUNDLE_ERRORS_PROTOBUF_OFF (20UL)
+#define FD_METRICS_COUNTER_BUNDLE_ERRORS_TRANSPORT_OFF (21UL)
+#define FD_METRICS_COUNTER_BUNDLE_ERRORS_TIMEOUT_OFF (22UL)
+#define FD_METRICS_COUNTER_BUNDLE_ERRORS_NO_FEE_INFO_OFF (23UL)
+#define FD_METRICS_COUNTER_BUNDLE_ERRORS_SSL_ALLOC_OFF (24UL)
 
-#define FD_METRICS_GAUGE_BUNDLE_HEAP_SIZE_OFF  (24UL)
+#define FD_METRICS_GAUGE_BUNDLE_HEAP_SIZE_OFF  (25UL)
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_SIZE_NAME "bundle_heap_size"
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_SIZE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_SIZE_DESC "Workspace heap size"
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_SIZE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_BUNDLE_HEAP_FREE_BYTES_OFF  (25UL)
+#define FD_METRICS_GAUGE_BUNDLE_HEAP_FREE_BYTES_OFF  (26UL)
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_FREE_BYTES_NAME "bundle_heap_free_bytes"
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_FREE_BYTES_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_FREE_BYTES_DESC "Approx free space in workspace"
 #define FD_METRICS_GAUGE_BUNDLE_HEAP_FREE_BYTES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BUNDLE_SHREDSTREAM_HEARTBEATS_OFF  (26UL)
+#define FD_METRICS_COUNTER_BUNDLE_SHREDSTREAM_HEARTBEATS_OFF  (27UL)
 #define FD_METRICS_COUNTER_BUNDLE_SHREDSTREAM_HEARTBEATS_NAME "bundle_shredstream_heartbeats"
 #define FD_METRICS_COUNTER_BUNDLE_SHREDSTREAM_HEARTBEATS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BUNDLE_SHREDSTREAM_HEARTBEATS_DESC "Number of ShredStream heartbeats successfully sent"
 #define FD_METRICS_COUNTER_BUNDLE_SHREDSTREAM_HEARTBEATS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_BUNDLE_KEEPALIVES_OFF  (27UL)
+#define FD_METRICS_COUNTER_BUNDLE_KEEPALIVES_OFF  (28UL)
 #define FD_METRICS_COUNTER_BUNDLE_KEEPALIVES_NAME "bundle_keepalives"
 #define FD_METRICS_COUNTER_BUNDLE_KEEPALIVES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_BUNDLE_KEEPALIVES_DESC "Number of HTTP/2 PINGs acknowledged by server"
 #define FD_METRICS_COUNTER_BUNDLE_KEEPALIVES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_BUNDLE_CONNECTED_OFF  (28UL)
+#define FD_METRICS_GAUGE_BUNDLE_CONNECTED_OFF  (29UL)
 #define FD_METRICS_GAUGE_BUNDLE_CONNECTED_NAME "bundle_connected"
 #define FD_METRICS_GAUGE_BUNDLE_CONNECTED_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_BUNDLE_CONNECTED_DESC "1 if connected to the bundle server, 0 if not"
 #define FD_METRICS_GAUGE_BUNDLE_CONNECTED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_BUNDLE_RTT_SAMPLE_OFF  (29UL)
+#define FD_METRICS_GAUGE_BUNDLE_RTT_SAMPLE_OFF  (30UL)
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SAMPLE_NAME "bundle_rtt_sample"
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SAMPLE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SAMPLE_DESC "Latest RTT sample at scrape time (nanoseconds)"
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SAMPLE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_BUNDLE_RTT_SMOOTHED_OFF  (30UL)
+#define FD_METRICS_GAUGE_BUNDLE_RTT_SMOOTHED_OFF  (31UL)
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SMOOTHED_NAME "bundle_rtt_smoothed"
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SMOOTHED_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SMOOTHED_DESC "RTT moving average (nanoseconds)"
 #define FD_METRICS_GAUGE_BUNDLE_RTT_SMOOTHED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_BUNDLE_RTT_VAR_OFF  (31UL)
+#define FD_METRICS_GAUGE_BUNDLE_RTT_VAR_OFF  (32UL)
 #define FD_METRICS_GAUGE_BUNDLE_RTT_VAR_NAME "bundle_rtt_var"
 #define FD_METRICS_GAUGE_BUNDLE_RTT_VAR_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_BUNDLE_RTT_VAR_DESC "RTT variance (nanoseconds)"
 #define FD_METRICS_GAUGE_BUNDLE_RTT_VAR_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_HISTOGRAM_BUNDLE_MESSAGE_RX_DELAY_NANOS_OFF  (32UL)
+#define FD_METRICS_HISTOGRAM_BUNDLE_MESSAGE_RX_DELAY_NANOS_OFF  (33UL)
 #define FD_METRICS_HISTOGRAM_BUNDLE_MESSAGE_RX_DELAY_NANOS_NAME "bundle_message_rx_delay_nanos"
 #define FD_METRICS_HISTOGRAM_BUNDLE_MESSAGE_RX_DELAY_NANOS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_BUNDLE_MESSAGE_RX_DELAY_NANOS_DESC "Message receive delay in nanoseconds from bundle server to bundle client"
diff --git a/src/disco/metrics/generated/fd_metrics_dedup.h b/src/disco/metrics/generated/fd_metrics_dedup.h
index ef7f41bd82..d5923d99d7 100644
--- a/src/disco/metrics/generated/fd_metrics_dedup.h
+++ b/src/disco/metrics/generated/fd_metrics_dedup.h
@@ -3,19 +3,19 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_DEDUP_TRANSACTION_BUNDLE_PEER_FAILURE_OFF  (16UL)
+#define FD_METRICS_COUNTER_DEDUP_TRANSACTION_BUNDLE_PEER_FAILURE_OFF  (17UL)
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_BUNDLE_PEER_FAILURE_NAME "dedup_transaction_bundle_peer_failure"
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_BUNDLE_PEER_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_BUNDLE_PEER_FAILURE_DESC "Count of transactions that failed to dedup because a peer transaction in the bundle failed"
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_BUNDLE_PEER_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_DEDUP_TRANSACTION_DEDUP_FAILURE_OFF  (17UL)
+#define FD_METRICS_COUNTER_DEDUP_TRANSACTION_DEDUP_FAILURE_OFF  (18UL)
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_DEDUP_FAILURE_NAME "dedup_transaction_dedup_failure"
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_DEDUP_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_DEDUP_FAILURE_DESC "Count of transactions that failed to deduplicate in the dedup stage"
 #define FD_METRICS_COUNTER_DEDUP_TRANSACTION_DEDUP_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_DEDUP_GOSSIPED_VOTES_RECEIVED_OFF  (18UL)
+#define FD_METRICS_COUNTER_DEDUP_GOSSIPED_VOTES_RECEIVED_OFF  (19UL)
 #define FD_METRICS_COUNTER_DEDUP_GOSSIPED_VOTES_RECEIVED_NAME "dedup_gossiped_votes_received"
 #define FD_METRICS_COUNTER_DEDUP_GOSSIPED_VOTES_RECEIVED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_DEDUP_GOSSIPED_VOTES_RECEIVED_DESC "Count of simple vote transactions received over gossip instead of via the normal TPU path"
diff --git a/src/disco/metrics/generated/fd_metrics_enums.h b/src/disco/metrics/generated/fd_metrics_enums.h
index eee5ff556d..679ade4b8d 100644
--- a/src/disco/metrics/generated/fd_metrics_enums.h
+++ b/src/disco/metrics/generated/fd_metrics_enums.h
@@ -1,7 +1,7 @@
 /* THIS FILE IS GENERATED BY gen_metrics.py. DO NOT HAND EDIT. */
 
 #define FD_METRICS_ENUM_TILE_REGIME_NAME "tile_regime"
-#define FD_METRICS_ENUM_TILE_REGIME_CNT (8UL)
+#define FD_METRICS_ENUM_TILE_REGIME_CNT (9UL)
 #define FD_METRICS_ENUM_TILE_REGIME_V_CAUGHT_UP_HOUSEKEEPING_IDX  0
 #define FD_METRICS_ENUM_TILE_REGIME_V_CAUGHT_UP_HOUSEKEEPING_NAME "caught_up_housekeeping"
 #define FD_METRICS_ENUM_TILE_REGIME_V_PROCESSING_HOUSEKEEPING_IDX  1
@@ -18,6 +18,8 @@
 #define FD_METRICS_ENUM_TILE_REGIME_V_CAUGHT_UP_POSTFRAG_NAME "caught_up_postfrag"
 #define FD_METRICS_ENUM_TILE_REGIME_V_PROCESSING_POSTFRAG_IDX  7
 #define FD_METRICS_ENUM_TILE_REGIME_V_PROCESSING_POSTFRAG_NAME "processing_postfrag"
+#define FD_METRICS_ENUM_TILE_REGIME_V_SLEEPING_IDX  8
+#define FD_METRICS_ENUM_TILE_REGIME_V_SLEEPING_NAME "sleeping"
 
 #define FD_METRICS_ENUM_SOCK_ERR_NAME "sock_err"
 #define FD_METRICS_ENUM_SOCK_ERR_CNT (6UL)
diff --git a/src/disco/metrics/generated/fd_metrics_gossip.h b/src/disco/metrics/generated/fd_metrics_gossip.h
index d628b77f6a..68378bffbf 100644
--- a/src/disco/metrics/generated/fd_metrics_gossip.h
+++ b/src/disco/metrics/generated/fd_metrics_gossip.h
@@ -3,414 +3,414 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_GAUGE_GOSSIP_LAST_CRDS_PUSH_CONTACT_INFO_PUBLISH_TIMESTAMP_NANOS_OFF  (16UL)
+#define FD_METRICS_GAUGE_GOSSIP_LAST_CRDS_PUSH_CONTACT_INFO_PUBLISH_TIMESTAMP_NANOS_OFF  (17UL)
 #define FD_METRICS_GAUGE_GOSSIP_LAST_CRDS_PUSH_CONTACT_INFO_PUBLISH_TIMESTAMP_NANOS_NAME "gossip_last_crds_push_contact_info_publish_timestamp_nanos"
 #define FD_METRICS_GAUGE_GOSSIP_LAST_CRDS_PUSH_CONTACT_INFO_PUBLISH_TIMESTAMP_NANOS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_LAST_CRDS_PUSH_CONTACT_INFO_PUBLISH_TIMESTAMP_NANOS_DESC "Time (in nanoseconds) of last CRDS Push ContactInfo message publish"
 #define FD_METRICS_GAUGE_GOSSIP_LAST_CRDS_PUSH_CONTACT_INFO_PUBLISH_TIMESTAMP_NANOS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_MISMATCHED_CONTACT_INFO_SHRED_VERSION_OFF  (17UL)
+#define FD_METRICS_COUNTER_GOSSIP_MISMATCHED_CONTACT_INFO_SHRED_VERSION_OFF  (18UL)
 #define FD_METRICS_COUNTER_GOSSIP_MISMATCHED_CONTACT_INFO_SHRED_VERSION_NAME "gossip_mismatched_contact_info_shred_version"
 #define FD_METRICS_COUNTER_GOSSIP_MISMATCHED_CONTACT_INFO_SHRED_VERSION_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_MISMATCHED_CONTACT_INFO_SHRED_VERSION_DESC "Mismatched Contact Info Shred Version"
 #define FD_METRICS_COUNTER_GOSSIP_MISMATCHED_CONTACT_INFO_SHRED_VERSION_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_OFF  (18UL)
+#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_OFF  (19UL)
 #define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_NAME "gossip_ipv6_contact_info"
 #define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_DESC "IPv6 Contact Info (by peer type)"
 #define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_TVU_OFF (18UL)
-#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_REPAIR_OFF (19UL)
-#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_SEND_OFF (20UL)
+#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_TVU_OFF (19UL)
+#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_REPAIR_OFF (20UL)
+#define FD_METRICS_COUNTER_GOSSIP_IPV6_CONTACT_INFO_SEND_OFF (21UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_OFF  (21UL)
+#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_OFF  (22UL)
 #define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_NAME "gossip_zero_ipv4_contact_info"
 #define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_DESC "Zero IPv4 Contact Info (by peer type)"
 #define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_TVU_OFF (21UL)
-#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_REPAIR_OFF (22UL)
-#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_SEND_OFF (23UL)
+#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_TVU_OFF (22UL)
+#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_REPAIR_OFF (23UL)
+#define FD_METRICS_COUNTER_GOSSIP_ZERO_IPV4_CONTACT_INFO_SEND_OFF (24UL)
 
-#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_OFF  (24UL)
+#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_OFF  (25UL)
 #define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_NAME "gossip_peer_counts"
 #define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_DESC "Number of peers of each type"
 #define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_CNT  (3UL)
 
-#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_TVU_OFF (24UL)
-#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_REPAIR_OFF (25UL)
-#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_SEND_OFF (26UL)
+#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_TVU_OFF (25UL)
+#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_REPAIR_OFF (26UL)
+#define FD_METRICS_GAUGE_GOSSIP_PEER_COUNTS_SEND_OFF (27UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_SHRED_VERSION_ZERO_OFF  (27UL)
+#define FD_METRICS_COUNTER_GOSSIP_SHRED_VERSION_ZERO_OFF  (28UL)
 #define FD_METRICS_COUNTER_GOSSIP_SHRED_VERSION_ZERO_NAME "gossip_shred_version_zero"
 #define FD_METRICS_COUNTER_GOSSIP_SHRED_VERSION_ZERO_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_SHRED_VERSION_ZERO_DESC "Shred version zero"
 #define FD_METRICS_COUNTER_GOSSIP_SHRED_VERSION_ZERO_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_GOSSIP_VALUE_META_SIZE_OFF  (28UL)
+#define FD_METRICS_GAUGE_GOSSIP_VALUE_META_SIZE_OFF  (29UL)
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_META_SIZE_NAME "gossip_value_meta_size"
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_META_SIZE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_META_SIZE_DESC "Current size of the CRDS value metas map"
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_META_SIZE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_GOSSIP_VALUE_VEC_SIZE_OFF  (29UL)
+#define FD_METRICS_GAUGE_GOSSIP_VALUE_VEC_SIZE_OFF  (30UL)
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_VEC_SIZE_NAME "gossip_value_vec_size"
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_VEC_SIZE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_VEC_SIZE_DESC "Current size of the CRDS value vector"
 #define FD_METRICS_GAUGE_GOSSIP_VALUE_VEC_SIZE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_PACKETS_OFF  (30UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_PACKETS_OFF  (31UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_PACKETS_NAME "gossip_received_packets"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_PACKETS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_PACKETS_DESC "Number of all gossip packets received"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_PACKETS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_CORRUPTED_MESSAGES_OFF  (31UL)
+#define FD_METRICS_COUNTER_GOSSIP_CORRUPTED_MESSAGES_OFF  (32UL)
 #define FD_METRICS_COUNTER_GOSSIP_CORRUPTED_MESSAGES_NAME "gossip_corrupted_messages"
 #define FD_METRICS_COUNTER_GOSSIP_CORRUPTED_MESSAGES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_CORRUPTED_MESSAGES_DESC "Number of corrupted gossip messages received"
 #define FD_METRICS_COUNTER_GOSSIP_CORRUPTED_MESSAGES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_OFF  (32UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_OFF  (33UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_NAME "gossip_received_gossip_messages"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_DESC "Number of gossip messages received"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_CNT  (6UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PULL_REQUEST_OFF (32UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PULL_RESPONSE_OFF (33UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PUSH_OFF (34UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PRUNE_OFF (35UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PING_OFF (36UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PONG_OFF (37UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PULL_REQUEST_OFF (33UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PULL_RESPONSE_OFF (34UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PUSH_OFF (35UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PRUNE_OFF (36UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PING_OFF (37UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_GOSSIP_MESSAGES_PONG_OFF (38UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_UNKNOWN_MESSAGE_OFF  (38UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_UNKNOWN_MESSAGE_OFF  (39UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_UNKNOWN_MESSAGE_NAME "gossip_received_unknown_message"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_UNKNOWN_MESSAGE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_UNKNOWN_MESSAGE_DESC "Number of gossip messages received that have an unknown discriminant"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_UNKNOWN_MESSAGE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_OFF  (39UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_OFF  (40UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_NAME "gossip_received_crds_push"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_DESC "Number of CRDS values received from push messages"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_CNT  (14UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_CONTACT_INFO_V1_OFF (39UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_VOTE_OFF (40UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_LOWEST_SLOT_OFF (41UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_SNAPSHOT_HASHES_OFF (42UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_ACCOUNTS_HASHES_OFF (43UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_EPOCH_SLOTS_OFF (44UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_VERSION_V1_OFF (45UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_VERSION_V2_OFF (46UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_NODE_INSTANCE_OFF (47UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_DUPLICATE_SHRED_OFF (48UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_INCREMENTAL_SNAPSHOT_HASHES_OFF (49UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_CONTACT_INFO_V2_OFF (50UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_RESTART_LAST_VOTED_FORK_SLOTS_OFF (51UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_RESTART_HEAVIEST_FORK_OFF (52UL)
-
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_OFF  (53UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_CONTACT_INFO_V1_OFF (40UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_VOTE_OFF (41UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_LOWEST_SLOT_OFF (42UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_SNAPSHOT_HASHES_OFF (43UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_ACCOUNTS_HASHES_OFF (44UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_EPOCH_SLOTS_OFF (45UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_VERSION_V1_OFF (46UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_VERSION_V2_OFF (47UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_NODE_INSTANCE_OFF (48UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_DUPLICATE_SHRED_OFF (49UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_INCREMENTAL_SNAPSHOT_HASHES_OFF (50UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_CONTACT_INFO_V2_OFF (51UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_RESTART_LAST_VOTED_FORK_SLOTS_OFF (52UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PUSH_RESTART_HEAVIEST_FORK_OFF (53UL)
+
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_OFF  (54UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_NAME "gossip_received_crds_pull"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_DESC "Number of CRDS values received from pull response messages"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_CNT  (14UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_CONTACT_INFO_V1_OFF (53UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_VOTE_OFF (54UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_LOWEST_SLOT_OFF (55UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_SNAPSHOT_HASHES_OFF (56UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_ACCOUNTS_HASHES_OFF (57UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_EPOCH_SLOTS_OFF (58UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_VERSION_V1_OFF (59UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_VERSION_V2_OFF (60UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_NODE_INSTANCE_OFF (61UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_DUPLICATE_SHRED_OFF (62UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_INCREMENTAL_SNAPSHOT_HASHES_OFF (63UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_CONTACT_INFO_V2_OFF (64UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_RESTART_LAST_VOTED_FORK_SLOTS_OFF (65UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_RESTART_HEAVIEST_FORK_OFF (66UL)
-
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_OFF  (67UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_CONTACT_INFO_V1_OFF (54UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_VOTE_OFF (55UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_LOWEST_SLOT_OFF (56UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_SNAPSHOT_HASHES_OFF (57UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_ACCOUNTS_HASHES_OFF (58UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_EPOCH_SLOTS_OFF (59UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_VERSION_V1_OFF (60UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_VERSION_V2_OFF (61UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_NODE_INSTANCE_OFF (62UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_DUPLICATE_SHRED_OFF (63UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_INCREMENTAL_SNAPSHOT_HASHES_OFF (64UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_CONTACT_INFO_V2_OFF (65UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_RESTART_LAST_VOTED_FORK_SLOTS_OFF (66UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_PULL_RESTART_HEAVIEST_FORK_OFF (67UL)
+
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_OFF  (68UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_NAME "gossip_received_crds_duplicate_message_push"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_DESC "Number of duplicate CRDS values received from push messages"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_CNT  (14UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_CONTACT_INFO_V1_OFF (67UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_VOTE_OFF (68UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_LOWEST_SLOT_OFF (69UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_SNAPSHOT_HASHES_OFF (70UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_ACCOUNTS_HASHES_OFF (71UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_EPOCH_SLOTS_OFF (72UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_VERSION_V1_OFF (73UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_VERSION_V2_OFF (74UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_NODE_INSTANCE_OFF (75UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_DUPLICATE_SHRED_OFF (76UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_INCREMENTAL_SNAPSHOT_HASHES_OFF (77UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_CONTACT_INFO_V2_OFF (78UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_RESTART_LAST_VOTED_FORK_SLOTS_OFF (79UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_RESTART_HEAVIEST_FORK_OFF (80UL)
-
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_OFF  (81UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_CONTACT_INFO_V1_OFF (68UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_VOTE_OFF (69UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_LOWEST_SLOT_OFF (70UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_SNAPSHOT_HASHES_OFF (71UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_ACCOUNTS_HASHES_OFF (72UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_EPOCH_SLOTS_OFF (73UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_VERSION_V1_OFF (74UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_VERSION_V2_OFF (75UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_NODE_INSTANCE_OFF (76UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_DUPLICATE_SHRED_OFF (77UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_INCREMENTAL_SNAPSHOT_HASHES_OFF (78UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_CONTACT_INFO_V2_OFF (79UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_RESTART_LAST_VOTED_FORK_SLOTS_OFF (80UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PUSH_RESTART_HEAVIEST_FORK_OFF (81UL)
+
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_OFF  (82UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_NAME "gossip_received_crds_duplicate_message_pull"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_DESC "Number of duplicate CRDS values received from pull response messages"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_CNT  (14UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_CONTACT_INFO_V1_OFF (81UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_VOTE_OFF (82UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_LOWEST_SLOT_OFF (83UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_SNAPSHOT_HASHES_OFF (84UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_ACCOUNTS_HASHES_OFF (85UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_EPOCH_SLOTS_OFF (86UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_VERSION_V1_OFF (87UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_VERSION_V2_OFF (88UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_NODE_INSTANCE_OFF (89UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_DUPLICATE_SHRED_OFF (90UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_INCREMENTAL_SNAPSHOT_HASHES_OFF (91UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_CONTACT_INFO_V2_OFF (92UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_RESTART_LAST_VOTED_FORK_SLOTS_OFF (93UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_RESTART_HEAVIEST_FORK_OFF (94UL)
-
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_OFF  (95UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_CONTACT_INFO_V1_OFF (82UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_VOTE_OFF (83UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_LOWEST_SLOT_OFF (84UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_SNAPSHOT_HASHES_OFF (85UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_ACCOUNTS_HASHES_OFF (86UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_EPOCH_SLOTS_OFF (87UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_VERSION_V1_OFF (88UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_VERSION_V2_OFF (89UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_NODE_INSTANCE_OFF (90UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_DUPLICATE_SHRED_OFF (91UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_INCREMENTAL_SNAPSHOT_HASHES_OFF (92UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_CONTACT_INFO_V2_OFF (93UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_RESTART_LAST_VOTED_FORK_SLOTS_OFF (94UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DUPLICATE_MESSAGE_PULL_RESTART_HEAVIEST_FORK_OFF (95UL)
+
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_OFF  (96UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_NAME "gossip_received_crds_drop"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_DESC "Number of CRDS values dropped on receive"
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_CNT  (12UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_SUCCESS_OFF (95UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_DUPLICATE_OFF (96UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_UNKNOWN_DISCRIMINANT_OFF (97UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_OWN_MESSAGE_OFF (98UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_INVALID_SIGNATURE_OFF (99UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_TABLE_FULL_OFF (100UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_PUSH_QUEUE_FULL_OFF (101UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_INVALID_GOSSIP_PORT_OFF (102UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_PEER_TABLE_FULL_OFF (103UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_INACTIVES_QUEUE_FULL_OFF (104UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_DISCARDED_PEER_OFF (105UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_ENCODING_FAILED_OFF (106UL)
-
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_OFF  (107UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_SUCCESS_OFF (96UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_DUPLICATE_OFF (97UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_UNKNOWN_DISCRIMINANT_OFF (98UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_OWN_MESSAGE_OFF (99UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_INVALID_SIGNATURE_OFF (100UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_TABLE_FULL_OFF (101UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_PUSH_QUEUE_FULL_OFF (102UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_INVALID_GOSSIP_PORT_OFF (103UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_PEER_TABLE_FULL_OFF (104UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_INACTIVES_QUEUE_FULL_OFF (105UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_DISCARDED_PEER_OFF (106UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECEIVED_CRDS_DROP_ENCODING_FAILED_OFF (107UL)
+
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_OFF  (108UL)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_NAME "gossip_push_crds"
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DESC "Number of CRDS values pushed"
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_CNT  (14UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_CONTACT_INFO_V1_OFF (107UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_VOTE_OFF (108UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_LOWEST_SLOT_OFF (109UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_SNAPSHOT_HASHES_OFF (110UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_ACCOUNTS_HASHES_OFF (111UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_EPOCH_SLOTS_OFF (112UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_VERSION_V1_OFF (113UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_VERSION_V2_OFF (114UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_NODE_INSTANCE_OFF (115UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_SHRED_OFF (116UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_INCREMENTAL_SNAPSHOT_HASHES_OFF (117UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_CONTACT_INFO_V2_OFF (118UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_RESTART_LAST_VOTED_FORK_SLOTS_OFF (119UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_RESTART_HEAVIEST_FORK_OFF (120UL)
-
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_OFF  (121UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_CONTACT_INFO_V1_OFF (108UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_VOTE_OFF (109UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_LOWEST_SLOT_OFF (110UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_SNAPSHOT_HASHES_OFF (111UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_ACCOUNTS_HASHES_OFF (112UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_EPOCH_SLOTS_OFF (113UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_VERSION_V1_OFF (114UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_VERSION_V2_OFF (115UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_NODE_INSTANCE_OFF (116UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_SHRED_OFF (117UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_INCREMENTAL_SNAPSHOT_HASHES_OFF (118UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_CONTACT_INFO_V2_OFF (119UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_RESTART_LAST_VOTED_FORK_SLOTS_OFF (120UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_RESTART_HEAVIEST_FORK_OFF (121UL)
+
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_OFF  (122UL)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_NAME "gossip_push_crds_duplicate_message"
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_DESC "Number of duplicate CRDS values inserted (internally)"
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_CNT  (14UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_CONTACT_INFO_V1_OFF (121UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_VOTE_OFF (122UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_LOWEST_SLOT_OFF (123UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_SNAPSHOT_HASHES_OFF (124UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_ACCOUNTS_HASHES_OFF (125UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_EPOCH_SLOTS_OFF (126UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_VERSION_V1_OFF (127UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_VERSION_V2_OFF (128UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_NODE_INSTANCE_OFF (129UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_DUPLICATE_SHRED_OFF (130UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_INCREMENTAL_SNAPSHOT_HASHES_OFF (131UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_CONTACT_INFO_V2_OFF (132UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_RESTART_LAST_VOTED_FORK_SLOTS_OFF (133UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_RESTART_HEAVIEST_FORK_OFF (134UL)
-
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_OFF  (135UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_CONTACT_INFO_V1_OFF (122UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_VOTE_OFF (123UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_LOWEST_SLOT_OFF (124UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_SNAPSHOT_HASHES_OFF (125UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_ACCOUNTS_HASHES_OFF (126UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_EPOCH_SLOTS_OFF (127UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_VERSION_V1_OFF (128UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_VERSION_V2_OFF (129UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_NODE_INSTANCE_OFF (130UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_DUPLICATE_SHRED_OFF (131UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_INCREMENTAL_SNAPSHOT_HASHES_OFF (132UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_CONTACT_INFO_V2_OFF (133UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_RESTART_LAST_VOTED_FORK_SLOTS_OFF (134UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DUPLICATE_MESSAGE_RESTART_HEAVIEST_FORK_OFF (135UL)
+
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_OFF  (136UL)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_NAME "gossip_push_crds_drop"
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_DESC "Number of CRDS values dropped on push"
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_CNT  (12UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_SUCCESS_OFF (135UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_DUPLICATE_OFF (136UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_UNKNOWN_DISCRIMINANT_OFF (137UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_OWN_MESSAGE_OFF (138UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_INVALID_SIGNATURE_OFF (139UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_TABLE_FULL_OFF (140UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_PUSH_QUEUE_FULL_OFF (141UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_INVALID_GOSSIP_PORT_OFF (142UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_PEER_TABLE_FULL_OFF (143UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_INACTIVES_QUEUE_FULL_OFF (144UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_DISCARDED_PEER_OFF (145UL)
-#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_ENCODING_FAILED_OFF (146UL)
-
-#define FD_METRICS_GAUGE_GOSSIP_PUSH_CRDS_QUEUE_COUNT_OFF  (147UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_SUCCESS_OFF (136UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_DUPLICATE_OFF (137UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_UNKNOWN_DISCRIMINANT_OFF (138UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_OWN_MESSAGE_OFF (139UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_INVALID_SIGNATURE_OFF (140UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_TABLE_FULL_OFF (141UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_PUSH_QUEUE_FULL_OFF (142UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_INVALID_GOSSIP_PORT_OFF (143UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_PEER_TABLE_FULL_OFF (144UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_INACTIVES_QUEUE_FULL_OFF (145UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_DISCARDED_PEER_OFF (146UL)
+#define FD_METRICS_COUNTER_GOSSIP_PUSH_CRDS_DROP_ENCODING_FAILED_OFF (147UL)
+
+#define FD_METRICS_GAUGE_GOSSIP_PUSH_CRDS_QUEUE_COUNT_OFF  (148UL)
 #define FD_METRICS_GAUGE_GOSSIP_PUSH_CRDS_QUEUE_COUNT_NAME "gossip_push_crds_queue_count"
 #define FD_METRICS_GAUGE_GOSSIP_PUSH_CRDS_QUEUE_COUNT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_PUSH_CRDS_QUEUE_COUNT_DESC "Number of CRDS values in the queue to be pushed"
 #define FD_METRICS_GAUGE_GOSSIP_PUSH_CRDS_QUEUE_COUNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_GOSSIP_ACTIVE_PUSH_DESTINATIONS_OFF  (148UL)
+#define FD_METRICS_GAUGE_GOSSIP_ACTIVE_PUSH_DESTINATIONS_OFF  (149UL)
 #define FD_METRICS_GAUGE_GOSSIP_ACTIVE_PUSH_DESTINATIONS_NAME "gossip_active_push_destinations"
 #define FD_METRICS_GAUGE_GOSSIP_ACTIVE_PUSH_DESTINATIONS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_ACTIVE_PUSH_DESTINATIONS_DESC "Number of active Push destinations"
 #define FD_METRICS_GAUGE_GOSSIP_ACTIVE_PUSH_DESTINATIONS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_REFRESH_PUSH_STATES_FAIL_COUNT_OFF  (149UL)
+#define FD_METRICS_COUNTER_GOSSIP_REFRESH_PUSH_STATES_FAIL_COUNT_OFF  (150UL)
 #define FD_METRICS_COUNTER_GOSSIP_REFRESH_PUSH_STATES_FAIL_COUNT_NAME "gossip_refresh_push_states_fail_count"
 #define FD_METRICS_COUNTER_GOSSIP_REFRESH_PUSH_STATES_FAIL_COUNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_REFRESH_PUSH_STATES_FAIL_COUNT_DESC "Number of failures whilst refreshing push states"
 #define FD_METRICS_COUNTER_GOSSIP_REFRESH_PUSH_STATES_FAIL_COUNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_OFF  (150UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_OFF  (151UL)
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_NAME "gossip_pull_req_fail"
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_DESC "Number of PullReq messages that failed"
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_CNT  (4UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_PEER_NOT_IN_ACTIVES_OFF (150UL)
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_UNRESPONSIVE_PEER_OFF (151UL)
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_PENDING_POOL_FULL_OFF (152UL)
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_ENCODING_FAILED_OFF (153UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_PEER_NOT_IN_ACTIVES_OFF (151UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_UNRESPONSIVE_PEER_OFF (152UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_PENDING_POOL_FULL_OFF (153UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_FAIL_ENCODING_FAILED_OFF (154UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_OFF  (154UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_OFF  (155UL)
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_NAME "gossip_pull_req_bloom_filter"
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_DESC "Result of the bloom filter check for a PullReq"
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_CNT  (2UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_HIT_OFF (154UL)
-#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_MISS_OFF (155UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_HIT_OFF (155UL)
+#define FD_METRICS_COUNTER_GOSSIP_PULL_REQ_BLOOM_FILTER_MISS_OFF (156UL)
 
-#define FD_METRICS_GAUGE_GOSSIP_PULL_REQ_RESP_PACKETS_OFF  (156UL)
+#define FD_METRICS_GAUGE_GOSSIP_PULL_REQ_RESP_PACKETS_OFF  (157UL)
 #define FD_METRICS_GAUGE_GOSSIP_PULL_REQ_RESP_PACKETS_NAME "gossip_pull_req_resp_packets"
 #define FD_METRICS_GAUGE_GOSSIP_PULL_REQ_RESP_PACKETS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_PULL_REQ_RESP_PACKETS_DESC "Number of packets used to respond to a PullReq"
 #define FD_METRICS_GAUGE_GOSSIP_PULL_REQ_RESP_PACKETS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_OFF  (157UL)
+#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_OFF  (158UL)
 #define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_NAME "gossip_prune_fail_count"
 #define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_DESC "Number of Prune messages that failed"
 #define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_NOT_FOR_ME_OFF (157UL)
-#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_SIGN_ENCODING_FAILED_OFF (158UL)
-#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_INVALID_SIGNATURE_OFF (159UL)
+#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_NOT_FOR_ME_OFF (158UL)
+#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_SIGN_ENCODING_FAILED_OFF (159UL)
+#define FD_METRICS_COUNTER_GOSSIP_PRUNE_FAIL_COUNT_INVALID_SIGNATURE_OFF (160UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_STALE_ENTRY_OFF  (160UL)
+#define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_STALE_ENTRY_OFF  (161UL)
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_STALE_ENTRY_NAME "gossip_make_prune_stale_entry"
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_STALE_ENTRY_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_STALE_ENTRY_DESC "Number of stale entries removed from the stats table while making prune messages"
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_STALE_ENTRY_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_HIGH_DUPLICATES_OFF  (161UL)
+#define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_HIGH_DUPLICATES_OFF  (162UL)
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_HIGH_DUPLICATES_NAME "gossip_make_prune_high_duplicates"
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_HIGH_DUPLICATES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_HIGH_DUPLICATES_DESC "Number of origins with high duplicate counts found while making prune messages"
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_HIGH_DUPLICATES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_GOSSIP_MAKE_PRUNE_REQUESTED_ORIGINS_OFF  (162UL)
+#define FD_METRICS_GAUGE_GOSSIP_MAKE_PRUNE_REQUESTED_ORIGINS_OFF  (163UL)
 #define FD_METRICS_GAUGE_GOSSIP_MAKE_PRUNE_REQUESTED_ORIGINS_NAME "gossip_make_prune_requested_origins"
 #define FD_METRICS_GAUGE_GOSSIP_MAKE_PRUNE_REQUESTED_ORIGINS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_MAKE_PRUNE_REQUESTED_ORIGINS_DESC "Number of requested origins in the last prune message we made"
 #define FD_METRICS_GAUGE_GOSSIP_MAKE_PRUNE_REQUESTED_ORIGINS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_SIGN_DATA_ENCODE_FAILED_OFF  (163UL)
+#define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_SIGN_DATA_ENCODE_FAILED_OFF  (164UL)
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_SIGN_DATA_ENCODE_FAILED_NAME "gossip_make_prune_sign_data_encode_failed"
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_SIGN_DATA_ENCODE_FAILED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_SIGN_DATA_ENCODE_FAILED_DESC "Number of times we failed to encode the sign data"
 #define FD_METRICS_COUNTER_GOSSIP_MAKE_PRUNE_SIGN_DATA_ENCODE_FAILED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_OFF  (164UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_OFF  (165UL)
 #define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_NAME "gossip_sent_gossip_messages"
 #define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_DESC "Number of gossip messages sent"
 #define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_CNT  (6UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PULL_REQUEST_OFF (164UL)
-#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PULL_RESPONSE_OFF (165UL)
-#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PUSH_OFF (166UL)
-#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PRUNE_OFF (167UL)
-#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PING_OFF (168UL)
-#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PONG_OFF (169UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PULL_REQUEST_OFF (165UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PULL_RESPONSE_OFF (166UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PUSH_OFF (167UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PRUNE_OFF (168UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PING_OFF (169UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_GOSSIP_MESSAGES_PONG_OFF (170UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_SENT_PACKETS_OFF  (170UL)
+#define FD_METRICS_COUNTER_GOSSIP_SENT_PACKETS_OFF  (171UL)
 #define FD_METRICS_COUNTER_GOSSIP_SENT_PACKETS_NAME "gossip_sent_packets"
 #define FD_METRICS_COUNTER_GOSSIP_SENT_PACKETS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_SENT_PACKETS_DESC "Number of Packets sent"
 #define FD_METRICS_COUNTER_GOSSIP_SENT_PACKETS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_OFF  (171UL)
+#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_OFF  (172UL)
 #define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_NAME "gossip_send_ping_event"
 #define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_DESC "Number of Ping messages sent with non-standard outcomes"
 #define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_ACTIVES_TABLE_FULL_OFF (171UL)
-#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_ACTIVES_TABLE_INSERT_OFF (172UL)
-#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_MAX_PING_COUNT_EXCEEDED_OFF (173UL)
+#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_ACTIVES_TABLE_FULL_OFF (172UL)
+#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_ACTIVES_TABLE_INSERT_OFF (173UL)
+#define FD_METRICS_COUNTER_GOSSIP_SEND_PING_EVENT_MAX_PING_COUNT_EXCEEDED_OFF (174UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECV_PING_INVALID_SIGNATURE_OFF  (174UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECV_PING_INVALID_SIGNATURE_OFF  (175UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PING_INVALID_SIGNATURE_NAME "gossip_recv_ping_invalid_signature"
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PING_INVALID_SIGNATURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PING_INVALID_SIGNATURE_DESC "Number of times we received a Ping message with an invalid signature"
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PING_INVALID_SIGNATURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_OFF  (175UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_OFF  (176UL)
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_NAME "gossip_recv_pong_event"
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_DESC "Number of Pong messages processed with non-standard outcomes"
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_CNT  (5UL)
 
-#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_NEW_PEER_OFF (175UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_WRONG_TOKEN_OFF (176UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_INVALID_SIGNATURE_OFF (177UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_EXPIRED_OFF (178UL)
-#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_TABLE_FULL_OFF (179UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_NEW_PEER_OFF (176UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_WRONG_TOKEN_OFF (177UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_INVALID_SIGNATURE_OFF (178UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_EXPIRED_OFF (179UL)
+#define FD_METRICS_COUNTER_GOSSIP_RECV_PONG_EVENT_TABLE_FULL_OFF (180UL)
 
-#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_OFF  (180UL)
+#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_OFF  (181UL)
 #define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_NAME "gossip_gossip_peer_counts"
 #define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_DESC "Number of gossip peers tracked"
 #define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_CNT  (3UL)
 
-#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_TOTAL_OFF (180UL)
-#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_ACTIVE_OFF (181UL)
-#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_INACTIVE_OFF (182UL)
+#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_TOTAL_OFF (181UL)
+#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_ACTIVE_OFF (182UL)
+#define FD_METRICS_GAUGE_GOSSIP_GOSSIP_PEER_COUNTS_INACTIVE_OFF (183UL)
 
 #define FD_METRICS_GOSSIP_TOTAL (167UL)
 extern const fd_metrics_meta_t FD_METRICS_GOSSIP[FD_METRICS_GOSSIP_TOTAL];
diff --git a/src/disco/metrics/generated/fd_metrics_ipecho.h b/src/disco/metrics/generated/fd_metrics_ipecho.h
new file mode 100644
index 0000000000..9693a0124e
--- /dev/null
+++ b/src/disco/metrics/generated/fd_metrics_ipecho.h
@@ -0,0 +1,43 @@
+/* THIS FILE IS GENERATED BY gen_metrics.py. DO NOT HAND EDIT. */
+
+#include "../fd_metrics_base.h"
+#include "fd_metrics_enums.h"
+
+#define FD_METRICS_GAUGE_IPECHO_SHRED_VERSION_OFF  (17UL)
+#define FD_METRICS_GAUGE_IPECHO_SHRED_VERSION_NAME "ipecho_shred_version"
+#define FD_METRICS_GAUGE_IPECHO_SHRED_VERSION_TYPE (FD_METRICS_TYPE_GAUGE)
+#define FD_METRICS_GAUGE_IPECHO_SHRED_VERSION_DESC "The current shred version used by the validator"
+#define FD_METRICS_GAUGE_IPECHO_SHRED_VERSION_CVT  (FD_METRICS_CONVERTER_NONE)
+
+#define FD_METRICS_GAUGE_IPECHO_CONNECTION_COUNT_OFF  (18UL)
+#define FD_METRICS_GAUGE_IPECHO_CONNECTION_COUNT_NAME "ipecho_connection_count"
+#define FD_METRICS_GAUGE_IPECHO_CONNECTION_COUNT_TYPE (FD_METRICS_TYPE_GAUGE)
+#define FD_METRICS_GAUGE_IPECHO_CONNECTION_COUNT_DESC "The number of active connections to the ipecho service"
+#define FD_METRICS_GAUGE_IPECHO_CONNECTION_COUNT_CVT  (FD_METRICS_CONVERTER_NONE)
+
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_OK_OFF  (19UL)
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_OK_NAME "ipecho_connections_closed_ok"
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_OK_TYPE (FD_METRICS_TYPE_COUNTER)
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_OK_DESC "The number of connections to the ipecho service that have been made and closed normally"
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_OK_CVT  (FD_METRICS_CONVERTER_NONE)
+
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_ERROR_OFF  (20UL)
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_ERROR_NAME "ipecho_connections_closed_error"
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_ERROR_TYPE (FD_METRICS_TYPE_COUNTER)
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_ERROR_DESC "The number of connections to the ipecho service that have been made and closed abnormally"
+#define FD_METRICS_COUNTER_IPECHO_CONNECTIONS_CLOSED_ERROR_CVT  (FD_METRICS_CONVERTER_NONE)
+
+#define FD_METRICS_COUNTER_IPECHO_BYTES_READ_OFF  (21UL)
+#define FD_METRICS_COUNTER_IPECHO_BYTES_READ_NAME "ipecho_bytes_read"
+#define FD_METRICS_COUNTER_IPECHO_BYTES_READ_TYPE (FD_METRICS_TYPE_COUNTER)
+#define FD_METRICS_COUNTER_IPECHO_BYTES_READ_DESC "The total number of bytes read from all connections to the ipecho service"
+#define FD_METRICS_COUNTER_IPECHO_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
+
+#define FD_METRICS_COUNTER_IPECHO_BYTES_WRITTEN_OFF  (22UL)
+#define FD_METRICS_COUNTER_IPECHO_BYTES_WRITTEN_NAME "ipecho_bytes_written"
+#define FD_METRICS_COUNTER_IPECHO_BYTES_WRITTEN_TYPE (FD_METRICS_TYPE_COUNTER)
+#define FD_METRICS_COUNTER_IPECHO_BYTES_WRITTEN_DESC "The total number of bytes written to all connections to the ipecho service"
+#define FD_METRICS_COUNTER_IPECHO_BYTES_WRITTEN_CVT  (FD_METRICS_CONVERTER_NONE)
+
+#define FD_METRICS_IPECHO_TOTAL (6UL)
+extern const fd_metrics_meta_t FD_METRICS_IPECHO[FD_METRICS_IPECHO_TOTAL];
diff --git a/src/disco/metrics/generated/fd_metrics_metric.h b/src/disco/metrics/generated/fd_metrics_metric.h
index b832debaf0..3d94174210 100644
--- a/src/disco/metrics/generated/fd_metrics_metric.h
+++ b/src/disco/metrics/generated/fd_metrics_metric.h
@@ -3,7 +3,7 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_GAUGE_METRIC_BOOT_TIMESTAMP_NANOS_OFF  (16UL)
+#define FD_METRICS_GAUGE_METRIC_BOOT_TIMESTAMP_NANOS_OFF  (17UL)
 #define FD_METRICS_GAUGE_METRIC_BOOT_TIMESTAMP_NANOS_NAME "metric_boot_timestamp_nanos"
 #define FD_METRICS_GAUGE_METRIC_BOOT_TIMESTAMP_NANOS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_METRIC_BOOT_TIMESTAMP_NANOS_DESC "Timestamp when validator was started (nanoseconds since epoch)"
diff --git a/src/disco/metrics/generated/fd_metrics_net.h b/src/disco/metrics/generated/fd_metrics_net.h
index b1bad7cca2..82ee12737a 100644
--- a/src/disco/metrics/generated/fd_metrics_net.h
+++ b/src/disco/metrics/generated/fd_metrics_net.h
@@ -3,169 +3,169 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_NET_RX_PKT_CNT_OFF  (16UL)
+#define FD_METRICS_COUNTER_NET_RX_PKT_CNT_OFF  (17UL)
 #define FD_METRICS_COUNTER_NET_RX_PKT_CNT_NAME "net_rx_pkt_cnt"
 #define FD_METRICS_COUNTER_NET_RX_PKT_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_PKT_CNT_DESC "Packet receive count."
 #define FD_METRICS_COUNTER_NET_RX_PKT_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_RX_BYTES_TOTAL_OFF  (17UL)
+#define FD_METRICS_COUNTER_NET_RX_BYTES_TOTAL_OFF  (18UL)
 #define FD_METRICS_COUNTER_NET_RX_BYTES_TOTAL_NAME "net_rx_bytes_total"
 #define FD_METRICS_COUNTER_NET_RX_BYTES_TOTAL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_BYTES_TOTAL_DESC "Total number of bytes received (including Ethernet header)."
 #define FD_METRICS_COUNTER_NET_RX_BYTES_TOTAL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_RX_UNDERSZ_CNT_OFF  (18UL)
+#define FD_METRICS_COUNTER_NET_RX_UNDERSZ_CNT_OFF  (19UL)
 #define FD_METRICS_COUNTER_NET_RX_UNDERSZ_CNT_NAME "net_rx_undersz_cnt"
 #define FD_METRICS_COUNTER_NET_RX_UNDERSZ_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_UNDERSZ_CNT_DESC "Number of incoming packets dropped due to being too small."
 #define FD_METRICS_COUNTER_NET_RX_UNDERSZ_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_RX_FILL_BLOCKED_CNT_OFF  (19UL)
+#define FD_METRICS_COUNTER_NET_RX_FILL_BLOCKED_CNT_OFF  (20UL)
 #define FD_METRICS_COUNTER_NET_RX_FILL_BLOCKED_CNT_NAME "net_rx_fill_blocked_cnt"
 #define FD_METRICS_COUNTER_NET_RX_FILL_BLOCKED_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_FILL_BLOCKED_CNT_DESC "Number of incoming packets dropped due to fill ring being full."
 #define FD_METRICS_COUNTER_NET_RX_FILL_BLOCKED_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_RX_BACKPRESSURE_CNT_OFF  (20UL)
+#define FD_METRICS_COUNTER_NET_RX_BACKPRESSURE_CNT_OFF  (21UL)
 #define FD_METRICS_COUNTER_NET_RX_BACKPRESSURE_CNT_NAME "net_rx_backpressure_cnt"
 #define FD_METRICS_COUNTER_NET_RX_BACKPRESSURE_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_BACKPRESSURE_CNT_DESC "Number of incoming packets dropped due to backpressure."
 #define FD_METRICS_COUNTER_NET_RX_BACKPRESSURE_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_NET_RX_BUSY_CNT_OFF  (21UL)
+#define FD_METRICS_GAUGE_NET_RX_BUSY_CNT_OFF  (22UL)
 #define FD_METRICS_GAUGE_NET_RX_BUSY_CNT_NAME "net_rx_busy_cnt"
 #define FD_METRICS_GAUGE_NET_RX_BUSY_CNT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_NET_RX_BUSY_CNT_DESC "Number of receive buffers currently busy."
 #define FD_METRICS_GAUGE_NET_RX_BUSY_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_NET_RX_IDLE_CNT_OFF  (22UL)
+#define FD_METRICS_GAUGE_NET_RX_IDLE_CNT_OFF  (23UL)
 #define FD_METRICS_GAUGE_NET_RX_IDLE_CNT_NAME "net_rx_idle_cnt"
 #define FD_METRICS_GAUGE_NET_RX_IDLE_CNT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_NET_RX_IDLE_CNT_DESC "Number of receive buffers currently idle."
 #define FD_METRICS_GAUGE_NET_RX_IDLE_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_SUBMIT_CNT_OFF  (23UL)
+#define FD_METRICS_COUNTER_NET_TX_SUBMIT_CNT_OFF  (24UL)
 #define FD_METRICS_COUNTER_NET_TX_SUBMIT_CNT_NAME "net_tx_submit_cnt"
 #define FD_METRICS_COUNTER_NET_TX_SUBMIT_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_SUBMIT_CNT_DESC "Number of packet transmit jobs submitted."
 #define FD_METRICS_COUNTER_NET_TX_SUBMIT_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_COMPLETE_CNT_OFF  (24UL)
+#define FD_METRICS_COUNTER_NET_TX_COMPLETE_CNT_OFF  (25UL)
 #define FD_METRICS_COUNTER_NET_TX_COMPLETE_CNT_NAME "net_tx_complete_cnt"
 #define FD_METRICS_COUNTER_NET_TX_COMPLETE_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_COMPLETE_CNT_DESC "Number of packet transmit jobs marked as completed by the kernel."
 #define FD_METRICS_COUNTER_NET_TX_COMPLETE_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_BYTES_TOTAL_OFF  (25UL)
+#define FD_METRICS_COUNTER_NET_TX_BYTES_TOTAL_OFF  (26UL)
 #define FD_METRICS_COUNTER_NET_TX_BYTES_TOTAL_NAME "net_tx_bytes_total"
 #define FD_METRICS_COUNTER_NET_TX_BYTES_TOTAL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_BYTES_TOTAL_DESC "Total number of bytes transmitted (including Ethernet header)."
 #define FD_METRICS_COUNTER_NET_TX_BYTES_TOTAL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_ROUTE_FAIL_CNT_OFF  (26UL)
+#define FD_METRICS_COUNTER_NET_TX_ROUTE_FAIL_CNT_OFF  (27UL)
 #define FD_METRICS_COUNTER_NET_TX_ROUTE_FAIL_CNT_NAME "net_tx_route_fail_cnt"
 #define FD_METRICS_COUNTER_NET_TX_ROUTE_FAIL_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_ROUTE_FAIL_CNT_DESC "Number of packet transmit jobs dropped due to route failure."
 #define FD_METRICS_COUNTER_NET_TX_ROUTE_FAIL_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_NEIGHBOR_FAIL_CNT_OFF  (27UL)
+#define FD_METRICS_COUNTER_NET_TX_NEIGHBOR_FAIL_CNT_OFF  (28UL)
 #define FD_METRICS_COUNTER_NET_TX_NEIGHBOR_FAIL_CNT_NAME "net_tx_neighbor_fail_cnt"
 #define FD_METRICS_COUNTER_NET_TX_NEIGHBOR_FAIL_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_NEIGHBOR_FAIL_CNT_DESC "Number of packet transmit jobs dropped due to unresolved neighbor."
 #define FD_METRICS_COUNTER_NET_TX_NEIGHBOR_FAIL_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_FULL_FAIL_CNT_OFF  (28UL)
+#define FD_METRICS_COUNTER_NET_TX_FULL_FAIL_CNT_OFF  (29UL)
 #define FD_METRICS_COUNTER_NET_TX_FULL_FAIL_CNT_NAME "net_tx_full_fail_cnt"
 #define FD_METRICS_COUNTER_NET_TX_FULL_FAIL_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_FULL_FAIL_CNT_DESC "Number of packet transmit jobs dropped due to XDP TX ring full or missing completions."
 #define FD_METRICS_COUNTER_NET_TX_FULL_FAIL_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_NET_TX_BUSY_CNT_OFF  (29UL)
+#define FD_METRICS_GAUGE_NET_TX_BUSY_CNT_OFF  (30UL)
 #define FD_METRICS_GAUGE_NET_TX_BUSY_CNT_NAME "net_tx_busy_cnt"
 #define FD_METRICS_GAUGE_NET_TX_BUSY_CNT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_NET_TX_BUSY_CNT_DESC "Number of transmit buffers currently busy."
 #define FD_METRICS_GAUGE_NET_TX_BUSY_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_NET_TX_IDLE_CNT_OFF  (30UL)
+#define FD_METRICS_GAUGE_NET_TX_IDLE_CNT_OFF  (31UL)
 #define FD_METRICS_GAUGE_NET_TX_IDLE_CNT_NAME "net_tx_idle_cnt"
 #define FD_METRICS_GAUGE_NET_TX_IDLE_CNT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_NET_TX_IDLE_CNT_DESC "Number of transmit buffers currently idle."
 #define FD_METRICS_GAUGE_NET_TX_IDLE_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XSK_TX_WAKEUP_CNT_OFF  (31UL)
+#define FD_METRICS_COUNTER_NET_XSK_TX_WAKEUP_CNT_OFF  (32UL)
 #define FD_METRICS_COUNTER_NET_XSK_TX_WAKEUP_CNT_NAME "net_xsk_tx_wakeup_cnt"
 #define FD_METRICS_COUNTER_NET_XSK_TX_WAKEUP_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XSK_TX_WAKEUP_CNT_DESC "Number of XSK sendto syscalls dispatched."
 #define FD_METRICS_COUNTER_NET_XSK_TX_WAKEUP_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XSK_RX_WAKEUP_CNT_OFF  (32UL)
+#define FD_METRICS_COUNTER_NET_XSK_RX_WAKEUP_CNT_OFF  (33UL)
 #define FD_METRICS_COUNTER_NET_XSK_RX_WAKEUP_CNT_NAME "net_xsk_rx_wakeup_cnt"
 #define FD_METRICS_COUNTER_NET_XSK_RX_WAKEUP_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XSK_RX_WAKEUP_CNT_DESC "Number of XSK recvmsg syscalls dispatched."
 #define FD_METRICS_COUNTER_NET_XSK_RX_WAKEUP_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XDP_RX_DROPPED_OTHER_OFF  (33UL)
+#define FD_METRICS_COUNTER_NET_XDP_RX_DROPPED_OTHER_OFF  (34UL)
 #define FD_METRICS_COUNTER_NET_XDP_RX_DROPPED_OTHER_NAME "net_xdp_rx_dropped_other"
 #define FD_METRICS_COUNTER_NET_XDP_RX_DROPPED_OTHER_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XDP_RX_DROPPED_OTHER_DESC "xdp_statistics_v0.rx_dropped: Dropped for other reasons"
 #define FD_METRICS_COUNTER_NET_XDP_RX_DROPPED_OTHER_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XDP_RX_INVALID_DESCS_OFF  (34UL)
+#define FD_METRICS_COUNTER_NET_XDP_RX_INVALID_DESCS_OFF  (35UL)
 #define FD_METRICS_COUNTER_NET_XDP_RX_INVALID_DESCS_NAME "net_xdp_rx_invalid_descs"
 #define FD_METRICS_COUNTER_NET_XDP_RX_INVALID_DESCS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XDP_RX_INVALID_DESCS_DESC "xdp_statistics_v0.rx_invalid_descs: Dropped due to invalid descriptor"
 #define FD_METRICS_COUNTER_NET_XDP_RX_INVALID_DESCS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XDP_TX_INVALID_DESCS_OFF  (35UL)
+#define FD_METRICS_COUNTER_NET_XDP_TX_INVALID_DESCS_OFF  (36UL)
 #define FD_METRICS_COUNTER_NET_XDP_TX_INVALID_DESCS_NAME "net_xdp_tx_invalid_descs"
 #define FD_METRICS_COUNTER_NET_XDP_TX_INVALID_DESCS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XDP_TX_INVALID_DESCS_DESC "xdp_statistics_v0.tx_invalid_descs: Dropped due to invalid descriptor"
 #define FD_METRICS_COUNTER_NET_XDP_TX_INVALID_DESCS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XDP_RX_RING_FULL_OFF  (36UL)
+#define FD_METRICS_COUNTER_NET_XDP_RX_RING_FULL_OFF  (37UL)
 #define FD_METRICS_COUNTER_NET_XDP_RX_RING_FULL_NAME "net_xdp_rx_ring_full"
 #define FD_METRICS_COUNTER_NET_XDP_RX_RING_FULL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XDP_RX_RING_FULL_DESC "xdp_statistics_v1.rx_ring_full: Dropped due to rx ring being full"
 #define FD_METRICS_COUNTER_NET_XDP_RX_RING_FULL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XDP_RX_FILL_RING_EMPTY_DESCS_OFF  (37UL)
+#define FD_METRICS_COUNTER_NET_XDP_RX_FILL_RING_EMPTY_DESCS_OFF  (38UL)
 #define FD_METRICS_COUNTER_NET_XDP_RX_FILL_RING_EMPTY_DESCS_NAME "net_xdp_rx_fill_ring_empty_descs"
 #define FD_METRICS_COUNTER_NET_XDP_RX_FILL_RING_EMPTY_DESCS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XDP_RX_FILL_RING_EMPTY_DESCS_DESC "xdp_statistics_v1.rx_fill_ring_empty_descs: Failed to retrieve item from fill ring"
 #define FD_METRICS_COUNTER_NET_XDP_RX_FILL_RING_EMPTY_DESCS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_XDP_TX_RING_EMPTY_DESCS_OFF  (38UL)
+#define FD_METRICS_COUNTER_NET_XDP_TX_RING_EMPTY_DESCS_OFF  (39UL)
 #define FD_METRICS_COUNTER_NET_XDP_TX_RING_EMPTY_DESCS_NAME "net_xdp_tx_ring_empty_descs"
 #define FD_METRICS_COUNTER_NET_XDP_TX_RING_EMPTY_DESCS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_XDP_TX_RING_EMPTY_DESCS_DESC "xdp_statistics_v1.tx_ring_empty_descs: Failed to retrieve item from tx ring"
 #define FD_METRICS_COUNTER_NET_XDP_TX_RING_EMPTY_DESCS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_RX_GRE_CNT_OFF  (39UL)
+#define FD_METRICS_COUNTER_NET_RX_GRE_CNT_OFF  (40UL)
 #define FD_METRICS_COUNTER_NET_RX_GRE_CNT_NAME "net_rx_gre_cnt"
 #define FD_METRICS_COUNTER_NET_RX_GRE_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_GRE_CNT_DESC "Number of valid GRE packets received"
 #define FD_METRICS_COUNTER_NET_RX_GRE_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_RX_GRE_INVALID_CNT_OFF  (40UL)
+#define FD_METRICS_COUNTER_NET_RX_GRE_INVALID_CNT_OFF  (41UL)
 #define FD_METRICS_COUNTER_NET_RX_GRE_INVALID_CNT_NAME "net_rx_gre_invalid_cnt"
 #define FD_METRICS_COUNTER_NET_RX_GRE_INVALID_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_GRE_INVALID_CNT_DESC "Number of invalid GRE packets received"
 #define FD_METRICS_COUNTER_NET_RX_GRE_INVALID_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_RX_GRE_IGNORED_CNT_OFF  (41UL)
+#define FD_METRICS_COUNTER_NET_RX_GRE_IGNORED_CNT_OFF  (42UL)
 #define FD_METRICS_COUNTER_NET_RX_GRE_IGNORED_CNT_NAME "net_rx_gre_ignored_cnt"
 #define FD_METRICS_COUNTER_NET_RX_GRE_IGNORED_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_RX_GRE_IGNORED_CNT_DESC "Number of received but ignored GRE packets"
 #define FD_METRICS_COUNTER_NET_RX_GRE_IGNORED_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_GRE_CNT_OFF  (42UL)
+#define FD_METRICS_COUNTER_NET_TX_GRE_CNT_OFF  (43UL)
 #define FD_METRICS_COUNTER_NET_TX_GRE_CNT_NAME "net_tx_gre_cnt"
 #define FD_METRICS_COUNTER_NET_TX_GRE_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_GRE_CNT_DESC "Number of GRE packet transmit jobs submitted"
 #define FD_METRICS_COUNTER_NET_TX_GRE_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NET_TX_GRE_ROUTE_FAIL_CNT_OFF  (43UL)
+#define FD_METRICS_COUNTER_NET_TX_GRE_ROUTE_FAIL_CNT_OFF  (44UL)
 #define FD_METRICS_COUNTER_NET_TX_GRE_ROUTE_FAIL_CNT_NAME "net_tx_gre_route_fail_cnt"
 #define FD_METRICS_COUNTER_NET_TX_GRE_ROUTE_FAIL_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NET_TX_GRE_ROUTE_FAIL_CNT_DESC "Number of GRE packets transmit jobs dropped due to route failure"
diff --git a/src/disco/metrics/generated/fd_metrics_netlnk.h b/src/disco/metrics/generated/fd_metrics_netlnk.h
index dd884acdb0..e6289549a2 100644
--- a/src/disco/metrics/generated/fd_metrics_netlnk.h
+++ b/src/disco/metrics/generated/fd_metrics_netlnk.h
@@ -3,70 +3,70 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_NETLNK_DROP_EVENTS_OFF  (16UL)
+#define FD_METRICS_COUNTER_NETLNK_DROP_EVENTS_OFF  (17UL)
 #define FD_METRICS_COUNTER_NETLNK_DROP_EVENTS_NAME "netlnk_drop_events"
 #define FD_METRICS_COUNTER_NETLNK_DROP_EVENTS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_DROP_EVENTS_DESC "Number of netlink drop events caught"
 #define FD_METRICS_COUNTER_NETLNK_DROP_EVENTS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NETLNK_LINK_FULL_SYNCS_OFF  (17UL)
+#define FD_METRICS_COUNTER_NETLNK_LINK_FULL_SYNCS_OFF  (18UL)
 #define FD_METRICS_COUNTER_NETLNK_LINK_FULL_SYNCS_NAME "netlnk_link_full_syncs"
 #define FD_METRICS_COUNTER_NETLNK_LINK_FULL_SYNCS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_LINK_FULL_SYNCS_DESC "Number of full link table syncs done"
 #define FD_METRICS_COUNTER_NETLNK_LINK_FULL_SYNCS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NETLNK_ROUTE_FULL_SYNCS_OFF  (18UL)
+#define FD_METRICS_COUNTER_NETLNK_ROUTE_FULL_SYNCS_OFF  (19UL)
 #define FD_METRICS_COUNTER_NETLNK_ROUTE_FULL_SYNCS_NAME "netlnk_route_full_syncs"
 #define FD_METRICS_COUNTER_NETLNK_ROUTE_FULL_SYNCS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_ROUTE_FULL_SYNCS_DESC "Number of full route table syncs done"
 #define FD_METRICS_COUNTER_NETLNK_ROUTE_FULL_SYNCS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NETLNK_UPDATES_OFF  (19UL)
+#define FD_METRICS_COUNTER_NETLNK_UPDATES_OFF  (20UL)
 #define FD_METRICS_COUNTER_NETLNK_UPDATES_NAME "netlnk_updates"
 #define FD_METRICS_COUNTER_NETLNK_UPDATES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_UPDATES_DESC "Number of netlink live updates processed"
 #define FD_METRICS_COUNTER_NETLNK_UPDATES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_NETLNK_UPDATES_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_NETLNK_UPDATES_LINK_OFF (19UL)
-#define FD_METRICS_COUNTER_NETLNK_UPDATES_NEIGH_OFF (20UL)
-#define FD_METRICS_COUNTER_NETLNK_UPDATES_IPV4_ROUTE_OFF (21UL)
+#define FD_METRICS_COUNTER_NETLNK_UPDATES_LINK_OFF (20UL)
+#define FD_METRICS_COUNTER_NETLNK_UPDATES_NEIGH_OFF (21UL)
+#define FD_METRICS_COUNTER_NETLNK_UPDATES_IPV4_ROUTE_OFF (22UL)
 
-#define FD_METRICS_GAUGE_NETLNK_INTERFACE_COUNT_OFF  (22UL)
+#define FD_METRICS_GAUGE_NETLNK_INTERFACE_COUNT_OFF  (23UL)
 #define FD_METRICS_GAUGE_NETLNK_INTERFACE_COUNT_NAME "netlnk_interface_count"
 #define FD_METRICS_GAUGE_NETLNK_INTERFACE_COUNT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_NETLNK_INTERFACE_COUNT_DESC "Number of network interfaces"
 #define FD_METRICS_GAUGE_NETLNK_INTERFACE_COUNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_OFF  (23UL)
+#define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_OFF  (24UL)
 #define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_NAME "netlnk_route_count"
 #define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_DESC "Number of IPv4 routes"
 #define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_CNT  (2UL)
 
-#define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_LOCAL_OFF (23UL)
-#define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_MAIN_OFF (24UL)
+#define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_LOCAL_OFF (24UL)
+#define FD_METRICS_GAUGE_NETLNK_ROUTE_COUNT_MAIN_OFF (25UL)
 
-#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_SENT_OFF  (25UL)
+#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_SENT_OFF  (26UL)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_SENT_NAME "netlnk_neigh_probe_sent"
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_SENT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_SENT_DESC "Number of neighbor solicit requests sent to kernel"
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_SENT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_FAILS_OFF  (26UL)
+#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_FAILS_OFF  (27UL)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_FAILS_NAME "netlnk_neigh_probe_fails"
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_FAILS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_FAILS_DESC "Number of neighbor solicit requests that failed to send (kernel too slow)"
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_FAILS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_HOST_OFF  (27UL)
+#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_HOST_OFF  (28UL)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_HOST_NAME "netlnk_neigh_probe_rate_limit_host"
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_HOST_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_HOST_DESC "Number of neighbor solicit that exceeded the per-host rate limit"
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_HOST_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_GLOBAL_OFF  (28UL)
+#define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_GLOBAL_OFF  (29UL)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_GLOBAL_NAME "netlnk_neigh_probe_rate_limit_global"
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_GLOBAL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_NETLNK_NEIGH_PROBE_RATE_LIMIT_GLOBAL_DESC "Number of neighbor solicit that exceeded the global rate limit"
diff --git a/src/disco/metrics/generated/fd_metrics_pack.h b/src/disco/metrics/generated/fd_metrics_pack.h
index 9e45d92034..3e7b6cf384 100644
--- a/src/disco/metrics/generated/fd_metrics_pack.h
+++ b/src/disco/metrics/generated/fd_metrics_pack.h
@@ -3,7 +3,7 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_HISTOGRAM_PACK_SCHEDULE_MICROBLOCK_DURATION_SECONDS_OFF  (16UL)
+#define FD_METRICS_HISTOGRAM_PACK_SCHEDULE_MICROBLOCK_DURATION_SECONDS_OFF  (17UL)
 #define FD_METRICS_HISTOGRAM_PACK_SCHEDULE_MICROBLOCK_DURATION_SECONDS_NAME "pack_schedule_microblock_duration_seconds"
 #define FD_METRICS_HISTOGRAM_PACK_SCHEDULE_MICROBLOCK_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_SCHEDULE_MICROBLOCK_DURATION_SECONDS_DESC "Duration of scheduling one microblock"
@@ -11,7 +11,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_SCHEDULE_MICROBLOCK_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_PACK_SCHEDULE_MICROBLOCK_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_HISTOGRAM_PACK_NO_SCHED_MICROBLOCK_DURATION_SECONDS_OFF  (33UL)
+#define FD_METRICS_HISTOGRAM_PACK_NO_SCHED_MICROBLOCK_DURATION_SECONDS_OFF  (34UL)
 #define FD_METRICS_HISTOGRAM_PACK_NO_SCHED_MICROBLOCK_DURATION_SECONDS_NAME "pack_no_sched_microblock_duration_seconds"
 #define FD_METRICS_HISTOGRAM_PACK_NO_SCHED_MICROBLOCK_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_NO_SCHED_MICROBLOCK_DURATION_SECONDS_DESC "Duration of discovering that there are no schedulable transactions"
@@ -19,7 +19,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_NO_SCHED_MICROBLOCK_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_PACK_NO_SCHED_MICROBLOCK_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_HISTOGRAM_PACK_INSERT_TRANSACTION_DURATION_SECONDS_OFF  (50UL)
+#define FD_METRICS_HISTOGRAM_PACK_INSERT_TRANSACTION_DURATION_SECONDS_OFF  (51UL)
 #define FD_METRICS_HISTOGRAM_PACK_INSERT_TRANSACTION_DURATION_SECONDS_NAME "pack_insert_transaction_duration_seconds"
 #define FD_METRICS_HISTOGRAM_PACK_INSERT_TRANSACTION_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_INSERT_TRANSACTION_DURATION_SECONDS_DESC "Duration of inserting one transaction into the pool of available transactions"
@@ -27,7 +27,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_INSERT_TRANSACTION_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_PACK_INSERT_TRANSACTION_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_HISTOGRAM_PACK_COMPLETE_MICROBLOCK_DURATION_SECONDS_OFF  (67UL)
+#define FD_METRICS_HISTOGRAM_PACK_COMPLETE_MICROBLOCK_DURATION_SECONDS_OFF  (68UL)
 #define FD_METRICS_HISTOGRAM_PACK_COMPLETE_MICROBLOCK_DURATION_SECONDS_NAME "pack_complete_microblock_duration_seconds"
 #define FD_METRICS_HISTOGRAM_PACK_COMPLETE_MICROBLOCK_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_COMPLETE_MICROBLOCK_DURATION_SECONDS_DESC "Duration of the computation associated with marking one microblock as complete"
@@ -35,7 +35,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_COMPLETE_MICROBLOCK_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_PACK_COMPLETE_MICROBLOCK_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_HISTOGRAM_PACK_TOTAL_TRANSACTIONS_PER_MICROBLOCK_COUNT_OFF  (84UL)
+#define FD_METRICS_HISTOGRAM_PACK_TOTAL_TRANSACTIONS_PER_MICROBLOCK_COUNT_OFF  (85UL)
 #define FD_METRICS_HISTOGRAM_PACK_TOTAL_TRANSACTIONS_PER_MICROBLOCK_COUNT_NAME "pack_total_transactions_per_microblock_count"
 #define FD_METRICS_HISTOGRAM_PACK_TOTAL_TRANSACTIONS_PER_MICROBLOCK_COUNT_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_TOTAL_TRANSACTIONS_PER_MICROBLOCK_COUNT_DESC "Count of transactions in a scheduled microblock, including both votes and non-votes"
@@ -43,7 +43,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_TOTAL_TRANSACTIONS_PER_MICROBLOCK_COUNT_MIN  (0UL)
 #define FD_METRICS_HISTOGRAM_PACK_TOTAL_TRANSACTIONS_PER_MICROBLOCK_COUNT_MAX  (64UL)
 
-#define FD_METRICS_HISTOGRAM_PACK_VOTES_PER_MICROBLOCK_COUNT_OFF  (101UL)
+#define FD_METRICS_HISTOGRAM_PACK_VOTES_PER_MICROBLOCK_COUNT_OFF  (102UL)
 #define FD_METRICS_HISTOGRAM_PACK_VOTES_PER_MICROBLOCK_COUNT_NAME "pack_votes_per_microblock_count"
 #define FD_METRICS_HISTOGRAM_PACK_VOTES_PER_MICROBLOCK_COUNT_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_VOTES_PER_MICROBLOCK_COUNT_DESC "Count of simple vote transactions in a scheduled microblock"
@@ -51,172 +51,172 @@
 #define FD_METRICS_HISTOGRAM_PACK_VOTES_PER_MICROBLOCK_COUNT_MIN  (0UL)
 #define FD_METRICS_HISTOGRAM_PACK_VOTES_PER_MICROBLOCK_COUNT_MAX  (64UL)
 
-#define FD_METRICS_COUNTER_PACK_NORMAL_TRANSACTION_RECEIVED_OFF  (118UL)
+#define FD_METRICS_COUNTER_PACK_NORMAL_TRANSACTION_RECEIVED_OFF  (119UL)
 #define FD_METRICS_COUNTER_PACK_NORMAL_TRANSACTION_RECEIVED_NAME "pack_normal_transaction_received"
 #define FD_METRICS_COUNTER_PACK_NORMAL_TRANSACTION_RECEIVED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_NORMAL_TRANSACTION_RECEIVED_DESC "Count of transactions received via the normal TPU path"
 #define FD_METRICS_COUNTER_PACK_NORMAL_TRANSACTION_RECEIVED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_OFF  (119UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_OFF  (120UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NAME "pack_transaction_inserted"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_DESC "Result of inserting a transaction into the pack object"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_CNT  (21UL)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_CONFLICT_OFF (119UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_BUNDLE_BLACKLIST_OFF (120UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_INVALID_NONCE_OFF (121UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_WRITE_SYSVAR_OFF (122UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_ESTIMATION_FAIL_OFF (123UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_DUPLICATE_ACCOUNT_OFF (124UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TOO_MANY_ACCOUNTS_OFF (125UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TOO_LARGE_OFF (126UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_EXPIRED_OFF (127UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_ADDR_LUT_OFF (128UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_UNAFFORDABLE_OFF (129UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_DUPLICATE_OFF (130UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_PRIORITY_OFF (131UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_PRIORITY_OFF (132UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONVOTE_ADD_OFF (133UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_VOTE_ADD_OFF (134UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONVOTE_REPLACE_OFF (135UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_VOTE_REPLACE_OFF (136UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_NONVOTE_ADD_OFF (137UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_UNUSED_OFF (138UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_NONVOTE_REPLACE_OFF (139UL)
-
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_OFF  (140UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_CONFLICT_OFF (120UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_BUNDLE_BLACKLIST_OFF (121UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_INVALID_NONCE_OFF (122UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_WRITE_SYSVAR_OFF (123UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_ESTIMATION_FAIL_OFF (124UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_DUPLICATE_ACCOUNT_OFF (125UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TOO_MANY_ACCOUNTS_OFF (126UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TOO_LARGE_OFF (127UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_EXPIRED_OFF (128UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_ADDR_LUT_OFF (129UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_UNAFFORDABLE_OFF (130UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_DUPLICATE_OFF (131UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_PRIORITY_OFF (132UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_PRIORITY_OFF (133UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONVOTE_ADD_OFF (134UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_VOTE_ADD_OFF (135UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONVOTE_REPLACE_OFF (136UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_VOTE_REPLACE_OFF (137UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_NONVOTE_ADD_OFF (138UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_UNUSED_OFF (139UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_NONCE_NONVOTE_REPLACE_OFF (140UL)
+
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_OFF  (141UL)
 #define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NAME "pack_metric_timing"
 #define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_METRIC_TIMING_DESC "Time in nanos spent in each state"
 #define FD_METRICS_COUNTER_PACK_METRIC_TIMING_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_PACK_METRIC_TIMING_CNT  (16UL)
 
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_NO_LEADER_NO_MICROBLOCK_OFF (140UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_NO_LEADER_NO_MICROBLOCK_OFF (141UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_NO_LEADER_NO_MICROBLOCK_OFF (142UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_NO_LEADER_NO_MICROBLOCK_OFF (143UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_LEADER_NO_MICROBLOCK_OFF (144UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_LEADER_NO_MICROBLOCK_OFF (145UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_LEADER_NO_MICROBLOCK_OFF (146UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_LEADER_NO_MICROBLOCK_OFF (147UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_NO_LEADER_MICROBLOCK_OFF (148UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_NO_LEADER_MICROBLOCK_OFF (149UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_NO_LEADER_MICROBLOCK_OFF (150UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_NO_LEADER_MICROBLOCK_OFF (151UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_LEADER_MICROBLOCK_OFF (152UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_LEADER_MICROBLOCK_OFF (153UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_LEADER_MICROBLOCK_OFF (154UL)
-#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_LEADER_MICROBLOCK_OFF (155UL)
-
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_FROM_EXTRA_OFF  (156UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_NO_LEADER_NO_MICROBLOCK_OFF (141UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_NO_LEADER_NO_MICROBLOCK_OFF (142UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_NO_LEADER_NO_MICROBLOCK_OFF (143UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_NO_LEADER_NO_MICROBLOCK_OFF (144UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_LEADER_NO_MICROBLOCK_OFF (145UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_LEADER_NO_MICROBLOCK_OFF (146UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_LEADER_NO_MICROBLOCK_OFF (147UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_LEADER_NO_MICROBLOCK_OFF (148UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_NO_LEADER_MICROBLOCK_OFF (149UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_NO_LEADER_MICROBLOCK_OFF (150UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_NO_LEADER_MICROBLOCK_OFF (151UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_NO_LEADER_MICROBLOCK_OFF (152UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_NO_BANK_LEADER_MICROBLOCK_OFF (153UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_NO_BANK_LEADER_MICROBLOCK_OFF (154UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_NO_TXN_BANK_LEADER_MICROBLOCK_OFF (155UL)
+#define FD_METRICS_COUNTER_PACK_METRIC_TIMING_TXN_BANK_LEADER_MICROBLOCK_OFF (156UL)
+
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_FROM_EXTRA_OFF  (157UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_FROM_EXTRA_NAME "pack_transaction_dropped_from_extra"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_FROM_EXTRA_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_FROM_EXTRA_DESC "Transactions dropped from the extra transaction storage because it was full"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_FROM_EXTRA_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TO_EXTRA_OFF  (157UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TO_EXTRA_OFF  (158UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TO_EXTRA_NAME "pack_transaction_inserted_to_extra"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TO_EXTRA_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TO_EXTRA_DESC "Transactions inserted into the extra transaction storage because pack's primary storage was full"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_TO_EXTRA_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_FROM_EXTRA_OFF  (158UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_FROM_EXTRA_OFF  (159UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_FROM_EXTRA_NAME "pack_transaction_inserted_from_extra"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_FROM_EXTRA_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_FROM_EXTRA_DESC "Transactions pulled from the extra transaction storage and inserted into pack's primary storage"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_INSERTED_FROM_EXTRA_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_EXPIRED_OFF  (159UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_EXPIRED_OFF  (160UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_EXPIRED_NAME "pack_transaction_expired"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_EXPIRED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_EXPIRED_DESC "Transactions deleted from pack because their TTL expired"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_EXPIRED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_DELETED_OFF  (160UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_DELETED_OFF  (161UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DELETED_NAME "pack_transaction_deleted"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DELETED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DELETED_DESC "Transactions dropped from pack because they were requested to be deleted"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DELETED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_PARTIAL_BUNDLE_OFF  (161UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_PARTIAL_BUNDLE_OFF  (162UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_PARTIAL_BUNDLE_NAME "pack_transaction_dropped_partial_bundle"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_PARTIAL_BUNDLE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_PARTIAL_BUNDLE_DESC "Transactions dropped from pack because they were part of a partial bundle"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_DROPPED_PARTIAL_BUNDLE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_OFF  (162UL)
+#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_OFF  (163UL)
 #define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_NAME "pack_available_transactions"
 #define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_DESC "The total number of pending transactions in pack's pool that are available to be scheduled"
 #define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_CNT  (5UL)
 
-#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_ALL_OFF (162UL)
-#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_REGULAR_OFF (163UL)
-#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_VOTES_OFF (164UL)
-#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_CONFLICTING_OFF (165UL)
-#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_BUNDLES_OFF (166UL)
+#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_ALL_OFF (163UL)
+#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_REGULAR_OFF (164UL)
+#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_VOTES_OFF (165UL)
+#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_CONFLICTING_OFF (166UL)
+#define FD_METRICS_GAUGE_PACK_AVAILABLE_TRANSACTIONS_BUNDLES_OFF (167UL)
 
-#define FD_METRICS_GAUGE_PACK_PENDING_TRANSACTIONS_HEAP_SIZE_OFF  (167UL)
+#define FD_METRICS_GAUGE_PACK_PENDING_TRANSACTIONS_HEAP_SIZE_OFF  (168UL)
 #define FD_METRICS_GAUGE_PACK_PENDING_TRANSACTIONS_HEAP_SIZE_NAME "pack_pending_transactions_heap_size"
 #define FD_METRICS_GAUGE_PACK_PENDING_TRANSACTIONS_HEAP_SIZE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_PACK_PENDING_TRANSACTIONS_HEAP_SIZE_DESC "The maximum number of pending transactions that pack can consider.  This value is fixed at Firedancer startup but is a useful reference for AvailableTransactions."
 #define FD_METRICS_GAUGE_PACK_PENDING_TRANSACTIONS_HEAP_SIZE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_PACK_SMALLEST_PENDING_TRANSACTION_OFF  (168UL)
+#define FD_METRICS_GAUGE_PACK_SMALLEST_PENDING_TRANSACTION_OFF  (169UL)
 #define FD_METRICS_GAUGE_PACK_SMALLEST_PENDING_TRANSACTION_NAME "pack_smallest_pending_transaction"
 #define FD_METRICS_GAUGE_PACK_SMALLEST_PENDING_TRANSACTION_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_PACK_SMALLEST_PENDING_TRANSACTION_DESC "A lower bound on the smallest non-vote transaction (in cost units) that is immediately available for scheduling"
 #define FD_METRICS_GAUGE_PACK_SMALLEST_PENDING_TRANSACTION_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_MICROBLOCK_PER_BLOCK_LIMIT_OFF  (169UL)
+#define FD_METRICS_COUNTER_PACK_MICROBLOCK_PER_BLOCK_LIMIT_OFF  (170UL)
 #define FD_METRICS_COUNTER_PACK_MICROBLOCK_PER_BLOCK_LIMIT_NAME "pack_microblock_per_block_limit"
 #define FD_METRICS_COUNTER_PACK_MICROBLOCK_PER_BLOCK_LIMIT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_MICROBLOCK_PER_BLOCK_LIMIT_DESC "The number of times pack did not pack a microblock because the limit on microblocks/block had been reached"
 #define FD_METRICS_COUNTER_PACK_MICROBLOCK_PER_BLOCK_LIMIT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_DATA_PER_BLOCK_LIMIT_OFF  (170UL)
+#define FD_METRICS_COUNTER_PACK_DATA_PER_BLOCK_LIMIT_OFF  (171UL)
 #define FD_METRICS_COUNTER_PACK_DATA_PER_BLOCK_LIMIT_NAME "pack_data_per_block_limit"
 #define FD_METRICS_COUNTER_PACK_DATA_PER_BLOCK_LIMIT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_DATA_PER_BLOCK_LIMIT_DESC "The number of times pack did not pack a microblock because it reached the data per block limit at the start of trying to schedule a microblock"
 #define FD_METRICS_COUNTER_PACK_DATA_PER_BLOCK_LIMIT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_OFF  (171UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_OFF  (172UL)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_NAME "pack_transaction_schedule"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_DESC "Result of trying to consider a transaction for scheduling"
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_CNT  (7UL)
 
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_TAKEN_OFF (171UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_CU_LIMIT_OFF (172UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_FAST_PATH_OFF (173UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_BYTE_LIMIT_OFF (174UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_WRITE_COST_OFF (175UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_SLOW_PATH_OFF (176UL)
-#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_DEFER_SKIP_OFF (177UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_TAKEN_OFF (172UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_CU_LIMIT_OFF (173UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_FAST_PATH_OFF (174UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_BYTE_LIMIT_OFF (175UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_WRITE_COST_OFF (176UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_SLOW_PATH_OFF (177UL)
+#define FD_METRICS_COUNTER_PACK_TRANSACTION_SCHEDULE_DEFER_SKIP_OFF (178UL)
 
-#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_OFF  (178UL)
+#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_OFF  (179UL)
 #define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_NAME "pack_bundle_crank_status"
 #define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_DESC "Result of considering whether bundle cranks are needed"
 #define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_CNT  (4UL)
 
-#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_NOT_NEEDED_OFF (178UL)
-#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_INSERTED_OFF (179UL)
-#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_CREATION_FAILED_OFF (180UL)
-#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_INSERTION_FAILED_OFF (181UL)
+#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_NOT_NEEDED_OFF (179UL)
+#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_INSERTED_OFF (180UL)
+#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_CREATION_FAILED_OFF (181UL)
+#define FD_METRICS_COUNTER_PACK_BUNDLE_CRANK_STATUS_INSERTION_FAILED_OFF (182UL)
 
-#define FD_METRICS_GAUGE_PACK_CUS_CONSUMED_IN_BLOCK_OFF  (182UL)
+#define FD_METRICS_GAUGE_PACK_CUS_CONSUMED_IN_BLOCK_OFF  (183UL)
 #define FD_METRICS_GAUGE_PACK_CUS_CONSUMED_IN_BLOCK_NAME "pack_cus_consumed_in_block"
 #define FD_METRICS_GAUGE_PACK_CUS_CONSUMED_IN_BLOCK_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_PACK_CUS_CONSUMED_IN_BLOCK_DESC "The number of cost units consumed in the current block, or 0 if pack is not currently packing a block"
 #define FD_METRICS_GAUGE_PACK_CUS_CONSUMED_IN_BLOCK_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_HISTOGRAM_PACK_CUS_SCHEDULED_OFF  (183UL)
+#define FD_METRICS_HISTOGRAM_PACK_CUS_SCHEDULED_OFF  (184UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_SCHEDULED_NAME "pack_cus_scheduled"
 #define FD_METRICS_HISTOGRAM_PACK_CUS_SCHEDULED_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_SCHEDULED_DESC "The number of cost units scheduled for each block pack produced.  This can be higher than the block limit because of returned CUs."
@@ -224,7 +224,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_CUS_SCHEDULED_MIN  (1000000UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_SCHEDULED_MAX  (240000000UL)
 
-#define FD_METRICS_HISTOGRAM_PACK_CUS_REBATED_OFF  (200UL)
+#define FD_METRICS_HISTOGRAM_PACK_CUS_REBATED_OFF  (201UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_REBATED_NAME "pack_cus_rebated"
 #define FD_METRICS_HISTOGRAM_PACK_CUS_REBATED_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_REBATED_DESC "The number of compute units rebated for each block pack produced.  Compute units are rebated when a transaction fails prior to execution or requests more compute units than it uses."
@@ -232,7 +232,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_CUS_REBATED_MIN  (1000000UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_REBATED_MAX  (240000000UL)
 
-#define FD_METRICS_HISTOGRAM_PACK_CUS_NET_OFF  (217UL)
+#define FD_METRICS_HISTOGRAM_PACK_CUS_NET_OFF  (218UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_NET_NAME "pack_cus_net"
 #define FD_METRICS_HISTOGRAM_PACK_CUS_NET_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_NET_DESC "The net number of cost units (scheduled - rebated) in each block pack produced."
@@ -240,7 +240,7 @@
 #define FD_METRICS_HISTOGRAM_PACK_CUS_NET_MIN  (1000000UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_NET_MAX  (100000000UL)
 
-#define FD_METRICS_HISTOGRAM_PACK_CUS_PCT_OFF  (234UL)
+#define FD_METRICS_HISTOGRAM_PACK_CUS_PCT_OFF  (235UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_PCT_NAME "pack_cus_pct"
 #define FD_METRICS_HISTOGRAM_PACK_CUS_PCT_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_PCT_DESC "The percent of the total block cost limit used for each block pack produced."
@@ -248,13 +248,13 @@
 #define FD_METRICS_HISTOGRAM_PACK_CUS_PCT_MIN  (0UL)
 #define FD_METRICS_HISTOGRAM_PACK_CUS_PCT_MAX  (100UL)
 
-#define FD_METRICS_COUNTER_PACK_DELETE_MISSED_OFF  (251UL)
+#define FD_METRICS_COUNTER_PACK_DELETE_MISSED_OFF  (252UL)
 #define FD_METRICS_COUNTER_PACK_DELETE_MISSED_NAME "pack_delete_missed"
 #define FD_METRICS_COUNTER_PACK_DELETE_MISSED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_DELETE_MISSED_DESC "Count of attempts to delete a transaction that wasn't found"
 #define FD_METRICS_COUNTER_PACK_DELETE_MISSED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_PACK_DELETE_HIT_OFF  (252UL)
+#define FD_METRICS_COUNTER_PACK_DELETE_HIT_OFF  (253UL)
 #define FD_METRICS_COUNTER_PACK_DELETE_HIT_NAME "pack_delete_hit"
 #define FD_METRICS_COUNTER_PACK_DELETE_HIT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_PACK_DELETE_HIT_DESC "Count of attempts to delete a transaction that was found and deleted"
diff --git a/src/disco/metrics/generated/fd_metrics_poh.h b/src/disco/metrics/generated/fd_metrics_poh.h
index 147b9d9c03..263f761af5 100644
--- a/src/disco/metrics/generated/fd_metrics_poh.h
+++ b/src/disco/metrics/generated/fd_metrics_poh.h
@@ -3,7 +3,7 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_HISTOGRAM_POH_BEGIN_LEADER_DELAY_SECONDS_OFF  (16UL)
+#define FD_METRICS_HISTOGRAM_POH_BEGIN_LEADER_DELAY_SECONDS_OFF  (17UL)
 #define FD_METRICS_HISTOGRAM_POH_BEGIN_LEADER_DELAY_SECONDS_NAME "poh_begin_leader_delay_seconds"
 #define FD_METRICS_HISTOGRAM_POH_BEGIN_LEADER_DELAY_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_POH_BEGIN_LEADER_DELAY_SECONDS_DESC "Delay between when we become leader in a slot and when we receive the bank."
@@ -11,7 +11,7 @@
 #define FD_METRICS_HISTOGRAM_POH_BEGIN_LEADER_DELAY_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_POH_BEGIN_LEADER_DELAY_SECONDS_MAX  (0.01)
 
-#define FD_METRICS_HISTOGRAM_POH_FIRST_MICROBLOCK_DELAY_SECONDS_OFF  (33UL)
+#define FD_METRICS_HISTOGRAM_POH_FIRST_MICROBLOCK_DELAY_SECONDS_OFF  (34UL)
 #define FD_METRICS_HISTOGRAM_POH_FIRST_MICROBLOCK_DELAY_SECONDS_NAME "poh_first_microblock_delay_seconds"
 #define FD_METRICS_HISTOGRAM_POH_FIRST_MICROBLOCK_DELAY_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_POH_FIRST_MICROBLOCK_DELAY_SECONDS_DESC "Delay between when we become leader in a slot and when we receive the first microblock."
@@ -19,7 +19,7 @@
 #define FD_METRICS_HISTOGRAM_POH_FIRST_MICROBLOCK_DELAY_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_POH_FIRST_MICROBLOCK_DELAY_SECONDS_MAX  (0.01)
 
-#define FD_METRICS_HISTOGRAM_POH_SLOT_DONE_DELAY_SECONDS_OFF  (50UL)
+#define FD_METRICS_HISTOGRAM_POH_SLOT_DONE_DELAY_SECONDS_OFF  (51UL)
 #define FD_METRICS_HISTOGRAM_POH_SLOT_DONE_DELAY_SECONDS_NAME "poh_slot_done_delay_seconds"
 #define FD_METRICS_HISTOGRAM_POH_SLOT_DONE_DELAY_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_POH_SLOT_DONE_DELAY_SECONDS_DESC "Delay between when we become leader in a slot and when we finish the slot."
@@ -27,7 +27,7 @@
 #define FD_METRICS_HISTOGRAM_POH_SLOT_DONE_DELAY_SECONDS_MIN  (0.001)
 #define FD_METRICS_HISTOGRAM_POH_SLOT_DONE_DELAY_SECONDS_MAX  (0.6)
 
-#define FD_METRICS_HISTOGRAM_POH_BUNDLE_INITIALIZE_DELAY_SECONDS_OFF  (67UL)
+#define FD_METRICS_HISTOGRAM_POH_BUNDLE_INITIALIZE_DELAY_SECONDS_OFF  (68UL)
 #define FD_METRICS_HISTOGRAM_POH_BUNDLE_INITIALIZE_DELAY_SECONDS_NAME "poh_bundle_initialize_delay_seconds"
 #define FD_METRICS_HISTOGRAM_POH_BUNDLE_INITIALIZE_DELAY_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_POH_BUNDLE_INITIALIZE_DELAY_SECONDS_DESC "Delay in starting the slot caused by loading the information needed to generate the bundle crank transactions"
diff --git a/src/disco/metrics/generated/fd_metrics_quic.h b/src/disco/metrics/generated/fd_metrics_quic.h
index 0a68cc5152..d4fa11652c 100644
--- a/src/disco/metrics/generated/fd_metrics_quic.h
+++ b/src/disco/metrics/generated/fd_metrics_quic.h
@@ -3,273 +3,273 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_QUIC_TXNS_OVERRUN_OFF  (16UL)
+#define FD_METRICS_COUNTER_QUIC_TXNS_OVERRUN_OFF  (17UL)
 #define FD_METRICS_COUNTER_QUIC_TXNS_OVERRUN_NAME "quic_txns_overrun"
 #define FD_METRICS_COUNTER_QUIC_TXNS_OVERRUN_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_TXNS_OVERRUN_DESC "Count of txns overrun before reassembled (too small txn_reassembly_count)."
 #define FD_METRICS_COUNTER_QUIC_TXNS_OVERRUN_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_TXN_REASMS_STARTED_OFF  (17UL)
+#define FD_METRICS_COUNTER_QUIC_TXN_REASMS_STARTED_OFF  (18UL)
 #define FD_METRICS_COUNTER_QUIC_TXN_REASMS_STARTED_NAME "quic_txn_reasms_started"
 #define FD_METRICS_COUNTER_QUIC_TXN_REASMS_STARTED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_TXN_REASMS_STARTED_DESC "Count of fragmented txn receive ops started."
 #define FD_METRICS_COUNTER_QUIC_TXN_REASMS_STARTED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_QUIC_TXN_REASMS_ACTIVE_OFF  (18UL)
+#define FD_METRICS_GAUGE_QUIC_TXN_REASMS_ACTIVE_OFF  (19UL)
 #define FD_METRICS_GAUGE_QUIC_TXN_REASMS_ACTIVE_NAME "quic_txn_reasms_active"
 #define FD_METRICS_GAUGE_QUIC_TXN_REASMS_ACTIVE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_QUIC_TXN_REASMS_ACTIVE_DESC "Number of fragmented txn receive ops currently active."
 #define FD_METRICS_GAUGE_QUIC_TXN_REASMS_ACTIVE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_FRAGS_OK_OFF  (19UL)
+#define FD_METRICS_COUNTER_QUIC_FRAGS_OK_OFF  (20UL)
 #define FD_METRICS_COUNTER_QUIC_FRAGS_OK_NAME "quic_frags_ok"
 #define FD_METRICS_COUNTER_QUIC_FRAGS_OK_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_FRAGS_OK_DESC "Count of txn frags received"
 #define FD_METRICS_COUNTER_QUIC_FRAGS_OK_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_FRAGS_GAP_OFF  (20UL)
+#define FD_METRICS_COUNTER_QUIC_FRAGS_GAP_OFF  (21UL)
 #define FD_METRICS_COUNTER_QUIC_FRAGS_GAP_NAME "quic_frags_gap"
 #define FD_METRICS_COUNTER_QUIC_FRAGS_GAP_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_FRAGS_GAP_DESC "Count of txn frags dropped due to data gap"
 #define FD_METRICS_COUNTER_QUIC_FRAGS_GAP_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_FRAGS_DUP_OFF  (21UL)
+#define FD_METRICS_COUNTER_QUIC_FRAGS_DUP_OFF  (22UL)
 #define FD_METRICS_COUNTER_QUIC_FRAGS_DUP_NAME "quic_frags_dup"
 #define FD_METRICS_COUNTER_QUIC_FRAGS_DUP_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_FRAGS_DUP_DESC "Count of txn frags dropped due to dup (stream already completed)"
 #define FD_METRICS_COUNTER_QUIC_FRAGS_DUP_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_OFF  (22UL)
+#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_OFF  (23UL)
 #define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_NAME "quic_txns_received"
 #define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_DESC "Count of txns received via TPU."
 #define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_UDP_OFF (22UL)
-#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_QUIC_FAST_OFF (23UL)
-#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_QUIC_FRAG_OFF (24UL)
+#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_UDP_OFF (23UL)
+#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_QUIC_FAST_OFF (24UL)
+#define FD_METRICS_COUNTER_QUIC_TXNS_RECEIVED_QUIC_FRAG_OFF (25UL)
 
-#define FD_METRICS_COUNTER_QUIC_TXNS_ABANDONED_OFF  (25UL)
+#define FD_METRICS_COUNTER_QUIC_TXNS_ABANDONED_OFF  (26UL)
 #define FD_METRICS_COUNTER_QUIC_TXNS_ABANDONED_NAME "quic_txns_abandoned"
 #define FD_METRICS_COUNTER_QUIC_TXNS_ABANDONED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_TXNS_ABANDONED_DESC "Count of txns abandoned because a conn was lost."
 #define FD_METRICS_COUNTER_QUIC_TXNS_ABANDONED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_TXN_UNDERSZ_OFF  (26UL)
+#define FD_METRICS_COUNTER_QUIC_TXN_UNDERSZ_OFF  (27UL)
 #define FD_METRICS_COUNTER_QUIC_TXN_UNDERSZ_NAME "quic_txn_undersz"
 #define FD_METRICS_COUNTER_QUIC_TXN_UNDERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_TXN_UNDERSZ_DESC "Count of txns received via QUIC dropped because they were too small."
 #define FD_METRICS_COUNTER_QUIC_TXN_UNDERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_TXN_OVERSZ_OFF  (27UL)
+#define FD_METRICS_COUNTER_QUIC_TXN_OVERSZ_OFF  (28UL)
 #define FD_METRICS_COUNTER_QUIC_TXN_OVERSZ_NAME "quic_txn_oversz"
 #define FD_METRICS_COUNTER_QUIC_TXN_OVERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_TXN_OVERSZ_DESC "Count of txns received via QUIC dropped because they were too large."
 #define FD_METRICS_COUNTER_QUIC_TXN_OVERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_UNDERSZ_OFF  (28UL)
+#define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_UNDERSZ_OFF  (29UL)
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_UNDERSZ_NAME "quic_legacy_txn_undersz"
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_UNDERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_UNDERSZ_DESC "Count of packets received on the non-QUIC port that were too small to be a valid IP packet."
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_UNDERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_OVERSZ_OFF  (29UL)
+#define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_OVERSZ_OFF  (30UL)
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_OVERSZ_NAME "quic_legacy_txn_oversz"
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_OVERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_OVERSZ_DESC "Count of packets received on the non-QUIC port that were too large to be a valid transaction."
 #define FD_METRICS_COUNTER_QUIC_LEGACY_TXN_OVERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_PACKETS_OFF  (30UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_PACKETS_OFF  (31UL)
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_PACKETS_NAME "quic_received_packets"
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_PACKETS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_PACKETS_DESC "Number of IP packets received."
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_PACKETS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_BYTES_OFF  (31UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_BYTES_OFF  (32UL)
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_BYTES_NAME "quic_received_bytes"
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_BYTES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_BYTES_DESC "Total bytes received (including IP, UDP, QUIC headers)."
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_BYTES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_SENT_PACKETS_OFF  (32UL)
+#define FD_METRICS_COUNTER_QUIC_SENT_PACKETS_OFF  (33UL)
 #define FD_METRICS_COUNTER_QUIC_SENT_PACKETS_NAME "quic_sent_packets"
 #define FD_METRICS_COUNTER_QUIC_SENT_PACKETS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_SENT_PACKETS_DESC "Number of IP packets sent."
 #define FD_METRICS_COUNTER_QUIC_SENT_PACKETS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_SENT_BYTES_OFF  (33UL)
+#define FD_METRICS_COUNTER_QUIC_SENT_BYTES_OFF  (34UL)
 #define FD_METRICS_COUNTER_QUIC_SENT_BYTES_NAME "quic_sent_bytes"
 #define FD_METRICS_COUNTER_QUIC_SENT_BYTES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_SENT_BYTES_DESC "Total bytes sent (including IP, UDP, QUIC headers)."
 #define FD_METRICS_COUNTER_QUIC_SENT_BYTES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_ALLOC_OFF  (34UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_ALLOC_OFF  (35UL)
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_ALLOC_NAME "quic_connections_alloc"
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_ALLOC_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_ALLOC_DESC "The number of currently allocated QUIC connections."
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_ALLOC_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_OFF  (35UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_OFF  (36UL)
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_NAME "quic_connections_state"
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_DESC "The number of QUIC connections in each state."
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_CNT  (8UL)
 
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_INVALID_OFF (35UL)
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_HANDSHAKE_OFF (36UL)
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_HANDSHAKE_COMPLETE_OFF (37UL)
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_ACTIVE_OFF (38UL)
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_PEER_CLOSE_OFF (39UL)
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_ABORT_OFF (40UL)
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_CLOSE_PENDING_OFF (41UL)
-#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_DEAD_OFF (42UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_INVALID_OFF (36UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_HANDSHAKE_OFF (37UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_HANDSHAKE_COMPLETE_OFF (38UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_ACTIVE_OFF (39UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_PEER_CLOSE_OFF (40UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_ABORT_OFF (41UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_CLOSE_PENDING_OFF (42UL)
+#define FD_METRICS_GAUGE_QUIC_CONNECTIONS_STATE_DEAD_OFF (43UL)
 
-#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CREATED_OFF  (43UL)
+#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CREATED_OFF  (44UL)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CREATED_NAME "quic_connections_created"
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CREATED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CREATED_DESC "The total number of connections that have been created."
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CREATED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CLOSED_OFF  (44UL)
+#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CLOSED_OFF  (45UL)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CLOSED_NAME "quic_connections_closed"
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CLOSED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CLOSED_DESC "Number of connections gracefully closed."
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_CLOSED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_ABORTED_OFF  (45UL)
+#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_ABORTED_OFF  (46UL)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_ABORTED_NAME "quic_connections_aborted"
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_ABORTED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_ABORTED_DESC "Number of connections aborted."
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_ABORTED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_TIMED_OUT_OFF  (46UL)
+#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_TIMED_OUT_OFF  (47UL)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_TIMED_OUT_NAME "quic_connections_timed_out"
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_TIMED_OUT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_TIMED_OUT_DESC "Number of connections timed out."
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_TIMED_OUT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_RETRIED_OFF  (47UL)
+#define FD_METRICS_COUNTER_QUIC_CONNECTIONS_RETRIED_OFF  (48UL)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_RETRIED_NAME "quic_connections_retried"
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_RETRIED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_RETRIED_DESC "Number of connections established with retry."
 #define FD_METRICS_COUNTER_QUIC_CONNECTIONS_RETRIED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_NO_SLOTS_OFF  (48UL)
+#define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_NO_SLOTS_OFF  (49UL)
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_NO_SLOTS_NAME "quic_connection_error_no_slots"
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_NO_SLOTS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_NO_SLOTS_DESC "Number of connections that failed to create due to lack of slots."
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_NO_SLOTS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_RETRY_FAIL_OFF  (49UL)
+#define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_RETRY_FAIL_OFF  (50UL)
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_RETRY_FAIL_NAME "quic_connection_error_retry_fail"
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_RETRY_FAIL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_RETRY_FAIL_DESC "Number of connections that failed during retry (e.g. invalid token)."
 #define FD_METRICS_COUNTER_QUIC_CONNECTION_ERROR_RETRY_FAIL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_NO_CONN_OFF  (50UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_NO_CONN_OFF  (51UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_CONN_NAME "quic_pkt_no_conn"
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_CONN_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_CONN_DESC "Number of packets with an unknown connection ID."
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_CONN_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_OFF  (51UL)
+#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_OFF  (52UL)
 #define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_NAME "quic_frame_tx_alloc"
 #define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_DESC "Results of attempts to acquire QUIC frame metadata."
 #define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_SUCCESS_OFF (51UL)
-#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_FAIL_EMPTY_POOL_OFF (52UL)
-#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_FAIL_CONN_MAX_OFF (53UL)
+#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_SUCCESS_OFF (52UL)
+#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_FAIL_EMPTY_POOL_OFF (53UL)
+#define FD_METRICS_COUNTER_QUIC_FRAME_TX_ALLOC_FAIL_CONN_MAX_OFF (54UL)
 
-#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_OFF  (54UL)
+#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_OFF  (55UL)
 #define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_NAME "quic_initial_token_len"
 #define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_DESC "Number of Initial packets grouped by token length."
 #define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_ZERO_OFF (54UL)
-#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_FD_QUIC_LEN_OFF (55UL)
-#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_INVALID_LEN_OFF (56UL)
+#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_ZERO_OFF (55UL)
+#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_FD_QUIC_LEN_OFF (56UL)
+#define FD_METRICS_COUNTER_QUIC_INITIAL_TOKEN_LEN_INVALID_LEN_OFF (57UL)
 
-#define FD_METRICS_COUNTER_QUIC_HANDSHAKES_CREATED_OFF  (57UL)
+#define FD_METRICS_COUNTER_QUIC_HANDSHAKES_CREATED_OFF  (58UL)
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKES_CREATED_NAME "quic_handshakes_created"
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKES_CREATED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKES_CREATED_DESC "Number of handshake flows created."
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKES_CREATED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_HANDSHAKE_ERROR_ALLOC_FAIL_OFF  (58UL)
+#define FD_METRICS_COUNTER_QUIC_HANDSHAKE_ERROR_ALLOC_FAIL_OFF  (59UL)
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_ERROR_ALLOC_FAIL_NAME "quic_handshake_error_alloc_fail"
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_ERROR_ALLOC_FAIL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_ERROR_ALLOC_FAIL_DESC "Number of handshakes dropped due to alloc fail."
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_ERROR_ALLOC_FAIL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_HANDSHAKE_EVICTED_OFF  (59UL)
+#define FD_METRICS_COUNTER_QUIC_HANDSHAKE_EVICTED_OFF  (60UL)
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_EVICTED_NAME "quic_handshake_evicted"
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_EVICTED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_EVICTED_DESC "Number of handshakes dropped due to eviction."
 #define FD_METRICS_COUNTER_QUIC_HANDSHAKE_EVICTED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_EVENTS_OFF  (60UL)
+#define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_EVENTS_OFF  (61UL)
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_EVENTS_NAME "quic_stream_received_events"
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_EVENTS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_EVENTS_DESC "Number of stream RX events."
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_EVENTS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_BYTES_OFF  (61UL)
+#define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_BYTES_OFF  (62UL)
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_BYTES_NAME "quic_stream_received_bytes"
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_BYTES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_BYTES_DESC "Total stream payload bytes received."
 #define FD_METRICS_COUNTER_QUIC_STREAM_RECEIVED_BYTES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_OFF  (62UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_OFF  (63UL)
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_NAME "quic_received_frames"
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_DESC "Number of QUIC frames received."
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CNT  (22UL)
 
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_UNKNOWN_OFF (62UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_ACK_OFF (63UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_RESET_STREAM_OFF (64UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STOP_SENDING_OFF (65UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CRYPTO_OFF (66UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_NEW_TOKEN_OFF (67UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STREAM_OFF (68UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_MAX_DATA_OFF (69UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_MAX_STREAM_DATA_OFF (70UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_MAX_STREAMS_OFF (71UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_DATA_BLOCKED_OFF (72UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STREAM_DATA_BLOCKED_OFF (73UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STREAMS_BLOCKED_OFF (74UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_NEW_CONN_ID_OFF (75UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_RETIRE_CONN_ID_OFF (76UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PATH_CHALLENGE_OFF (77UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PATH_RESPONSE_OFF (78UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CONN_CLOSE_QUIC_OFF (79UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CONN_CLOSE_APP_OFF (80UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_HANDSHAKE_DONE_OFF (81UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PING_OFF (82UL)
-#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PADDING_OFF (83UL)
-
-#define FD_METRICS_COUNTER_QUIC_ACK_TX_OFF  (84UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_UNKNOWN_OFF (63UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_ACK_OFF (64UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_RESET_STREAM_OFF (65UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STOP_SENDING_OFF (66UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CRYPTO_OFF (67UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_NEW_TOKEN_OFF (68UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STREAM_OFF (69UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_MAX_DATA_OFF (70UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_MAX_STREAM_DATA_OFF (71UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_MAX_STREAMS_OFF (72UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_DATA_BLOCKED_OFF (73UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STREAM_DATA_BLOCKED_OFF (74UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_STREAMS_BLOCKED_OFF (75UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_NEW_CONN_ID_OFF (76UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_RETIRE_CONN_ID_OFF (77UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PATH_CHALLENGE_OFF (78UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PATH_RESPONSE_OFF (79UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CONN_CLOSE_QUIC_OFF (80UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_CONN_CLOSE_APP_OFF (81UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_HANDSHAKE_DONE_OFF (82UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PING_OFF (83UL)
+#define FD_METRICS_COUNTER_QUIC_RECEIVED_FRAMES_PADDING_OFF (84UL)
+
+#define FD_METRICS_COUNTER_QUIC_ACK_TX_OFF  (85UL)
 #define FD_METRICS_COUNTER_QUIC_ACK_TX_NAME "quic_ack_tx"
 #define FD_METRICS_COUNTER_QUIC_ACK_TX_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_ACK_TX_DESC "ACK events"
 #define FD_METRICS_COUNTER_QUIC_ACK_TX_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_QUIC_ACK_TX_CNT  (5UL)
 
-#define FD_METRICS_COUNTER_QUIC_ACK_TX_NOOP_OFF (84UL)
-#define FD_METRICS_COUNTER_QUIC_ACK_TX_NEW_OFF (85UL)
-#define FD_METRICS_COUNTER_QUIC_ACK_TX_MERGED_OFF (86UL)
-#define FD_METRICS_COUNTER_QUIC_ACK_TX_DROP_OFF (87UL)
-#define FD_METRICS_COUNTER_QUIC_ACK_TX_CANCEL_OFF (88UL)
+#define FD_METRICS_COUNTER_QUIC_ACK_TX_NOOP_OFF (85UL)
+#define FD_METRICS_COUNTER_QUIC_ACK_TX_NEW_OFF (86UL)
+#define FD_METRICS_COUNTER_QUIC_ACK_TX_MERGED_OFF (87UL)
+#define FD_METRICS_COUNTER_QUIC_ACK_TX_DROP_OFF (88UL)
+#define FD_METRICS_COUNTER_QUIC_ACK_TX_CANCEL_OFF (89UL)
 
-#define FD_METRICS_HISTOGRAM_QUIC_SERVICE_DURATION_SECONDS_OFF  (89UL)
+#define FD_METRICS_HISTOGRAM_QUIC_SERVICE_DURATION_SECONDS_OFF  (90UL)
 #define FD_METRICS_HISTOGRAM_QUIC_SERVICE_DURATION_SECONDS_NAME "quic_service_duration_seconds"
 #define FD_METRICS_HISTOGRAM_QUIC_SERVICE_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_QUIC_SERVICE_DURATION_SECONDS_DESC "Duration spent in service"
@@ -277,7 +277,7 @@
 #define FD_METRICS_HISTOGRAM_QUIC_SERVICE_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_QUIC_SERVICE_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_HISTOGRAM_QUIC_RECEIVE_DURATION_SECONDS_OFF  (106UL)
+#define FD_METRICS_HISTOGRAM_QUIC_RECEIVE_DURATION_SECONDS_OFF  (107UL)
 #define FD_METRICS_HISTOGRAM_QUIC_RECEIVE_DURATION_SECONDS_NAME "quic_receive_duration_seconds"
 #define FD_METRICS_HISTOGRAM_QUIC_RECEIVE_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_QUIC_RECEIVE_DURATION_SECONDS_DESC "Duration spent processing packets"
@@ -285,73 +285,73 @@
 #define FD_METRICS_HISTOGRAM_QUIC_RECEIVE_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_QUIC_RECEIVE_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_COUNTER_QUIC_FRAME_FAIL_PARSE_OFF  (123UL)
+#define FD_METRICS_COUNTER_QUIC_FRAME_FAIL_PARSE_OFF  (124UL)
 #define FD_METRICS_COUNTER_QUIC_FRAME_FAIL_PARSE_NAME "quic_frame_fail_parse"
 #define FD_METRICS_COUNTER_QUIC_FRAME_FAIL_PARSE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_FRAME_FAIL_PARSE_DESC "Number of QUIC frames failed to parse."
 #define FD_METRICS_COUNTER_QUIC_FRAME_FAIL_PARSE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_OFF  (124UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_OFF  (125UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_NAME "quic_pkt_crypto_failed"
 #define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_DESC "Number of packets that failed decryption."
 #define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_CNT  (4UL)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_INITIAL_OFF (124UL)
-#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_EARLY_OFF (125UL)
-#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_HANDSHAKE_OFF (126UL)
-#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_APP_OFF (127UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_INITIAL_OFF (125UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_EARLY_OFF (126UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_HANDSHAKE_OFF (127UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_CRYPTO_FAILED_APP_OFF (128UL)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_OFF  (128UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_OFF  (129UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_NAME "quic_pkt_no_key"
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_DESC "Number of packets that failed decryption due to missing key."
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_CNT  (4UL)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_INITIAL_OFF (128UL)
-#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_EARLY_OFF (129UL)
-#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_HANDSHAKE_OFF (130UL)
-#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_APP_OFF (131UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_INITIAL_OFF (129UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_EARLY_OFF (130UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_HANDSHAKE_OFF (131UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_NO_KEY_APP_OFF (132UL)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_NET_HEADER_INVALID_OFF  (132UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_NET_HEADER_INVALID_OFF  (133UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_NET_HEADER_INVALID_NAME "quic_pkt_net_header_invalid"
 #define FD_METRICS_COUNTER_QUIC_PKT_NET_HEADER_INVALID_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_NET_HEADER_INVALID_DESC "Number of packets dropped due to weird IP or UDP header."
 #define FD_METRICS_COUNTER_QUIC_PKT_NET_HEADER_INVALID_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_QUIC_HEADER_INVALID_OFF  (133UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_QUIC_HEADER_INVALID_OFF  (134UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_QUIC_HEADER_INVALID_NAME "quic_pkt_quic_header_invalid"
 #define FD_METRICS_COUNTER_QUIC_PKT_QUIC_HEADER_INVALID_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_QUIC_HEADER_INVALID_DESC "Number of packets dropped due to weird QUIC header."
 #define FD_METRICS_COUNTER_QUIC_PKT_QUIC_HEADER_INVALID_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_UNDERSZ_OFF  (134UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_UNDERSZ_OFF  (135UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_UNDERSZ_NAME "quic_pkt_undersz"
 #define FD_METRICS_COUNTER_QUIC_PKT_UNDERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_UNDERSZ_DESC "Number of QUIC packets dropped due to being too small."
 #define FD_METRICS_COUNTER_QUIC_PKT_UNDERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_OVERSZ_OFF  (135UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_OVERSZ_OFF  (136UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_OVERSZ_NAME "quic_pkt_oversz"
 #define FD_METRICS_COUNTER_QUIC_PKT_OVERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_OVERSZ_DESC "Number of QUIC packets dropped due to being too large."
 #define FD_METRICS_COUNTER_QUIC_PKT_OVERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_VERNEG_OFF  (136UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_VERNEG_OFF  (137UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_VERNEG_NAME "quic_pkt_verneg"
 #define FD_METRICS_COUNTER_QUIC_PKT_VERNEG_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_VERNEG_DESC "Number of QUIC version negotiation packets received."
 #define FD_METRICS_COUNTER_QUIC_PKT_VERNEG_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_RETRY_SENT_OFF  (137UL)
+#define FD_METRICS_COUNTER_QUIC_RETRY_SENT_OFF  (138UL)
 #define FD_METRICS_COUNTER_QUIC_RETRY_SENT_NAME "quic_retry_sent"
 #define FD_METRICS_COUNTER_QUIC_RETRY_SENT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_RETRY_SENT_DESC "Number of QUIC Retry packets sent."
 #define FD_METRICS_COUNTER_QUIC_RETRY_SENT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_QUIC_PKT_RETRANSMISSIONS_OFF  (138UL)
+#define FD_METRICS_COUNTER_QUIC_PKT_RETRANSMISSIONS_OFF  (139UL)
 #define FD_METRICS_COUNTER_QUIC_PKT_RETRANSMISSIONS_NAME "quic_pkt_retransmissions"
 #define FD_METRICS_COUNTER_QUIC_PKT_RETRANSMISSIONS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_QUIC_PKT_RETRANSMISSIONS_DESC "Number of QUIC packets that retransmitted."
diff --git a/src/disco/metrics/generated/fd_metrics_repair.h b/src/disco/metrics/generated/fd_metrics_repair.h
index 0993d05d83..333b1ee0de 100644
--- a/src/disco/metrics/generated/fd_metrics_repair.h
+++ b/src/disco/metrics/generated/fd_metrics_repair.h
@@ -3,71 +3,71 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_CLNT_PKT_OFF  (16UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_CLNT_PKT_OFF  (17UL)
 #define FD_METRICS_COUNTER_REPAIR_RECV_CLNT_PKT_NAME "repair_recv_clnt_pkt"
 #define FD_METRICS_COUNTER_REPAIR_RECV_CLNT_PKT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_RECV_CLNT_PKT_DESC "Now many client packets have we received"
 #define FD_METRICS_COUNTER_REPAIR_RECV_CLNT_PKT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_OFF  (17UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_OFF  (18UL)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_NAME "repair_recv_serv_pkt"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_DESC "How many server packets have we received"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_CORRUPT_PKT_OFF  (18UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_CORRUPT_PKT_OFF  (19UL)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_CORRUPT_PKT_NAME "repair_recv_serv_corrupt_pkt"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_CORRUPT_PKT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_CORRUPT_PKT_DESC "How many corrupt server packets have we received"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_CORRUPT_PKT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_INVALID_SIGNATURE_OFF  (19UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_INVALID_SIGNATURE_OFF  (20UL)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_INVALID_SIGNATURE_NAME "repair_recv_serv_invalid_signature"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_INVALID_SIGNATURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_INVALID_SIGNATURE_DESC "How many invalid signatures have we received"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_INVALID_SIGNATURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_FULL_PING_TABLE_OFF  (20UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_FULL_PING_TABLE_OFF  (21UL)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_FULL_PING_TABLE_NAME "repair_recv_serv_full_ping_table"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_FULL_PING_TABLE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_FULL_PING_TABLE_DESC "Is our ping table full and causing packet drops"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_FULL_PING_TABLE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_OFF  (21UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_OFF  (22UL)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_NAME "repair_recv_serv_pkt_types"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_DESC "Server messages received"
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_CNT  (5UL)
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_PONG_OFF (21UL)
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_WINDOW_OFF (22UL)
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_HIGHEST_WINDOW_OFF (23UL)
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_ORPHAN_OFF (24UL)
-#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_UNKNOWN_OFF (25UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_PONG_OFF (22UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_WINDOW_OFF (23UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_HIGHEST_WINDOW_OFF (24UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_ORPHAN_OFF (25UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_SERV_PKT_TYPES_UNKNOWN_OFF (26UL)
 
-#define FD_METRICS_COUNTER_REPAIR_RECV_PKT_CORRUPTED_MSG_OFF  (26UL)
+#define FD_METRICS_COUNTER_REPAIR_RECV_PKT_CORRUPTED_MSG_OFF  (27UL)
 #define FD_METRICS_COUNTER_REPAIR_RECV_PKT_CORRUPTED_MSG_NAME "repair_recv_pkt_corrupted_msg"
 #define FD_METRICS_COUNTER_REPAIR_RECV_PKT_CORRUPTED_MSG_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_RECV_PKT_CORRUPTED_MSG_DESC "How many corrupt messages have we received"
 #define FD_METRICS_COUNTER_REPAIR_RECV_PKT_CORRUPTED_MSG_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_REPAIR_SEND_PKT_CNT_OFF  (27UL)
+#define FD_METRICS_COUNTER_REPAIR_SEND_PKT_CNT_OFF  (28UL)
 #define FD_METRICS_COUNTER_REPAIR_SEND_PKT_CNT_NAME "repair_send_pkt_cnt"
 #define FD_METRICS_COUNTER_REPAIR_SEND_PKT_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_SEND_PKT_CNT_DESC "How many packets have sent"
 #define FD_METRICS_COUNTER_REPAIR_SEND_PKT_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_OFF  (28UL)
+#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_OFF  (29UL)
 #define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_NAME "repair_sent_pkt_types"
 #define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_DESC "What types of client messages are we sending"
 #define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_NEEDED_WINDOW_OFF (28UL)
-#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_NEEDED_HIGHEST_WINDOW_OFF (29UL)
-#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_NEEDED_ORPHAN_OFF (30UL)
+#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_NEEDED_WINDOW_OFF (29UL)
+#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_NEEDED_HIGHEST_WINDOW_OFF (30UL)
+#define FD_METRICS_COUNTER_REPAIR_SENT_PKT_TYPES_NEEDED_ORPHAN_OFF (31UL)
 
 #define FD_METRICS_REPAIR_TOTAL (15UL)
 extern const fd_metrics_meta_t FD_METRICS_REPAIR[FD_METRICS_REPAIR_TOTAL];
diff --git a/src/disco/metrics/generated/fd_metrics_replay.h b/src/disco/metrics/generated/fd_metrics_replay.h
index d5bddf36ed..9b37d2ec35 100644
--- a/src/disco/metrics/generated/fd_metrics_replay.h
+++ b/src/disco/metrics/generated/fd_metrics_replay.h
@@ -3,13 +3,13 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_GAUGE_REPLAY_SLOT_OFF  (16UL)
+#define FD_METRICS_GAUGE_REPLAY_SLOT_OFF  (17UL)
 #define FD_METRICS_GAUGE_REPLAY_SLOT_NAME "replay_slot"
 #define FD_METRICS_GAUGE_REPLAY_SLOT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_REPLAY_SLOT_DESC ""
 #define FD_METRICS_GAUGE_REPLAY_SLOT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_REPLAY_LAST_VOTED_SLOT_OFF  (17UL)
+#define FD_METRICS_GAUGE_REPLAY_LAST_VOTED_SLOT_OFF  (18UL)
 #define FD_METRICS_GAUGE_REPLAY_LAST_VOTED_SLOT_NAME "replay_last_voted_slot"
 #define FD_METRICS_GAUGE_REPLAY_LAST_VOTED_SLOT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_REPLAY_LAST_VOTED_SLOT_DESC ""
diff --git a/src/disco/metrics/generated/fd_metrics_resolv.h b/src/disco/metrics/generated/fd_metrics_resolv.h
index 8161478c44..218a2d9e44 100644
--- a/src/disco/metrics/generated/fd_metrics_resolv.h
+++ b/src/disco/metrics/generated/fd_metrics_resolv.h
@@ -3,45 +3,45 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_RESOLV_NO_BANK_DROP_OFF  (16UL)
+#define FD_METRICS_COUNTER_RESOLV_NO_BANK_DROP_OFF  (17UL)
 #define FD_METRICS_COUNTER_RESOLV_NO_BANK_DROP_NAME "resolv_no_bank_drop"
 #define FD_METRICS_COUNTER_RESOLV_NO_BANK_DROP_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_RESOLV_NO_BANK_DROP_DESC "Count of transactions dropped because the bank was not available"
 #define FD_METRICS_COUNTER_RESOLV_NO_BANK_DROP_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_OFF  (17UL)
+#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_OFF  (18UL)
 #define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_NAME "resolv_stash_operation"
 #define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_DESC "Count of operations that happened on the transaction stash"
 #define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_CNT  (4UL)
 
-#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_INSERTED_OFF (17UL)
-#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_OVERRUN_OFF (18UL)
-#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_PUBLISHED_OFF (19UL)
-#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_REMOVED_OFF (20UL)
+#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_INSERTED_OFF (18UL)
+#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_OVERRUN_OFF (19UL)
+#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_PUBLISHED_OFF (20UL)
+#define FD_METRICS_COUNTER_RESOLV_STASH_OPERATION_REMOVED_OFF (21UL)
 
-#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_OFF  (21UL)
+#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_OFF  (22UL)
 #define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_NAME "resolv_lut_resolved"
 #define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_DESC "Count of address lookup tables resolved"
 #define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_CNT  (6UL)
 
-#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_INVALID_LOOKUP_INDEX_OFF (21UL)
-#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_ACCOUNT_UNINITIALIZED_OFF (22UL)
-#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_INVALID_ACCOUNT_DATA_OFF (23UL)
-#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_INVALID_ACCOUNT_OWNER_OFF (24UL)
-#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_ACCOUNT_NOT_FOUND_OFF (25UL)
-#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_SUCCESS_OFF (26UL)
+#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_INVALID_LOOKUP_INDEX_OFF (22UL)
+#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_ACCOUNT_UNINITIALIZED_OFF (23UL)
+#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_INVALID_ACCOUNT_DATA_OFF (24UL)
+#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_INVALID_ACCOUNT_OWNER_OFF (25UL)
+#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_ACCOUNT_NOT_FOUND_OFF (26UL)
+#define FD_METRICS_COUNTER_RESOLV_LUT_RESOLVED_SUCCESS_OFF (27UL)
 
-#define FD_METRICS_COUNTER_RESOLV_BLOCKHASH_EXPIRED_OFF  (27UL)
+#define FD_METRICS_COUNTER_RESOLV_BLOCKHASH_EXPIRED_OFF  (28UL)
 #define FD_METRICS_COUNTER_RESOLV_BLOCKHASH_EXPIRED_NAME "resolv_blockhash_expired"
 #define FD_METRICS_COUNTER_RESOLV_BLOCKHASH_EXPIRED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_RESOLV_BLOCKHASH_EXPIRED_DESC "Count of transactions that failed to resolve because the blockhash was expired"
 #define FD_METRICS_COUNTER_RESOLV_BLOCKHASH_EXPIRED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_RESOLV_TRANSACTION_BUNDLE_PEER_FAILURE_OFF  (28UL)
+#define FD_METRICS_COUNTER_RESOLV_TRANSACTION_BUNDLE_PEER_FAILURE_OFF  (29UL)
 #define FD_METRICS_COUNTER_RESOLV_TRANSACTION_BUNDLE_PEER_FAILURE_NAME "resolv_transaction_bundle_peer_failure"
 #define FD_METRICS_COUNTER_RESOLV_TRANSACTION_BUNDLE_PEER_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_RESOLV_TRANSACTION_BUNDLE_PEER_FAILURE_DESC "Count of transactions that failed to resolve because a peer transaction in the bundle failed"
diff --git a/src/disco/metrics/generated/fd_metrics_send.h b/src/disco/metrics/generated/fd_metrics_send.h
index bb85209ac2..c41b65e6c5 100644
--- a/src/disco/metrics/generated/fd_metrics_send.h
+++ b/src/disco/metrics/generated/fd_metrics_send.h
@@ -3,305 +3,305 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_SEND_LEADER_NOT_FOUND_OFF  (16UL)
+#define FD_METRICS_COUNTER_SEND_LEADER_NOT_FOUND_OFF  (17UL)
 #define FD_METRICS_COUNTER_SEND_LEADER_NOT_FOUND_NAME "send_leader_not_found"
 #define FD_METRICS_COUNTER_SEND_LEADER_NOT_FOUND_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_LEADER_NOT_FOUND_DESC "Total number of times slot leader not found"
 #define FD_METRICS_COUNTER_SEND_LEADER_NOT_FOUND_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_OFF  (17UL)
+#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_OFF  (18UL)
 #define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_NAME "send_new_contact_info"
 #define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_DESC "Total number of contact infos received and handled"
 #define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_CNT  (5UL)
 
-#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_CONNECT_OFF (17UL)
-#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_UNROUTABLE_OFF (18UL)
-#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_UNSTAKED_OFF (19UL)
-#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_CHANGED_OFF (20UL)
-#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_NO_CHANGE_OFF (21UL)
+#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_CONNECT_OFF (18UL)
+#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_UNROUTABLE_OFF (19UL)
+#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_UNSTAKED_OFF (20UL)
+#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_CHANGED_OFF (21UL)
+#define FD_METRICS_COUNTER_SEND_NEW_CONTACT_INFO_NO_CHANGE_OFF (22UL)
 
-#define FD_METRICS_COUNTER_SEND_CONTACT_STALE_OFF  (22UL)
+#define FD_METRICS_COUNTER_SEND_CONTACT_STALE_OFF  (23UL)
 #define FD_METRICS_COUNTER_SEND_CONTACT_STALE_NAME "send_contact_stale"
 #define FD_METRICS_COUNTER_SEND_CONTACT_STALE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONTACT_STALE_DESC "Total number of reconnects skipped due to stale contact info"
 #define FD_METRICS_COUNTER_SEND_CONTACT_STALE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_OFF  (23UL)
+#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_OFF  (24UL)
 #define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_NAME "send_quic_send_result"
 #define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_DESC "Total number of transactions we attempted to send via QUIC"
 #define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_SUCCESS_OFF (23UL)
-#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_NO_CONN_OFF (24UL)
-#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_NO_STREAM_OFF (25UL)
+#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_SUCCESS_OFF (24UL)
+#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_NO_CONN_OFF (25UL)
+#define FD_METRICS_COUNTER_SEND_QUIC_SEND_RESULT_NO_STREAM_OFF (26UL)
 
-#define FD_METRICS_COUNTER_SEND_QUIC_CONN_CREATE_FAILED_OFF  (26UL)
+#define FD_METRICS_COUNTER_SEND_QUIC_CONN_CREATE_FAILED_OFF  (27UL)
 #define FD_METRICS_COUNTER_SEND_QUIC_CONN_CREATE_FAILED_NAME "send_quic_conn_create_failed"
 #define FD_METRICS_COUNTER_SEND_QUIC_CONN_CREATE_FAILED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_QUIC_CONN_CREATE_FAILED_DESC "Total number of QUIC connection creation failures"
 #define FD_METRICS_COUNTER_SEND_QUIC_CONN_CREATE_FAILED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_RECEIVED_PACKETS_OFF  (27UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_PACKETS_OFF  (28UL)
 #define FD_METRICS_COUNTER_SEND_RECEIVED_PACKETS_NAME "send_received_packets"
 #define FD_METRICS_COUNTER_SEND_RECEIVED_PACKETS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_RECEIVED_PACKETS_DESC "Total count of QUIC packets received"
 #define FD_METRICS_COUNTER_SEND_RECEIVED_PACKETS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_RECEIVED_BYTES_OFF  (28UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_BYTES_OFF  (29UL)
 #define FD_METRICS_COUNTER_SEND_RECEIVED_BYTES_NAME "send_received_bytes"
 #define FD_METRICS_COUNTER_SEND_RECEIVED_BYTES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_RECEIVED_BYTES_DESC "Total bytes received via QUIC"
 #define FD_METRICS_COUNTER_SEND_RECEIVED_BYTES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_SENT_PACKETS_OFF  (29UL)
+#define FD_METRICS_COUNTER_SEND_SENT_PACKETS_OFF  (30UL)
 #define FD_METRICS_COUNTER_SEND_SENT_PACKETS_NAME "send_sent_packets"
 #define FD_METRICS_COUNTER_SEND_SENT_PACKETS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_SENT_PACKETS_DESC "Total count of QUIC packets sent"
 #define FD_METRICS_COUNTER_SEND_SENT_PACKETS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_SENT_BYTES_OFF  (30UL)
+#define FD_METRICS_COUNTER_SEND_SENT_BYTES_OFF  (31UL)
 #define FD_METRICS_COUNTER_SEND_SENT_BYTES_NAME "send_sent_bytes"
 #define FD_METRICS_COUNTER_SEND_SENT_BYTES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_SENT_BYTES_DESC "Total bytes sent via QUIC"
 #define FD_METRICS_COUNTER_SEND_SENT_BYTES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_RETRY_SENT_OFF  (31UL)
+#define FD_METRICS_COUNTER_SEND_RETRY_SENT_OFF  (32UL)
 #define FD_METRICS_COUNTER_SEND_RETRY_SENT_NAME "send_retry_sent"
 #define FD_METRICS_COUNTER_SEND_RETRY_SENT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_RETRY_SENT_DESC "Total count of QUIC retry packets sent"
 #define FD_METRICS_COUNTER_SEND_RETRY_SENT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_ALLOC_OFF  (32UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_ALLOC_OFF  (33UL)
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_ALLOC_NAME "send_connections_alloc"
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_ALLOC_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_ALLOC_DESC "Number of currently allocated QUIC connections"
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_ALLOC_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_OFF  (33UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_OFF  (34UL)
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_NAME "send_connections_state"
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_DESC "Number of QUIC connections in each state"
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_CNT  (8UL)
 
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_INVALID_OFF (33UL)
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_HANDSHAKE_OFF (34UL)
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_HANDSHAKE_COMPLETE_OFF (35UL)
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_ACTIVE_OFF (36UL)
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_PEER_CLOSE_OFF (37UL)
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_ABORT_OFF (38UL)
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_CLOSE_PENDING_OFF (39UL)
-#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_DEAD_OFF (40UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_INVALID_OFF (34UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_HANDSHAKE_OFF (35UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_HANDSHAKE_COMPLETE_OFF (36UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_ACTIVE_OFF (37UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_PEER_CLOSE_OFF (38UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_ABORT_OFF (39UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_CLOSE_PENDING_OFF (40UL)
+#define FD_METRICS_GAUGE_SEND_CONNECTIONS_STATE_DEAD_OFF (41UL)
 
-#define FD_METRICS_COUNTER_SEND_CONNECTIONS_CREATED_OFF  (41UL)
+#define FD_METRICS_COUNTER_SEND_CONNECTIONS_CREATED_OFF  (42UL)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CREATED_NAME "send_connections_created"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CREATED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CREATED_DESC "Total count of QUIC connections created"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CREATED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_CONNECTIONS_CLOSED_OFF  (42UL)
+#define FD_METRICS_COUNTER_SEND_CONNECTIONS_CLOSED_OFF  (43UL)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CLOSED_NAME "send_connections_closed"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CLOSED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CLOSED_DESC "Total count of QUIC connections closed"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_CLOSED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_CONNECTIONS_ABORTED_OFF  (43UL)
+#define FD_METRICS_COUNTER_SEND_CONNECTIONS_ABORTED_OFF  (44UL)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_ABORTED_NAME "send_connections_aborted"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_ABORTED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_ABORTED_DESC "Total count of QUIC connections aborted"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_ABORTED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_CONNECTIONS_TIMED_OUT_OFF  (44UL)
+#define FD_METRICS_COUNTER_SEND_CONNECTIONS_TIMED_OUT_OFF  (45UL)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_TIMED_OUT_NAME "send_connections_timed_out"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_TIMED_OUT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_TIMED_OUT_DESC "Total count of QUIC connections timed out"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_TIMED_OUT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_CONNECTIONS_RETRIED_OFF  (45UL)
+#define FD_METRICS_COUNTER_SEND_CONNECTIONS_RETRIED_OFF  (46UL)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_RETRIED_NAME "send_connections_retried"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_RETRIED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_RETRIED_DESC "Total count of QUIC connections retried"
 #define FD_METRICS_COUNTER_SEND_CONNECTIONS_RETRIED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_NO_SLOTS_OFF  (46UL)
+#define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_NO_SLOTS_OFF  (47UL)
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_NO_SLOTS_NAME "send_connection_error_no_slots"
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_NO_SLOTS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_NO_SLOTS_DESC "Total count of connection errors due to no slots"
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_NO_SLOTS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_RETRY_FAIL_OFF  (47UL)
+#define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_RETRY_FAIL_OFF  (48UL)
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_RETRY_FAIL_NAME "send_connection_error_retry_fail"
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_RETRY_FAIL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_RETRY_FAIL_DESC "Total count of connection retry failures"
 #define FD_METRICS_COUNTER_SEND_CONNECTION_ERROR_RETRY_FAIL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_OFF  (48UL)
+#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_OFF  (49UL)
 #define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_NAME "send_pkt_crypto_failed"
 #define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_DESC "Total count of packets with crypto failures"
 #define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_CNT  (4UL)
 
-#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_INITIAL_OFF (48UL)
-#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_EARLY_OFF (49UL)
-#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_HANDSHAKE_OFF (50UL)
-#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_APP_OFF (51UL)
+#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_INITIAL_OFF (49UL)
+#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_EARLY_OFF (50UL)
+#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_HANDSHAKE_OFF (51UL)
+#define FD_METRICS_COUNTER_SEND_PKT_CRYPTO_FAILED_APP_OFF (52UL)
 
-#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_OFF  (52UL)
+#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_OFF  (53UL)
 #define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_NAME "send_pkt_no_key"
 #define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_DESC "Total count of packets with no key"
 #define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_CNT  (4UL)
 
-#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_INITIAL_OFF (52UL)
-#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_EARLY_OFF (53UL)
-#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_HANDSHAKE_OFF (54UL)
-#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_APP_OFF (55UL)
+#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_INITIAL_OFF (53UL)
+#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_EARLY_OFF (54UL)
+#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_HANDSHAKE_OFF (55UL)
+#define FD_METRICS_COUNTER_SEND_PKT_NO_KEY_APP_OFF (56UL)
 
-#define FD_METRICS_COUNTER_SEND_PKT_NO_CONN_OFF  (56UL)
+#define FD_METRICS_COUNTER_SEND_PKT_NO_CONN_OFF  (57UL)
 #define FD_METRICS_COUNTER_SEND_PKT_NO_CONN_NAME "send_pkt_no_conn"
 #define FD_METRICS_COUNTER_SEND_PKT_NO_CONN_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_NO_CONN_DESC "Total count of packets with no connection"
 #define FD_METRICS_COUNTER_SEND_PKT_NO_CONN_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_TX_ALLOC_FAIL_OFF  (57UL)
+#define FD_METRICS_COUNTER_SEND_PKT_TX_ALLOC_FAIL_OFF  (58UL)
 #define FD_METRICS_COUNTER_SEND_PKT_TX_ALLOC_FAIL_NAME "send_pkt_tx_alloc_fail"
 #define FD_METRICS_COUNTER_SEND_PKT_TX_ALLOC_FAIL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_TX_ALLOC_FAIL_DESC "Total count of packet TX allocation failures"
 #define FD_METRICS_COUNTER_SEND_PKT_TX_ALLOC_FAIL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_NET_HEADER_INVALID_OFF  (58UL)
+#define FD_METRICS_COUNTER_SEND_PKT_NET_HEADER_INVALID_OFF  (59UL)
 #define FD_METRICS_COUNTER_SEND_PKT_NET_HEADER_INVALID_NAME "send_pkt_net_header_invalid"
 #define FD_METRICS_COUNTER_SEND_PKT_NET_HEADER_INVALID_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_NET_HEADER_INVALID_DESC "Total count of packets with invalid network headers"
 #define FD_METRICS_COUNTER_SEND_PKT_NET_HEADER_INVALID_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_QUIC_HEADER_INVALID_OFF  (59UL)
+#define FD_METRICS_COUNTER_SEND_PKT_QUIC_HEADER_INVALID_OFF  (60UL)
 #define FD_METRICS_COUNTER_SEND_PKT_QUIC_HEADER_INVALID_NAME "send_pkt_quic_header_invalid"
 #define FD_METRICS_COUNTER_SEND_PKT_QUIC_HEADER_INVALID_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_QUIC_HEADER_INVALID_DESC "Total count of packets with invalid QUIC headers"
 #define FD_METRICS_COUNTER_SEND_PKT_QUIC_HEADER_INVALID_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_UNDERSZ_OFF  (60UL)
+#define FD_METRICS_COUNTER_SEND_PKT_UNDERSZ_OFF  (61UL)
 #define FD_METRICS_COUNTER_SEND_PKT_UNDERSZ_NAME "send_pkt_undersz"
 #define FD_METRICS_COUNTER_SEND_PKT_UNDERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_UNDERSZ_DESC "Total count of undersized packets"
 #define FD_METRICS_COUNTER_SEND_PKT_UNDERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_OVERSZ_OFF  (61UL)
+#define FD_METRICS_COUNTER_SEND_PKT_OVERSZ_OFF  (62UL)
 #define FD_METRICS_COUNTER_SEND_PKT_OVERSZ_NAME "send_pkt_oversz"
 #define FD_METRICS_COUNTER_SEND_PKT_OVERSZ_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_OVERSZ_DESC "Total count of oversized packets"
 #define FD_METRICS_COUNTER_SEND_PKT_OVERSZ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_VERNEG_OFF  (62UL)
+#define FD_METRICS_COUNTER_SEND_PKT_VERNEG_OFF  (63UL)
 #define FD_METRICS_COUNTER_SEND_PKT_VERNEG_NAME "send_pkt_verneg"
 #define FD_METRICS_COUNTER_SEND_PKT_VERNEG_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_VERNEG_DESC "Total count of version negotiation packets"
 #define FD_METRICS_COUNTER_SEND_PKT_VERNEG_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_PKT_RETRANSMISSIONS_OFF  (63UL)
+#define FD_METRICS_COUNTER_SEND_PKT_RETRANSMISSIONS_OFF  (64UL)
 #define FD_METRICS_COUNTER_SEND_PKT_RETRANSMISSIONS_NAME "send_pkt_retransmissions"
 #define FD_METRICS_COUNTER_SEND_PKT_RETRANSMISSIONS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_PKT_RETRANSMISSIONS_DESC "Total count of packet retransmissions"
 #define FD_METRICS_COUNTER_SEND_PKT_RETRANSMISSIONS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_HANDSHAKES_CREATED_OFF  (64UL)
+#define FD_METRICS_COUNTER_SEND_HANDSHAKES_CREATED_OFF  (65UL)
 #define FD_METRICS_COUNTER_SEND_HANDSHAKES_CREATED_NAME "send_handshakes_created"
 #define FD_METRICS_COUNTER_SEND_HANDSHAKES_CREATED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_HANDSHAKES_CREATED_DESC "Total count of QUIC handshakes created"
 #define FD_METRICS_COUNTER_SEND_HANDSHAKES_CREATED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_HANDSHAKE_ERROR_ALLOC_FAIL_OFF  (65UL)
+#define FD_METRICS_COUNTER_SEND_HANDSHAKE_ERROR_ALLOC_FAIL_OFF  (66UL)
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_ERROR_ALLOC_FAIL_NAME "send_handshake_error_alloc_fail"
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_ERROR_ALLOC_FAIL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_ERROR_ALLOC_FAIL_DESC "Total count of handshake allocation failures"
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_ERROR_ALLOC_FAIL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_HANDSHAKE_EVICTED_OFF  (66UL)
+#define FD_METRICS_COUNTER_SEND_HANDSHAKE_EVICTED_OFF  (67UL)
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_EVICTED_NAME "send_handshake_evicted"
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_EVICTED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_EVICTED_DESC "Total count of handshakes evicted"
 #define FD_METRICS_COUNTER_SEND_HANDSHAKE_EVICTED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_EVENTS_OFF  (67UL)
+#define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_EVENTS_OFF  (68UL)
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_EVENTS_NAME "send_stream_received_events"
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_EVENTS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_EVENTS_DESC "Total count of stream events received"
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_EVENTS_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_BYTES_OFF  (68UL)
+#define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_BYTES_OFF  (69UL)
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_BYTES_NAME "send_stream_received_bytes"
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_BYTES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_BYTES_DESC "Total bytes received via streams"
 #define FD_METRICS_COUNTER_SEND_STREAM_RECEIVED_BYTES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_OFF  (69UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_OFF  (70UL)
 #define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_NAME "send_received_frames"
 #define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_DESC "Total count of QUIC frames received"
 #define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CNT  (22UL)
 
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_UNKNOWN_OFF (69UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_ACK_OFF (70UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_RESET_STREAM_OFF (71UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STOP_SENDING_OFF (72UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CRYPTO_OFF (73UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_NEW_TOKEN_OFF (74UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STREAM_OFF (75UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_MAX_DATA_OFF (76UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_MAX_STREAM_DATA_OFF (77UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_MAX_STREAMS_OFF (78UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_DATA_BLOCKED_OFF (79UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STREAM_DATA_BLOCKED_OFF (80UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STREAMS_BLOCKED_OFF (81UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_NEW_CONN_ID_OFF (82UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_RETIRE_CONN_ID_OFF (83UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PATH_CHALLENGE_OFF (84UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PATH_RESPONSE_OFF (85UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CONN_CLOSE_QUIC_OFF (86UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CONN_CLOSE_APP_OFF (87UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_HANDSHAKE_DONE_OFF (88UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PING_OFF (89UL)
-#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PADDING_OFF (90UL)
-
-#define FD_METRICS_COUNTER_SEND_FRAME_FAIL_PARSE_OFF  (91UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_UNKNOWN_OFF (70UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_ACK_OFF (71UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_RESET_STREAM_OFF (72UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STOP_SENDING_OFF (73UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CRYPTO_OFF (74UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_NEW_TOKEN_OFF (75UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STREAM_OFF (76UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_MAX_DATA_OFF (77UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_MAX_STREAM_DATA_OFF (78UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_MAX_STREAMS_OFF (79UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_DATA_BLOCKED_OFF (80UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STREAM_DATA_BLOCKED_OFF (81UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_STREAMS_BLOCKED_OFF (82UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_NEW_CONN_ID_OFF (83UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_RETIRE_CONN_ID_OFF (84UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PATH_CHALLENGE_OFF (85UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PATH_RESPONSE_OFF (86UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CONN_CLOSE_QUIC_OFF (87UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_CONN_CLOSE_APP_OFF (88UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_HANDSHAKE_DONE_OFF (89UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PING_OFF (90UL)
+#define FD_METRICS_COUNTER_SEND_RECEIVED_FRAMES_PADDING_OFF (91UL)
+
+#define FD_METRICS_COUNTER_SEND_FRAME_FAIL_PARSE_OFF  (92UL)
 #define FD_METRICS_COUNTER_SEND_FRAME_FAIL_PARSE_NAME "send_frame_fail_parse"
 #define FD_METRICS_COUNTER_SEND_FRAME_FAIL_PARSE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_FRAME_FAIL_PARSE_DESC "Total count of frame parse failures"
 #define FD_METRICS_COUNTER_SEND_FRAME_FAIL_PARSE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_OFF  (92UL)
+#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_OFF  (93UL)
 #define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_NAME "send_frame_tx_alloc"
 #define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_DESC "Results of attempts to acquire QUIC frame metadata."
 #define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_CNT  (3UL)
 
-#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_SUCCESS_OFF (92UL)
-#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_FAIL_EMPTY_POOL_OFF (93UL)
-#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_FAIL_CONN_MAX_OFF (94UL)
+#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_SUCCESS_OFF (93UL)
+#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_FAIL_EMPTY_POOL_OFF (94UL)
+#define FD_METRICS_COUNTER_SEND_FRAME_TX_ALLOC_FAIL_CONN_MAX_OFF (95UL)
 
-#define FD_METRICS_COUNTER_SEND_ACK_TX_OFF  (95UL)
+#define FD_METRICS_COUNTER_SEND_ACK_TX_OFF  (96UL)
 #define FD_METRICS_COUNTER_SEND_ACK_TX_NAME "send_ack_tx"
 #define FD_METRICS_COUNTER_SEND_ACK_TX_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SEND_ACK_TX_DESC "Total count of ACK frames transmitted"
 #define FD_METRICS_COUNTER_SEND_ACK_TX_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SEND_ACK_TX_CNT  (5UL)
 
-#define FD_METRICS_COUNTER_SEND_ACK_TX_NOOP_OFF (95UL)
-#define FD_METRICS_COUNTER_SEND_ACK_TX_NEW_OFF (96UL)
-#define FD_METRICS_COUNTER_SEND_ACK_TX_MERGED_OFF (97UL)
-#define FD_METRICS_COUNTER_SEND_ACK_TX_DROP_OFF (98UL)
-#define FD_METRICS_COUNTER_SEND_ACK_TX_CANCEL_OFF (99UL)
+#define FD_METRICS_COUNTER_SEND_ACK_TX_NOOP_OFF (96UL)
+#define FD_METRICS_COUNTER_SEND_ACK_TX_NEW_OFF (97UL)
+#define FD_METRICS_COUNTER_SEND_ACK_TX_MERGED_OFF (98UL)
+#define FD_METRICS_COUNTER_SEND_ACK_TX_DROP_OFF (99UL)
+#define FD_METRICS_COUNTER_SEND_ACK_TX_CANCEL_OFF (100UL)
 
-#define FD_METRICS_HISTOGRAM_SEND_SERVICE_DURATION_SECONDS_OFF  (100UL)
+#define FD_METRICS_HISTOGRAM_SEND_SERVICE_DURATION_SECONDS_OFF  (101UL)
 #define FD_METRICS_HISTOGRAM_SEND_SERVICE_DURATION_SECONDS_NAME "send_service_duration_seconds"
 #define FD_METRICS_HISTOGRAM_SEND_SERVICE_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SEND_SERVICE_DURATION_SECONDS_DESC "Duration spent in service"
@@ -309,7 +309,7 @@
 #define FD_METRICS_HISTOGRAM_SEND_SERVICE_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_SEND_SERVICE_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_HISTOGRAM_SEND_RECEIVE_DURATION_SECONDS_OFF  (117UL)
+#define FD_METRICS_HISTOGRAM_SEND_RECEIVE_DURATION_SECONDS_OFF  (118UL)
 #define FD_METRICS_HISTOGRAM_SEND_RECEIVE_DURATION_SECONDS_NAME "send_receive_duration_seconds"
 #define FD_METRICS_HISTOGRAM_SEND_RECEIVE_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SEND_RECEIVE_DURATION_SECONDS_DESC "Duration spent processing packets"
@@ -317,7 +317,7 @@
 #define FD_METRICS_HISTOGRAM_SEND_RECEIVE_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_SEND_RECEIVE_DURATION_SECONDS_MAX  (0.1)
 
-#define FD_METRICS_HISTOGRAM_SEND_SIGN_DURATION_SECONDS_OFF  (134UL)
+#define FD_METRICS_HISTOGRAM_SEND_SIGN_DURATION_SECONDS_OFF  (135UL)
 #define FD_METRICS_HISTOGRAM_SEND_SIGN_DURATION_SECONDS_NAME "send_sign_duration_seconds"
 #define FD_METRICS_HISTOGRAM_SEND_SIGN_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SEND_SIGN_DURATION_SECONDS_DESC "Duration spent waiting for tls_cv signatures"
diff --git a/src/disco/metrics/generated/fd_metrics_shred.h b/src/disco/metrics/generated/fd_metrics_shred.h
index 20b2a69e12..47da1109dc 100644
--- a/src/disco/metrics/generated/fd_metrics_shred.h
+++ b/src/disco/metrics/generated/fd_metrics_shred.h
@@ -3,7 +3,7 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_HISTOGRAM_SHRED_CLUSTER_CONTACT_INFO_CNT_OFF  (16UL)
+#define FD_METRICS_HISTOGRAM_SHRED_CLUSTER_CONTACT_INFO_CNT_OFF  (17UL)
 #define FD_METRICS_HISTOGRAM_SHRED_CLUSTER_CONTACT_INFO_CNT_NAME "shred_cluster_contact_info_cnt"
 #define FD_METRICS_HISTOGRAM_SHRED_CLUSTER_CONTACT_INFO_CNT_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SHRED_CLUSTER_CONTACT_INFO_CNT_DESC "Number of contact infos in the cluster contact info message"
@@ -11,19 +11,19 @@
 #define FD_METRICS_HISTOGRAM_SHRED_CLUSTER_CONTACT_INFO_CNT_MIN  (0UL)
 #define FD_METRICS_HISTOGRAM_SHRED_CLUSTER_CONTACT_INFO_CNT_MAX  (40200UL)
 
-#define FD_METRICS_COUNTER_SHRED_MICROBLOCKS_ABANDONED_OFF  (33UL)
+#define FD_METRICS_COUNTER_SHRED_MICROBLOCKS_ABANDONED_OFF  (34UL)
 #define FD_METRICS_COUNTER_SHRED_MICROBLOCKS_ABANDONED_NAME "shred_microblocks_abandoned"
 #define FD_METRICS_COUNTER_SHRED_MICROBLOCKS_ABANDONED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_MICROBLOCKS_ABANDONED_DESC "The number of microblocks that were abandoned because we switched slots without finishing the current slot"
 #define FD_METRICS_COUNTER_SHRED_MICROBLOCKS_ABANDONED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SHRED_INVALID_BLOCK_ID_OFF  (34UL)
+#define FD_METRICS_COUNTER_SHRED_INVALID_BLOCK_ID_OFF  (35UL)
 #define FD_METRICS_COUNTER_SHRED_INVALID_BLOCK_ID_NAME "shred_invalid_block_id"
 #define FD_METRICS_COUNTER_SHRED_INVALID_BLOCK_ID_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_INVALID_BLOCK_ID_DESC "The number of times a block was created with unknown parent block_id"
 #define FD_METRICS_COUNTER_SHRED_INVALID_BLOCK_ID_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_HISTOGRAM_SHRED_BATCH_SZ_OFF  (35UL)
+#define FD_METRICS_HISTOGRAM_SHRED_BATCH_SZ_OFF  (36UL)
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_SZ_NAME "shred_batch_sz"
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_SZ_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_SZ_DESC "The size (in bytes) of each microblock batch that is shredded"
@@ -31,7 +31,7 @@
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_SZ_MIN  (1024UL)
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_SZ_MAX  (65536UL)
 
-#define FD_METRICS_HISTOGRAM_SHRED_BATCH_MICROBLOCK_CNT_OFF  (52UL)
+#define FD_METRICS_HISTOGRAM_SHRED_BATCH_MICROBLOCK_CNT_OFF  (53UL)
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_MICROBLOCK_CNT_NAME "shred_batch_microblock_cnt"
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_MICROBLOCK_CNT_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_MICROBLOCK_CNT_DESC "The number of microblocks in each microblock batch that is shredded"
@@ -39,7 +39,7 @@
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_MICROBLOCK_CNT_MIN  (2UL)
 #define FD_METRICS_HISTOGRAM_SHRED_BATCH_MICROBLOCK_CNT_MAX  (256UL)
 
-#define FD_METRICS_HISTOGRAM_SHRED_SHREDDING_DURATION_SECONDS_OFF  (69UL)
+#define FD_METRICS_HISTOGRAM_SHRED_SHREDDING_DURATION_SECONDS_OFF  (70UL)
 #define FD_METRICS_HISTOGRAM_SHRED_SHREDDING_DURATION_SECONDS_NAME "shred_shredding_duration_seconds"
 #define FD_METRICS_HISTOGRAM_SHRED_SHREDDING_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SHRED_SHREDDING_DURATION_SECONDS_DESC "Duration of producing one FEC set from the shredder"
@@ -47,7 +47,7 @@
 #define FD_METRICS_HISTOGRAM_SHRED_SHREDDING_DURATION_SECONDS_MIN  (1e-05)
 #define FD_METRICS_HISTOGRAM_SHRED_SHREDDING_DURATION_SECONDS_MAX  (0.01)
 
-#define FD_METRICS_HISTOGRAM_SHRED_ADD_SHRED_DURATION_SECONDS_OFF  (86UL)
+#define FD_METRICS_HISTOGRAM_SHRED_ADD_SHRED_DURATION_SECONDS_OFF  (87UL)
 #define FD_METRICS_HISTOGRAM_SHRED_ADD_SHRED_DURATION_SECONDS_NAME "shred_add_shred_duration_seconds"
 #define FD_METRICS_HISTOGRAM_SHRED_ADD_SHRED_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
 #define FD_METRICS_HISTOGRAM_SHRED_ADD_SHRED_DURATION_SECONDS_DESC "Duration of verifying and processing one shred received from the network"
@@ -55,57 +55,57 @@
 #define FD_METRICS_HISTOGRAM_SHRED_ADD_SHRED_DURATION_SECONDS_MIN  (1e-08)
 #define FD_METRICS_HISTOGRAM_SHRED_ADD_SHRED_DURATION_SECONDS_MAX  (0.001)
 
-#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_OFF  (103UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_OFF  (104UL)
 #define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_NAME "shred_shred_processed"
 #define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_DESC "The result of processing a thread from the network"
 #define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_CNT  (6UL)
 
-#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_BAD_SLOT_OFF (103UL)
-#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_PARSE_FAILED_OFF (104UL)
-#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_REJECTED_OFF (105UL)
-#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_IGNORED_OFF (106UL)
-#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_OKAY_OFF (107UL)
-#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_COMPLETES_OFF (108UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_BAD_SLOT_OFF (104UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_PARSE_FAILED_OFF (105UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_REJECTED_OFF (106UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_IGNORED_OFF (107UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_OKAY_OFF (108UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_PROCESSED_COMPLETES_OFF (109UL)
 
-#define FD_METRICS_COUNTER_SHRED_FEC_SET_SPILLED_OFF  (109UL)
+#define FD_METRICS_COUNTER_SHRED_FEC_SET_SPILLED_OFF  (110UL)
 #define FD_METRICS_COUNTER_SHRED_FEC_SET_SPILLED_NAME "shred_fec_set_spilled"
 #define FD_METRICS_COUNTER_SHRED_FEC_SET_SPILLED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_FEC_SET_SPILLED_DESC "The number of FEC sets that were spilled because they didn't complete in time and we needed space"
 #define FD_METRICS_COUNTER_SHRED_FEC_SET_SPILLED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_INITIAL_OFF  (110UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_INITIAL_OFF  (111UL)
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_INITIAL_NAME "shred_shred_rejected_initial"
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_INITIAL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_INITIAL_DESC "The number of shreds that were rejected before any resources were allocated for the FEC set"
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_INITIAL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_UNCHAINED_OFF  (111UL)
+#define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_UNCHAINED_OFF  (112UL)
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_UNCHAINED_NAME "shred_shred_rejected_unchained"
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_UNCHAINED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_UNCHAINED_DESC "The number of shreds that were rejected because they're not chained merkle shreds"
 #define FD_METRICS_COUNTER_SHRED_SHRED_REJECTED_UNCHAINED_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SHRED_FEC_REJECTED_FATAL_OFF  (112UL)
+#define FD_METRICS_COUNTER_SHRED_FEC_REJECTED_FATAL_OFF  (113UL)
 #define FD_METRICS_COUNTER_SHRED_FEC_REJECTED_FATAL_NAME "shred_fec_rejected_fatal"
 #define FD_METRICS_COUNTER_SHRED_FEC_REJECTED_FATAL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_FEC_REJECTED_FATAL_DESC "The number of FEC sets that were rejected for reasons that cause the whole FEC set to become invalid"
 #define FD_METRICS_COUNTER_SHRED_FEC_REJECTED_FATAL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_REQUEST_OFF  (113UL)
+#define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_REQUEST_OFF  (114UL)
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_REQUEST_NAME "shred_force_complete_request"
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_REQUEST_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_REQUEST_DESC "The number of times we received a FEC force complete message"
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_REQUEST_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_FAILURE_OFF  (114UL)
+#define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_FAILURE_OFF  (115UL)
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_FAILURE_NAME "shred_force_complete_failure"
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_FAILURE_DESC "The number of times we failed to force complete a FEC set on request"
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_SUCCESS_OFF  (115UL)
+#define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_SUCCESS_OFF  (116UL)
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_SUCCESS_NAME "shred_force_complete_success"
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_SUCCESS_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SHRED_FORCE_COMPLETE_SUCCESS_DESC "The number of times we successfully forced completed a FEC set on request"
diff --git a/src/disco/metrics/generated/fd_metrics_sign.h b/src/disco/metrics/generated/fd_metrics_sign.h
new file mode 100644
index 0000000000..42a0151c57
--- /dev/null
+++ b/src/disco/metrics/generated/fd_metrics_sign.h
@@ -0,0 +1,15 @@
+/* THIS FILE IS GENERATED BY gen_metrics.py. DO NOT HAND EDIT. */
+
+#include "../fd_metrics_base.h"
+#include "fd_metrics_enums.h"
+
+#define FD_METRICS_HISTOGRAM_SIGN_SIGN_DURATION_SECONDS_OFF  (17UL)
+#define FD_METRICS_HISTOGRAM_SIGN_SIGN_DURATION_SECONDS_NAME "sign_sign_duration_seconds"
+#define FD_METRICS_HISTOGRAM_SIGN_SIGN_DURATION_SECONDS_TYPE (FD_METRICS_TYPE_HISTOGRAM)
+#define FD_METRICS_HISTOGRAM_SIGN_SIGN_DURATION_SECONDS_DESC "Duration of signing a message"
+#define FD_METRICS_HISTOGRAM_SIGN_SIGN_DURATION_SECONDS_CVT  (FD_METRICS_CONVERTER_SECONDS)
+#define FD_METRICS_HISTOGRAM_SIGN_SIGN_DURATION_SECONDS_MIN  (1e-08)
+#define FD_METRICS_HISTOGRAM_SIGN_SIGN_DURATION_SECONDS_MAX  (0.001)
+
+#define FD_METRICS_SIGN_TOTAL (1UL)
+extern const fd_metrics_meta_t FD_METRICS_SIGN[FD_METRICS_SIGN_TOTAL];
diff --git a/src/disco/metrics/generated/fd_metrics_snapdc.h b/src/disco/metrics/generated/fd_metrics_snapdc.h
index 315bc31bd8..0af4b51574 100644
--- a/src/disco/metrics/generated/fd_metrics_snapdc.h
+++ b/src/disco/metrics/generated/fd_metrics_snapdc.h
@@ -3,31 +3,31 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_GAUGE_SNAPDC_STATE_OFF  (16UL)
+#define FD_METRICS_GAUGE_SNAPDC_STATE_OFF  (17UL)
 #define FD_METRICS_GAUGE_SNAPDC_STATE_NAME "snapdc_state"
 #define FD_METRICS_GAUGE_SNAPDC_STATE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPDC_STATE_DESC "State of the tile. 0 = waiting for compressed byte stream, 1 = decompressing full snapshot, 2 = decompressing incremental snapshot, 3 = done."
 #define FD_METRICS_GAUGE_SNAPDC_STATE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPDC_FULL_COMPRESSED_BYTES_READ_OFF  (17UL)
+#define FD_METRICS_GAUGE_SNAPDC_FULL_COMPRESSED_BYTES_READ_OFF  (18UL)
 #define FD_METRICS_GAUGE_SNAPDC_FULL_COMPRESSED_BYTES_READ_NAME "snapdc_full_compressed_bytes_read"
 #define FD_METRICS_GAUGE_SNAPDC_FULL_COMPRESSED_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPDC_FULL_COMPRESSED_BYTES_READ_DESC "Number of bytes read so far from the compressed full snapshot file. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPDC_FULL_COMPRESSED_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPDC_FULL_DECOMPRESSED_BYTES_READ_OFF  (18UL)
+#define FD_METRICS_GAUGE_SNAPDC_FULL_DECOMPRESSED_BYTES_READ_OFF  (19UL)
 #define FD_METRICS_GAUGE_SNAPDC_FULL_DECOMPRESSED_BYTES_READ_NAME "snapdc_full_decompressed_bytes_read"
 #define FD_METRICS_GAUGE_SNAPDC_FULL_DECOMPRESSED_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPDC_FULL_DECOMPRESSED_BYTES_READ_DESC "Number of bytes read so far from the decompressed file. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPDC_FULL_DECOMPRESSED_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_COMPRESSED_BYTES_READ_OFF  (19UL)
+#define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_COMPRESSED_BYTES_READ_OFF  (20UL)
 #define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_COMPRESSED_BYTES_READ_NAME "snapdc_incremental_compressed_bytes_read"
 #define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_COMPRESSED_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_COMPRESSED_BYTES_READ_DESC "Number of bytes read so far from the compressed incremental snapshot file. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_COMPRESSED_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_DECOMPRESSED_BYTES_READ_OFF  (20UL)
+#define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_DECOMPRESSED_BYTES_READ_OFF  (21UL)
 #define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_DECOMPRESSED_BYTES_READ_NAME "snapdc_incremental_decompressed_bytes_read"
 #define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_DECOMPRESSED_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPDC_INCREMENTAL_DECOMPRESSED_BYTES_READ_DESC "Number of bytes read so far from the decompressed incremental snapshot file. Might decrease if snapshot load is aborted and restarted"
diff --git a/src/disco/metrics/generated/fd_metrics_snapin.h b/src/disco/metrics/generated/fd_metrics_snapin.h
index 80b6c66025..0148c64a4a 100644
--- a/src/disco/metrics/generated/fd_metrics_snapin.h
+++ b/src/disco/metrics/generated/fd_metrics_snapin.h
@@ -3,25 +3,25 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_GAUGE_SNAPIN_STATE_OFF  (16UL)
+#define FD_METRICS_GAUGE_SNAPIN_STATE_OFF  (17UL)
 #define FD_METRICS_GAUGE_SNAPIN_STATE_NAME "snapin_state"
 #define FD_METRICS_GAUGE_SNAPIN_STATE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPIN_STATE_DESC "State of the tile. 0 = waiting for decompressed snapshot bytestream, 1 = processing full snapshot, 2 = processing incremental snapshot, 3 = done."
 #define FD_METRICS_GAUGE_SNAPIN_STATE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPIN_FULL_BYTES_READ_OFF  (17UL)
+#define FD_METRICS_GAUGE_SNAPIN_FULL_BYTES_READ_OFF  (18UL)
 #define FD_METRICS_GAUGE_SNAPIN_FULL_BYTES_READ_NAME "snapin_full_bytes_read"
 #define FD_METRICS_GAUGE_SNAPIN_FULL_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPIN_FULL_BYTES_READ_DESC "Number of bytes read so far from the full snapshot. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPIN_FULL_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPIN_INCREMENTAL_BYTES_READ_OFF  (18UL)
+#define FD_METRICS_GAUGE_SNAPIN_INCREMENTAL_BYTES_READ_OFF  (19UL)
 #define FD_METRICS_GAUGE_SNAPIN_INCREMENTAL_BYTES_READ_NAME "snapin_incremental_bytes_read"
 #define FD_METRICS_GAUGE_SNAPIN_INCREMENTAL_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPIN_INCREMENTAL_BYTES_READ_DESC "Number of bytes read so far from the incremental snapshot. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPIN_INCREMENTAL_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPIN_ACCOUNTS_INSERTED_OFF  (19UL)
+#define FD_METRICS_GAUGE_SNAPIN_ACCOUNTS_INSERTED_OFF  (20UL)
 #define FD_METRICS_GAUGE_SNAPIN_ACCOUNTS_INSERTED_NAME "snapin_accounts_inserted"
 #define FD_METRICS_GAUGE_SNAPIN_ACCOUNTS_INSERTED_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPIN_ACCOUNTS_INSERTED_DESC "Number of accounts inserted during snpashot loading. Might decrease if snapshot load is aborted and restarted"
diff --git a/src/disco/metrics/generated/fd_metrics_snaprd.h b/src/disco/metrics/generated/fd_metrics_snaprd.h
index 95bab8ab66..3bf569d2f8 100644
--- a/src/disco/metrics/generated/fd_metrics_snaprd.h
+++ b/src/disco/metrics/generated/fd_metrics_snaprd.h
@@ -3,67 +3,67 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_GAUGE_SNAPRD_STATE_OFF  (16UL)
+#define FD_METRICS_GAUGE_SNAPRD_STATE_OFF  (17UL)
 #define FD_METRICS_GAUGE_SNAPRD_STATE_NAME "snaprd_state"
 #define FD_METRICS_GAUGE_SNAPRD_STATE_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_STATE_DESC "State of the tile. 0 = waiting for at least one peer from gossip, 1 = collecting peers from gossip, 2 = pinging peers, 3 = collecting ping responses, 4 = reading full snapshot file, 5 = reading incremental snapshot file, 6 = downloading full snapshot file, 7 = downloading incremental snapshot file, 8 = pinging peers before loading the incremental snapshot, 0 = collecting ping responses before loading the incremental snapshot, 10 = waiting for full snapshot to finish loading, 11 = waiting for incremental snapshot to finish loading, 12 = done."
 #define FD_METRICS_GAUGE_SNAPRD_STATE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SNAPRD_FULL_NUM_RETRIES_OFF  (17UL)
+#define FD_METRICS_COUNTER_SNAPRD_FULL_NUM_RETRIES_OFF  (18UL)
 #define FD_METRICS_COUNTER_SNAPRD_FULL_NUM_RETRIES_NAME "snaprd_full_num_retries"
 #define FD_METRICS_COUNTER_SNAPRD_FULL_NUM_RETRIES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SNAPRD_FULL_NUM_RETRIES_DESC "Number of times we aborted and retried full snapshot download because the peer was too slow"
 #define FD_METRICS_COUNTER_SNAPRD_FULL_NUM_RETRIES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SNAPRD_INCREMENTAL_NUM_RETRIES_OFF  (18UL)
+#define FD_METRICS_COUNTER_SNAPRD_INCREMENTAL_NUM_RETRIES_OFF  (19UL)
 #define FD_METRICS_COUNTER_SNAPRD_INCREMENTAL_NUM_RETRIES_NAME "snaprd_incremental_num_retries"
 #define FD_METRICS_COUNTER_SNAPRD_INCREMENTAL_NUM_RETRIES_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SNAPRD_INCREMENTAL_NUM_RETRIES_DESC "Number of times we aborted and retried incremental snapshot download because the peer was too slow"
 #define FD_METRICS_COUNTER_SNAPRD_INCREMENTAL_NUM_RETRIES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_READ_OFF  (19UL)
+#define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_READ_OFF  (20UL)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_READ_NAME "snaprd_full_bytes_read"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_READ_DESC "Number of bytes read so far from the full snapshot. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_WRITTEN_OFF  (20UL)
+#define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_WRITTEN_OFF  (21UL)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_WRITTEN_NAME "snaprd_full_bytes_written"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_WRITTEN_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_WRITTEN_DESC "Number of bytes written so far from the full snapshot. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_WRITTEN_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_TOTAL_OFF  (21UL)
+#define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_TOTAL_OFF  (22UL)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_TOTAL_NAME "snaprd_full_bytes_total"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_TOTAL_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_TOTAL_DESC "Total size of the full snapshot file. Might change if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_BYTES_TOTAL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_FULL_DOWNLOAD_RETRIES_OFF  (22UL)
+#define FD_METRICS_GAUGE_SNAPRD_FULL_DOWNLOAD_RETRIES_OFF  (23UL)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_DOWNLOAD_RETRIES_NAME "snaprd_full_download_retries"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_DOWNLOAD_RETRIES_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_FULL_DOWNLOAD_RETRIES_DESC "Number of times we retried the full snapshot download because the peer was too slow"
 #define FD_METRICS_GAUGE_SNAPRD_FULL_DOWNLOAD_RETRIES_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_READ_OFF  (23UL)
+#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_READ_OFF  (24UL)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_READ_NAME "snaprd_incremental_bytes_read"
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_READ_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_READ_DESC "Number of bytes read so far from the incremental snapshot. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_READ_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_WRITTEN_OFF  (24UL)
+#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_WRITTEN_OFF  (25UL)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_WRITTEN_NAME "snaprd_incremental_bytes_written"
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_WRITTEN_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_WRITTEN_DESC "Number of bytes written so far from the incremental snapshot. Might decrease if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_WRITTEN_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_TOTAL_OFF  (25UL)
+#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_TOTAL_OFF  (26UL)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_TOTAL_NAME "snaprd_incremental_bytes_total"
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_TOTAL_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_TOTAL_DESC "Total size of the incremental snapshot file. Might change if snapshot load is aborted and restarted"
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_BYTES_TOTAL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_DOWNLOAD_RETRIES_OFF  (26UL)
+#define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_DOWNLOAD_RETRIES_OFF  (27UL)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_DOWNLOAD_RETRIES_NAME "snaprd_incremental_download_retries"
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_DOWNLOAD_RETRIES_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_SNAPRD_INCREMENTAL_DOWNLOAD_RETRIES_DESC "Number of times we retried the incremental snapshot download because the peer was too slow"
diff --git a/src/disco/metrics/generated/fd_metrics_sock.h b/src/disco/metrics/generated/fd_metrics_sock.h
index 5456794ce2..dedaa01928 100644
--- a/src/disco/metrics/generated/fd_metrics_sock.h
+++ b/src/disco/metrics/generated/fd_metrics_sock.h
@@ -3,51 +3,51 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_OFF  (16UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_OFF  (17UL)
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_NAME "sock_syscalls_sendmmsg"
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_DESC "Number of sendmmsg syscalls dispatched"
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_CVT  (FD_METRICS_CONVERTER_NONE)
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_CNT  (6UL)
 
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_NO_ERROR_OFF (16UL)
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_SLOW_OFF (17UL)
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_PERM_OFF (18UL)
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_UNREACH_OFF (19UL)
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_DOWN_OFF (20UL)
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_OTHER_OFF (21UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_NO_ERROR_OFF (17UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_SLOW_OFF (18UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_PERM_OFF (19UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_UNREACH_OFF (20UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_DOWN_OFF (21UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_SENDMMSG_OTHER_OFF (22UL)
 
-#define FD_METRICS_COUNTER_SOCK_SYSCALLS_RECVMMSG_OFF  (22UL)
+#define FD_METRICS_COUNTER_SOCK_SYSCALLS_RECVMMSG_OFF  (23UL)
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_RECVMMSG_NAME "sock_syscalls_recvmmsg"
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_RECVMMSG_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_RECVMMSG_DESC "Number of recvmsg syscalls dispatched"
 #define FD_METRICS_COUNTER_SOCK_SYSCALLS_RECVMMSG_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SOCK_RX_PKT_CNT_OFF  (23UL)
+#define FD_METRICS_COUNTER_SOCK_RX_PKT_CNT_OFF  (24UL)
 #define FD_METRICS_COUNTER_SOCK_RX_PKT_CNT_NAME "sock_rx_pkt_cnt"
 #define FD_METRICS_COUNTER_SOCK_RX_PKT_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SOCK_RX_PKT_CNT_DESC "Number of packets received"
 #define FD_METRICS_COUNTER_SOCK_RX_PKT_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SOCK_TX_PKT_CNT_OFF  (24UL)
+#define FD_METRICS_COUNTER_SOCK_TX_PKT_CNT_OFF  (25UL)
 #define FD_METRICS_COUNTER_SOCK_TX_PKT_CNT_NAME "sock_tx_pkt_cnt"
 #define FD_METRICS_COUNTER_SOCK_TX_PKT_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SOCK_TX_PKT_CNT_DESC "Number of packets sent"
 #define FD_METRICS_COUNTER_SOCK_TX_PKT_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SOCK_TX_DROP_CNT_OFF  (25UL)
+#define FD_METRICS_COUNTER_SOCK_TX_DROP_CNT_OFF  (26UL)
 #define FD_METRICS_COUNTER_SOCK_TX_DROP_CNT_NAME "sock_tx_drop_cnt"
 #define FD_METRICS_COUNTER_SOCK_TX_DROP_CNT_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SOCK_TX_DROP_CNT_DESC "Number of packets failed to send"
 #define FD_METRICS_COUNTER_SOCK_TX_DROP_CNT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SOCK_TX_BYTES_TOTAL_OFF  (26UL)
+#define FD_METRICS_COUNTER_SOCK_TX_BYTES_TOTAL_OFF  (27UL)
 #define FD_METRICS_COUNTER_SOCK_TX_BYTES_TOTAL_NAME "sock_tx_bytes_total"
 #define FD_METRICS_COUNTER_SOCK_TX_BYTES_TOTAL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SOCK_TX_BYTES_TOTAL_DESC "Total number of bytes transmitted (including Ethernet header)."
 #define FD_METRICS_COUNTER_SOCK_TX_BYTES_TOTAL_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_SOCK_RX_BYTES_TOTAL_OFF  (27UL)
+#define FD_METRICS_COUNTER_SOCK_RX_BYTES_TOTAL_OFF  (28UL)
 #define FD_METRICS_COUNTER_SOCK_RX_BYTES_TOTAL_NAME "sock_rx_bytes_total"
 #define FD_METRICS_COUNTER_SOCK_RX_BYTES_TOTAL_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_SOCK_RX_BYTES_TOTAL_DESC "Total number of bytes received (including Ethernet header)."
diff --git a/src/disco/metrics/generated/fd_metrics_store.h b/src/disco/metrics/generated/fd_metrics_store.h
index fa21047dad..ff2a4b18b2 100644
--- a/src/disco/metrics/generated/fd_metrics_store.h
+++ b/src/disco/metrics/generated/fd_metrics_store.h
@@ -3,7 +3,7 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_STORE_TRANSACTIONS_INSERTED_OFF  (16UL)
+#define FD_METRICS_COUNTER_STORE_TRANSACTIONS_INSERTED_OFF  (17UL)
 #define FD_METRICS_COUNTER_STORE_TRANSACTIONS_INSERTED_NAME "store_transactions_inserted"
 #define FD_METRICS_COUNTER_STORE_TRANSACTIONS_INSERTED_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_STORE_TRANSACTIONS_INSERTED_DESC "Count of transactions produced while we were leader in the shreds that have been inserted so far"
diff --git a/src/disco/metrics/generated/fd_metrics_storei.h b/src/disco/metrics/generated/fd_metrics_storei.h
index 1f26e317ab..e333562efd 100644
--- a/src/disco/metrics/generated/fd_metrics_storei.h
+++ b/src/disco/metrics/generated/fd_metrics_storei.h
@@ -3,13 +3,13 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_GAUGE_STOREI_FIRST_TURBINE_SLOT_OFF  (16UL)
+#define FD_METRICS_GAUGE_STOREI_FIRST_TURBINE_SLOT_OFF  (17UL)
 #define FD_METRICS_GAUGE_STOREI_FIRST_TURBINE_SLOT_NAME "storei_first_turbine_slot"
 #define FD_METRICS_GAUGE_STOREI_FIRST_TURBINE_SLOT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_STOREI_FIRST_TURBINE_SLOT_DESC ""
 #define FD_METRICS_GAUGE_STOREI_FIRST_TURBINE_SLOT_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_GAUGE_STOREI_CURRENT_TURBINE_SLOT_OFF  (17UL)
+#define FD_METRICS_GAUGE_STOREI_CURRENT_TURBINE_SLOT_OFF  (18UL)
 #define FD_METRICS_GAUGE_STOREI_CURRENT_TURBINE_SLOT_NAME "storei_current_turbine_slot"
 #define FD_METRICS_GAUGE_STOREI_CURRENT_TURBINE_SLOT_TYPE (FD_METRICS_TYPE_GAUGE)
 #define FD_METRICS_GAUGE_STOREI_CURRENT_TURBINE_SLOT_DESC ""
diff --git a/src/disco/metrics/generated/fd_metrics_verify.h b/src/disco/metrics/generated/fd_metrics_verify.h
index cfe911fd19..c576823af0 100644
--- a/src/disco/metrics/generated/fd_metrics_verify.h
+++ b/src/disco/metrics/generated/fd_metrics_verify.h
@@ -3,25 +3,25 @@
 #include "../fd_metrics_base.h"
 #include "fd_metrics_enums.h"
 
-#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_BUNDLE_PEER_FAILURE_OFF  (16UL)
+#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_BUNDLE_PEER_FAILURE_OFF  (17UL)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_BUNDLE_PEER_FAILURE_NAME "verify_transaction_bundle_peer_failure"
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_BUNDLE_PEER_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_BUNDLE_PEER_FAILURE_DESC "Count of transactions that failed to verify because a peer transaction in the bundle failed"
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_BUNDLE_PEER_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_PARSE_FAILURE_OFF  (17UL)
+#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_PARSE_FAILURE_OFF  (18UL)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_PARSE_FAILURE_NAME "verify_transaction_parse_failure"
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_PARSE_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_PARSE_FAILURE_DESC "Count of transactions that failed to parse"
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_PARSE_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_DEDUP_FAILURE_OFF  (18UL)
+#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_DEDUP_FAILURE_OFF  (19UL)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_DEDUP_FAILURE_NAME "verify_transaction_dedup_failure"
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_DEDUP_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_DEDUP_FAILURE_DESC "Count of transactions that failed to deduplicate in the verify stage"
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_DEDUP_FAILURE_CVT  (FD_METRICS_CONVERTER_NONE)
 
-#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_VERIFY_FAILURE_OFF  (19UL)
+#define FD_METRICS_COUNTER_VERIFY_TRANSACTION_VERIFY_FAILURE_OFF  (20UL)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_VERIFY_FAILURE_NAME "verify_transaction_verify_failure"
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_VERIFY_FAILURE_TYPE (FD_METRICS_TYPE_COUNTER)
 #define FD_METRICS_COUNTER_VERIFY_TRANSACTION_VERIFY_FAILURE_DESC "Count of transactions that failed to deduplicate in the verify stage"
diff --git a/src/disco/metrics/metrics.xml b/src/disco/metrics/metrics.xml
index 7997eb311f..0c1a36e05d 100644
--- a/src/disco/metrics/metrics.xml
+++ b/src/disco/metrics/metrics.xml
@@ -37,6 +37,8 @@ metric introduced.
 
     <int value="6" name="CaughtUpPostfrag" label="Caught up + Postfrag" />
     <int value="7" name="ProcessingPostfrag" label="Processing + Postfrag" />
+
+    <int value="8" name="Sleeping" label="Sleeping" />
 </enum>
 
 <common>
diff --git a/src/disco/net/sock/generated/sock_seccomp.h b/src/disco/net/sock/generated/sock_seccomp.h
index 068abcc6b3..2bc83c928c 100644
--- a/src/disco/net/sock/generated/sock_seccomp.h
+++ b/src/disco/net/sock/generated/sock_seccomp.h
@@ -21,76 +21,88 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_sock_instr_cnt = 35;
+static const unsigned int sock_filter_policy_sock_instr_cnt = 41;
 
 static void populate_sock_filter_policy_sock( ulong out_cnt, struct sock_filter * out, uint logfile_fd, uint tx_fd, uint rx_fd0, uint rx_fd1) {
-  FD_TEST( out_cnt >= 35 );
-  struct sock_filter filter[35] = {
+  FD_TEST( out_cnt >= 41 );
+  struct sock_filter filter[41] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 31 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 37 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow poll based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_poll, /* check_poll */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_poll, /* check_poll */ 7, 0 ),
     /* allow recvmmsg based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_recvmmsg, /* check_recvmmsg */ 6, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_recvmmsg, /* check_recvmmsg */ 8, 0 ),
     /* allow sendmmsg based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendmmsg, /* check_sendmmsg */ 15, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendmmsg, /* check_sendmmsg */ 17, 0 ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 20, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 22, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 23, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 25, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 26, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 30, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 24 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 28 },
 //  check_poll:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 23, /* RET_KILL_PROCESS */ 22 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 27, /* RET_KILL_PROCESS */ 26 ),
 //  check_recvmmsg:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JGE | BPF_K, rx_fd0, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 20 ),
+    BPF_JUMP( BPF_JMP | BPF_JGE | BPF_K, rx_fd0, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 24 ),
 //  lbl_2:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JGE | BPF_K, rx_fd1, /* RET_KILL_PROCESS */ 18, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JGE | BPF_K, rx_fd1, /* RET_KILL_PROCESS */ 22, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JGT | BPF_K, 64, /* RET_KILL_PROCESS */ 16, /* lbl_3 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JGT | BPF_K, 64, /* RET_KILL_PROCESS */ 20, /* lbl_3 */ 0 ),
 //  lbl_3:
     /* load syscall argument 3 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[3])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* lbl_4 */ 0, /* RET_KILL_PROCESS */ 14 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* lbl_4 */ 0, /* RET_KILL_PROCESS */ 18 ),
 //  lbl_4:
     /* load syscall argument 4 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[4])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 13, /* RET_KILL_PROCESS */ 12 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 17, /* RET_KILL_PROCESS */ 16 ),
 //  check_sendmmsg:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, tx_fd, /* lbl_5 */ 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, tx_fd, /* lbl_5 */ 0, /* RET_KILL_PROCESS */ 14 ),
 //  lbl_5:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JGT | BPF_K, 64, /* RET_KILL_PROCESS */ 8, /* lbl_6 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JGT | BPF_K, 64, /* RET_KILL_PROCESS */ 12, /* lbl_6 */ 0 ),
 //  lbl_6:
     /* load syscall argument 3 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[3])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* RET_ALLOW */ 11, /* RET_KILL_PROCESS */ 10 ),
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 5, /* lbl_7 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 9, /* lbl_7 */ 0 ),
 //  lbl_7:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_8 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_8:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/net/sock/sock.seccomppolicy b/src/disco/net/sock/sock.seccomppolicy
index c3a9afb7dd..5f2d87363c 100644
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
diff --git a/src/disco/net/xdp/generated/xdp_seccomp.h b/src/disco/net/xdp/generated/xdp_seccomp.h
index 36d8ac50ea..211ef51e11 100644
--- a/src/disco/net/xdp/generated/xdp_seccomp.h
+++ b/src/disco/net/xdp/generated/xdp_seccomp.h
@@ -21,40 +21,44 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_xdp_instr_cnt = 45;
+static const unsigned int sock_filter_policy_xdp_instr_cnt = 51;
 
 static void populate_sock_filter_policy_xdp( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd, unsigned int xsk_fd, unsigned int lo_xsk_fd) {
-  FD_TEST( out_cnt >= 45 );
-  struct sock_filter filter[45] = {
+  FD_TEST( out_cnt >= 51 );
+  struct sock_filter filter[51] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 41 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 47 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 7, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 8, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 10, 0 ),
     /* allow sendto based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendto, /* check_sendto */ 9, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sendto, /* check_sendto */ 11, 0 ),
     /* allow recvmsg based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_recvmsg, /* check_recvmsg */ 22, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_recvmsg, /* check_recvmsg */ 24, 0 ),
     /* allow getsockopt based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getsockopt, /* check_getsockopt */ 27, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getsockopt, /* check_getsockopt */ 29, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 36, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 40, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 34 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 38 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 33, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 37, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 31, /* RET_KILL_PROCESS */ 30 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 35, /* RET_KILL_PROCESS */ 34 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 29, /* RET_KILL_PROCESS */ 28 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 33, /* RET_KILL_PROCESS */ 32 ),
 //  check_sendto:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
@@ -62,27 +66,27 @@ static void populate_sock_filter_policy_xdp( ulong out_cnt, struct sock_filter *
 //  lbl_3:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, lo_xsk_fd, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 24 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, lo_xsk_fd, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 28 ),
 //  lbl_2:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_4 */ 0, /* RET_KILL_PROCESS */ 22 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_4 */ 0, /* RET_KILL_PROCESS */ 26 ),
 //  lbl_4:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_5 */ 0, /* RET_KILL_PROCESS */ 20 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_5 */ 0, /* RET_KILL_PROCESS */ 24 ),
 //  lbl_5:
     /* load syscall argument 3 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[3])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* lbl_6 */ 0, /* RET_KILL_PROCESS */ 18 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* lbl_6 */ 0, /* RET_KILL_PROCESS */ 22 ),
 //  lbl_6:
     /* load syscall argument 4 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[4])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_7 */ 0, /* RET_KILL_PROCESS */ 16 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* lbl_7 */ 0, /* RET_KILL_PROCESS */ 20 ),
 //  lbl_7:
     /* load syscall argument 5 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[5])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 15, /* RET_KILL_PROCESS */ 14 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 19, /* RET_KILL_PROCESS */ 18 ),
 //  check_recvmsg:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
@@ -90,11 +94,11 @@ static void populate_sock_filter_policy_xdp( ulong out_cnt, struct sock_filter *
 //  lbl_9:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, lo_xsk_fd, /* lbl_8 */ 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, lo_xsk_fd, /* lbl_8 */ 0, /* RET_KILL_PROCESS */ 14 ),
 //  lbl_8:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* RET_ALLOW */ 9, /* RET_KILL_PROCESS */ 8 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, MSG_DONTWAIT, /* RET_ALLOW */ 13, /* RET_KILL_PROCESS */ 12 ),
 //  check_getsockopt:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
@@ -102,15 +106,23 @@ static void populate_sock_filter_policy_xdp( ulong out_cnt, struct sock_filter *
 //  lbl_11:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, lo_xsk_fd, /* lbl_10 */ 0, /* RET_KILL_PROCESS */ 4 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, lo_xsk_fd, /* lbl_10 */ 0, /* RET_KILL_PROCESS */ 8 ),
 //  lbl_10:
     /* load syscall argument 1 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SOL_XDP, /* lbl_12 */ 0, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SOL_XDP, /* lbl_12 */ 0, /* RET_KILL_PROCESS */ 6 ),
 //  lbl_12:
     /* load syscall argument 2 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, XDP_STATISTICS, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, XDP_STATISTICS, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_13 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_13:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/net/xdp/xdp.seccomppolicy b/src/disco/net/xdp/xdp.seccomppolicy
index e4622dc139..8120b8fc1a 100644
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
index c765a0fbbc..5f0d578fc0 100644
--- a/src/disco/netlink/fd_netlink_tile.c
+++ b/src/disco/netlink/fd_netlink_tile.c
@@ -414,6 +414,7 @@ after_frag( fd_netlink_tile_ctx_t * ctx,
 
 #define STEM_BURST (1UL)
 #define STEM_LAZY ((ulong)13e6) /* 13ms */
+#define STEM_IDLE_SLEEP_ENABLED 0
 
 #define STEM_CALLBACK_CONTEXT_TYPE  fd_netlink_tile_ctx_t
 #define STEM_CALLBACK_CONTEXT_ALIGN alignof(fd_netlink_tile_ctx_t)
diff --git a/src/disco/pack/fd_pack_tile.c b/src/disco/pack/fd_pack_tile.c
index 2cce656b85..00cc504c43 100644
--- a/src/disco/pack/fd_pack_tile.c
+++ b/src/disco/pack/fd_pack_tile.c
@@ -693,7 +693,7 @@ after_credit( fd_pack_ctx_t *     ctx,
         break;
       case FD_PACK_STRATEGY_BUNDLE:
         flags = FD_PACK_SCHEDULE_VOTE | FD_PACK_SCHEDULE_BUNDLE
-                                      | fd_int_if( ctx->slot_end_ns - ctx->approx_wallclock_ns<50000000L, FD_PACK_SCHEDULE_TXN,  0 );
+                                      | fd_int_if( ctx->slot_end_ns - ctx->approx_wallclock_ns<100000000L, FD_PACK_SCHEDULE_TXN,  0 );
         break;
     }
 
diff --git a/src/disco/pack/fd_pack_tile.seccomppolicy b/src/disco/pack/fd_pack_tile.seccomppolicy
index efb7dec4f4..e7062f5651 100644
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
diff --git a/src/disco/pack/generated/fd_pack_tile_seccomp.h b/src/disco/pack/generated/fd_pack_tile_seccomp.h
index 83a86c8e32..c2c7bcc45a 100644
--- a/src/disco/pack/generated/fd_pack_tile_seccomp.h
+++ b/src/disco/pack/generated/fd_pack_tile_seccomp.h
@@ -21,34 +21,46 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_pack_tile_instr_cnt = 14;
+static const unsigned int sock_filter_policy_fd_pack_tile_instr_cnt = 20;
 
 static void populate_sock_filter_policy_fd_pack_tile( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd) {
-  FD_TEST( out_cnt >= 14 );
-  struct sock_filter filter[14] = {
+  FD_TEST( out_cnt >= 20 );
+  struct sock_filter filter[20] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 16 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 2, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 4, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 7, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 8, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 12, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 6 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 10 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 5, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 9, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_2:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/plugin/fd_plugin_tile.seccomppolicy b/src/disco/plugin/fd_plugin_tile.seccomppolicy
index a5880d7c08..adcf27ca3f 100644
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
diff --git a/src/disco/plugin/generated/fd_plugin_tile_seccomp.h b/src/disco/plugin/generated/fd_plugin_tile_seccomp.h
index c67ab8aa13..d89d2b037e 100644
--- a/src/disco/plugin/generated/fd_plugin_tile_seccomp.h
+++ b/src/disco/plugin/generated/fd_plugin_tile_seccomp.h
@@ -21,34 +21,46 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_plugin_tile_instr_cnt = 14;
+static const unsigned int sock_filter_policy_fd_plugin_tile_instr_cnt = 20;
 
 static void populate_sock_filter_policy_fd_plugin_tile( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd) {
-  FD_TEST( out_cnt >= 14 );
-  struct sock_filter filter[14] = {
+  FD_TEST( out_cnt >= 20 );
+  struct sock_filter filter[20] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 16 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 2, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 4, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 7, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 8, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 12, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 6 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 10 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 5, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 9, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_2:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/quic/generated/quic_seccomp.h b/src/disco/quic/generated/quic_seccomp.h
index ebb5db8fef..53abec58ef 100644
--- a/src/disco/quic/generated/quic_seccomp.h
+++ b/src/disco/quic/generated/quic_seccomp.h
@@ -21,40 +21,52 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_quic_instr_cnt = 17;
+static const unsigned int sock_filter_policy_quic_instr_cnt = 23;
 
 static void populate_sock_filter_policy_quic( ulong out_cnt, struct sock_filter * out, uint logfile_fd, uint keylog_fd) {
-  FD_TEST( out_cnt >= 17 );
-  struct sock_filter filter[17] = {
+  FD_TEST( out_cnt >= 23 );
+  struct sock_filter filter[23] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 13 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 19 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 3, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 5, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 8, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 10, 0 ),
     /* simply allow getrandom */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getrandom, /* RET_ALLOW */ 10, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_getrandom, /* RET_ALLOW */ 16, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 10, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 14, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 8 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 12 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 7, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 11, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* lbl_2 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 9, /* lbl_2 */ 0 ),
 //  lbl_2:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, keylog_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, keylog_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_3 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_3:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/quic/quic.seccomppolicy b/src/disco/quic/quic.seccomppolicy
index 2f1a9d90dd..0c4eaa7dd5 100644
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
index 76627b5dc8..86bdfa27e1 100644
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
index efb7dec4f4..e7062f5651 100644
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
diff --git a/src/disco/shred/generated/fd_shred_tile_seccomp.h b/src/disco/shred/generated/fd_shred_tile_seccomp.h
index a30de774c4..eeaf804d61 100644
--- a/src/disco/shred/generated/fd_shred_tile_seccomp.h
+++ b/src/disco/shred/generated/fd_shred_tile_seccomp.h
@@ -21,34 +21,46 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_shred_tile_instr_cnt = 14;
+static const unsigned int sock_filter_policy_fd_shred_tile_instr_cnt = 20;
 
 static void populate_sock_filter_policy_fd_shred_tile( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd) {
-  FD_TEST( out_cnt >= 14 );
-  struct sock_filter filter[14] = {
+  FD_TEST( out_cnt >= 20 );
+  struct sock_filter filter[20] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 16 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 2, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 4, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 7, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 8, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 12, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 6 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 10 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 5, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 9, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_2:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/sign/fd_sign_tile.seccomppolicy b/src/disco/sign/fd_sign_tile.seccomppolicy
index efb7dec4f4..e7062f5651 100644
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
diff --git a/src/disco/sign/generated/fd_sign_tile_seccomp.h b/src/disco/sign/generated/fd_sign_tile_seccomp.h
index 7a682b41e3..842b478141 100644
--- a/src/disco/sign/generated/fd_sign_tile_seccomp.h
+++ b/src/disco/sign/generated/fd_sign_tile_seccomp.h
@@ -21,34 +21,46 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_sign_tile_instr_cnt = 14;
+static const unsigned int sock_filter_policy_fd_sign_tile_instr_cnt = 20;
 
 static void populate_sock_filter_policy_fd_sign_tile( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd) {
-  FD_TEST( out_cnt >= 14 );
-  struct sock_filter filter[14] = {
+  FD_TEST( out_cnt >= 20 );
+  struct sock_filter filter[20] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 16 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 2, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 4, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 7, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 8, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 12, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 6 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 10 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 5, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 9, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_2:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/disco/stem/fd_stem.c b/src/disco/stem/fd_stem.c
index 4bcfa0675b..d00f7ff572 100644
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
index d8e9777fab..2d57e883a7 100644
--- a/src/disco/stem/fd_stem.h
+++ b/src/disco/stem/fd_stem.h
@@ -2,6 +2,7 @@
 #define HEADER_fd_src_disco_stem_fd_stem_h
 
 #include "../fd_disco_base.h"
+#include "../../util/pod/fd_pod.h"
 
 #define FD_STEM_SCRATCH_ALIGN (128UL)
 
diff --git a/src/disco/topo/fd_topo.h b/src/disco/topo/fd_topo.h
index 900f5529c5..2b0a720efc 100644
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
index 11a122a5b3..4c33028b08 100644
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
index efb7dec4f4..e7062f5651 100644
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
diff --git a/src/disco/verify/generated/fd_verify_tile_seccomp.h b/src/disco/verify/generated/fd_verify_tile_seccomp.h
index 8c0813d671..b4cd0792a4 100644
--- a/src/disco/verify/generated/fd_verify_tile_seccomp.h
+++ b/src/disco/verify/generated/fd_verify_tile_seccomp.h
@@ -21,34 +21,46 @@
 #else
 # error "Target architecture is unsupported by seccomp."
 #endif
-static const unsigned int sock_filter_policy_fd_verify_tile_instr_cnt = 14;
+static const unsigned int sock_filter_policy_fd_verify_tile_instr_cnt = 20;
 
 static void populate_sock_filter_policy_fd_verify_tile( ulong out_cnt, struct sock_filter * out, unsigned int logfile_fd) {
-  FD_TEST( out_cnt >= 14 );
-  struct sock_filter filter[14] = {
+  FD_TEST( out_cnt >= 20 );
+  struct sock_filter filter[20] = {
     /* Check: Jump to RET_KILL_PROCESS if the script's arch != the runtime arch */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, arch ) ) ),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 10 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, ARCH_NR, 0, /* RET_KILL_PROCESS */ 16 ),
     /* loading syscall number in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, ( offsetof( struct seccomp_data, nr ) ) ),
     /* allow write based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 2, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_write, /* check_write */ 4, 0 ),
     /* allow fsync based on expression */
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 5, 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_fsync, /* check_fsync */ 7, 0 ),
+    /* allow clock_nanosleep based on expression */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_clock_nanosleep, /* check_clock_nanosleep */ 8, 0 ),
+    /* simply allow sched_yield */
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_yield, /* RET_ALLOW */ 12, 0 ),
     /* none of the syscalls matched */
-    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 6 },
+    { BPF_JMP | BPF_JA, 0, 0, /* RET_KILL_PROCESS */ 10 },
 //  check_write:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 5, /* lbl_1 */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 2, /* RET_ALLOW */ 9, /* lbl_1 */ 0 ),
 //  lbl_1:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 3, /* RET_KILL_PROCESS */ 2 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 7, /* RET_KILL_PROCESS */ 6 ),
 //  check_fsync:
     /* load syscall argument 0 in accumulator */
     BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
-    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, logfile_fd, /* RET_ALLOW */ 5, /* RET_KILL_PROCESS */ 4 ),
+//  check_clock_nanosleep:
+    /* load syscall argument 0 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, CLOCK_REALTIME, /* lbl_2 */ 0, /* RET_KILL_PROCESS */ 2 ),
+//  lbl_2:
+    /* load syscall argument 1 in accumulator */
+    BPF_STMT( BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
+    BPF_JUMP( BPF_JMP | BPF_JEQ | BPF_K, 0, /* RET_ALLOW */ 1, /* RET_KILL_PROCESS */ 0 ),
 //  RET_KILL_PROCESS:
     /* KILL_PROCESS is placed before ALLOW since it's the fallthrough case. */
     BPF_STMT( BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS ),
diff --git a/src/discoh/poh/fd_poh_tile.c b/src/discoh/poh/fd_poh_tile.c
index 304965ac8a..7eb08a64ff 100644
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
index d13bbe900c..be02c24371 100644
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
index 479e0f1829..a97f5778d4 100644
--- a/src/util/log/fd_log.h
+++ b/src/util/log/fd_log.h
@@ -142,6 +142,7 @@
 
 #include "../env/fd_env.h"
 #include "../io/fd_io.h"
+#include <time.h>
 
 /* FD_LOG_NOTICE(( ... printf style arguments ... )) will send a message
    at the NOTICE level to the logger.  E.g. for a typical fd_log`


  return { filePath, body }
}

export default modDiff
