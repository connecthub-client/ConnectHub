// One-time privilege setup for VPN connections. OpenVPN needs root to
// create a tun interface and change routes; rather than prompt for a
// password on every connect/disconnect (pkexec's default), this installs a
// polkit rule that allows the current desktop session to run one specific,
// narrowly-scoped helper script as root without a password - not a blanket
// "run anything as root" grant.
//
// The helper script itself re-validates its arguments at run time (only
// config/auth files inside this user's own vpn-profiles directory are
// accepted, and `--script-security 0` is forced so an uploaded .ovpn can
// never use `up`/`down`/`route-up` etc. to run arbitrary code as root) -
// see HELPER_SCRIPT below. That validation is the actual security boundary;
// the polkit action only decides who may reach the helper without a prompt.
use uuid::Uuid;

use crate::error::{AppError, AppResult};

// Not renamed alongside the app (Termora -> ConnectHub): these are the
// exact path/action id already installed (root-owned) on any machine that
// ran setup before the rename. Changing them would orphan that install and
// silently require re-running setup - is_installed() checks these same
// paths, so it would just show the setup banner again for no real reason.
pub const HELPER_PATH: &str = "/usr/local/libexec/termora-openvpn-helper";
const POLICY_PATH: &str = "/usr/share/polkit-1/actions/com.termora.vpn.policy";
const POLICY_ACTION_ID: &str = "com.termora.vpn.run";

// New (not a rename of anything) - added alongside per-host route
// injection, so these use the current ConnectHub branding from the start.
// See vpn::add_host_routes for why this exists: a VPN server may rely on
// taking over the default route to make its own private network (or, for
// a profile whose whole point is changing your exit IP, even a public
// target) reachable at all, and running more than one such profile at once
// means only one can hold that default route - explicitly routing each
// assigned host's own IP through its own tunnel (a /32 route, which always
// outranks a broader default-route claim from any interface) works
// regardless of what either server pushes or which one currently "owns"
// the default route.
pub const ROUTE_HELPER_PATH: &str = "/usr/local/libexec/connecthub-route-helper";
const ROUTE_POLICY_PATH: &str = "/usr/share/polkit-1/actions/com.connecthub.route.policy";
const ROUTE_POLICY_ACTION_ID: &str = "com.connecthub.route.run";

const HELPER_SCRIPT: &str = r#"#!/bin/sh
# Installed and managed by ConnectHub - do not edit by hand, it will be
# overwritten the next time VPN setup runs. Only reachable via the
# com.termora.vpn.run polkit action (see the matching .policy file), which
# grants no other privileges.
set -e

CONFIG="$1"
MGMT_PORT="$2"
AUTHFILE="$3"

USER_HOME=$(getent passwd "$PKEXEC_UID" | cut -d: -f6)
ALLOWED_DIR="$USER_HOME/.local/share/sshtool/vpn-profiles"

