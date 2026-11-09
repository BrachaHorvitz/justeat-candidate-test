---
name: live-case-fast
description: Use when the user is doing a timed live coding interview or case study with AI assistance and needs to lead, review, and explain the resulting solution.
---

# Live Case Fast

Deliver the required behavior on time, with short reviews and meaningful
verification. The candidate owns business decisions and must explain the code.
Default: 60 minutes total, including the candidate's practice. If the user gives a
different budget, scale the schedule below proportionally. Reply in the user's language.

## Start and authorization

Read the task and existing code. Save the start time, deadline, and baseline
commit in `.live-case/notes.md`. On resume, read the saved spec, plan, and notes;
preserve the clock and approved scope.
Report elapsed time at milestones; separate candidate waits from working elapsed
time. Background agents and tools count as working, not as candidate waiting.
Working elapsed time is not model compute or billable time.

Bundle material business questions with recommendations. Record reasonable
defaults explicitly. Obtain one approval of a short spec and plan before product
code. Existing approval covers resuming that plan.

Then implement required features, tests, reviews, and minimal fixes to clear
requirement violations autonomously. Ask only about new business semantics,
scope changes, or accepted trade-offs; continue independent work while waiting.
For example, fix a reproduced failure to restore budget on cancellation without
asking again. Whether an earlier card payment should be refunded is a new
business decision. Environment permissions still apply; publishing and
destructive work need their own authorization.

## Decisions the candidate can inspect

Use this format for business ambiguity, scope changes, or meaningful trade-offs:
- **Decision:** what must be settled, with a numbered ID.
- **Options:** lettered choices, each with its benefit and cost.
- **Recommendation:** which option and why.
- **If you pick the other:** the effect on time and code.

Gather open decisions for the next checkpoint and keep building independent
approved work. The candidate can answer `1a, 2b`; log the answer and who decided.
Pause only behavior dependent on an unanswered choice. If the candidate explicitly
authorizes a provisional option, label that work provisional until they settle
it; silence is not approval. Names and file layout are the builder's choices.

Clear fixes to approved requirements remain autonomous. Log their rationale,
rejected alternative where relevant, and evidence so the candidate can explain
them; do not turn every explainable implementation choice into another approval.

## Model routing

| Work | Model when available |
|---|---|
| Combined spec and plan | Opus 5.5 |
| Implementation, tests, routine debugging, documentation | Sonnet 5.5 |
| Intermediate slice reviews | Sonnet 5.5 |
| Fresh final review against the original task | Opus 5.5 |

Use a Sonnet main session and dispatch one Opus planning job before writing the
spec and plan. Tell that job to invoke brainstorming and writing-plans and return
the short artifacts and material decisions. Do not replace the delegation with
inline Sonnet planning merely to save time. If the actual dispatch fails or the
model is unavailable, disclose the error and the available-model fallback.
Set models using actual delegation controls; a skill cannot switch the main
session by saying so.
Use exact IDs when supported. If the tool accepts only `sonnet`/`opus`, verify
which version the configured provider resolves them to. Give agents relevant
files and contracts instead of the full conversation. If a model or delegation
is unavailable, disclose the fallback and work with the available session model.
After a rate-limit failure, inspect saved work and continue locally; do not loop
through retries or replacement agents. Do not change global model settings.
If the account/session has no usable quota, stop new API attempts and leave a
resumable checkpoint: changed files, actual failing/passing checks, unfinished
fixes/reviews, and next actions. Never label that interrupted state complete.

## Schedule

These are deadlines, not waiting periods. Advance early and scale to the actual
time budget.

| Minutes | Outcome |
|---|---|
| 0-6 | Short spec and plan approved |
| 6-32 | First complete flow by minute 14; required features and tests built |
| 32-42 | Final review, adversarial checks, important fixes |
| 42-50 | Clean-start HTTP demo, final checks, short README |
| 50-60 | Candidate reads core code and practices explanations |

At minute 20 without a working end-to-end flow, simplify and drop stretch goals.
Prioritize required work at minute 32. A missing required feature remains
incomplete, not a newly labelled stretch goal. Raise a concrete scope decision
when the deadline is threatened. Stop ordinary code changes for practice;
report a later blocker and its time cost before reopening the build.

## Plan and build

Write `.live-case/spec.md` and `plan.md`, about one page each: required behavior,
responses, schema, invariants, assumptions; layers and request flow; slices,
fixed interfaces/file ownership, risk-based tests, and deferred extras.
Reference the brief. Do not write full implementations or exhaustive tests into
the plan. Use a familiar stack and reuse an approved starter when supplied.

