import { Injectable } from '@angular/core';

import { QuizService } from '../../data/quiz.service';
import { QuizStateService } from '../../state/quizstate.service';
import { SelectedOptionService } from '../../state/selectedoption.service';
import { FeedbackService } from '../../features/feedback/feedback.service';
import { SelectionMessageService } from '../../features/selection-message/selection-message.service';
import { TimerService } from '../../features/timer/timer.service';
import { ExplanationTextService } from '../../features/explanation/explanation-text.service';
import { OptionInteractionService, OptionInteractionState } from './option-interaction.service';
import { OptionClickHandlerService } from './option-click-handler.service';
import { OptionUiSyncService } from './option-ui-sync.service';
import { OptionSelectionPolicyService } from '../policy/option-selection-policy.service';
import { OptionService } from '../view/option.service';
import { OptionLockService } from '../policy/option-lock.service';
import { NextButtonStateService } from '../../state/next-button-state.service';
import { SharedOptionExplanationService } from '../../features/shared-option/shared-option-explanation.service';

import { Option } from '../../../models/Option.model';
import { OptionBindings } from '../../../models/OptionBindings.model';
import { FeedbackProps } from '../../../models/FeedbackProps.model';
import { SelectedOption } from '../../../models/SelectedOption.model';
import { QuestionType } from '../../../models/question-type.enum';

@Injectable({ providedIn: 'root' })
export class SharedOptionClickService {
  constructor(
    private quizService: QuizService,
    private quizStateService: QuizStateService,
    private selectedOptionService: SelectedOptionService,
    private feedbackService: FeedbackService,
    private selectionMessageService: SelectionMessageService,
    private timerService: TimerService,
    private explanationTextService: ExplanationTextService,
    private optionInteractionService: OptionInteractionService,
    private optionUiSyncService: OptionUiSyncService,
    private optionSelectionPolicyService: OptionSelectionPolicyService,
    private optionService: OptionService,
    private optionLockService: OptionLockService,
    private clickHandler: OptionClickHandlerService,
    private nextButtonStateService: NextButtonStateService,
    private sharedOptionExplanationService: SharedOptionExplanationService
  ) {}

  onOptionUI(comp: any, ev: any): void {
    if (ev == null || ev.optionId == null) return;

    const index = ev.displayIndex ?? comp.findBindingByOptionId(ev.optionId)?.i;
    if (index === undefined || index < 0) return;
    const binding = comp.optionBindings[index];
    if (!binding) return;

    // Always play sound when an option event fires — the event itself
    // proves the user interacted with the option. The previous isDisabled
    // gate blocked sound for options that were still clickable via
    // mat-radio (change) events, causing silent incorrect clicks.
    comp.cdRef.markForCheck();
    let pristineCorrect = binding.option?.correct === true;
    try {
      const nrm = (t: any) => String(t ?? '').trim().toLowerCase();
      const optText = nrm(binding.option?.text);
      const qIdx = comp.getActiveQuestionIndex?.() ?? comp.currentQuestionIndex ?? 0;
      const bundle: any[] = (this.quizService as any)?.quizInitialState ?? [];
      const quizId = this.quizService?.quizId;
      if (optText && bundle.length > 0 && quizId) {
        // Use question TEXT matching to handle shuffled mode correctly.
        // pristineQuiz.questions[qIdx] uses display index which maps to
        // the wrong question when shuffle is active.
        const qText = nrm(comp.currentQuestion?.questionText);
        let matched = false;
        if (qText) {
          for (const quiz of bundle) {
            for (const pq of (quiz?.questions ?? [])) {
              if (nrm(pq?.questionText) !== qText) continue;
              const matchedOpt = (pq?.options ?? []).find((o: any) => nrm(o?.text) === optText);
              if (matchedOpt !== undefined) {
                pristineCorrect = matchedOpt?.correct === true || String(matchedOpt?.correct) === 'true';
                matched = true;
              }
              break;
            }
            if (matched) break;
          }
        }
        // Fallback: index-based lookup (works for unshuffled mode)
        if (!matched) {
          const pristineQuiz = bundle.find((qz: any) => qz?.quizId === quizId);
          const pristineQ = pristineQuiz?.questions?.[qIdx];
          if (pristineQ) {
            const matchedOpt = (pristineQ.options ?? []).find((o: any) => nrm(o?.text) === optText);
            if (matchedOpt !== undefined) {
              pristineCorrect = matchedOpt?.correct === true || String(matchedOpt?.correct) === 'true';
            }
          }
        }
      }
    } catch { }
    comp.soundService.playOnceForOption({
      ...binding.option,
      correct: pristineCorrect,
      selected: true,
      questionIndex: comp.currentQuestionIndex
    });

    const now = Date.now();
    const isRapidDuplicate = comp._lastHandledIndex === index &&
      comp._lastHandledTime &&
      (now - comp._lastHandledTime < 100);

    if (ev.kind === 'change') {
      const native = ev.nativeEvent;

      if (isRapidDuplicate) {
        console.log(`[SOC.onOptionUI] ⏭️ Skipping 'change' for Q${comp.getActiveQuestionIndex() + 1} option ${index} (Already handled)`);
        return;
      }

      comp._lastHandledIndex = index;
      comp._lastHandledTime = now;
      console.log(`[SOC.onOptionUI] 🟢 Processing 'change' for Q${comp.getActiveQuestionIndex() + 1} option ${index}`);

      this.quizStateService.markUserInteracted(comp.getActiveQuestionIndex());

      this.runOptionContentClick(comp, binding, index, native as any);
      return;
    }

    if (ev.kind === 'interaction' || ev.kind === 'contentClick') {
      const event = ev.nativeEvent as MouseEvent;

      if (comp.isDisabled(binding, index)) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      const target = event?.target as HTMLElement;
      const isInsideMaterialControl =
        target?.tagName === 'INPUT' ||
        target?.closest('.mat-mdc-radio-button') ||
        target?.closest('.mat-mdc-checkbox');

      if (isInsideMaterialControl) {
        // If the option is disabled but is a correct single-answer option,
        // process it here — mat-radio won't fire 'change' when disabled.
        const isCorrectOpt = binding?.option?.correct === true || String(binding?.option?.correct) === 'true';
        const isSingleMode = comp.type === 'single' && !comp.isMultiMode;
        if (!(isSingleMode && isCorrectOpt && binding.disabled)) {
          console.log(`[SOC.onOptionUI] ⏭️ Skipping '${ev.kind}' on input for Q${comp.getActiveQuestionIndex() + 1} option ${index} (Delegating to 'change')`);
          return;
        }
        // Fall through to process the click directly for disabled correct options
      }

      if (isRapidDuplicate) {
        console.log(`[SOC.onOptionUI] ⏭️ Skipping '${ev.kind}' for Q${comp.getActiveQuestionIndex() + 1} option ${index} (Rapid duplicate)`);
        return;
      }

      if (comp.type === 'single' && !comp.isMultiMode && binding.option.selected && comp.showFeedback) {
        console.log(`[SOC.onOptionUI] ⏭️ Skipping '${ev.kind}' for ALREADY selected single option ${index}`);
        return;
      }

      comp._lastHandledIndex = index;
      comp._lastHandledTime = now;
      console.log(`[SOC.onOptionUI] 🟢 Processing '${ev.kind}' for Q${comp.getActiveQuestionIndex() + 1} option ${index}`);

      if (comp.type === 'single') {
        if (comp.form.get('selectedOptionId')?.value !== index) {
          comp.form.get('selectedOptionId')?.setValue(index, { emitEvent: false });
        }
      } else {
        const ctrl = comp.form.get(String(index));
        if (ctrl) {
          ctrl.setValue(!binding.option.selected, { emitEvent: false });
        }
      }

      this.runOptionContentClick(comp, binding, index, event);
      return;
    }
  }

