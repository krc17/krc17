# Weekly Engineering Sync — 24 July

Sample file. Delete it once real notes land in this folder.
Drop `.docx`, `.pdf`, `.md`, or `.txt` here and the panel picks them up
automatically, newest file first.

## Decisions

- Cluster failover work stays on the critical path for August; HA testing moves ahead of the Grafana dashboards.
- Guest VLAN rollout is paused until the RMA switch arrives — no workaround worth the risk on production traffic.
- Backup restore-tests become a nightly job rather than weekly, effective this Friday.

## Action items

- Kevin to schedule the live-migration smoke test window with the media team.
- Dana to finish the Suricata EVE parser and post a sample normalised event.
- Marcus to chase the vendor on the RMA and report an ETA by Monday.
- Priya to circulate the restore-test runbook for review.

## Risks raised

- SIEM ingest is at risk: the parser is more involved than scoped, and the 5 August date assumes no further surprises in the EVE schema.
- Switch RMA has no committed ship date, which puts the guest VLAN milestone in question.

## Notes

Attendance was full. Next sync is 31 July, same time. Bring restore-test numbers
from the first three nights.
