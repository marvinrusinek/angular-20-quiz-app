import { Injectable } from '@angular/core';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { SharedOptionConfig } from '../../../models/SharedOptionConfig.model';
import { QuizQuestion } from '../../../models/QuizQuestion.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { FeedbackProps } from '../../../models/FeedbackProps.model';
import { OptionClickHandlerService } from './option-click-handler.service';
import { OptionService } from '../view/option.service';
import { QuizService } from '../../data/quiz.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { FeedbackService } from '../../features/feedback/feedback.service';
import { OptionHydrationService } from './option-hydration.service';
import { OptionBindingFactoryService } from './option-binding-factory.service';
import { ExplanationTextService } from '../../features/explanation/explanation-text.service';

@Injectable({ providedIn: 'root' })
export class SharedOptionBindingService {
  constructor(
    private quizService: QuizService,
    private selectedOptionService: SelectedOptionService,
    private feedbackService: FeedbackService,
    private optionHydrationService: OptionHydrationService,
    private optionBindingFactory: OptionBindingFactoryService,
    private explanationTextService: ExplanationTextService,
    private clickHandler: OptionClickHandlerService,
    private optionService: OptionService
  ) {}

  synchronizeOptionBindings(comp: any): void {
    if (!Array.isArray(comp.optionsToDisplay) || comp.optionsToDisplay.length === 0) {
      console.warn('[SOC] synchronizeOptionBindings() aborted — optionsToDisplay EMPTY');
      const hasSelection = comp.optionBindings?.some((opt: any) => opt.isSelected);
      if (!hasSelection && !comp.freezeOptionBindings) {
        comp.optionBindings = [];
      }
      return;
    }

    if (comp.freezeOptionBindings || comp.hasUserClicked) {
      console.warn('[SOC] freezeOptionBindings/hasUserClicked active — ABORTING reassignment');
      return;
    }

    const bindings = comp.optionsToDisplay.map((option: any, idx: number) => {
      const isSelected = option.selected ?? false;
      const isCorrect = option.correct ?? false;
      return {
        option: {
          ...option,
          // Force visual flags OFF for the initial pass. The real
          // visual state is applied by rehydrateUiFromState AFTER
          // authoritative selections are resolved. Using stale
          // option.selected here causes a brief flash of incorrect
          // highlights on refresh.
          highlight: false,
          showIcon: false
        },
        index: idx,
        isSelected: false,
        isCorrect,
        showFeedback: false,
        feedback: option.feedback ?? 'No feedback available',
        showFeedbackForOption: { [idx]: false },
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: false,
        highlightCorrect: false,
        disabled: comp.computeDisabledState(option, idx),
        type: comp.resolveInteractionType(),
        appHighlightOption: false,
        appHighlightInputType: (comp.type === 'multiple' ? 'checkbox' : 'radio') as 'checkbox' | 'radio',
        allOptions: [...comp.optionsToDisplay],
        appHighlightReset: false,
        ariaLabel: `Option ${idx + 1}`,
        appResetBackground: false,
        optionsToDisplay: [...comp.optionsToDisplay],
        checked: false,
        change: () => { },
        active: true
      };
    });

    queueMicrotask(() => {
      // If processOptionBindings already built correct bindings (with
      // rehydrated state), skip this overwrite — the microtask would
      // replace them with stale option.selected data, causing a flash
      // of incorrect highlights before the next CD cycle corrects them.
      if (comp.optionBindingsInitialized && comp.optionBindings?.length > 0) {
        comp.showOptions = true;
        comp.renderReady = true;
        comp.cdRef.markForCheck();
        return;
      }
      comp.optionBindings = bindings;
      comp.showOptions = true;
      comp.renderReady = true;
      comp.cdRef.detectChanges();
    });

    comp.updateHighlighting();
  }

  setOptionBindingsIfChanged(comp: any, newOptions: Option[]): void {
    if (!newOptions?.length) return;

    const incomingIds = newOptions.map((o: any) => o.optionId).join(',');
    const existingIds = comp.optionBindings?.map((b: any) => b.option.optionId).join(',');

    if (incomingIds !== existingIds || !comp.optionBindings?.length) {
      comp.optionBindings = newOptions.map((option: any, idx: number) => ({
        option: { ...option },
        index: idx,
        isSelected: !!option.selected,
        isCorrect: option.correct ?? false,
        showFeedback: false,
        feedback: option.feedback ?? 'No feedback available',
        showFeedbackForOption: false,
        highlightCorrectAfterIncorrect: false,
        highlightIncorrect: false,
        highlightCorrect: false,
        disabled: comp.computeDisabledState(option, idx),
        type: comp.resolveInteractionType(),
        appHighlightOption: false,
        appHighlightInputType: '',
        allOptions: comp.optionsToDisplay ?? []
      })) as unknown as OptionBindings[];
    } else {
      let idx = 0;
      for (const binding of comp.optionBindings ?? []) {
        const updated = newOptions[idx];
        if (updated) {
          binding.option = { ...updated };
          binding.isSelected = !!updated.selected;
          binding.isCorrect = updated.correct ?? false;
        }
        idx++;
      }
    }

    comp.optionsReady = true;
    comp.showOptions = true;

    if (this.explanationTextService.latestExplanation) {
      const currentIdx = comp.resolveDisplayIndex(comp.currentQuestionIndex);
      if (this.explanationTextService.latestExplanationIndex === currentIdx) {
        comp.deferHighlightUpdate(() => comp.emitExplanation(currentIdx));
      }
    }
  }

