# pi-purge

Paseo plugin for pi-purge, the instruction-authority cleansing tool for the pi coding agent
(`@earendil-works/pi-coding-agent`) on the daemon machine.

It surfaces the purge state inside Paseo: the pi-purge console lives in the sidebar panel strip
alongside Snippets (workspace panel with the explorer location first), carrying the 18-patch
table, Guard/Apply/Revert actions, and a drill range that fires four live drills (simulated
update with self-heal, identity injection forensics, output-cap breakthrough, project-trust
bypass). Sidebar rows open maximized views of the status and the drill range, a composer pill
puts a shield menu above the message box for every active agent, and `/purge` and `/drill` slash
commands work from the composer.

Daemon side, it also observes `agent.session_open`: when a pi agent is about to start, it runs a
hash guard against the pi bundle and silently reapplies the patches if a pi update overwrote
them, so Paseo-launched pi agents always run purged.

## Setup

- The pi-purge tool must exist at `C:/Users/Milk/.pi/agent/pi-purge/pi-purge.mjs`
  (override with the `PI_PURGE_TOOL` environment variable on the daemon).
- Requires Paseo `>=0.12.0 <0.13.0` and a pi install managed by pi-purge on the same machine.

## Capabilities and limits

- Status reads nothing beyond the pi install directory and pi's npm launcher scripts.
- Apply rewrites pi bundle chunks from pristine backups; Revert restores them.
- Guard runs automatically on pi agent session open; it never blocks the session—on failure it
  logs to the plugin log only.