Build the first HTTP-to-database flow sequentially. Close it with its checks,
commit, review dispatch, and candidate checkpoint before expanding to later
slices. The checkpoint is a full message in the format under Review checkpoints,
sent before the next slice's first test and appended to `.live-case/notes.md` as
"Checkpoint N". Write no later slice's test until both are done. A progress note
does not count, and announcing a checkpoint or pointing to the notes is not
sending it: put the checkpoint text itself in the reply. The
background review does not block independent work. Later use at most two
implementation agents, only with fixed interfaces, separate files including
tests, and no dependency on unfinished work. Keep schemas/shared rules under
one owner. Use worktrees for overlapping changes or when required by the
environment; disjoint files may share a workspace. Agents do not commit; the
main agent integrates and checks their work.

Define focused-test and full-check commands, including existing lint/type checks.
For each slice: invoke TDD, write the behavior test, run it to an intended
assertion failure and record the command/result, then implement and run focused
checks. Scaffold importable interfaces if needed to reach the behavior assertion
before implementing the rule. Missing-module and compilation failures are setup
failures, not proof an assertion detects the bug. Writing production behavior
first and disclosing it afterwards does not satisfy this sequence. Reproduce bugs
before fixing them and show the regression detects the failure.

Use focused checks during edits and related fixes; batch costly integration
startup into one invocation. Run full checks after the first complete flow, an
integrated slice or parallel batch, and before completion. Several related fixes
may share the next full-check checkpoint. Focused-only verification remains
provisional. Do not repeat unchanged green suites without a new failure,
relevant change, or unresolved risk.

Introduce shared-state protection in the slice that first creates the race.
Test required money, state, time, malformed-input, and shared-state rules. Check
accepted inputs that can break downstream results, not just parser shape, such as
aggregates past the safe numeric range. Before the final review, run an adversarial
sweep and add regressions for each failure; no client input may produce a 500.
Cover: oversized body, malformed paths and request targets (bad percent escapes, `//`),
every field with every wrong JSON type, numeric literals whose source text differs
from the parsed value (`0.10000000000000001`), and each limit at, below, and above its
boundary. After any change to validation, re-run the whole sweep so a fix cannot
loosen another field.
Include a lifecycle test across main endpoints. Avoid shared-date fixtures,
unbounded waits, and leaked resources. Commit slices/batches after full checks
pass. Demo important live paths at milestones; do not restart the server or
repeat an unchanged demo for every small test. After two failed fix attempts or
seven minutes on a blocker, simplify or escalate with evidence and remaining time.

## Reviews: retained, short, important findings only

Invoke `superpowers:requesting-code-review` before each review dispatch and
`superpowers:receiving-code-review` when a review returns, before saving or fixing
anything; record each invocation once.
Every integrated feature slice gets a background Sonnet review; one review may
cover a parallel batch with each slice named. Continue independent work. Keep
at most one incremental reviewer active; queue or combine unreviewed slices.
Before the final review is dispatched, every integrated slice has a dispatched
review or is named in a combined one, and the notes say which. Skipping a slice's
review for time is not allowed; combine it instead.
Budget two minutes and at most three unique findings per incremental review.
Use one fresh Opus final review, budget four minutes and at most five findings.
Tell every reviewer to run each check as one simple command, writing any script to
a file under `.live-case/` first, because heredocs and `&&`/`;` chains may be
denied. If a review or recheck returns with no executed evidence, re-dispatch it
once with that instruction before relying on your own checks, which stay labelled
non-independent.
Monitor budgets: timed-out reviews are incomplete, never passed. Report any
coverage left unfinished at the deadline.

Do not create recursive reviews for every fix commit. The existing reviewer or
final review checks fixes. Any code change after the final review, for any
finding, needs a fresh reviewer's recheck: dispatch it yourself without asking
the candidate, budget two minutes, scope it to the fix diff and the behavior it
touches, and do not claim completion until it returns or is reported unfinished.
It is mandatory, never an offered option or a deferred item, and it is a focused independent
recheck. Give reviewers the original task, relevant code/diff, assumptions, and
tests. The final review covers the complete solution, not just module seams.
The plan is supporting context, not the authority over the original task.

Review brief:
> Report only important requirement, correctness, financial, data-integrity,
> security, or realistically triggerable failure findings. Check ordinary paths
> and in-scope boundaries/invalid inputs, including accepted inputs that later
> produce wrong results or crashes. Omit style, naming, speculative scale issues,
> optional features, and generic abstraction advice. Rank by impact; do not fill
> a quota. Each finding: severity, file:line, triggering input/interleaving,
> expected vs actual behavior, and evidence status (Reproduced / Unverified).
> Include command/result when run; never claim an unexecuted case reproduced.
> Change no code. If none qualify, say so and state material verification gaps.

A behavior the original task or approved spec/plan requires cannot be deferred as
minor: reproduce it and fix it. Defer only behavior outside both, with the reason
in the notes.
Reproduce plausible important findings and add focused regressions. Fix proven
requirement violations within approved scope without another approval. Investigate
unverified money, concurrency, or data-integrity concerns before declaring them
safe; identify static proof as such. Ask only when a fix needs a new business or
scope decision. Record deferred/unverified behavior risks in notes and README.
Cosmetic work and broad investigation must not displace required behavior.

## Review checkpoints during the work