  generateOptionBindings(comp: any): void {
    if (comp.hasUserClicked && comp.optionBindings?.length > 0) {
      console.log('[generateOptionBindings] SKIPPED — user has already clicked, preserving binding state');
      return;
    }

    const currentIndex = comp.getActiveQuestionIndex() ?? 0;

    const localOpts = Array.isArray(comp.optionsToDisplay)
      ? comp.optionsToDisplay.map((o: any) => structuredClone(o))
      : [];

    const correctTexts = new Set<string>();
    const correctIds = new Set<number>();
    if (comp.currentQuestion && Array.isArray(comp.currentQuestion.answer)) {
      comp.currentQuestion.answer.forEach((a: any) => {
        if (!a) return;
        if (a.text) correctTexts.add(a.text.trim().toLowerCase());
        const id = Number(a.optionId);
        if (!isNaN(id)) correctIds.add(id);
      });
    }

    comp.optionsToDisplay = localOpts.map((opt: any, i: number) => {
      const oIdNum = Number(opt.optionId);
      const oId = !isNaN(oIdNum) ? oIdNum : (currentIndex + 1) * 100 + (i + 1);
      const oText = (opt.text ?? '').trim().toLowerCase();

      const isCorrect = opt.correct === true ||
        (opt as any).correct === "true" ||
        (!isNaN(oIdNum) && correctIds.has(oIdNum)) ||
        !!(oText && correctTexts.has(oText));

      return {
        ...opt,
        optionId: oId,
        correct: isCorrect,
        highlight: false,
        showIcon: false,
        active: opt.active ?? true,
        disabled: comp.computeDisabledState(opt, i)
      };
    });

    comp.optionBindings = this.optionBindingFactory.createBindings({
      optionsToDisplay: comp.optionsToDisplay,
      type: comp.resolveInteractionType(),
      showFeedback: comp.showFeedback,
      showFeedbackForOption: {},
      highlightCorrectAfterIncorrect: comp.highlightCorrectAfterIncorrect(),
      shouldResetBackground: comp.shouldResetBackground,
      ariaLabelPrefix: 'Option',
      onChange: (opt: any, idx: number) => comp.handleOptionClick(opt, idx),
      isSelected: () => false,
      isDisabled: (opt: any, idx: number) => comp.computeDisabledState(opt, idx)
    });

    comp.rehydrateUiFromState('generateOptionBindings');

    const hasFreshFeedback = Object.keys(comp.feedbackConfigs).length > 0;
    if (!hasFreshFeedback) {
      comp.rebuildShowFeedbackMapFromBindings();
    }

    comp.showOptions = true;
    comp.optionsReady = true;
    comp.renderReady = true;

    comp.markRenderReady('Bindings refreshed');
    comp.cdRef.markForCheck();
  }

  processOptionBindings(comp: any): void {
    const options = comp.optionsToDisplay ?? [];

    if (!options.length) {
      comp.optionBindingsInitialized = false;
      return;
    }
    if (comp.freezeOptionBindings) return;
    if (!comp.currentQuestion) return;

    const currentIdx = comp.currentQuestionIndex ?? this.quizService.getCurrentQuestionIndex();

    const rawSavedSelections = this.selectedOptionService.getSelectedOptionsForQuestion(currentIdx) || [];
    // Strict question-context filter: drop any selection whose stored
    // questionIndex doesn't match currentIdx, so a previous question's
    // selections can never stamp highlights onto a new question's options.
    const savedSelections = rawSavedSelections.filter((s: any) => {
      const sQIdx = s?.questionIndex ?? s?.qIdx ?? s?.questionIdx;
      return sQIdx == null || Number(sQIdx) === Number(currentIdx);
    });
    const savedIds = this.optionHydrationService.toIdSet(savedSelections);

    const getBindings = comp.getOptionBindings.bind(comp);
    const highlightSet = comp.highlightedOptionIds;

    const feedbackSentence = this.feedbackService.buildFeedbackMessage(
      comp.currentQuestion,
      savedSelections,
      false,
      false,
      currentIdx,
      comp.optionsToDisplay
    ) || '';

    // DIAGNOSTIC: dump what processOptionBindings sees on Q2
    console.log(`[POB] Q${currentIdx + 1} savedIds=[${[...savedIds]}] highlightSet=[${[...highlightSet]}] savedSelections.length=${savedSelections.length}`);
    for (const s of savedSelections) {
      console.log(`  saved: id=${(s as any).optionId} sel=${(s as any).selected} disp=${(s as any).displayIndex} text="${((s as any).text ?? '').substring(0, 30)}"`);
    }

    comp.optionBindings = options.map((opt: any, idx: number) => {
      const oIdNum = Number(opt.optionId);
      const effectiveId = (!isNaN(oIdNum) && oIdNum > -1) ? oIdNum : idx;

      if (opt.optionId == null) {
        opt.optionId = effectiveId;
      }

      opt.feedback = feedbackSentence;

      const isSelected = savedIds.has(effectiveId) || savedIds.has(String(effectiveId));

      // Honor saved selections for BOTH single and multi mode. The previous
      // behavior unconditionally wiped highlights in multi mode, so rehydrate
      // restored them but any subsequent processOptionBindings run would
      // clear them again. Only clear when there's no matching saved entry.
      // NOTE: Only trust highlightSet during LIVE interaction (hasUserClicked).
      // On refresh, highlightSet may contain stale IDs from a previous CD
      // cycle that briefly flash an incorrect option before rehydrate clears it.
      const useHighlightSet = comp.hasUserClicked && highlightSet.has(effectiveId);
      if (isSelected || useHighlightSet) {
        opt.highlight = true;
        console.log(`[POB] Q${currentIdx + 1} idx=${idx} effectiveId=${effectiveId} → highlight=TRUE (isSelected=${isSelected} inHighlightSet=${highlightSet.has(effectiveId)}) text="${(opt.text ?? '').substring(0, 30)}"`);
      } else {
        opt.highlight = false;
      }

      return getBindings(opt, idx, isSelected);
    });

    comp.rebuildShowFeedbackMapFromBindings();

    comp.updateSelections(-1);
    comp.updateHighlighting();

    // Re-apply persisted refresh state AFTER the id-based rebuild above.
    // `processOptionBindings` only knows how to light options whose
    // `optionId` appears in `savedIds`. That misses position-encoded
    // matches (displayIndex/text) needed on refresh, AND it does not
    // populate `disabledOptionsPerQuestion` for never-clicked wrongs.
    // Calling rehydrate after the rebuild guarantees the canonical
    // refresh state is the last write before detectChanges.
    comp.rehydrateUiFromState('processOptionBindings');

    comp.optionsReady = true;
    comp.renderReady = true;
    comp.viewReady = true;
    comp.cdRef.detectChanges();
  }