  runOptionContentClick(comp: any, binding: any, index: number, event: any): void {
    console.error('🟣 SOC.runOptionContentClick ENTERED idx=' + index + ' optionIds=' + (comp.optionBindings||[]).map((b:any,i:number)=>i+':'+b?.option?.optionId).join(','));
    // DIAGNOSTIC: show what question text sources resolve to
    try {
      const _qIdx = comp.getActiveQuestionIndex();
      const _dispQ = (this.quizService as any)?.getQuestionsInDisplayOrder?.();
      const _shufQ = (this.quizService as any)?.shuffledQuestions;
      const _origQ = (this.quizService as any)?.questions;
      console.log(`[SOC] QUESTION SOURCES Q${_qIdx + 1}: comp.currentQuestion="${(comp.currentQuestion?.questionText || '').slice(0, 50)}" displayOrder="${(_dispQ?.[_qIdx]?.questionText || '').slice(0, 50)}" shuffled="${(_shufQ?.[_qIdx]?.questionText || '').slice(0, 50)}" original="${(_origQ?.[_qIdx]?.questionText || '').slice(0, 50)}" isShuffleEnabled=${(this.quizService as any)?.isShuffleEnabled?.()}`);
    } catch {}

    const now = Date.now();
    if (comp._lastRunClickIndex === index && comp._lastRunClickTime && (now - comp._lastRunClickTime) < 200) {
      console.log(`[SOC.runOptionContentClick] Skipping rapid duplicate for index=${index}`);
      return;
    }
    comp._lastRunClickIndex = index;
    comp._lastRunClickTime = now;

    this.quizStateService.markUserInteracted(comp.getActiveQuestionIndex());

    const baseCtx = comp.buildOptionUiSyncContext();
    const state: any = {
      ...baseCtx,
      disabledOptionsPerQuestion: comp.disabledOptionsPerQuestion,
      correctClicksPerQuestion: comp.correctClicksPerQuestion,
      freezeOptionBindings: comp.freezeOptionBindings,
      disableRenderTrigger: comp.disableRenderTrigger,
      currentQuestion: comp.currentQuestion,
      currentQuestionIndex: baseCtx.getActiveQuestionIndex(),
      showExplanationChange: comp.showExplanationChange,
      explanationToDisplayChange: comp.explanationToDisplayChange
    };

    comp.freezeOptionBindings = true;
    state.freezeOptionBindings = true;

    // In shuffled mode, OIS/OUS must NOT emit FET — their correctness
    // checks use stale data. Only the SOC's pristine-based logic (below)
    // is authoritative. Pass a no-op emitExplanation to suppress.
    const _isShuffledForFET = (this.quizService as any)?.isShuffleEnabled?.()
      && Array.isArray((this.quizService as any)?.shuffledQuestions)
      && (this.quizService as any)?.shuffledQuestions?.length > 0;
    const emitExplanationFn = _isShuffledForFET
      ? (_idx: number, _skip?: boolean) => { /* no-op in shuffled mode */ }
      : (idx: number, skipGuard?: boolean) => comp.emitExplanation(idx, skipGuard);

    try {
      this.optionInteractionService.handleOptionClick(
        binding,
        index,
        event,
        state,
        (idx: number) => comp.getQuestionAtDisplayIndex(idx),
        emitExplanationFn,
        (b: any, i: number, ev: any, existingCtx: any) => {
          this.updateOptionAndUI(comp, b, i, ev, existingCtx || state);
          state.showFeedback = comp.showFeedback;
          state.showFeedbackForOption = comp.showFeedbackForOption;
          state.feedbackConfigs = comp.feedbackConfigs;
          state.lastFeedbackOptionId = comp.lastFeedbackOptionId;
          state.disableRenderTrigger = comp.disableRenderTrigger;
        }
      );
    } finally {
      comp.freezeOptionBindings = false;
      state.freezeOptionBindings = false;
    }

    comp.disableRenderTrigger = state.disableRenderTrigger;
    comp.lastClickedOptionId = state.lastClickedOptionId;
    comp.lastClickTimestamp = state.lastClickTimestamp;
    comp.hasUserClicked = state.hasUserClicked;
    comp.freezeOptionBindings = state.freezeOptionBindings;
    comp.showFeedback = state.showFeedback;
    comp.showFeedbackForOption = state.showFeedbackForOption;
    comp.feedbackConfigs = state.feedbackConfigs;
    comp.lastFeedbackOptionId = state.lastFeedbackOptionId;

    for (const b of state.optionBindings) {
      if (b) {
        b.showFeedbackForOption = { ...comp.showFeedbackForOption };
      }
    }
    comp.optionBindings = state.optionBindings;

    const qIdx = comp.getActiveQuestionIndex();
    if (!comp._multiSelectByQuestion.has(qIdx)) {
      comp._multiSelectByQuestion.set(qIdx, new Set<number>());
    }
    const durableSet = comp._multiSelectByQuestion.get(qIdx)!;
    durableSet.add(index);
    console.log(`[SOC] DURABLE tracker Q${qIdx + 1}: clicked=${index}, all selected=[${[...durableSet]}]`);

    // Enable Next button on ANY option selection (correct or incorrect).
    // Use forceEnable so the reactive stream cannot override for 2 seconds,
    // giving setAnswered time to propagate through the stream as well.
    this.nextButtonStateService.forceEnable(2000);
    this.selectedOptionService.setAnswered(true, true);

    if (!comp._correctIndicesByQuestion.has(qIdx)) {
      const question = comp.currentQuestion ?? comp.getQuestionAtDisplayIndex(qIdx);
      const result = this.clickHandler.resolveCorrectIndices(
        question, qIdx, comp.isMultiMode, comp.type
      );
      comp._correctIndicesByQuestion.set(qIdx, result.correctIndices);
    }
    const correctIndicesFromQ = comp._correctIndicesByQuestion.get(qIdx)!;
    const correctCountFromQ = correctIndicesFromQ.length;

    // ALWAYS resolve correct indices from pristine quizInitialState.
    // This is the single source of truth — mutated flags are unreliable.
    let effectiveCorrectIndices = correctIndicesFromQ;
    const isShuffled = (this.quizService as any)?.isShuffleEnabled?.()
      && Array.isArray((this.quizService as any)?.shuffledQuestions)
      && (this.quizService as any)?.shuffledQuestions?.length > 0;

    let pristineCorrectCount = correctCountFromQ;
    try {
      const nrmP = (t: any) => String(t ?? '').trim().toLowerCase();
      // IMPORTANT: In shuffled mode, comp.currentQuestion points to the
      // WRONG question (original order). Use ONLY display-order sources.
      let qTextCandidates: string[];
      if (isShuffled) {
        qTextCandidates = [
          nrmP((this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[qIdx]?.questionText),
          nrmP((this.quizService as any)?.shuffledQuestions?.[qIdx]?.questionText),
          nrmP(comp.getQuestionAtDisplayIndex?.(qIdx)?.questionText)
        ].filter((t: string) => !!t);
      } else {
        qTextCandidates = [
          nrmP(comp.currentQuestion?.questionText),
          nrmP((this.quizService as any)?.questions?.[qIdx]?.questionText),
          nrmP(comp.getQuestionAtDisplayIndex?.(qIdx)?.questionText)
        ].filter((t: string) => !!t);
      }
      const bundleP: any[] = (this.quizService as any)?.quizInitialState ?? [];

      console.log(`[SOC] PRISTINE REBUILD Q${qIdx + 1}: bundleLen=${bundleP.length}, qTextCandidates count=${qTextCandidates.length}`);
      if (qTextCandidates.length > 0) {
        console.log(`[SOC] PRISTINE REBUILD Q${qIdx + 1}: qText[0]="${qTextCandidates[0]?.slice(0, 60)}"`);
      }
      if (bundleP.length === 0) {
        console.warn(`[SOC] PRISTINE REBUILD Q${qIdx + 1}: quizInitialState is EMPTY!`);
      }

      let matched = false;
      for (const qText of qTextCandidates) {
        for (const quiz of bundleP) {
          const quizQuestions = quiz?.questions ?? [];
          for (const pq of quizQuestions) {
            const pqText = nrmP(pq?.questionText);
            if (pqText !== qText) continue;
            matched = true;
            const pristineOpts = pq?.options ?? [];
            const pristineCorrectTexts = new Set<string>(
              pristineOpts
                .filter((o: any) => o?.correct === true || String(o?.correct) === 'true')
                .map((o: any) => nrmP(o?.text))
            );
            pristineCorrectCount = pristineCorrectTexts.size;
            const rebuilt: number[] = [];
            const bindings: any[] = Array.isArray(comp.optionBindings) ? comp.optionBindings : [];
            const bindingTexts: string[] = [];
            for (let i = 0; i < bindings.length; i++) {
              const bt = nrmP(bindings[i]?.option?.text);
              bindingTexts.push(bt);
              if (pristineCorrectTexts.has(bt)) {
                rebuilt.push(i);
              }
            }
            console.log(`[SOC] PRISTINE REBUILD Q${qIdx + 1}: MATCHED question. pristineCorrectTexts=${JSON.stringify([...pristineCorrectTexts].map(t => t.slice(0, 40)))}, bindingTexts=${JSON.stringify(bindingTexts.map(t => t.slice(0, 40)))}, rebuilt=[${rebuilt}]`);
            if (rebuilt.length > 0) {
              effectiveCorrectIndices = rebuilt;
              comp._correctIndicesByQuestion.set(qIdx, rebuilt);
            }
            break;
          }
          if (matched) break;
        }
        if (matched) break;
      }
      if (!matched) {
        console.warn(`[SOC] PRISTINE REBUILD Q${qIdx + 1}: NO QUESTION MATCHED in quizInitialState!`);
        // Log first few pristine question texts for comparison
        for (const quiz of bundleP) {
          const pqTexts = (quiz?.questions ?? []).map((pq: any) => nrmP(pq?.questionText)?.slice(0, 50));
          console.log(`[SOC] PRISTINE available questions: ${JSON.stringify(pqTexts)}`);
        }
      }
    } catch (err) {
      console.error(`[SOC] PRISTINE REBUILD error:`, err);
    }
    const effectiveCorrectCount = effectiveCorrectIndices.length;
    const isMultiFromQ = comp.isMultiMode || comp.type === 'multiple' || effectiveCorrectCount > 1 || pristineCorrectCount > 1;

    console.log(`[SOC.runOptionContentClick] DEBUG: Q${qIdx + 1} index=${index} isMultiFromQ=${isMultiFromQ} correctIndicesFromQ=[${effectiveCorrectIndices}] pristineCorrectCount=${pristineCorrectCount}`);

    // Universal "all correct selected" timer stop. Resolves the canonical
    // correct indices and checks whether the durable selection set now
    // contains every correct index. Works for both single- and multi-answer.
    try {
      let allCorrectIdxs: number[] = [];
      const allQs: any[] = (this.quizService as any)?.questions ?? [];
      const passedText = (comp.currentQuestion?.questionText || '').trim().toLowerCase();
      let canonicalQ: any = null;
      if (passedText && allQs.length) {
        const cIdx = allQs.findIndex((q: any) => (q?.questionText || '').trim().toLowerCase() === passedText);
        if (cIdx >= 0) canonicalQ = allQs[cIdx];
      }
      if (!canonicalQ) canonicalQ = allQs[qIdx] ?? comp.currentQuestion;
      const rawOpts = canonicalQ?.options ?? [];
      allCorrectIdxs = rawOpts
        .map((o: any, i: number) => {
          const c = o?.correct ?? o?.isCorrect;
          return (c === true || c === 'true' || c === 1 || c === '1') ? i : -1;
        })
        .filter((n: number) => n >= 0);
      if (allCorrectIdxs.length === 0 && effectiveCorrectIndices?.length) {
        allCorrectIdxs = effectiveCorrectIndices;
      }
      if (allCorrectIdxs.length > 0) {
        const allSelected = allCorrectIdxs.every(ci => durableSet.has(ci));
        if (allSelected) {
          this.timerService.stopTimer?.(undefined, { force: true, bypassAntiThrash: true });
        }
      }
    } catch {}

    if (isMultiFromQ && effectiveCorrectCount > 0) {
      const clickState = this.clickHandler.computeMultiAnswerClickState(
        index, durableSet, effectiveCorrectIndices
      );

      console.log(`[SOC] MULTI-ANSWER STATE Q${qIdx + 1}: correctSel=${clickState.correctSelected}, incorrectSel=${clickState.incorrectSelected}, remaining=${clickState.remaining}, durableSet=[${[...durableSet]}]`);

      if (!comp.disabledOptionsPerQuestion.has(qIdx)) {
        comp.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
      }
      const disabledSetRef = comp.disabledOptionsPerQuestion.get(qIdx)!;
      this.clickHandler.updateDisabledSet(
        disabledSetRef, index, clickState.isClickedCorrect,
        clickState.remaining, comp.optionBindings.length, effectiveCorrectIndices
      );

      // Set _multiAnswerPerfect BEFORE applying bindings so that
      // isDisabled() sees it when Angular re-renders the option items.
      if (clickState.remaining === 0) {
        if (!(this.quizService as any)._multiAnswerPerfect) {
          (this.quizService as any)._multiAnswerPerfect = new Map<number, boolean>();
        }
        (this.quizService as any)._multiAnswerPerfect.set(qIdx, true);
      }

      const bindingUpdates = this.clickHandler.computeMultiAnswerBindingUpdates(
        comp.optionBindings.length, durableSet, effectiveCorrectIndices, disabledSetRef
      );
      comp.optionBindings = comp.optionBindings.map((ob: any, bi: number) => ({
        ...ob,
        isSelected: bindingUpdates[bi].isSelected,
        isCorrect: bindingUpdates[bi].isCorrect,
        disabled: bindingUpdates[bi].disabled,
        option: ob.option ? {
          ...ob.option,
          ...bindingUpdates[bi].optionOverrides
        } : ob.option
      }));

      const feedbackText = this.clickHandler.generateMultiAnswerFeedbackText(clickState);

      const correctMessage = this.feedbackService.setCorrectMessage(
        (comp.optionsToDisplay ?? []).filter((o: any) => o && typeof o === 'object'),
        comp.currentQuestion!
      );
      comp._feedbackDisplay = {
        idx: index,
        config: {
          feedback: feedbackText,
          showFeedback: true,
          correctMessage,
          selectedOption: binding.option,
          options: comp.optionsToDisplay ?? [],
          question: comp.currentQuestion ?? null,
          idx: index
        } as FeedbackProps
      };
      console.log(`[SOC] FORCED _feedbackDisplay: idx=${index} text="${feedbackText}"`);

      const optsForMsg: Option[] = comp.optionBindings.map((ob: any, bi: number) => ({
        ...ob.option,
        correct: new Set(effectiveCorrectIndices).has(bi),
        selected: durableSet.has(bi),
      })) as Option[];
      const selMsg = this.selectionMessageService.computeFinalMessage({
        index: qIdx,
        total: this.quizService?.totalQuestions ?? 0,
        qType: QuestionType.MultipleAnswer,
        opts: optsForMsg
      });
      this.selectionMessageService.pushMessage(selMsg, qIdx);
      queueMicrotask(() => this.selectionMessageService.pushMessage(selMsg, qIdx));
      setTimeout(() => this.selectionMessageService.pushMessage(selMsg, qIdx), 0);

      // CHECK: all correct options selected? Uses effectiveCorrectIndices
      // (already rebuilt from pristine quizInitialState when needed).
      const allCorrectInDurable = effectiveCorrectIndices.length > 0 &&
        effectiveCorrectIndices.every((ci: number) => durableSet.has(ci));
      console.log(`[SOC] MULTI gate Q${qIdx + 1}: effectiveCorrect=[${effectiveCorrectIndices}] durableSet=[${[...durableSet]}] allCorrectInDurable=${allCorrectInDurable} remaining=${clickState.remaining}`);

      if (allCorrectInDurable) {
        try { this.timerService.stopTimer?.(undefined, { force: true, bypassAntiThrash: true }); } catch {}
        this.nextButtonStateService.setNextButtonState(true);

        // Set FET bypass BEFORE scoring so all downstream gates are open
        this.explanationTextService.fetBypassForQuestion.set(qIdx, true);

        this.quizService.scoreDirectly(qIdx, true, true);
        console.log(`[SOC] Scored multi-answer Q${qIdx + 1} as correct (incorrectSel=${clickState.incorrectSelected})`);

        if (!(this.quizService as any)._multiAnswerPerfect) {
          (this.quizService as any)._multiAnswerPerfect = new Map<number, boolean>();
        }
        (this.quizService as any)._multiAnswerPerfect.set(qIdx, true);

        (this.explanationTextService as any)._fetLocked = false;
        this.explanationTextService.unlockExplanation();

        comp.showExplanationChange.emit(true);

        // Resolve explanation text from pristine data and write directly
        // via explanationTextService — bypasses all intermediary paths.
        let fetText = '';
        try {
          const nrmFET = (t: any) => String(t ?? '').trim().toLowerCase();
          const fetQText = isShuffled
            ? (nrmFET((this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[qIdx]?.questionText)
              || nrmFET((this.quizService as any)?.shuffledQuestions?.[qIdx]?.questionText))
            : (nrmFET(comp.currentQuestion?.questionText)
              || nrmFET((this.quizService as any)?.questions?.[qIdx]?.questionText));
          const bundleFET: any[] = (this.quizService as any)?.quizInitialState ?? [];
          for (const quiz of bundleFET) {
            for (const pq of (quiz?.questions ?? [])) {
              if (nrmFET(pq?.questionText) !== fetQText) continue;
              fetText = (pq?.explanation ?? '').trim();
              break;
            }
            if (fetText) break;
          }
          // Also try live question objects
          if (!fetText) {
            const liveQ = comp.currentQuestion
              ?? comp.getQuestionAtDisplayIndex?.(qIdx)
              ?? (this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[qIdx];
            fetText = (liveQ?.explanation ?? '').trim();
          }
        } catch { /* ignore */ }

        console.log(`[SOC] MULTI FET Q${qIdx + 1}: resolved explanation="${(fetText || '').slice(0, 60)}"`);

        if (fetText) {
          // Format the explanation with correct option names
          let formattedFET = fetText;
          try {
            const correctNames: string[] = [];
            for (const ci of effectiveCorrectIndices) {
              const name = comp.optionBindings?.[ci]?.option?.text;
              if (name) correctNames.push(name.trim());
            }
            if (correctNames.length > 0) {
              const nameStr = correctNames.length === 1
                ? correctNames[0]
                : correctNames.slice(0, -1).join(', ') + ' and ' + correctNames[correctNames.length - 1];
              formattedFET = `${nameStr} are correct because ${fetText}`;
            }
          } catch { /* ignore */ }

          // Write directly via explanationTextService
          this.explanationTextService._activeIndex = qIdx;
          (this.explanationTextService as any).latestExplanation = formattedFET;
          (this.explanationTextService as any).latestExplanationIndex = qIdx;
          this.explanationTextService.setExplanationText(formattedFET, {
            force: true,
            context: `question:${qIdx}`,
            index: qIdx
          });
          this.explanationTextService.emitFormatted(qIdx, formattedFET);
          this.explanationTextService.setShouldDisplayExplanation(true, {
            context: `question:${qIdx}`,
            force: true
          } as any);
          this.explanationTextService.setIsExplanationTextDisplayed(true, {
            context: `question:${qIdx}`,
            force: true
          } as any);
          this.explanationTextService.lockExplanation();
          this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
          console.log(`[SOC] MULTI FET WRITTEN for Q${qIdx + 1}: "${formattedFET.slice(0, 60)}..."`);
        }

        // Also try the component path as backup
        setTimeout(() => {
          try {
            comp.emitExplanation(qIdx, true);
          } catch { /* ignore */ }
        }, 50);
      } else if (!allCorrectInDurable) {
        console.log(`[SOC] FET not fired Q${qIdx + 1} — not all correct selected yet`);
      }

      const savedFeedback = comp._feedbackDisplay;
      queueMicrotask(() => {
        comp._feedbackDisplay = savedFeedback;
        comp.cdRef.detectChanges();
      });

      comp.showFeedback = true;
      comp.cdRef.detectChanges();
      return;
    }

    // SINGLE-ANSWER: disable incorrect options only when the correct one is clicked
    if (!isMultiFromQ) {
      // CANONICAL resolution: match comp.currentQuestion text against
      // quizService.questions[] to get authoritative correct flags. This
      // avoids stale/empty cache from clickHandler.resolveCorrectIndices.
      let correctIdxs: number[] = [];
      try {
        const allQs: any[] = (this.quizService as any)?.questions ?? [];
        const passedText = (comp.currentQuestion?.questionText || '').trim().toLowerCase();
        let canonicalQ: any = null;
        if (passedText && allQs.length) {
          const idx = allQs.findIndex((q: any) => (q?.questionText || '').trim().toLowerCase() === passedText);
          if (idx >= 0) canonicalQ = allQs[idx];
        }
        if (!canonicalQ) canonicalQ = allQs[qIdx] ?? comp.currentQuestion;
        const rawOpts = canonicalQ?.options ?? [];
        correctIdxs = rawOpts
          .map((o: any, i: number) => {
            const c = o?.correct ?? o?.isCorrect;
            return (c === true || c === 'true' || c === 1 || c === '1') ? i : -1;
          })
          .filter((n: number) => n >= 0);
      } catch {}
      if (correctIdxs.length === 0 && effectiveCorrectIndices?.length) {
        correctIdxs = effectiveCorrectIndices;
      }
      const correctSet = new Set(correctIdxs);
      const isClickedCorrect = correctSet.has(index);
      console.log(`[SOC] SINGLE-MODE check Q${qIdx + 1}: clicked=${index}, correct=[${[...correctSet]}], isCorrect=${isClickedCorrect}`);
      // PRISTINE cross-check for single-answer: verify against quizInitialState.
      // Default to FALSE (safe) — only set true when pristine confirms.
      let pristineSingleCorrect = false;
      try {
        const nrmSA = (t: any) => String(t ?? '').trim().toLowerCase();
        const clickedText = nrmSA(comp.optionBindings?.[index]?.option?.text);
        const qTextSA = isShuffled
          ? (nrmSA((this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[qIdx]?.questionText)
            || nrmSA((this.quizService as any)?.shuffledQuestions?.[qIdx]?.questionText))
          : (nrmSA(comp.currentQuestion?.questionText)
            || nrmSA((this.quizService as any)?.questions?.[qIdx]?.questionText));
        if (clickedText && qTextSA) {
          const bundleSA: any[] = (this.quizService as any)?.quizInitialState ?? [];
          let saMatched = false;
          for (const quiz of bundleSA) {
            for (const pq of (quiz?.questions ?? [])) {
              if (nrmSA(pq?.questionText) !== qTextSA) continue;
              saMatched = true;
              const matchedOpt = (pq?.options ?? []).find((o: any) => nrmSA(o?.text) === clickedText);
              if (matchedOpt !== undefined) {
                pristineSingleCorrect = matchedOpt?.correct === true || String(matchedOpt?.correct) === 'true';
              }
              console.log(`[SOC] SINGLE pristine match: qText="${qTextSA.slice(0, 40)}" clickedText="${clickedText.slice(0, 40)}" matchedOpt=${matchedOpt !== undefined} correct=${pristineSingleCorrect}`);
              break;
            }
            if (saMatched) break;
          }
        }
      } catch { /* ignore */ }
      console.log(`[SOC] SINGLE pristine text-match result: pristineSingleCorrect=${pristineSingleCorrect}`);
      if (pristineSingleCorrect) {
        try { this.timerService.stopTimer?.(undefined, { force: true, bypassAntiThrash: true }); } catch {}

        // Score and emit FET for single-answer correct click
        // Set FET bypass BEFORE scoring so all downstream gates are open
        this.explanationTextService.fetBypassForQuestion.set(qIdx, true);
        this.quizService.scoreDirectly(qIdx, true, false);
        this.nextButtonStateService.setNextButtonState(true);
        if (!(this.quizService as any)._multiAnswerPerfect) {
          (this.quizService as any)._multiAnswerPerfect = new Map<number, boolean>();
        }
        (this.quizService as any)._multiAnswerPerfect.set(qIdx, true);

        (this.explanationTextService as any)._fetLocked = false;
        this.explanationTextService.unlockExplanation();
        comp.showExplanationChange.emit(true);
        const singleFetQuestion = comp.currentQuestion
          ?? comp.getQuestionAtDisplayIndex?.(qIdx)
          ?? (this.quizService as any)?.getQuestionsInDisplayOrder?.()?.[qIdx];

        // SYNCHRONOUS FET write — push FET directly into the pipeline
        // so combineLatest fires while fetBypassForQuestion is already set.
        // The setTimeout path below is kept as backup.
        try {
          const singleFetCtxSync = {
            resolvedIndex: qIdx,
            question: singleFetQuestion,
            currentQuestion: comp.currentQuestion,
            quizId: comp.quizId?.() ?? comp.quizId ?? '',
            optionBindings: comp.optionBindings ?? [],
            optionsToDisplay: comp.optionsToDisplay ?? [],
            isMultiMode: false
          };
          const fetText = this.sharedOptionExplanationService.resolveExplanationText(singleFetCtxSync as any)?.trim()
            || singleFetQuestion?.explanation || '';
          if (fetText) {
            this.explanationTextService._activeIndex = qIdx;
            (this.explanationTextService as any).latestExplanation = fetText;
            (this.explanationTextService as any).latestExplanationIndex = qIdx;
            this.explanationTextService.setExplanationText(fetText, {
              force: true,
              context: `question:${qIdx}`,
              index: qIdx
            });
            this.explanationTextService.emitFormatted(qIdx, fetText);
            this.explanationTextService.setShouldDisplayExplanation(true, {
              context: `question:${qIdx}`,
              force: true
            } as any);
            this.explanationTextService.setIsExplanationTextDisplayed(true, {
              context: `question:${qIdx}`,
              force: true
            } as any);
            this.explanationTextService.lockExplanation();
            this.quizStateService.setDisplayState({ mode: 'explanation', answered: true });
            console.log(`[SOC] SYNC single-answer FET written for Q${qIdx + 1}: "${fetText.slice(0, 60)}..."`);
          }
        } catch (syncErr) {
          console.warn(`[SOC] Sync single-answer FET write failed:`, syncErr);
        }

        const singleFetCtx = {
          resolvedIndex: qIdx,
          question: singleFetQuestion,
          currentQuestion: comp.currentQuestion,
          quizId: comp.quizId?.() ?? comp.quizId ?? '',
          optionBindings: comp.optionBindings ?? [],
          optionsToDisplay: comp.optionsToDisplay ?? [],
          isMultiMode: false
        };
        // Resolve FET text once for reuse by all write paths
        let resolvedFetText = '';
        try {
          resolvedFetText = this.sharedOptionExplanationService.resolveExplanationText(singleFetCtx as any)?.trim()
            || singleFetQuestion?.explanation || '';
        } catch { /* ignore */ }
        setTimeout(() => {
          try {
            this.sharedOptionExplanationService.emitExplanation(singleFetCtx as any, true);
            console.log(`[SOC] Direct single-answer emitExplanation called for Q${qIdx + 1}`);
          } catch (err) {
            console.error(`[SOC] Direct single-answer emitExplanation failed:`, err);
            comp.emitExplanation(qIdx, true);
          }
        }, 0);
        // DIRECT DOM FALLBACK: after pipeline has had time to process,
        // verify the DOM actually shows FET. If not, stamp it directly.
        // This bypasses every pipeline gate and guard.
        if (resolvedFetText) {
          const fetForDom = resolvedFetText;
          const stampFet = (label: string) => {
            try {
              const h3 = document.querySelector('codelab-quiz-content h3');
              if (h3) {
                const domNow = (h3.innerHTML || '').toLowerCase();
                if (!domNow.includes('correct because')) {
                  h3.innerHTML = fetForDom;
                  console.log(`[SOC] ⚡ DIRECT DOM FALLBACK (${label}) wrote FET for Q${qIdx + 1}`);
                }
              }
            } catch { /* ignore */ }
          };
          setTimeout(() => stampFet('50ms'), 50);
          setTimeout(() => stampFet('150ms'), 150);
          setTimeout(() => stampFet('350ms'), 350);
        }
        if (!comp.disabledOptionsPerQuestion.has(qIdx)) {
          comp.disabledOptionsPerQuestion.set(qIdx, new Set<number>());
        }
        const disabledSetRef = comp.disabledOptionsPerQuestion.get(qIdx)!;
        disabledSetRef.clear();
        const currentBindings: any[] = Array.isArray(comp.optionBindings)
          ? comp.optionBindings
          : (typeof comp.optionBindings === 'function' ? comp.optionBindings() : []);
        for (let i = 0; i < currentBindings.length; i++) {
          if (!correctSet.has(i)) disabledSetRef.add(i);
        }
        // Build a set of previously-clicked indices for THIS question so
        // that a wrong option the user selected earlier keeps its red + X
        // icon after the correct answer is found.
        // IMPORTANT: Do NOT use selectedOptionService.getSelectedOptionsForQuestion
        // here — handleOptionClick already cleared and replaced the service
        // state with only the current (correct) click. The _multiSelectByQuestion
        // durable set tracks every click index for the lifetime of the session
        // and is NOT cleared between clicks, making it the reliable source.
        const durableClicks = comp._multiSelectByQuestion?.get(qIdx);
        const historySet = new Set<number>(durableClicks ?? []);

        // Replace with NEW array of NEW binding objects so OnPush children
        // re-render. In-place mutation alone does not trigger child CD.
        const newBindings = currentBindings.map((ob: any, bi: number) => {
          const isCorrectBinding = correctSet.has(bi);
          const isClicked = bi === index;
          const wasPreviouslyClicked = historySet.has(bi) && !isClicked && !isCorrectBinding;
          return {
            ...ob,
            disabled: !isCorrectBinding,
            isSelected: isClicked,
            option: ob?.option ? {
              ...ob.option,
              selected: isClicked,
              highlight: isClicked || wasPreviouslyClicked,
              showIcon: isClicked || wasPreviouslyClicked
            } : ob?.option
          };
        });
        comp.optionBindings = newBindings;
        console.log(`[SOC] SINGLE-MODE disabled Q${qIdx + 1}: disabled=[${[...disabledSetRef]}], bindings.disabled=[${newBindings.map((b: any) => b?.disabled).join(',')}]`);

        // Persist the currently-selected (correct) option AND any
        // previously-clicked wrong options to sel_Q* so refresh can
        // restore red+X icons on incorrect options the user tried.
        try {
          const toSave: any[] = [];
          for (let bi = 0; bi < newBindings.length; bi++) {
            const nb = newBindings[bi];
            if (!nb?.option) continue;
            const isCorrectBinding = correctSet.has(bi);
            const isClicked = bi === index;
            const wasPreviouslyClicked = historySet.has(bi) && !isClicked && !isCorrectBinding;
            if (isClicked || wasPreviouslyClicked) {
              toSave.push({
                optionId: nb.option.optionId,
                text: nb.option.text,
                displayIndex: bi,
                questionIndex: qIdx,
                selected: isClicked,
                highlight: true,
                showIcon: true,
                correct: isCorrectBinding
              });
            }
          }
          if (toSave.length > 0) {
            sessionStorage.setItem('sel_Q' + qIdx, JSON.stringify(toSave));
            this.selectedOptionService.addToSelectionHistory(qIdx, toSave as any[]);
          }
        } catch { /* ignore */ }

        comp.cdRef?.markForCheck?.();
        comp.cdRef?.detectChanges?.();
      }
    }

    comp._feedbackDisplay = null;
    if (comp.showFeedback) {
      const clickedBinding = comp.optionBindings[index];
      if (clickedBinding) {
        const key = comp.keyOf(clickedBinding.option, index);
        const byKey = comp.feedbackConfigs[key];
        const byIdx = (Object.values(comp.feedbackConfigs) as FeedbackProps[]).find(
          (c: any) => c?.idx === index && c.showFeedback
        );
        let cfg: FeedbackProps | undefined =
          (byKey?.showFeedback ? byKey : undefined) ??
          byIdx ??
          (comp.activeFeedbackConfig?.showFeedback ? comp.activeFeedbackConfig : undefined);

        if (cfg?.showFeedback) {
          cfg = this.clickHandler.overrideMultiAnswerFeedback(
            cfg, clickedBinding, comp.optionBindings
          );
        }

        if (cfg?.showFeedback) {
          comp._feedbackDisplay = { idx: index, config: cfg };
          console.log(`[SOC] _feedbackDisplay SET: idx=${index} text="${cfg.feedback}"`);
        } else {
          console.warn(`[SOC] No feedback config found for idx=${index}`, {
            key,
            feedbackConfigKeys: Object.keys(comp.feedbackConfigs),
            activeFeedbackConfig: comp.activeFeedbackConfig
          });
        }
      }
    }

    // Create NEW binding object references so OnPush option-item children
    // detect the input change and re-render.  The click handler mutates
    // bindings in-place (showIcon, highlight, isSelected, etc.), but
    // OnPush only triggers when the @Input reference changes.
    // For single-answer: authoritatively enforce that ONLY the clicked
    // binding has isSelected=true, while previously-clicked options keep
    // highlight+showIcon (but NOT isSelected). Intermediate service calls
    // (syncSelectedFlags, forceSelectIntoServices) can corrupt isSelected
    // via effectiveId collisions; this is the final backstop.
    if (!isMultiFromQ) {
      const histSet = new Set<number>(durableSet ?? []);
      comp.optionBindings = (comp.optionBindings ?? []).map((b: any, bi: number) => {
        const isClicked = bi === index;
        const inHistory = histSet.has(bi);
        return {
          ...b,
          isSelected: isClicked,
          option: b.option ? {
            ...b.option,
            selected: isClicked,
            highlight: isClicked || inHistory,
            showIcon: isClicked || inHistory
          } : b.option
        };
      });
    } else {
      comp.optionBindings = (comp.optionBindings ?? []).map((b: any) => ({
        ...b,
        option: b.option ? { ...b.option } : b.option
      }));
    }


    comp.cdRef.detectChanges();
  }

  handleSelection(comp: any, option: SelectedOption, index: number, optionId: number): void {
    const normalizedId = (optionId != null && !isNaN(Number(optionId))) ? Number(optionId) : null;
    const effectiveId = (normalizedId !== null && normalizedId > -1) ? normalizedId : index;

    const correctCount = (comp.currentQuestion?.options?.filter((o: any) => {
      const c = (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    }).length ?? 0);
    const isMultiMode = comp.type === 'multiple' ||
      comp.config()?.type === 'multiple' ||
      correctCount > 1;

    if (!isMultiMode) {
      for (const opt of comp.optionsToDisplay || []) {
        opt.selected = false;
      }
      for (const b of comp.optionBindings || []) {
        b.isSelected = false;
        b.option.selected = false;
      }

      option.selected = true;
      if (comp.optionsToDisplay?.[index]) {
        comp.optionsToDisplay[index].selected = true;
      }
      const cfgClick = comp.config();
      if (cfgClick) cfgClick.selectedOptionIndex = index;
      comp.selectedOption = option;

      comp.selectedOptions.clear();
      comp.selectedOptions.add(effectiveId);
      (option as any).displayIndex = index;
      this.selectedOptionService.setSelectedOption(option);
    } else {
      const qIdx = comp.getActiveQuestionIndex() ?? 0;

      option.selected = !option.selected;
      if (comp.optionsToDisplay?.[index]) {
        comp.optionsToDisplay[index].selected = option.selected;
      }

      option.selected
        ? comp.selectedOptions.add(effectiveId)
        : comp.selectedOptions.delete(effectiveId);

      const selOpt: SelectedOption = {
        ...option,
        optionId: (option.optionId != null && option.optionId !== -1) ? option.optionId : effectiveId,
        displayIndex: index,
        questionIndex: qIdx,
        selected: option.selected
      } as SelectedOption;
      (selOpt as any).index = index;
      (option as any).displayIndex = index;
      this.selectedOptionService.addOption(qIdx, selOpt);
    }

    const optionBinding = comp.optionBindings[index];
    if (optionBinding) {
      optionBinding.isSelected = option.selected;
    }
  }

  updateOptionAndUI(comp: any, optionBinding: any, index: number, event: any, existingCtx?: any): void {
    const ctx = existingCtx ?? comp.buildOptionUiSyncContext();

    this.optionUiSyncService.updateOptionAndUI(optionBinding, index, event, ctx);

    comp.feedbackConfigs = { ...ctx.feedbackConfigs };
    comp.showFeedbackForOption = { ...ctx.showFeedbackForOption };
    comp.showFeedback = ctx.showFeedback;
    comp.lastFeedbackOptionId = Number(ctx.lastFeedbackOptionId);
    comp.lastFeedbackQuestionIndex = ctx.lastFeedbackQuestionIndex;
    const isChecked = 'checked' in event ? event.checked : true;
    comp.lastSelectedOptionIndex = isChecked ? index : -1;
    comp.lastSelectedOptionId = ctx.lastFeedbackOptionId;

    const feedbackKey = comp.keyOf(optionBinding.option, index);
    const syncedConfig = comp.feedbackConfigs[feedbackKey] as FeedbackProps | undefined;
    if (syncedConfig?.showFeedback) {
      comp.activeFeedbackConfig = syncedConfig;
      comp.currentFeedbackConfig = syncedConfig;
      comp._lastClickFeedback = {
        index,
        config: syncedConfig,
        questionIdx: comp.resolveCurrentQuestionIndex()
      };
    }

    comp.selectedOptions.clear();
    for (const id of ctx.selectedOptionMap.keys()) {
      comp.selectedOptions.add(Number(id));
    }

    if (ctx.optionBindings) {
      comp.optionBindings = [...ctx.optionBindings];
    } else {
      comp.optionBindings = comp.optionBindings.map((b: any) => ({
        ...b,
        showFeedbackForOption: { ...comp.showFeedbackForOption },
        showFeedback: comp.showFeedback,
        disabled: comp.computeDisabledState(b.option, b.index)
      }));
    }

    // SINGLE-ANSWER GUARD: OUS's syncSelectedFlags can corrupt isSelected
    // via effectiveId collisions. Enforce correct state BEFORE detectChanges
    // so option-item's _wasSelected latch never sees a false positive.
    const isCheckedForGuard = 'checked' in event ? event.checked : true;
    if (isCheckedForGuard && ctx.type === 'single') {
      const correctCount = (ctx.optionBindings ?? []).filter((b: any) => {
        const c = b?.option?.correct ?? b?.option?.isCorrect;
        return c === true || String(c) === 'true' || c === 1 || c === '1';
      }).length;
      if (correctCount <= 1) {
        for (let bi = 0; bi < (comp.optionBindings ?? []).length; bi++) {
          const ob = comp.optionBindings[bi];
          if (!ob) continue;
          ob.isSelected = (bi === index);
          if (ob.option) {
            ob.option.selected = (bi === index);
          }
        }
      }
    }

    this.updateBindingSnapshots(comp);
    comp.cdRef.detectChanges();
  }

  handleBackwardNavigationOptionClick(comp: any, option: any, index: number): void {
    const optionBinding = comp.optionBindings[index];

    if (comp.type === 'single') {
      for (const binding of comp.optionBindings) {
        const isThis = binding === optionBinding;
        binding.isSelected = isThis;
        binding.option.showIcon = isThis;
      }
      comp.selectedOption = option;
      comp.selectedOptions.clear();
      const optId = option.optionId ?? -1;
      comp.selectedOptions.add(optId);
    } else {
      optionBinding.isSelected = !optionBinding.isSelected;
      optionBinding.option.showIcon = optionBinding.isSelected;
      const id = option.optionId;
      const effectiveId = (id != null && id !== -1) ? id : index;
      if (optionBinding.isSelected) {
        comp.selectedOptions.add(Number(effectiveId));
      } else {
        comp.selectedOptions.delete(Number(effectiveId));
      }
    }

    comp.showFeedback = true;
    comp.updateHighlighting();
    comp.emitExplanation(comp.resolvedQuestionIndex ?? 0);
    comp.cdRef.markForCheck();
    comp.isNavigatingBackwards = false;
  }

  applySelectionsUI(comp: any, selectedOptions: any[]): void {
    if (!comp.optionsToDisplay?.length) return;
    if (comp.hasUserClicked || comp.freezeOptionBindings) return;

    const selIndices = new Set<number>();
    for (const s of selectedOptions) {
      const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
      if (sIdx != null && Number.isFinite(Number(sIdx))) {
        selIndices.add(Number(sIdx));
      }
    }

    const isCorrect = (o: any) => {
      if (!o) return false;
      return o.correct === true || String(o.correct) === 'true' || o.correct === 1 || o.correct === '1';
    };

    let lastCorrectIdx: number | null = null;
    for (let i = selectedOptions.length - 1; i >= 0; i--) {
      const s = selectedOptions[i];
      if (isCorrect(s)) {
        const sIdx = (s as any).displayIndex ?? (s as any).index ?? (s as any).idx;
        if (sIdx != null && Number.isFinite(Number(sIdx))) {
          lastCorrectIdx = Number(sIdx);
          break;
        }
      }
    }

    for (let i = 0; i < comp.optionsToDisplay.length; i++) {
      const opt = comp.optionsToDisplay[i];
      const isSelected = selIndices.has(i);
      opt.selected = isSelected;
      opt.showIcon = isSelected;
      opt.highlight = isSelected;
    }

    comp.generateOptionBindings();
    comp.cdRef.markForCheck();
  }

  updateBindingSnapshots(comp: any): void {
    if (!comp.optionBindings?.length) return;

    for (const binding of comp.optionBindings) {
      if (binding && binding.option) {
        binding.disabled = comp.computeDisabledState(binding.option, binding.index);

        const qIndex = comp.currentQuestionIndex;
        const isLocked = this.optionLockService.isLocked(binding, binding.index, qIndex);

        binding.cssClasses = this.optionService.getOptionClasses(
          binding,
          binding.index,
          comp.highlightedOptionIds,
          comp.flashDisabledSet,
          isLocked,
          comp.timerExpiredForQuestion
        );

        binding.optionIcon = this.optionService.getOptionIcon(binding, binding.index);

        binding.optionCursor = this.optionService.getOptionCursor(
          binding,
          binding.index,
          binding.disabled,
          comp.timerExpiredForQuestion
        );
      }
    }
    comp.cdRef.markForCheck();
  }

  preserveOptionHighlighting(comp: any): void {
    const isMulti = comp.isMultiMode;

    for (const option of comp.optionsToDisplay) {
      if (!option.selected) {
        option.highlight = false;
        option.showIcon = false;
        continue;
      }

      const isCorrect = this._isCorrect(option);
      if (isMulti) {
        if (isCorrect) {
          let lastCorrectIdx = -1;
          if (comp.selectedOptionHistory?.length > 0) {
            for (let j = comp.selectedOptionHistory.length - 1; j >= 0; j--) {
              const histId = comp.selectedOptionHistory[j];
              let hIdx = comp.optionsToDisplay.findIndex((_: any, oIdx: number) => oIdx === histId || String(oIdx) === String(histId));
              if (hIdx === -1) {
                hIdx = comp.optionsToDisplay.findIndex((o: any) => (o.optionId != null && o.optionId !== -1 && o.optionId == histId));
              }

              if (hIdx !== -1) {
                const oH = comp.optionsToDisplay[hIdx];
                if (oH?.selected && this._isCorrect(oH)) {
                  lastCorrectIdx = hIdx;
                  break;
                }
              }
            }
          }
          option.highlight = (comp.optionsToDisplay.indexOf(option) === lastCorrectIdx);
        } else {
          option.highlight = true;
        }
      } else {
        option.highlight = true;
      }
      option.showIcon = true;
    }
  }

  ensureOptionsToDisplay(comp: any): void {
    const activeIdx = comp.getActiveQuestionIndex();
    const displayQuestion = comp.getQuestionAtDisplayIndex(activeIdx);
    const fallbackOptions =
      displayQuestion?.options?.length
        ? displayQuestion.options
        : comp.currentQuestion?.options;

    if (
      Array.isArray(comp.optionsToDisplay) &&
      comp.optionsToDisplay.length > 0
    ) {
      return;
    }

    if (Array.isArray(fallbackOptions) && fallbackOptions.length > 0) {
      comp.optionsToDisplay = fallbackOptions.map((option: any) => ({
        ...option,
        active: option.active ?? true,
        feedback: option.feedback ?? undefined,
        showIcon: option.showIcon ?? false
      }));
      console.info(
        '[SharedOptionComponent] Restored optionsToDisplay from display-order question/options fallback'
      );
    } else {
      console.warn(
        '[SharedOptionComponent] No valid options available to restore.'
      );
      comp.optionsToDisplay = [];
    }

    comp.ensureOptionIds();
  }

  enforceSingleSelection(comp: any, selectedBinding: OptionBindings): void {
    this.optionSelectionPolicyService.enforceSingleSelection({
      optionBindings: comp.optionBindings,
      selectedBinding,
      showFeedbackForOption: comp.showFeedbackForOption,
      updateFeedbackState: (id: number) => {
        if (!comp.showFeedbackForOption) {
          comp.showFeedbackForOption = {};
        }
        comp.showFeedback = true;
        comp.showFeedbackForOption[id] = true;
      },
    });
  }

  private _isCorrect(o: any): boolean {
    if (o === true || o === 'true' || o === 1 || o === '1') return true;
    if (o && typeof o === 'object') {
      const c = o.correct ?? o.isCorrect ?? (o as any).correct;
      return c === true || String(c) === 'true' || c === 1 || c === '1';
    }
    return false;
  }
}
