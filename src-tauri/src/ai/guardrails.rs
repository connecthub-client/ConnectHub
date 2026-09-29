// Hard backstop for the AI feature's command execution, enforced in Rust
// (commands::ai_commands::ai_command_exec) rather than only suggested by
// the frontend UI - a compromised or buggy frontend can't bypass it by
// simply not showing the confirmation dialog. This is a last-resort net,
// not the actual safety design: the real design is a visible, per-step log
// with a Stop button (see aiStore.ts on the frontend) - this list only
// catches the specific case of something *destructive* slipping through
// either mode.

pub const MAX_OUTPUT_BYTES: usize = 8 * 1024;

// Plain lowercase substring checks - deliberately not a regex crate
// dependency for a list this short and this codebase's own preference for
// hand-rolled logic over a library for something small (see CLAUDE.md's
// "no external DnD library" precedent). Extend this list rather than
// trying to make it exhaustive - it only needs to catch the most
// unambiguously destructive patterns, not every conceivable one.
const DENYLIST_PATTERNS: &[&str] = &[
    "rm -rf",
    "rm -fr",
    "dd if=",
    "dd of=",
    "mkfs",
    "shutdown",
    "reboot",
    "iptables -f",
    "> /dev/sd",
    "chmod -r 000 /",
    ":(){ :|:& };:", // classic fork-bomb literal
];

pub fn denylist_match(command: &str) -> Option<&'static str> {
    let lower = command.to_lowercase();
    DENYLIST_PATTERNS
        .iter()
        .copied()
        .find(|pattern| lower.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_a_denylisted_pattern_case_insensitively() {
        assert_eq!(denylist_match("sudo RM -RF /var/lib"), Some("rm -rf"));
    }

    #[test]
    fn matches_regardless_of_surrounding_command_text() {
        assert!(denylist_match("cd /tmp && shutdown -h now").is_some());
    }

    #[test]
    fn does_not_match_an_ordinary_command() {
        assert!(denylist_match("systemctl status nginx").is_none());
    }

    #[test]
    fn does_not_false_positive_on_a_substring_that_merely_contains_similar_words() {
        // "reboot" as a plain word should still match (it's in the list
        // deliberately) but something clearly unrelated should not.
        assert!(denylist_match("ls -la /home/reboot-notes.txt").is_some()); // contains "reboot" - accepted false positive, safer to over-trigger here
        assert!(denylist_match("cat /var/log/syslog | grep error").is_none());
    }
}