  hydrateOptionsFromSelectionState(comp: any): void {
    if (!Array.isArray(comp.optionsToDisplay) || comp.optionsToDisplay.length === 0) {
      return;
    }

    const currentIndex =
      comp.getActiveQuestionIndex() ??
      comp.currentQuestionIndex ??
      comp.questionIndex() ??
      0;

    const storedSelections =
      this.selectedOptionService.getSelectedOptionsForQuestion(currentIndex) ?? [];

    comp.optionsToDisplay = comp.optionsToDisplay.map((opt: any, i: number) => {
      const match = storedSelections.find(
        (s: any) =>
          Number(s.optionId) === Number(opt.optionId) &&
          Number(s.questionIndex) === Number(currentIndex)
      );

      return {
        ...opt,
        optionId:
          typeof opt.optionId === 'number' && Number.isFinite(opt.optionId)
            ? opt.optionId
            : (currentIndex + 1) * 100 + (i + 1),
        selected: !!match?.selected,
        highlight: !!match?.highlight,
        showIcon: !!match?.showIcon,
        active: opt.active ?? true,
        disabled: comp.computeDisabledState(opt, i)
      };
    });

    comp.cdRef.markForCheck();
  }

  rehydrateUiFromState(comp: any, reason: string): void {
    // Guard FIRST: if the user has already clicked or bindings are frozen,
    // do NOT touch visual state — the click handler owns it.  Moving this
    // above the clean-slate prevents a subscription-triggered rehydrate
    // from wiping showIcon/highlight that the click path just set.
    if (comp.hasUserClicked || comp.freezeOptionBindings) return;

    // Universal clean-slate: clear stale visual state on the freshly
    // built bindings so highlights/selected from a previous question
    // can never leak into a new one.
    if (comp.optionBindings?.length) {
      comp.optionBindings.forEach((b: any) => {
        b.isSelected = false;
        if (b.option) {
          b.option.selected = false;
          b.option.highlight = false;
          b.option.showIcon = false;
        }
      });
    }
    if (comp.optionsToDisplay?.length) {
      comp.optionsToDisplay.forEach((opt: any) => {
        opt.selected = false;
        opt.highlight = false;
        opt.showIcon = false;
      });
    }
    // Force a re-render of the cleared state
    comp.cdRef?.markForCheck?.();

    const qIndex = comp.resolveCurrentQuestionIndex();
    const saved = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];
    if (!saved.length) return;