At each completed slice or integrated batch, and when an important review arrives,
show a checkpoint message the candidate can inspect, with the labelled lines
Elapsed, Works, Tests, Code, Next, Review, Findings, and Decisions. A status such
as "slice 1 is green" is not a checkpoint. Every checkpoint is also appended to
`.live-case/notes.md` so the candidate can reread it. Contents:
- Elapsed time; what works; test results; one useful code location; next step.
- Links to the review and decision log. If a review is pending, link its intended
  path and state pending rather than implying a report already exists.
- Important findings with evidence status and disposition: Fixed (with checks),
  Pending verification, Deferred (with reason), or Needs your decision.
- Open decisions in the four-field format above; use IDs to reference an
  unchanged decision rather than repeat its full text at every update.

Make received reviews and subsequent resolutions readable in their files; retain
the original finding and append the action, checks, and current status. On receipt,
save the returned findings, evidence, and gaps and change Pending to Received
before applying fixes. Do not leave a pending placeholder after the reviewer
has returned. Mark a finding Fixed only after its checks pass. The
candidate can read and challenge them throughout. Continue independent work
without requiring acknowledgement of a status update. If they explicitly ask to
read a review before its fixes, hold those fixes while continuing independent work.

## Finish, report, practice

Everything in `.live-case/` is for the candidate. Add `.live-case/` to the local
`.git/info/exclude`, preserving existing entries; in a worktree resolve it with
`git rev-parse --git-path info/exclude`. Exclusion does not untrack committed files;
flag tracked preparation files and ask before untracking them.

| File | Purpose |
|---|---|
| `.live-case/spec.md` | Short agreed requirements and assumptions |
| `.live-case/plan.md` | Approved slices, interfaces, ownership, and tests |
| `.live-case/notes.md` | After each slice: work/files, why, rejected alternatives, who decided, verification; decision log and interview prep sheet |
| `.live-case/review-commit-N.md` | Intermediate review, covered commit hash(es), findings, and resolution history |
| `.live-case/review.md` | Final review of the full solution and resolution history |
| `README.md` | Interviewer-facing run instructions, approach, and limitations |

Retain existing review files, including older `review-slice-N.md` files; link them
from the notes rather than rename or overwrite candidate material. One review
file may cover a parallel batch when its slices and commits are listed.

Before any branch switch or merge, run `git log --all -- .live-case/`. If it lists
commits, copy `.live-case/` outside the repository and verify the backup first;
restore the candidate's files afterwards, preserving newer content and raising
conflicting edits instead of overwriting them. This does not authorize a branch
switch, merge, or discard by itself.

Do not rewrite the repository, change global configuration, or publish unless requested.

After the final review and its recheck, update the notes: resolutions, the
evidence table, and the interview prep sheet (decisions, trade-offs, likely
questions). Missing notes mean the work is incomplete.

Before completion, run full checks and a clean-start HTTP lifecycle demo:
success, an invalid request, and relevant money/state/report effects. Keep a
requirement -> automated test / live check / unverified table in the notes.
Report actual counts, failures, and gaps. Stop processes you started by ID.

README: run/test commands, layers/flow, assumptions, cuts, known limitations,
next steps. Point the candidate to three or four core code locations; ask
interview questions one at a time about decisions, transactions, failures,
scaling, and verification of AI output.

| Pressure | Response |
|---|---|
| Candidate away; agreed requirement broken | Reproduce and minimally fix; approval already covers it |
| Focused test green; costly startup | Continue focused work; full-check at integration/completion |
| Time short; review pending | Enforce review budgets and disclose unfinished coverage |
| Cosmetic suggestions in review | Exclude them; prioritize required behavior |
| Model/agent limit | Inspect saved work, disclose fallback, continue without a retry loop |

## Superpowers skills

At entry to each relevant stage, invoke the named skill when available and record
the actual invocation once in the notes. Familiarity with its principles or a
time-saving rationale does not replace invocation. Apply this exercise's short
artifacts, time budgets, approval boundaries, and review brief:

| When | Skill |
|---|---|
| Initial clarification/spec | `superpowers:brainstorming` |
| Short slice plan | `superpowers:writing-plans` |
| New behavior and regression fixes | `superpowers:test-driven-development` |
| Claiming working, passing, or complete | `superpowers:verification-before-completion` |
| Unexpected failure or failed fix | `superpowers:systematic-debugging` |
| Dispatching and evaluating reviews | `superpowers:requesting-code-review`, `superpowers:receiving-code-review` |
| Independent approved parallel batch only | `superpowers:dispatching-parallel-agents` |

The initial spec/plan has one approval. Do not add another planning interview,
execution handoff, full implementations in the plan, default review templates,
or a reviewer cascade. Do not use `superpowers:executing-plans` or
`superpowers:subagent-driven-development`; this skill already owns execution.
Helpers do not add approval gates for clear requirement fixes. If a named skill
is unavailable, disclose that and follow this self-contained workflow.
