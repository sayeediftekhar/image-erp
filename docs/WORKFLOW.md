# Workflow — Architect / Implementer Loop

Two Claudes, two roles. Keep them separate.

- **Architect (Claude in chat):** holds the design conversation against the
  Blueprint, writes each atomic-task spec, reviews Claude Code's plan and its diff
  against the Iron Laws (§2). Does NOT touch this repo.
- **Implementer (Claude Code, in VS Code):** holds this repo, plans the *how* for
  ONE task, executes, runs the test suite, fixes errors, commits, and updates
  CONTEXT.md + LEARNINGS.md. Does NOT make design decisions.
- **Sayeed:** carries the spec from Architect to Implementer, approves the plan,
  approves the commit. The human gate on every plan and every commit.

## The loop, per task
1. Architect writes a Task Spec (problem, output contract, files, Iron Laws,
   applicable LEARNINGS, done-criteria) → Sayeed pastes it here.
2. Claude Code: **plan only, write no code.** Read CONTEXT.md + the spec, produce
   the implementation plan.
3. Sayeed takes the plan back to the Architect → approve or adjust.
4. On approval, Claude Code executes: build, run the test suite, self-heal on
   error (≈2 attempts), then commit with a descriptive message.
5. On a block it can't clear — a design ambiguity, a decision only Sayeed can make,
   a test it can't explain in ≈2 tries — STOP and write a `BLOCKED` /
   `NEEDS_CONTEXT` note naming the exact missing piece and who it's needed from.

## Standing rule 1 — docs move with the code
Every task PR updates CONTEXT.md (the `## Session` block: task done, decision made,
next task, blockers) and appends to LEARNINGS.md any quirk that cost >5 min — **in
the same commit as the code, never a separate docs commit.** The doc update is part
of the definition of done. A task whose CONTEXT.md is not updated is not done.

## Standing rule 2 — deferrals become GitHub issues
Any deferral, shortcut, or "fix later" is opened as a GitHub issue *that session*,
labelled `tech-debt`, `deferred`, or `phase-N`. Use `gh issue create`. A deferral
that is not an issue is a deferral you will forget. Reference the issue number in
the CONTEXT.md note that defers it.
