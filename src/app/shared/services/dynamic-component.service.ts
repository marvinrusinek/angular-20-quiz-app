import { ComponentRef, Injectable, Type, ViewContainerRef } from '@angular/core';

// ⬅️ STATIC IMPORT — works everywhere, no network fetch
import { AnswerComponent } from '../../components/question/answer/answer-component/answer.component';

@Injectable({ providedIn: 'root' })
export class DynamicComponentService {
  constructor() {}

  public loadComponent<T>(
    container: ViewContainerRef,
    multipleAnswer: boolean,
    onOptionClicked: (event: any) => void
  ): ComponentRef<T> {

    // Clear BEFORE creating the new component
    container.clear();

    // Create the component using Angular 20 Ivy-native API
    const componentRef = container.createComponent(AnswerComponent as Type<T>);

    // Pass the input
    (componentRef.instance as any).isMultipleAnswer = multipleAnswer;

    // Subscribe to the output and forward the event
    const instance: any = componentRef.instance;

    if (instance.optionClicked) {
      instance.optionClicked.subscribe((event: any) => {
        console.log('[⚡ DCS] Forwarding optionClicked event:', event);
        onOptionClicked(event);
      });
    } else {
      console.warn('[⚠ DCS] AnswerComponent has no optionClicked output.');
    }

    return componentRef;
  }
}
