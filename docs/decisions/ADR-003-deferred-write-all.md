# ADR-003 — Deferred write all for OLT Configuration

## Status

Accepted

## Context

BDCOM OLTs require `write all` command to save running configuration to startup configuration. Initially, `write all` was called immediately after each OLT configuration change (ONU add, delete, description update, bandwidth change).

However, this caused issues:
- OLT session drops after ~36 commands
- Multiple `write all` commands in quick succession may cause issues
- Configuration changes may not persist if `write all` runs too early
- Unnecessary wear on OLT flash memory

## Decision

Remove `write all` from all OLT driver methods. Instead:
1. `write all` runs via daily scheduler at 01:00 AM
2. Retry at 02:00 AM if 01:00 run had failures
3. Configuration changes take effect immediately (in running config)
4. Changes persist after next daily `write all`

## Alternatives Considered

1. **Immediate write all** — Call after every configuration change
   - Rejected: Causes session issues, unnecessary flash wear

2. **write all on-demand** — User triggers manually
   - Rejected: Users may forget, changes lost on reboot

3. **write all per-session** — Call once at end of telnet session
   - Rejected: BDCOM drops session after ~36 commands, unreliable

## Consequences

### Benefits
- No session issues from multiple `write all` commands
- Reduced flash memory wear
- Configuration changes apply immediately (running config)
- Daily backup ensures all changes persist

### Tradeoffs
- Changes lost if OLT reboots before daily `write all` (rare)
- No immediate persistence guarantee
- Requires scheduler to be running

## Date

2026-06-01
