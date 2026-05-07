# Uplift ideas

Append-only notes for potentially useful improvements discovered during autonomous phase work. These are review candidates, not implementation commitments.

## 2026-05-07

- Add a small "extension healthcheck" command that launches Chromium, verifies MetaMask is present, records extension ID/version, and exits before touching wallet secrets.
- Emit structured JSONL logs for launcher lifecycle events so later GNHF phases can assert observability without parsing free-form terminal output.
- Add a redaction test fixture that deliberately includes fake secret-looking values and verifies logger output masks them.
- Document a future `METAMASK_EXTENSION_VERSION` + checksum field alongside `METAMASK_EXTENSION_PATH` so local paths remain auditable once the fetcher exists.
- Consider adding a committed `metamask-artifact.json` manifest with version, expected zip filename, download URL, and checksum so the future fetcher and runtime resolver share one pin source.
- Add a future CLI `--format` option if humans need text output, but keep JSON as the default for agent consumption.
