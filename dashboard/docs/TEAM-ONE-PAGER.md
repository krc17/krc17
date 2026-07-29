# Posting to the Team Dashboard

The TV in the engineering area shows meeting takeaways, team updates and the
project board. You keep it current. It takes about a minute a week.

---

## Post a file

**Open `http://TV-PC-NAME:8770/drop` on any machine on the office network.**
Phone, laptop, desk PC — anything with a browser. No login, no shared drive.

1. Pick **Team Updates** or **Meeting Takeaways**
2. Drag your file in, or tap to choose it
3. Tap **Post to the wall**

It appears on the TV within a second. That is the whole process.

> The address is printed on the dashboard itself, under Team Updates.
> If it is not showing, the wall is set to local-only — ask Kevin.

**What works:** Word (`.docx`), PDF, Markdown (`.md`), plain text (`.txt`).
Up to 25 MB.
**What does not:** slides, spreadsheets, images, scanned PDFs with no text layer.

---

## What to post where

**Team Updates** — one file per project or per person. A good weekly update:

```
# Platform

## This week
- Cut the media server over to the NVMe pool, no downtime
- Backup window down from 4 hours to 70 minutes

## Next week
- Live-migration smoke test on Thursday

## Help needed
- Second pair of eyes on the fencing config
```

**Meeting Takeaways** — notes from a meeting. Lead with decisions, then
actions with names on them, then risks. The panel shows the newest first and
rotates through the rest every 25 seconds.

---

## Five things that make it read well on a wall

1. **Headings.** `#` in Markdown, or Heading 1/2 in Word. They become the
   coloured section labels. A wall of unbroken paragraph is unreadable at 4 metres.
2. **Bullets, not prose.** One idea per line.
3. **Front-load.** Only the first ~15 lines are visible without touching the
   screen. Put the thing people need to know at the top.
4. **Name files so the date is obvious** — `Platform - week 31.docx`. Posting
   the same name twice keeps both; the older one does not disappear.
5. **Names on actions.** "Dana to finish the parser" beats "the parser needs finishing".

---

## The project board

Tap any card on the TV to open it. From there you can:

- **Move it** to another column, or press and hold and drag it
- **Tick milestones** as they complete
- **Set progress** — nudge by ±10/±25, or jump to 0/25/50/75/100%
- **Change the due date** — shift by a day or a week, or set Today / +2 wks / +1 mo

Everything writes straight back to the project file, so the board and the file
never disagree. If you would rather edit the file directly, it is
`projects.yaml` in the dashboard's `data\projects` folder and it documents
itself at the top.

---

## The blackboard

Swipe left on the TV, or tap **Blackboard** in the bottom bar. Write with the
pen. It saves by itself and survives a reboot — treat it as a permanent
scratchpad, not a whiteboard that gets wiped nightly.

**Undo** removes your last stroke. **Clear** wipes the whole board and asks first.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| The page will not load | You are probably on guest wifi. Use the office network. |
| "Only these file types work" | Export to PDF or Word first. |
| Your PDF shows up blank | It is a scan. Run OCR, or post the Word original. |
| Your file is not on the wall | Check you tapped **Post to the wall**, not just chose the file. |
| Something else | Tell Kevin. Nothing you can post will break it. |

---

*Questions: Kevin. Nothing here is destructive — the worst you can do is post
a file nobody needed, and deleting it is one line in a folder.*
