import { Injectable } from '@angular/core';

import { OptionBindings } from '../../../models/OptionBindings.model';
import { Option } from '../../../models/Option.model';
import { OptionUiSyncContext } from '../engine/option-ui-sync.service';

type SharedOptionComponentLike =
  Omit<OptionUiSyncContext, 'toggleSelectedOption'> & {
    optionVisualEffectsService: {
      toggleSelectedOption: (opt: Option, map: Map<number, boolean>) => void;
    };
  };

@Injectable({ providedIn: 'root' })
export class OptionUiContextBuilderService {
  build(ctx: OptionUiSyncContext): OptionUiSyncContext {
    return ctx;
  }

  fromSharedOptionComponent(src: any): OptionUiSyncContext {
    return {
      ...src,
      // Explicitly bind methods that are on the prototype (spread doesn't copy them)
      keyOf: (o: Option, i: number) => src.keyOf(o, i),
      getActiveQuestionIndex: () => src.getActiveQuestionIndex(),
      getQuestionAtDisplayIndex: (idx: number) => src.getQuestionAtDisplayIndex(idx),
      emitExplanation: (idx: number) => src.emitExplanation(idx),

      toggleSelectedOption: (opt: any) =>
        src.optionVisualEffectsService.toggleSelectedOption(opt, src.selectedOptionMap),

      onSelect: (binding: any, checked: boolean, questionIndex: number) => {


        src.optionClicked.emit({
          option: {
            ...binding.option,
            selected: checked
          },
          index: binding.index,
          checked,
          wasReselected: false
        });
      }
    };
  }
}