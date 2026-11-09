---
name: live-case
description: Use when the user is doing a timed live coding case study in a job interview, with Claude Code writing the code while the user leads and reviews.
---

# Live Case

A timed interview exercise, not production. Claude writes. The user decides,
reviews, and must be able to explain every line. Reply in the user's language.
Default length is 90 minutes; if the user gives another, scale the stages.

## Clock
Run `date` at the start and save the start time in the notes. If the case began
before this session, use the time the user gives. Run it again at every stop and
before each TDD step. Open every stop with `Minute X/90`.

## Start
If `.live-case/notes.md` exists, this is a resume: read the spec, plan and notes,
keep the saved start time, and continue from the last approved slice.
Otherwise record the starting commit in the notes. If the folder is not a git
repo, raise `git init` as a decision. Run `git ls-files .live-case`; if it lists
files, raise untracking them as a decision before the first commit.

## Decision format
Anything that changes behaviour or scope, or that the user must explain in the
interview, goes to the user in this format:
- **Decision:** what must be settled
- **Options:** each with its benefit and cost
- **Recommendation:** which one, and why
- **If you pick the other:** what changes in time and code

Gather decisions for the next stop and keep building the work they do not block.
Something built before the user answers stays marked provisional until they do.
Names and file layout are yours to choose. The user can answer in shorthand such
as `1a, 2b`. Log each answer in the notes.

## Files
Everything in `.live-case/` is for the user. Add the folder to `.git/info/exclude`.
- `.live-case/spec.md`: output of stage 1.
- `.live-case/plan.md`: output of stage 2.
- `.live-case/notes.md`: after each slice, what was done, files, why, rejected
  alternative, who decided. Also holds the decision log and the prep sheet.
- `.live-case/review-commit-N.md`: written by the reviewer for each commit.
- `.live-case/review.md`: written by the seam reviewer in stage 4.
- `README.md`: for the interviewer, written in stage 5.

Before any branch switch or merge, run `git log --all -- .live-case/`. If it lists
commits, copy `.live-case/` outside the repository first and restore it afterwards.

## Stages

**1. Understand (0-8).** **REQUIRED SUB-SKILL:** Invoke superpowers:brainstorming
and write the spec through it whenever it is available. Apply these overrides:
skip the opt-out line. No visual companion, no spike, no builder check. Steps:
1. Read the brief and existing code. Ask only what they do not answer.
2. Send all open questions in one message, short enough to relay to the
   interviewer. For each layer the repo does not already fix (language,
   framework, storage, test tool), add the user's preference, and add any
   interviewer constraint, such as a required language or no external
   dependencies.
3. Play back once, with the stack proposal in the same message so one approval
   covers both. Spend at most 2 minutes on the stack. Settle each layer:
   - Fixed by the repo, the brief or the interviewer: settled; state it in one
     line.
   - A user preference that fits the requirements: take it without debate;
     mention a risk only if there is a real one (time, missing tooling).
   - No preference, or one that does not fit the requirements: raise one
     decision in the decision format, at most 3 options. Weigh the user's
     fluency and ability to explain every line, fit to the requirements just
     understood, setup time, built-in test tooling, and the fewest dependencies.
     Recommend the stack the user knows best unless the requirements favour
     another.
4. Run the version command of the runtime and of the test tool. Log the choice,
   the reason and the rejected alternative in the notes; it goes into the spec
   as a constraint and into the README under key decisions.
5. Write the spec, always, whatever size the task seems. Cover requirements,
   assumptions, and candidate edge cases (empty or invalid input, duplicates,
   limits, external failures); the user picks what is in scope. Output a
   one-page `.live-case/spec.md`. No code.

**2. Plan (8-12).** Use superpowers:writing-plans on the spec, with these
overrides: save to `.live-case/plan.md`, tasks are the slices, give files,
interfaces and tests per slice but no full implementations, replace the
execution header with "Execute using live-case stage 3.", remove each task's
commit step because stage 3 commits, and skip the Execution Handoff so no
execution choice is offered. Assign each in-scope edge case to a slice. Include
what is cut. Mark each slice Parallel-safe or Sequential, with the reason.
Parallel-safe requires separate files including tests, interfaces fixed in the
plan, and no dependency on an unfinished slice. Group parallel-safe slices into
batches of at most two. Slice 1 is always Sequential.

The plan has these required rows:
- **Architecture and flow:** layers, and the main request step by step.
- **Input hardening,** in the slice that first accepts input: strict parsing of
  wrong types and malformed bodies, null elements in lists, size limits.
- **Shared-state safety,** in the slice that first reads then writes shared state:
  the lock or guarded update, with its test.
- **Lifecycle test,** in the last slice: one test that walks the main entities
  through every endpoint, for example create, read the effect, advance to the
  final state, see it in the report; and create, cancel, see the effect undone.

At minute 12 open items become listed assumptions. Present spec and plan together
for one approval, which also approves the batches. No code without it.

**3. Build (12-45).** The first slice is working end to end. In slice 1 set up the
simplest test tooling and the check command; if that takes more than a few
minutes, stop and propose an alternative. For each slice, using
superpowers:test-driven-development:
1. Write failing tests from the spec for the slice's main path and edge cases.
   Run them and see them fail.
2. Write the minimal code that makes them pass.
3. Run the slice for real.
4. Run the check command, so earlier slices are covered too.
5. Fix failures with superpowers:systematic-debugging.
6. Commit once the check command is green.

