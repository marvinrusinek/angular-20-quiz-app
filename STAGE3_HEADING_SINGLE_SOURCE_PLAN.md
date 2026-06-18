# Stage 3 — Collapse the heading to one derived source

_Internal scratchpad — do NOT commit. Execution plan for the heading/FET single-source
refactor (Stage 3 of E6). Stages 1 (pure model `heading-model.ts`) and 2 (shadow
`heading-shadow.ts`) are done and validated; the shadow caught + we fixed one real
divergence (multi-answer revisit, commit 43cbd1e4)._

## Target

```
Before:  5 imperative writers + MutationObserver watchdog + cqc-fet-guard gate chain
         all racing over  <h3 #qText>.innerHTML
After:   deriveHeadingHtml(state)  ->  <h3 [innerHTML]="headingHtml()">  (bound once)
```

`deriveHeadingHtml` = the validated pure function in `heading-model.ts`.

## The writers to remove (the multi-writer battleground)

1. `writeQText` / the `qTextHtmlSig` effect — the primary signal->innerHTML path. This is
   the one that SURVIVES and becomes the single binding (its input becomes deriveHeadingHtml).
2. `questionHeadingService.setHtml(...)`
3. `computeIntendedQText(...)`
4. the timer-expiry direct DOM write
5. the MutationObserver watchdog: `installFetWatchdog` / `enforceFetGuard` ->
   `revertQTextToQuestion` (FET->question when "not resolved") + `restoreFetIfResolved`
   (re-assert FET after a racing question write). This is the corrective layer that only
   exists BECAUSE the others race. Our 06-14 fix patched its `isMultiAnswerResolvedNow`.

Plus the ~1,200-LOC `cqc-fet-guard` gate chain (NUCLEAR / HARD FINAL / ABSOLUTE LAST-LINE /
FINAL PRISTINE / UNIVERSAL BACKSTOP / BANNER PRESERVATION) deciding WHEN the FET may show.

## Why this is the high-risk step

Every prior attempt in this pipeline passed `tsc` + unit tests and broke ONLY in the
browser (timing / order-of-execution). 3 "semantically identical" refactors broke it.
=> Each step is gated by a MANUAL BROWSER PASS, and is individually reversible.

## Sequencing (do NOT just add the binding — it would fight the live writers)

You cannot bolt `[innerHTML]="headingHtml()"` on while 5 writers also set innerHTML; Angular
would re-stamp and fight them. Correct order:

- **Step 0 (PROBE, this session, reversible):** gate the watchdog's corrective writes behind
  a runtime flag `window.__fetWatchdogDisabled` (default OFF = current behavior). Browser-test
  every flow with it set to `true`. This answers the load-bearing question: *is the watchdog
  still doing real work, or is it now redundant?* No deletion, instant toggle, zero default
  change. Findings feed Step 3's risk.
- **Step 1 (INVESTIGATE):** read `writeQText` + the `qTextHtmlSig` effect + `questionHeadingService`
  end to end and map exactly what each of writers #2-#4 feeds and when. (Open question: do #2-#4
  call `writeQText`, or write innerHTML directly?) Produce the per-writer truth table.
- **Step 2 (CONSOLIDATE):** make `writeQText` the SOLE writer — route #2/#3/#4 through it (or
  delete if redundant), one at a time, browser-tested each. Heading still computed ad-hoc.
- **Step 3 (DERIVE):** switch `writeQText`'s content to `deriveHeadingHtml(state)`. Now the
  shadow should go permanently silent. Browser-test.
- **Step 4 (REMOVE CORRECTIVE):** with one writer + derived content, delete the watchdog
  (validated removable by Step 0) and collapse the gate chain. Browser-test.
- **Step 5 (BIND):** optional final — replace the imperative `writeQText` signal write with a
  plain `[innerHTML]="headingHtml()"` template binding. Browser-test.

## Per-step verification (manual browser, every step)

Both shuffle modes, on localhost AND gh-pages:
- single-answer: unanswered shows question; answered correctly -> FET
- multi-answer: first click -> question + "N correct" banner; complete all -> FET
- multi-answer revisit: complete, navigate away + back -> FET STAYS (the bug we fixed)
- timer expiry (unanswered) -> FET reveals
- normal run through to Show Results
Plus: watch the console — `[HEADING-SHADOW] MISMATCH` should NOT fire.

## Rollback

Every step is its own commit; `git revert <sha>` restores. Step 0 is a runtime flag (no
revert needed — just unset it). Never batch steps.

## Design decision (confirmed 2026-06-14)

**When the per-question timer expires, the heading SHOWS THE FET — including on
revisit.** (Option A; user-confirmed.) So `heading-model.ts` (`isTimedOut → FET`)
is correct and stays. The work is to make the PRIMARY path deliver this on revisit
so the watchdog becomes redundant — NOT to change the behavior.

### Scoped fix for "FET on timed-out revisit" (the real first Step)

