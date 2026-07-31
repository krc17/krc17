# Formatting content for the Team Dashboard

How the wall turns your files into what people see. Two kinds of content:
**documents** (Team Updates and Meeting Takeaways) and the **project board**.

---

## Documents — Team Updates & Meeting Takeaways

Same rules for both folders:

- `data\team-updates` — your weekly updates, one file per project or person
- `data\meeting-takeaways` — notes from a meeting

Drop a **Word (.docx)**, **PDF**, **Markdown (.md)** or **plain text (.txt)** file,
up to 25 MB. The panel shows the newest first and rotates every ~25 seconds.

### In Markdown (.md) — the simplest

```
# Platform                 <- first heading = the card TITLE (shown once, big)

## This week               <- a heading = a coloured UPPERCASE section label
- Media server on NVMe     <- a bullet, one idea per line
- Backup window 4h -> 70m

## Next week
- Live-migration test Thursday
```

- **Title:** the first `#` line becomes the card's title. Lead with one.
- **Headings / sub-headings:** `##`, `###` … all become the same coloured
  section label — there is only one heading look on the wall, so `#` for the
  title and `##` for every section is all you need.
- **Bullets:** start a line with `-`, `*`, or `1.` `2.` — numbers become bullets too.
- **Paragraphs:** plain lines. A blank line starts a new paragraph.

### In Word (.docx)

- Apply **Heading 1 / 2 / 3** styles for section labels (the first becomes the title).
- Use the **bulleted or numbered list** buttons for bullets.
- **Tables** work in Word (up to 12 rows × 6 columns) — the only way to get a table.

### What does NOT show (keep it plain)

- **Bold, italic, colour, font size** — all stripped. The wall styles it for you.
- **Code blocks** (```` ``` ```` fences) — hidden entirely.
- **Markdown tables** (`| a | b |`) — print as raw text. Use a Word table instead.
- **Images, links, buttons** — not shown (a link keeps its words, drops the URL).

### Reads well at 4 metres

1. Lead with a `#` title, then `##` sections.
2. Bullets, not paragraphs — one idea per line.
3. **Front-load:** only the first ~15 lines show without touching the screen.
4. Put the date in the filename — `Platform - week 31.docx`.

---

## The project board — `data\projects\projects.yaml`

Not prose — a simple form. Each project is one `-` item under `projects:`.
The card's parts map to the same ideas:

| On the card | In the file |
|---|---|
| **Heading** (card name) | `title:` |
| **Sub-heading** (one line under it) | `summary:` |
| **Bullets** | `milestones:` (first unfinished shows as "Next: …") and `tags:` (small chips) |
| **Buttons** | Built in. Tap a card to move its column, type **Total / Complete**, or set the **due date**. You don't add buttons — every card has them. |

```yaml
projects:
  - title: Proxmox cluster HA failover
    summary: Three-node quorum with replicated storage.
    owner: Kevin Caughman
    status: In Progress          # To Do | Selected | In Progress | In Review | Done
    priority: high               # critical | high | medium | low
    total: 8                     # with "complete": progress = complete/total,
    complete: 5                  # shows how many are left, 100% moves it to Done
    due: 2026-08-14              # YYYY-MM-DD
    tags: [infra, proxmox]
    milestones:
      - name: Live migration smoke test
        done: false
```

- Only `title:` is required; everything else falls back sensibly.
- The columns come from `board.columns:` at the top of the file.
- Instead of `total`/`complete`, you can set `progress: 0-100` directly.

---

*Anything you drop is safe — the worst case is a file nobody needed, and removing
it is one line in a folder. Questions → Kevin.*
