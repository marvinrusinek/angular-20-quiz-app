import { Injectable, ViewContainerRef, ComponentRef, Type } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DynamicComponentService {

  constructor() {}

  // Dynamically imports the AnswerComponent.
  private async importComponent(): Promise<Type<any>> {
    const module = await import(
      '../../components/question/answer/answer-component/answer.component?cb=' +
      performance.now()   // forces reload of the JS every time
    );

    if (!module?.AnswerComponent) {
      throw new Error('[DynamicComponentService] AnswerComponent failed to load.');
    }

    return module.AnswerComponent;
  }

  // Creates the AnswerComponent dynamically inside a ViewContainerRef.
  public async loadComponent<T>(
    container: ViewContainerRef,
    multipleAnswer: boolean,
    onOptionClicked: (event: any) => void
  ): Promise<ComponentRef<T>> {

    // Lazy load AnswerComponent class
    const AnswerComponent = await this.importComponent();

    // Clear old content
    container.clear();

    // Create component instance
    const componentRef = container.createComponent(AnswerComponent as Type<T>);

    // Assign inputs
    (componentRef.instance as any).isMultipleAnswer = multipleAnswer;

    // Wire outputs
    const instance: any = componentRef.instance;
    if (instance.optionClicked) {
      instance.optionClicked.subscribe((event: any) => {
        console.log('[⚡ DCS] Forwarding optionClicked:', event);
        onOptionClicked(event);
      });
    } else {
      console.warn('[⚠️ DCS] AnswerComponent has no optionClicked emitter.');
    }

    return componentRef;
  }
}