    // Match saved entries to the LIVE bindings by optionId/text FIRST
    // (stable across refresh), falling back to the saved displayIndex only
    // when no id/text match is found. Using displayIndex as the primary
    // key breaks on shuffle or any binding-position change: the saved
    // entry for the user's wrong click lands on a DIFFERENT binding,
    // painting a never-clicked option red and leaving the clicked option
    // unhighlighted.
    const savedByIndex = new Map<number, any>();
    for (const s of saved) {
      // Strict question-context check: drop selections from a different question
      const sQIdx = (s as any).questionIndex ?? (s as any).qIdx ?? (s as any).questionIdx;
      if (sQIdx != null && Number(sQIdx) !== qIndex) continue;

      // Ignore unselect traces UNLESS they carry explicit showIcon/highlight
      // (those are previously-clicked wrong options saved by the correct-click
      // binding rebuild — they need to restore their red+X on refresh).
      if ((s as any)?.selected === false && !(s as any)?.showIcon && !(s as any)?.highlight) continue;

      const sId = (s as any).optionId;
      const sText = ((s as any).text ?? '').trim().toLowerCase();
      const sIdIsReal = sId != null && sId !== -1 && String(sId) !== '-1';

      let pos = -1;
      if (comp.optionBindings?.length) {
        pos = comp.optionBindings.findIndex((b: any) => {
          const bId = b?.option?.optionId;
          const bIdIsReal = bId != null && bId !== -1 && String(bId) !== '-1';
          if (sIdIsReal && bIdIsReal && String(sId) === String(bId)) return true;
          if (sText && (b?.option?.text ?? '').trim().toLowerCase() === sText) return true;
          return false;
        });
      }

      // Fallback to displayIndex only when id/text match fails
      if (pos === -1) {
        const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
        if (sIdx != null && Number.isFinite(Number(sIdx))) {
          pos = Number(sIdx);
        }
      }

      if (pos !== -1 && !savedByIndex.has(pos)) {
        savedByIndex.set(pos, s);
      }
    }
    // If nothing remains after filtering, freshly-generated bindings are
    // already clean — bail to avoid accidentally restamping stale highlights.
    if (savedByIndex.size === 0) return;

    // TEMP DIAGNOSTIC — remove after debugging
    console.log(`[rehydrate] Q${qIndex + 1} saved.length=${saved.length} savedByIndex.size=${savedByIndex.size}`);
    for (const [pos, s] of savedByIndex.entries()) {
      const bText = comp.optionBindings?.[pos]?.option?.text?.substring(0, 30) ?? '?';
      console.log(`  pos=${pos} sId=${(s as any).optionId} sSel=${(s as any).selected} sShowIcon=${(s as any).showIcon} sText="${((s as any).text ?? '').substring(0, 30)}" bText="${bText}"`);
    }