Why the primary path drops it on revisit:
1. `applyTimerExpiryBypass` (in `writeQText`) fires only when the **transient**
   `timedOutIdxSubject.getValue() === curIdx`. That subject is set on expiry
   (cqc-orchestrator:193) but **reset to -1 on navigation** (cqc-question-nav:130),
   so on revisit it never matches.
2. Even if it matched, the bypass only lets **FET-looking `safe`** through — it does
   not GENERATE the FET. On revisit the nav path feeds `writeQText` the QUESTION text,
   which it classifies `_isJustQuestionText` and skips.

The watchdog's `restoreFetIfResolved` is what currently covers the gap (re-writes the
cached FET). To absorb that into the primary path: when the heading would otherwise show
question text for a question in the **durable** `timerExpiredUnanswered` set, emit the
cached/computed FET instead (mirror `restoreFetIfResolved`'s source + `looksLikeFet`
guard). Then the `__fetWatchdogDisabled` probe should stay clean on timed-out revisit →
watchdog removable (Step 4). REAL, fragile-pipeline change — implement behind browser
testing, one step, reversible.

## ROOT CAUSE — "FET reverts to question on timed-out multi-answer revisit" (traced 2026-06-14)

A `[HEADING-TRACE]` MutationObserver (added temporarily to heading-shadow, since reverted)
with Chrome async stack traces proved the mechanism end-to-end:
- The heading is stamped by Angular CD reading the **`qTextHtmlSig` signal** (`runEffect` ->
  `dom_renderer.setProperty`).
- Timer expiry writes the FET via `cqc-orchestrator.writeTimerExpiryFetToDom` (sets the signal,
  but only inside a short nav-guarded retry cascade).
- On REVISIT, the normal display flow re-sets the signal to **question+banner**
  (`buildQuestionDisplayHTML` output) and CD stamps it — wiping the FET.
- The display flow decides FET-vs-question using the **TRANSIENT** `timedOutIdxSubject`
  (reset to -1 on nav in `cqc-question-nav:135`) + the "multi-answer not `_multiAnswerPerfect`
  -> question+banner" rule. So on revisit it sees "not timed out, not completed" -> question.

**Why targeted patches all failed (5 attempts):** the signal is set by ~8 `qTextHtmlSig.set`
sites across cqc-fet-guard (writeQText + guards), cqc-display-text (stampFastPathFet + slow
path), cqc-orchestrator (timer-expiry), cqc-question-nav (clear). Patching ONE (watchdog
`isMultiAnswerResolvedNow`/`restoreFetIfResolved` writes innerHTML, lost to the signal effect;
`applyTimerExpiryBypass` keyed on transient flag / cache; `computeIntendedQText` only feeds the
EMPTY-restore observer, not the revert) gets overridden by another writer using the transient flag.

**The real fix (Stage-3-level):** a DURABLE per-question timeout flag (e.g.
`dotStatusService.timedOutFetForced`, set in `quiz-setup.subscribeToTimerExpiry`, cleared on
reset) consulted by EVERY display-flow path that sets the signal on nav (cqc-display-text
`computeEarlyFlags.isTimedOutForIdx` line 96; `buildDisplayTextContext.multiAnswerBlocked`;
writeQText's gates), each emitting the cached/computed FET (the FET IS stored at timeout via
`storeFormattedExplanation`). NOT safely doable as a single targeted patch — it is the
collapse-to-one-source work. Index note: timer-expiry idx = `host.currentQuestionIndex()`
(QuizComponent, 0-based) vs display-flow idx = `host.questionIndex()` (CodelabQuizContent) —
verify alignment when implementing.

## Status

- **Step 0: DONE 2026-06-14 — finding: the watchdog IS load-bearing.** Browser probe
  (`window.__fetWatchdogDisabled = true`, localhost) showed: revisit a TIMED-OUT,
  incomplete multi-answer question (Q4 / display idx 3) with the watchdog OFF → heading
  reverts to QUESTION text; model says FET (timeout branch); `[HEADING-SHADOW] MISMATCH
  {idx:3, modelSaysFet:true, liveIsFet:false, isMultiAnswerComplete:false, isTimedOut:true}`.
  Toggle watchdog back ON → FET shows again, mismatch stops. So the watchdog (specifically
  `restoreFetIfResolved` / the corrective path) is the ONLY writer re-asserting the FET on
  revisit to a timed-out question — the primary writers do not cover it.
  => The watchdog CANNOT be deleted (Step 4) until a prior step makes the primary path /
  single source emit the FET on timed-out revisit. That becomes Step 2.5 / the real first
  task. Revised order: Step 1 (investigate writeQText/effect) -> NEW Step: make primary path
  handle timed-out-revisit FET -> then consolidate/derive/remove.
- Steps 1-5: not started. Gated on explicit go-ahead, one at a time, browser-tested each.
- The `__fetWatchdogDisabled` probe flag stays in code (harmless, default off) for re-running
  the experiment during Stage 3; remove when Stage 3 concludes or is abandoned.
