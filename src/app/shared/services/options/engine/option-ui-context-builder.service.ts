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
      toggleSelectedOption: (opt: any) =>
        src.optionVisualEffectsService.toggleSelectedOption(opt, src.selectedOptionMap),
      
      onSelect: (binding: any) => {
        // 🔊 RESTORE SOUNDS: Play sound for the selected option
        const qIndex = typeof src.getActiveQuestionIndex === 'function'
          ? src.getActiveQuestionIndex()
          : src.currentQuestionIndex;


        
        src.soundService.playOnceForOption({
          ...binding.option,
          questionIndex: qIndex
        });

        // Notify parent component
        src.optionClicked.emit({
          option: binding.option,
          index: binding.index,
          checked: binding.isSelected,
          wasReselected: false
        });
      }
    };
  }
}