Slices after the first are built by Sonnet 5.5 subagents, each with Agent tool
worktree isolation, given the spec, the plan and its slice. Tell each subagent
the latest commit by hash. Its first action: compare HEAD with that hash and, if
they differ, reset the fresh worktree to it. Subagents do not commit. The main
agent copies each result in, runs the check command, then commits.

After each commit, dispatch a reviewer in the background on that commit's diff,
using the stage 4 brief with a 4-minute limit, writing to
`.live-case/review-commit-N.md`. Start the next slice without waiting for it.

**Stop card.** At every slice stop, output exactly these parts in this order, 15
lines at most: Built (1-2 lines); Flow (3-6 steps of the request); Read (one
file:line and why it matters); Results (tests, real run, anything not run);
Decisions (at most 3, in the decision format); Deferred (a count and the file
holding them). Update the notes.

**Finding gate.** A finding goes to Decisions when it is significant and proven.
Significant: a spec requirement is unmet, money is wrong or the wrong person is
charged, data is stored wrong, a security problem, or a 500 caused by a null,
missing or wrong-type value in the request body. Proven: reproduced by running it.
If a finding concerns money or concurrency and was not run, it goes to Decisions
labelled "not run". Every other finding goes to Deferred. A review that has not
arrived by the stop is presented at the next stop.

A fix the user chooses is a failing test, the fix, the check command, and a new
commit. If the user rejects a slice, revert its commit.

At minute 45, if a slice is open, raise one decision: finish it within 5 minutes,
or revert its commit and list it as cut.

**4. Verify (45-60).** Do a final end-to-end run from a clean start, following the
lifecycle test's scenarios on the running application. At minute 45, as soon as
no slice is open, dispatch a fresh background reviewer using
superpowers:requesting-code-review, limited to 5 minutes. Do not fill its
`code-reviewer.md` template. Give it exactly this brief, plus the spec and the
full diff from the starting commit, and nothing about how the code was written:

> Find where parts built separately do not fit together: conflicting assumptions
> about state or time, inconsistent error formats, logic duplicated and diverged,
> a change in one endpoint another endpoint does not account for. Label each
> Critical (requirement unmet, crash, wrong result on the main path, security),
> High (breaks on an in-scope edge case), Medium (real problem, limited impact),
> or Low (readability, style, small improvements). For each give file:line, the
> problem, and a concrete failure scenario. Sort by severity. Do not change any
> code. Write the result to .live-case/review.md.

The per-commit brief is the same with its first sentence replaced by: "Find every
problem you can in this commit."

Output a table of requirement or edge case -> test / manual check / not verified.

When a review arrives, use superpowers:receiving-code-review. Apply the finding
gate. Mark each finding that reaches Decisions Reproduced, Tried and not
reproduced, or Not run; use "not reproduced" only after a real attempt. Fix what
the user chooses. At minute 60 stop fixing. Everything unfixed that affects
behaviour goes to the README.

**5. Close (60-70).** README: how to run, approach, an Architecture and flow
section (components and what each owns, a small Mermaid diagram, and the main
request traced step by step, describing the code as built and checked against it,
not the plan), key decisions and why, what was cut, edge cases rejected or not
reached, known limitations including every unfixed finding that affects behavior,
what you would do with more time. In the notes add a prep sheet: decisions and
reasons, 3 likely interviewer questions, places the user corrected Claude.

**6. Practice (70-90).** The user reads the 3-4 places that hold the core logic,
named by you with file:line. Then ask interview questions about them, one at a
time, and correct the answers. Code changes stop.

## Checks
Define one local command in slice 1 that runs lint, type checks if any, and all
tests. If the repo already has CI, run the same checks locally. Do not set up CI
during the build. In stage 5, if the submission is a GitHub repo and time remains,
offer a minimal workflow running that same command as a decision. Otherwise list
it under what you would do with more time.

## Rules
- Each diff is small enough to read in a few minutes.
- No dependencies or abstractions the task does not need. No unrelated cleanup.
- Never report something as working unless it was run.
- Stop any process you start by its process id. `timeout` can leave it running.
- Minute 30 without a working end-to-end version: stop extensions, propose cuts.
- 10 minutes or 2 failed fixes on one problem: stop and propose a simplification.
- Short on time: cut scope, keep tests first. Only configuration and scaffolding
  go without a failing test.
- From minute 45, new tests only for bugs found.
- Never change a failing test just to pass. If unclear which is wrong, use the
  decision format.

## Superpowers skills
This skill's clock, stops and approvals override any superpowers default.

Use: brainstorming to write the spec in stage 1; writing-plans for stage 2;
test-driven-development for all code in stage 3 and all fixes;
verification-before-completion at every stop and in stage 4;
systematic-debugging on any failure, within the 2-failed-fixes limit;
requesting-code-review for every review, with this skill's brief and
severity labels; receiving-code-review to evaluate findings before fixing;
dispatching-parallel-agents only for parallel batches in the approved plan.

Do not use: executing-plans, subagent-driven-development.

If a named skill is unavailable, follow the rules in this file.

## Models
Set the model explicitly when dispatching: Sonnet 5.5 for building slices and
reading a large repo, Opus 5.5 for the code review. If one is unavailable, use
the session's model.

## Parallel work
Background by default: reading a large repo, the reviews.
Build slices in parallel only as batches marked in the approved plan, at most two
at a time. Never parallel: the first slice, or slices that share files or depend
on each other.