case "$CONFIG" in
    "$ALLOWED_DIR"/*.ovpn) ;;
    *)
        echo "termora-openvpn-helper: refusing config outside $ALLOWED_DIR" >&2
        exit 1
        ;;
esac

if [ -n "$AUTHFILE" ]; then
    case "$AUTHFILE" in
        "$ALLOWED_DIR"/*.auth) ;;
        *)
            echo "termora-openvpn-helper: refusing auth file outside $ALLOWED_DIR" >&2
            exit 1
            ;;
    esac
    exec openvpn --config "$CONFIG" --management 127.0.0.1 "$MGMT_PORT" \
        --management-signal --script-security 0 --auth-user-pass "$AUTHFILE"
fi

exec openvpn --config "$CONFIG" --management 127.0.0.1 "$MGMT_PORT" \
    --management-signal --script-security 0
"#;

const ROUTE_HELPER_SCRIPT: &str = r#"#!/bin/sh
# Installed and managed by ConnectHub - do not edit by hand, it will be
# overwritten the next time VPN setup runs. Only reachable via the
# com.connecthub.route.run polkit action (see the matching .policy file).
set -e

ACTION="$1"
IFACE="$2"
TARGET="$3"

case "$IFACE" in
    tun[0-9]*) ;;
    *)
        echo "connecthub-route-helper: refusing non-tun interface $IFACE" >&2
        exit 1
        ;;
esac

case "$TARGET" in
    ''|*[!0-9.]*)
        echo "connecthub-route-helper: refusing non-IPv4 target $TARGET" >&2
        exit 1
        ;;
esac

case "$ACTION" in
    add) exec ip route replace "$TARGET/32" dev "$IFACE" ;;
    *)
        echo "connecthub-route-helper: unknown action $ACTION" >&2
        exit 1
        ;;
esac
"#;

fn policy_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policyconfig PUBLIC "-//freedesktop//DTD PolicyKit Policy Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
<policyconfig>
  <action id="{POLICY_ACTION_ID}">
    <description>Run the ConnectHub OpenVPN helper</description>
    <message>ConnectHub wants to start or stop an OpenVPN connection</message>
    <icon_name>network-vpn</icon_name>
    <defaults>
      <allow_any>no</allow_any>
      <allow_inactive>no</allow_inactive>
      <allow_active>yes</allow_active>
    </defaults>
    <annotate key="org.freedesktop.policykit.exec.path">{HELPER_PATH}</annotate>
    <annotate key="org.freedesktop.policykit.exec.allow_gui">true</annotate>
  </action>
</policyconfig>
"#
    )
}

fn route_policy_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE policyconfig PUBLIC "-//freedesktop//DTD PolicyKit Policy Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/PolicyKit/1/policyconfig.dtd">
<policyconfig>
  <action id="{ROUTE_POLICY_ACTION_ID}">
    <description>Run the ConnectHub route helper</description>
    <message>ConnectHub wants to add a route for a VPN-connected host</message>
    <icon_name>network-vpn</icon_name>
    <defaults>
      <allow_any>no</allow_any>
      <allow_inactive>no</allow_inactive>
      <allow_active>yes</allow_active>
    </defaults>
    <annotate key="org.freedesktop.policykit.exec.path">{ROUTE_HELPER_PATH}</annotate>
    <annotate key="org.freedesktop.policykit.exec.allow_gui">true</annotate>
  </action>
</policyconfig>
"#
    )
}

pub fn is_installed() -> bool {
    std::path::Path::new(HELPER_PATH).exists()
        && std::path::Path::new(POLICY_PATH).exists()
        && std::path::Path::new(ROUTE_HELPER_PATH).exists()
        && std::path::Path::new(ROUTE_POLICY_PATH).exists()
}

// Writes both helper scripts + both policy files to a temp location
// (unprivileged), then runs a single `pkexec` call that installs all four -
// one authentication prompt for this one-time setup, not one per VPN
// connect/disconnect or route added. Anyone who ran setup before route
// injection existed will see the setup banner again exactly once (since
// is_installed() now also checks for the route helper), needing one more
// authorization to pick up the new files - the openvpn helper/policy
// themselves are untouched, so already-connected profiles aren't disrupted.
pub async fn install() -> AppResult<()> {
    let tmp = std::env::temp_dir();
    let helper_tmp = tmp.join(format!("termora-openvpn-helper-{}", Uuid::new_v4()));
    let policy_tmp = tmp.join(format!("termora-vpn-policy-{}.policy", Uuid::new_v4()));
    let route_helper_tmp = tmp.join(format!("connecthub-route-helper-{}", Uuid::new_v4()));
    let route_policy_tmp = tmp.join(format!("connecthub-route-policy-{}.policy", Uuid::new_v4()));
    let installer_tmp = tmp.join(format!("termora-vpn-install-{}.sh", Uuid::new_v4()));

    std::fs::write(&helper_tmp, HELPER_SCRIPT)?;
    std::fs::write(&policy_tmp, policy_xml())?;
    std::fs::write(&route_helper_tmp, ROUTE_HELPER_SCRIPT)?;
    std::fs::write(&route_policy_tmp, route_policy_xml())?;
    std::fs::write(
        &installer_tmp,
        format!(
            "#!/bin/sh\nset -e\n\
             install -D -m 0755 \"{}\" \"{HELPER_PATH}\"\n\
             install -D -m 0644 \"{}\" \"{POLICY_PATH}\"\n\
             install -D -m 0755 \"{}\" \"{ROUTE_HELPER_PATH}\"\n\
             install -D -m 0644 \"{}\" \"{ROUTE_POLICY_PATH}\"\n",
            helper_tmp.display(),
            policy_tmp.display(),
            route_helper_tmp.display(),
            route_policy_tmp.display(),
        ),
    )?;

    let result = tokio::process::Command::new("pkexec")
        .arg("/bin/sh")
        .arg(&installer_tmp)
        .status()
        .await;

    let _ = std::fs::remove_file(&helper_tmp);
    let _ = std::fs::remove_file(&policy_tmp);
    let _ = std::fs::remove_file(&route_helper_tmp);
    let _ = std::fs::remove_file(&route_policy_tmp);
    let _ = std::fs::remove_file(&installer_tmp);

    let status = result.map_err(|e| {
        AppError::Vpn(format!(
            "failed to launch pkexec (is polkit installed?): {e}"
        ))
    })?;
    if !status.success() {
        return Err(AppError::Vpn(
            "VPN privilege setup was cancelled or failed".into(),
        ));
    }
    Ok(())
}
