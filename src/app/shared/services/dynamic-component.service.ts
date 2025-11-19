import { Injectable, ViewContainerRef, ComponentRef, Type } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DynamicComponentService {

  constructor() {}
  
  // Dynamically loads AnswerComponent without creating circular dependencies.
  private async loadAnswerComponent(): Promise<Type<any>> {
    // Lazy-load module — NO TOP-LEVEL IMPORTS
    const module = await import(
      '../../components/question/answer/answer-component/answer.component'
    );

    if (!module?.AnswerComponent) {
      throw new Error('[DynamicComponentService] Failed to load AnswerComponent.');
    }

    return module.AnswerComponent;
  }

  // Creates the component and wires its output.
  public async loadComponent<T>(
    container: ViewContainerRef,
    multipleAnswer: boolean,
    onOptionClicked: (event: any) => void
  ): Promise<ComponentRef<T>> {

    // Lazy load component class
    const AnswerComponent = await this.loadAnswerComponent();

    // Clear target container BEFORE creating new component
    container.clear();

    // Instantiate the component
    const componentRef = container.createComponent(AnswerComponent as Type<T>);

    // Set inputs
    (componentRef.instance as any).isMultipleAnswer = multipleAnswer;

    // Wire output → handler
    const instance: any = componentRef.instance;

    if (instance.optionClicked) {
      instance.optionClicked.subscribe((event: any) => {
        console.log('[⚡ DCS] Forwarding optionClicked:', event);
        onOptionClicked(event);
      });
    } else {
      console.warn('[⚠️ DCS] AnswerComponent has no optionClicked output.');
    }

    return componentRef;
  }
}