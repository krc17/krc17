# Infrastructure

Sample file — one file per project or per person works well here.

## This week

- Corosync ring is live on its own VLAN; failover tested cleanly twice under synthetic load.
- ZFS replication is holding a 15-minute RPO across all three nodes.
- NVMe pool migration finished ahead of schedule, media server is fully cut over.

## Next week

- Live-migration smoke test during the Thursday maintenance window.
- Document the failover runbook while the details are still fresh.

## Help needed

- A second pair of eyes on the fencing configuration before the smoke test.
