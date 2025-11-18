import { ComponentRef, Injectable, Type, ViewContainerRef } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DynamicComponentService {
  constructor() {}

  public async loadComponent<T>(
    container: ViewContainerRef,
    multipleAnswer: boolean,
    onOptionClicked: (event: any) => void
  ): Promise<ComponentRef<T>> {

    // Dynamically import the AnswerComponent
    const { AnswerComponent } = await this.importComponent();
    if (!AnswerComponent) {
      throw new Error('[DynamicComponentService] AnswerComponent failed to load.');
    }

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

  private async importComponent(): Promise<{ AnswerComponent?: Type<any> }> {
    const module = await import('../../components/question/answer/answer-component/answer.component');
    return { AnswerComponent: module.AnswerComponent };
  }
}