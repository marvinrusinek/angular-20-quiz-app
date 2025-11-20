import { Injectable, ViewContainerRef, ComponentRef, Type } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DynamicComponentService {

  constructor() {}

  private async importComponent(): Promise<Type<any>> {
    // Clean import — no ?cb, no globs
    const module = await import(
      '../../components/question/answer/answer-component/answer.component'
      );

    if (!module || !module.AnswerComponent) {
      throw new Error('[DynamicComponentService] ❌ AnswerComponent failed to load.');
    }

    return module.AnswerComponent;
  }

  public async loadComponent<T>(
    container: ViewContainerRef,
    multipleAnswer: boolean,
    onOptionClicked: (event: any) => void
  ): Promise<ComponentRef<T>> {

    const AnswerComponent = await this.importComponent();

    container.clear();

    const componentRef = container.createComponent(AnswerComponent as Type<T>);

    (componentRef.instance as any).isMultipleAnswer = multipleAnswer;

    const instance: any = componentRef.instance;
    if (instance.optionClicked) {
      instance.optionClicked.subscribe((event: any) => {
        onOptionClicked(event);
      });
    }

    return componentRef;
  }
}
