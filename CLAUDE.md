# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

`krc17/krc17` is a **GitHub profile repository**. Because the repo name matches the
owner's username, GitHub renders its `README.md` directly on the user's public
profile page (https://github.com/krc17). This is the repo's entire purpose.

There is no application code, build system, test suite, or dependencies here — the
only meaningful file is `README.md`. Do not add build tooling, CI, or source
scaffolding unless the user explicitly asks; changes are almost always edits to the
profile content itself.

## Working with the README

- `README.md` is the deliverable. It is GitHub-Flavored Markdown and may include
  emoji shortcodes, HTML, and profile widgets/badges.
- The `<!--- ... --->` HTML comment at the bottom is GitHub's default profile-repo
  hint. It is intentionally hidden from the rendered profile; leave it unless the
  user wants it removed.
- To see how a change will look, use GitHub's **Preview** tab on the file — there is
  no local preview or render step in this repo.

## Conventions

- The default branch is `main`. Feature work in this session happens on the branch
  designated in the task instructions.
- Keep edits scoped to profile presentation. Verify rendered Markdown (headings,
  links, emoji, embedded HTML) rather than running any tooling — there is none.
