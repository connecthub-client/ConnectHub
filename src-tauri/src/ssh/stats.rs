use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

// POSIX `sh` (no bashisms, so busybox/dash hosts work too). Samples
// /proc/stat twice one second apart to get a CPU% delta, reads
// /proc/meminfo for used/total memory and swap, sums every non-loopback
// interface's cumulative rx/tx byte counters, and reads `df` for root
// filesystem usage. Network *rate* is computed client-side by diffing
// consecutive polls - this script only reports the raw counters, keeping
// this whole feature stateless on the Rust side.
const STATS_SCRIPT: &str = r#"
set -- $(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5; exit}' /proc/stat 2>/dev/null)
t1=${1:-0}; i1=${2:-0}
sleep 1
set -- $(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5; exit}' /proc/stat 2>/dev/null)
t2=${1:-0}; i2=${2:-0}
dt=$((t2 - t1))
di=$((i2 - i1))
cpu=0
if [ "$dt" -gt 0 ]; then
  cpu=$(( (100 * (dt - di)) / dt ))
fi
memtotal=$(awk '/MemTotal/{print $2; exit}' /proc/meminfo 2>/dev/null)
memavail=$(awk '/MemAvailable/{print $2; exit}' /proc/meminfo 2>/dev/null)
memtotal=${memtotal:-0}
memavail=${memavail:-0}
memused=$((memtotal - memavail))
swaptotal=$(awk '/SwapTotal/{print $2; exit}' /proc/meminfo 2>/dev/null)
swapfree=$(awk '/SwapFree/{print $2; exit}' /proc/meminfo 2>/dev/null)
swaptotal=${swaptotal:-0}
swapfree=${swapfree:-0}
swapused=$((swaptotal - swapfree))
rx=0
tx=0
for f in /sys/class/net/*/statistics/rx_bytes; do
  case "$f" in */lo/*) continue ;; esac
  [ -f "$f" ] || continue
  v=$(cat "$f" 2>/dev/null)
  rx=$((rx + ${v:-0}))
done
for f in /sys/class/net/*/statistics/tx_bytes; do
  case "$f" in */lo/*) continue ;; esac
  [ -f "$f" ] || continue
  v=$(cat "$f" 2>/dev/null)
  tx=$((tx + ${v:-0}))
done
set -- $(df -Pk / 2>/dev/null | awk 'NR==2{print $2, $3}')
disktotal=${1:-0}
diskused=${2:-0}
echo "CONNECTHUB_STATS $cpu $memused $memtotal $rx $tx $swapused $swaptotal $diskused $disktotal"
"#;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct HostStats {
    pub cpu_percent: f64,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub swap_used_mb: u64,
    pub swap_total_mb: u64,
    pub disk_used_mb: u64,
    pub disk_total_mb: u64,
}

// Pure parser, deliberately tolerant: any host that doesn't understand this
// script (non-Linux, a restricted shell, etc.) just yields `None` here so
// callers can degrade to "stats unavailable" instead of a hard error - this
// panel is a nice-to-have, not a connection-blocking feature.
pub fn parse_stats_output(stdout: &str) -> Option<HostStats> {
    let line = stdout.lines().find(|l| l.starts_with("CONNECTHUB_STATS "))?;
    let mut fields = line.split_whitespace().skip(1);
    let cpu_percent: f64 = fields.next()?.parse().ok()?;
    let mem_used_kb: u64 = fields.next()?.parse().ok()?;
    let mem_total_kb: u64 = fields.next()?.parse().ok()?;
    let rx_bytes: u64 = fields.next()?.parse().ok()?;
    let tx_bytes: u64 = fields.next()?.parse().ok()?;
    let swap_used_kb: u64 = fields.next()?.parse().ok()?;
    let swap_total_kb: u64 = fields.next()?.parse().ok()?;
    let disk_used_kb: u64 = fields.next()?.parse().ok()?;
    let disk_total_kb: u64 = fields.next()?.parse().ok()?;
    Some(HostStats {
        cpu_percent,
        mem_used_mb: mem_used_kb / 1024,
        mem_total_mb: mem_total_kb / 1024,
        rx_bytes,
        tx_bytes,
        swap_used_mb: swap_used_kb / 1024,
        swap_total_mb: swap_total_kb / 1024,
        disk_used_mb: disk_used_kb / 1024,
        disk_total_mb: disk_total_kb / 1024,
    })
}

// Runs the stats script over its own dedicated connection (same pattern as
// `exec::run` / snippets' run-on-hosts) rather than sharing the interactive
// session's connection - simpler, and consistent with how sftp/exec already
// work in this codebase.
pub async fn fetch(app: &AppState, host_id: Uuid) -> AppResult<HostStats> {
    let output = super::exec::run(app, host_id, STATS_SCRIPT.to_string()).await?;
    parse_stats_output(&output.stdout)
        .ok_or_else(|| AppError::Ssh("could not read host performance stats".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_well_formed_stats_line() {
        let stats =
            parse_stats_output("CONNECTHUB_STATS 12 2048000 8192000 500 1000 512000 2048000 10240000 51200000")
                .unwrap();
        assert_eq!(stats.cpu_percent, 12.0);
        assert_eq!(stats.mem_used_mb, 2000);
        assert_eq!(stats.mem_total_mb, 8000);
        assert_eq!(stats.rx_bytes, 500);
        assert_eq!(stats.tx_bytes, 1000);
        assert_eq!(stats.swap_used_mb, 500);
        assert_eq!(stats.swap_total_mb, 2000);
        assert_eq!(stats.disk_used_mb, 10000);
        assert_eq!(stats.disk_total_mb, 50000);
    }

    #[test]
    fn ignores_leading_shell_noise_and_finds_the_marker_line() {
        let stdout = "some warning from .bashrc\nCONNECTHUB_STATS 5 100 200 10 20 0 0 0 0\n";
        let stats = parse_stats_output(stdout).unwrap();
        assert_eq!(stats.cpu_percent, 5.0);
        assert_eq!(stats.rx_bytes, 10);
    }

    #[test]
    fn returns_none_when_marker_is_missing() {
        assert!(parse_stats_output("command not found: awk\n").is_none());
    }

    #[test]
    fn returns_none_when_a_field_is_missing() {
        assert!(parse_stats_output("CONNECTHUB_STATS 5 100 200 10 20 0 0").is_none());
    }

    #[test]
    fn returns_none_when_a_field_is_not_numeric() {
        assert!(parse_stats_output("CONNECTHUB_STATS oops 100 200 10 20 0 0 0 0").is_none());
    }

    #[test]
    fn returns_none_for_empty_output() {
        assert!(parse_stats_output("").is_none());
    }

    #[test]
    fn handles_a_host_with_no_swap_configured() {
        let stats =
            parse_stats_output("CONNECTHUB_STATS 3 100 200 10 20 0 0 10000 20000").unwrap();
        assert_eq!(stats.swap_used_mb, 0);
        assert_eq!(stats.swap_total_mb, 0);
    }
}