    // MULTI-ANSWER LOCK REHYDRATION
    // `disabledOptionsPerQuestion` is in-memory state that the click path
    // populates when the user picks a wrong option (locks that pick) and
    // again when all correct answers have been selected (locks every
    // remaining incorrect option). On refresh the map is empty, so
    // computeDisabledState returns false and the dark gray lock is lost.
    // Rebuild it here from the persisted selections + canonical question
    // before computeDisabledState runs for each binding below.
    try {
      const qForCorrect: any = comp.currentQuestion
        ?? comp.getQuestionAtDisplayIndex?.(qIndex);
      const isCorrectFlag = (o: any) =>
        o?.correct === true
        || String(o?.correct) === 'true'
        || o?.correct === 1
        || String(o?.correct) === '1';
      // Compute correct indices in the LIVE binding index space (not the
      // canonical question.options order) so they align with savedByIndex
      // keys. optionBindings may be shuffled relative to currentQuestion.
      // Fall back to canonical correct flags by optionId/text when the
      // binding's own option.correct is missing.
      const liveOpts: any[] = (comp.optionBindings ?? [])
        .map((b: any) => b?.option)
        .filter((o: any) => o != null);
      const canonicalOpts: any[] = qForCorrect?.options ?? [];
      const isBindingCorrect = (opt: any): boolean => {
        if (isCorrectFlag(opt)) return true;
        if (!canonicalOpts.length) return false;
        const byId = canonicalOpts.find((c: any) =>
          c?.optionId != null && opt?.optionId != null &&
          c.optionId !== -1 && opt.optionId !== -1 &&
          String(c.optionId) === String(opt.optionId)
        );
        if (byId && isCorrectFlag(byId)) return true;
        const oText = (opt?.text ?? '').trim().toLowerCase();
        if (oText) {
          const byText = canonicalOpts.find((c: any) =>
            (c?.text ?? '').trim().toLowerCase() === oText
          );
          if (byText && isCorrectFlag(byText)) return true;
        }
        return false;
      };
      const correctIdxs: number[] = liveOpts
        .map((o: any, i: number) => (isBindingCorrect(o) ? i : -1))
        .filter((n: number) => n >= 0);
      const correctOpts: any[] = liveOpts.length > 0 ? liveOpts : canonicalOpts;
      const isMulti = correctIdxs.length > 1
        || canonicalOpts.filter((o: any) => isCorrectFlag(o)).length > 1;
      const correctSet = new Set<number>(correctIdxs);
      if (isMulti && correctOpts.length > 0) {
        if (!comp.disabledOptionsPerQuestion.has(qIndex)) {
          comp.disabledOptionsPerQuestion.set(qIndex, new Set<number>());
        }
        const disabledSet: Set<number> = comp.disabledOptionsPerQuestion.get(qIndex)!;

        // Any saved incorrect pick is locked (mirrors the live click path).
        const selectedIdxs = new Set<number>();
        for (const idx of savedByIndex.keys()) {
          selectedIdxs.add(idx);
          if (!correctSet.has(idx)) {
            disabledSet.add(idx);
          }
        }

        // If every correct answer is in the persisted selections, the
        // question is fully resolved — lock all unselected incorrect
        // options as dark gray and mark the perfect-answer flag so other
        // paths (FET, scoring) stay consistent.
        const allCorrectSelected = correctIdxs.every((ci) => selectedIdxs.has(ci));
        if (allCorrectSelected) {
          for (let i = 0; i < correctOpts.length; i++) {
            if (!correctSet.has(i)) disabledSet.add(i);
          }
          try {
            const qs: any = this.quizService as any;
            if (!qs._multiAnswerPerfect) {
              qs._multiAnswerPerfect = new Map<number, boolean>();
            }
            qs._multiAnswerPerfect.set(qIndex, true);
          } catch { /* ignore */ }
        }
      }

      // SINGLE-ANSWER LOCK REHYDRATION
      // On refresh after the user picked the correct answer (possibly
      // after prior wrong clicks), every NEVER-CLICKED wrong option must
      // render as dark-gray-no-icon via computeDisabledState. Rebuild the
      // disabled set here. The clicked-wrong entry stays in savedByIndex
      // so the apply loop restores it as red-with-X (its selection trace).
      if (!isMulti && correctOpts.length > 0) {
        const hasCorrectPick = Array.from(savedByIndex.keys())
          .some((i) => correctSet.has(i));
        if (hasCorrectPick) {
          if (!comp.disabledOptionsPerQuestion.has(qIndex)) {
            comp.disabledOptionsPerQuestion.set(qIndex, new Set<number>());
          }
          const disabledSet: Set<number> = comp.disabledOptionsPerQuestion.get(qIndex)!;
          for (let i = 0; i < correctOpts.length; i++) {
            if (!correctSet.has(i)) disabledSet.add(i);
          }
        }
      }

      // DOT-CONFIRMED FALLBACK LOCK (works for BOTH single AND multi)
      // clickConfirmedDotStatus is persisted to sessionStorage as
      // dot_confirmed_<i> and restored on load. If the dot for this
      // question is 'correct', the user fully resolved it — lock every
      // non-correct binding as dark-gray-no-icon regardless of whether
      // the canonical/live correct-flag computation above produced a
      // usable correctSet. This is the reliable refresh signal that
      // survives shuffled/polluted option data.
      let dotStatus: 'correct' | 'wrong' | undefined;
      try {
        dotStatus = this.selectedOptionService.clickConfirmedDotStatus.get(qIndex);
        if (!dotStatus) {
          const stored = sessionStorage.getItem('dot_confirmed_' + qIndex);
          if (stored === 'correct' || stored === 'wrong') {
            dotStatus = stored;
          }
        }
      } catch { /* ignore */ }

      if (dotStatus === 'correct' && correctOpts.length > 0) {
        // For multi-answer, dot_confirmed='correct' is set per-click, not
        // per-question. A single correct click in multi-answer incorrectly
        // sets it. Only apply the full lock when ALL correct answers are
        // actually present in the saved selections.
        const allCorrectInSaved = isMulti
          ? correctIdxs.every((ci) => savedByIndex.has(ci))
          : true;

        if (allCorrectInSaved) {
          if (!comp.disabledOptionsPerQuestion.has(qIndex)) {
            comp.disabledOptionsPerQuestion.set(qIndex, new Set<number>());
          }
          const disabledSet: Set<number> = comp.disabledOptionsPerQuestion.get(qIndex)!;
          for (let i = 0; i < correctOpts.length; i++) {
            if (!correctSet.has(i)) {
              disabledSet.add(i);
            }
          }
          // Mark the multi question as "perfect" so computeDisabledState
          // for correct options returns the proper locked state.
          if (isMulti) {
            try {
              const qs: any = this.quizService as any;
              if (!qs._multiAnswerPerfect) {
                qs._multiAnswerPerfect = new Map<number, boolean>();
              }
              qs._multiAnswerPerfect.set(qIndex, true);
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }

    if (comp.optionBindings?.length) {
      comp.optionBindings.forEach((b: any, idx: number) => {
        let match = savedByIndex.get(idx);

        // Bidirectional verification: confirm the binding at this position
        // actually corresponds to the saved record. A displayIndex-fallback
        // match can land on the wrong binding when option order changed
        // between sessions (shuffle, data reload). If neither optionId nor
        // text agrees, discard the match so the binding stays clean.
        if (match && b?.option) {
          const mId = (match as any).optionId;
          const bId = b.option.optionId;
          const mIdReal = mId != null && mId !== -1 && String(mId) !== '-1';
          const bIdReal = bId != null && bId !== -1 && String(bId) !== '-1';
          const idsAgree = mIdReal && bIdReal && String(mId) === String(bId);
          const mText = ((match as any).text ?? '').trim().toLowerCase();
          const bText = (b.option.text ?? '').trim().toLowerCase();
          const textsAgree = mText && bText && mText === bText;
          if (!idsAgree && !textsAgree) {
            match = undefined;
          }
        }

        if (match) {
          b.isSelected = !!match.selected;
          b.option.selected = !!match.selected;

          // A "previously clicked wrong" entry has selected=false but
          // explicit highlight=true + showIcon=true. Trust the saved
          // record's flags directly for these entries so the red+X
          // restores on refresh without treating the option as the
          // active selection.
          const isPreviouslyClicked = !match.selected && !!match.showIcon;

          // On refresh, highlight all selected options unconditionally.
          // During live interaction, use history-based logic for multi-mode correct options.
          const isRefresh = this.selectedOptionService.hasRefreshBackup;
          if (isPreviouslyClicked) {
            b.option.highlight = true;
          } else if (isRefresh || !comp.isMultiMode || !comp.selectedOptionHistory?.length) {
            b.option.highlight = !!match.selected;
          } else {
            const isCorrect = comp.isCorrect(b.option);
            if (isCorrect) {
              let lastCorrectIdx: number | null = null;
              for (let j = comp.selectedOptionHistory.length - 1; j >= 0; j--) {
                const histId = comp.selectedOptionHistory[j];
                let hIdx = comp.optionBindings.findIndex((_: any, bIdx: number) => bIdx === histId || String(bIdx) === String(histId));
                if (hIdx === -1) {
                  hIdx = comp.optionBindings.findIndex((b2: any) => (b2.option?.optionId != null && b2.option.optionId !== -1 && b2.option.optionId == histId));
                }
                if (hIdx !== -1) {
                  const optAtH = comp.optionBindings[hIdx]?.option;
                  if (optAtH?.selected && comp.isCorrect(optAtH)) {
                    lastCorrectIdx = hIdx;
                    break;
                  }
                }
              }
              b.option.highlight = (lastCorrectIdx !== null && idx === lastCorrectIdx);
            } else {
              b.option.highlight = !!match.selected;
            }
          }
          // showIcon: trust the saved record's explicit flag for
          // previously-clicked entries. For normal entries, only show
          // when selected to prevent stale intermediate states.
          b.option.showIcon = isPreviouslyClicked
            ? !!match.showIcon
            : (!!match.selected && !!match.showIcon);
        } else {
          b.isSelected = false;
          b.option.selected = false;
          b.option.highlight = false;
          b.option.showIcon = false;
        }
        b.disabled = comp.computeDisabledState(b.option, idx);
        b.showFeedback = true;
      });
    }

    if (comp.optionsToDisplay?.length) {
      comp.optionsToDisplay.forEach((opt: any, idx: number) => {
        let match = savedByIndex.get(idx);
        // Same bidirectional verification as the optionBindings loop above.
        if (match && opt) {
          const mId = (match as any).optionId;
          const oId = opt.optionId;
          const mIdReal = mId != null && mId !== -1 && String(mId) !== '-1';
          const oIdReal = oId != null && oId !== -1 && String(oId) !== '-1';
          const idsAgree = mIdReal && oIdReal && String(mId) === String(oId);
          const mText = ((match as any).text ?? '').trim().toLowerCase();
          const oText = (opt.text ?? '').trim().toLowerCase();
          const textsAgree = mText && oText && mText === oText;
          if (!idsAgree && !textsAgree) {
            match = undefined;
          }
        }
        if (match) {
          opt.selected = !!match.selected;
          const isPreviouslyClicked = !match.selected && !!match.showIcon;
          const isRefresh = this.selectedOptionService.hasRefreshBackup;
          if (isPreviouslyClicked) {
            opt.highlight = true;
          } else if (isRefresh || !comp.isMultiMode || !comp.selectedOptionHistory?.length) {
            opt.highlight = !!match.selected;
          } else {
            const isCorrect = comp.isCorrect(opt);
            if (isCorrect) {
              let lastCorrectIdx: number | null = null;
              for (let j = comp.selectedOptionHistory.length - 1; j >= 0; j--) {
                const hIdx = Number(comp.selectedOptionHistory[j]);
                const optAtH = comp.optionsToDisplay[hIdx];
                if (optAtH?.selected && comp.isCorrect(optAtH)) {
                  lastCorrectIdx = hIdx;
                  break;
                }
              }
              opt.highlight = (lastCorrectIdx !== null && idx === lastCorrectIdx);
            } else {
              opt.highlight = !!match.selected;
            }
          }
          opt.showIcon = isPreviouslyClicked
            ? !!match.showIcon
            : (!!match.selected && !!match.showIcon);
        } else {
          opt.selected = false;
          opt.highlight = false;
          opt.showIcon = false;
        }
      });
    }

    if (saved.length > 0) {
      // Find the ACTIVE selection (selected: true) — this is the last
      // click the user made. The `saved` array is ordered by binding
      // position (not click order), so saved[saved.length - 1] is the
      // highest-index entry, NOT necessarily the last-clicked option.
      // For single-answer: only the current (correct) click has
      // selected: true; prior wrong clicks are saved with selected: false.
      const activeSelection = [...saved].reverse().find(
        (s: any) => s?.selected === true
      ) ?? saved[saved.length - 1];
      const activeIdx = (activeSelection as any).displayIndex
        ?? (activeSelection as any).index
        ?? (activeSelection as any).idx;
      if (activeIdx != null && Number.isFinite(Number(activeIdx))) {
        comp.lastFeedbackOptionId = Number(activeIdx);
        comp.showFeedback = true;
      }

      // Restore _feedbackDisplay so the feedback sentence reappears under
      // the last selected option on page refresh. shouldShowFeedbackAfter
      // in shared-option.component consults only _feedbackDisplay — the
      // bindings themselves are enough for highlights, but the inline
      // feedback block is gated on this field.
      if (!comp._feedbackDisplay) {
        // Use the ACTIVE selection (selected: true) to identify the
        // feedback target row. The saved array is ordered by binding
        // position, not by click order, so we cannot rely on array
        // order. The entry with selected: true is the authoritative
        // last-clicked option.
        let targetIdx = -1;
        if (Number.isFinite(Number(activeIdx))) {
          targetIdx = Number(activeIdx);
        } else {
          // No displayIndex on the active record — fall back to
          // highest key in savedByIndex (matched via optionId/text).
          for (const k of savedByIndex.keys()) {
            if (k > targetIdx) targetIdx = k;
          }
        }
        const targetBinding = targetIdx >= 0 ? comp.optionBindings?.[targetIdx] : null;
        if (targetBinding && comp.currentQuestion) {
          try {
            // IMPORTANT: pass ONLY the active selection to
            // buildFeedbackMessage — not the full saved history.
            // For single-answer, `saved` may contain the prior wrong
            // click plus the subsequent correct click. Passing both
            // causes buildFeedbackMessage to generate a wrong-answer
            // variant (e.g. "Not this one, try again!") even though
            // the LAST click was correct. The click path only feeds
            // the current click into the feedback builder, so mirror
            // that here.
            const lastSelectionOnly = [activeSelection] as any[];
            const feedbackText = this.feedbackService.buildFeedbackMessage(
              comp.currentQuestion,
              lastSelectionOnly,
              false,
              false,
              qIndex,
              comp.optionsToDisplay
            ) || '';
            let correctMessage = '';
            try {
              correctMessage = this.feedbackService.setCorrectMessage(
                (comp.optionsToDisplay ?? []).filter((o: any) => o && typeof o === 'object'),
                comp.currentQuestion
              );
            } catch { /* ignore */ }
            comp._feedbackDisplay = {
              idx: targetIdx,
              config: {
                feedback: feedbackText,
                showFeedback: true,
                correctMessage,
                selectedOption: targetBinding.option,
                options: comp.optionsToDisplay ?? [],
                question: comp.currentQuestion ?? null,
                idx: targetIdx
              } as FeedbackProps
            };
          } catch { /* ignore */ }
        }
      }
    }

    // Replace binding array with NEW object references so OnPush
    // option-item components detect the input change and re-render.
    comp.optionBindings = comp.optionBindings.map((b: any) => ({
      ...b,
      option: { ...b.option }
    }));

    comp.rebuildShowFeedbackMapFromBindings();
    comp.updateHighlighting();
    comp.cdRef.detectChanges();
  }

  buildSharedOptionConfig(comp: any, b: OptionBindings, i: number): SharedOptionConfig {
    const qIndex = comp.resolveCurrentQuestionIndex();
    const isMulti = comp.isMultiMode;

    // Use the binding's own isSelected flag rather than querying the
    // service. getSelectedOptionsForQuestion returns accumulated history
    // (correct + all prior wrong clicks) for single-answer mode, which
    // causes stale wrong-click entries to appear as "selected" — making
    // never-clicked wrong options highlight on refresh. The binding's
    // isSelected is set correctly by rehydrateUiFromState and by the
    // click handler, so it is the reliable source of truth.
    const isActuallySelected = b.isSelected;

    const optionKey = this.optionService.keyOf(b.option, i);
    const showCorrectOnTimeout = comp.timerExpiredForQuestion
      && (comp.timeoutCorrectOptionKeys?.has(optionKey) || !!b.option.correct);

    let shouldHighlight = isMulti
      ? (!!b.option.highlight || showCorrectOnTimeout)
      : (!!b.option.highlight || isActuallySelected || showCorrectOnTimeout);

    const isOnCorrectQuestion = comp.lastProcessedQuestionIndex === qIndex;
    const currentSelections = this.selectedOptionService.getSelectedOptionsForQuestion(qIndex) ?? [];

    const verifiedOption = {
      ...b.option,
      selected: isActuallySelected,
      highlight: shouldHighlight,
      showIcon: shouldHighlight
    };

    return {
      option: verifiedOption,
      idx: i,
      type: comp.resolveInteractionType(),
      isOptionSelected: isActuallySelected,
      isAnswerCorrect: b.isCorrect,
      highlightCorrectAfterIncorrect: comp.highlightCorrectAfterIncorrect(),
      shouldResetBackground:
        (comp.shouldResetBackground || (!isOnCorrectQuestion && currentSelections.length === 0))
        && !shouldHighlight,
      feedback: b.feedback ?? '',
      showFeedbackForOption: comp.showFeedbackForOption,
      optionsToDisplay: comp.optionsToDisplay,
      selectedOption: comp.selectedOption,
      currentQuestion: comp.currentQuestion,
      showFeedback: comp.showFeedback,
      correctMessage: comp.correctMessage,
      showCorrectMessage: !!comp.correctMessage,
      explanationText: '',
      showExplanation: false,
      selectedOptionIndex: comp.selectedOptionIndex,
      highlight: shouldHighlight
    };
  }

  getOptionBindings(comp: any, option: Option, idx: number, isSelected: boolean = false): OptionBindings {
    const correctOptionsCount =
      comp.optionsToDisplay?.filter((opt: any) => opt.correct).length ?? 0;
    const inferredType = correctOptionsCount > 1 ? 'multiple' : 'single';
    const selected = isSelected;

    return {
      option: {
        ...structuredClone(option),
        feedback: option.feedback ?? 'No feedback available',
      },
      index: idx,
      feedback: option.feedback ?? 'No feedback available',
      isCorrect: option.correct ?? false,
      showFeedback: comp.showFeedback,
      showFeedbackForOption: comp.showFeedbackForOption,
      highlightCorrectAfterIncorrect: comp.highlightCorrectAfterIncorrect(),
      highlightIncorrect: selected && !option.correct,
      highlightCorrect: selected && !!option.correct,
      allOptions: comp.optionsToDisplay,
      type: comp.resolveInteractionType(),
      appHighlightOption: false,
      appHighlightInputType: inferredType === 'multiple' ? 'checkbox' : 'radio',
      appHighlightReset: comp.shouldResetBackground,
      appResetBackground: comp.shouldResetBackground,
      optionsToDisplay: comp.optionsToDisplay,
      isSelected: selected,
      active: option.active ?? true,
      change: () => comp.handleOptionClick(option as SelectedOption, idx),
      disabled: comp.computeDisabledState(option, idx),
      ariaLabel: 'Option ' + (idx + 1),
      checked: selected
    };
  }

  getInlineFeedbackConfig(comp: any, b: OptionBindings, i: number): FeedbackProps | null {
    if (comp._feedbackDisplay?.idx === i && comp._feedbackDisplay.config?.showFeedback) {
      let config = comp._feedbackDisplay.config;

      const qIdx = comp.getActiveQuestionIndex();

      let correctIndicesArr: number[] = comp._correctIndicesByQuestion?.get(qIdx) ?? [];
      if (correctIndicesArr.length === 0) {
        const feedbackQ = comp.currentQuestion ?? comp.getQuestionAtDisplayIndex(qIdx);
        const result = this.clickHandler.resolveCorrectIndices(
          feedbackQ, qIdx, comp.isMultiMode, comp.type
        );
        correctIndicesArr = result.correctIndices;
      }

      const effectiveMultiMode = comp.isMultiMode || comp.type === 'multiple' || correctIndicesArr.length > 1;
      const durableSelected = comp._multiSelectByQuestion?.get(qIdx);

      if (effectiveMultiMode && durableSelected && durableSelected.size > 0 && correctIndicesArr.length > 0) {
        const clickState = this.clickHandler.computeMultiAnswerClickState(
          i, durableSelected, correctIndicesArr
        );
        const newFeedback = this.clickHandler.generateMultiAnswerFeedbackText(clickState);

        if (newFeedback !== config.feedback) {
          config = { ...config, feedback: newFeedback };
        }
      }

      return config;
    }
    return null;
  }

  fullyResetRows(comp: any): void {
    for (let i = 0; i < (comp.optionBindings?.length ?? 0); i++) {
      const b = comp.optionBindings[i];
      b.isSelected = false;
      b.option.selected = false;
      b.option.highlight = false;
      b.option.showIcon = false;
      b.disabled = false;

      const id = b.option.optionId;
      const effectiveId = (id != null && id !== -1) ? id : i;
      b.showFeedbackForOption[effectiveId as any] = false;
    }

    comp.lockedIncorrectOptionIds?.clear();
  }

  syncSelectedFlags(comp: any): void {
    for (let i = 0; i < (comp.optionBindings?.length ?? 0); i++) {
      const b = comp.optionBindings[i];
      const id = b.option.optionId;
      const numericId = (id != null && id !== -1) ? Number(id) : i;

      let chosen = comp.selectedOptionMap.has(i) ||
        (Number.isFinite(numericId) && comp.selectedOptionMap.has(numericId));

      if (!chosen) {
        chosen = comp.selectedOptionHistory.some((h: any) => Number(h) === numericId || Number(h) === i);
      }

      b.option.selected = chosen;
      b.isSelected = chosen;
    }
  }

  forceDisableAllOptions(comp: any): void {
    comp.forceDisableAll = true;
    for (const binding of comp.optionBindings ?? []) {
      if (binding.option) {
        binding.option.active = false;
      }
    }
    comp.clickService?.updateBindingSnapshots(comp);
    for (const opt of comp.optionsToDisplay ?? []) {
      if (opt) {
        opt.active = false;
      }
    }
    comp.cdRef.markForCheck();
  }

  clearForceDisableAllOptions(comp: any): void {
    comp.forceDisableAll = false;
    for (const binding of comp.optionBindings ?? []) {
      if (binding.option) {
        binding.option.active = true;
      }
    }

    for (const opt of comp.optionsToDisplay ?? []) {
      if (opt) opt.active = true;
    }

    try {
      const qIndex = comp.currentQuestionIndex;
      this.selectedOptionService.unlockQuestion(qIndex);
    } catch { }

    comp.clickService?.updateBindingSnapshots(comp);
  }

  markRenderReady(comp: any, reason: string = ''): void {
    const bindingsReady =
      Array.isArray(comp.optionBindings) && comp.optionBindings.length > 0;

    const optionsReady =
      Array.isArray(comp.optionsToDisplay) && comp.optionsToDisplay.length > 0;

    if (bindingsReady && optionsReady) {
      comp.ngZone.run(() => {
        if (reason) {
          console.log('[renderReady]: ' + reason);
        }

        comp.renderReady = true;
        comp.renderReadyChange.emit(true);
        comp.renderReadySubject?.next(true);
      });
    } else {
      console.warn('[markRenderReady skipped] Incomplete state:', {
        bindingsReady,
        optionsReady,
        reason
      });
    }
  }
}
