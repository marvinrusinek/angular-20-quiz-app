import { Injectable, ViewContainerRef, ComponentRef, Type } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DynamicComponentService {

  constructor() {}

  private async loadAnswerComponent(): Promise<Type<any>> {
    const module = await import(
      /* webpackIgnore: true */
      '../../components/question/answer/answer-component/answer.component' +
      `?cb=${Date.now()}`
    );

    if (!module?.AnswerComponent) {
      throw new Error('[DynamicComponentService] Failed to load AnswerComponent.');
    }

    return module.AnswerComponent;
  }

  public async loadComponent<T>(
    container: ViewContainerRef,
    multipleAnswer: boolean,
    onOptionClicked: (event: any) => void
  ): Promise<ComponentRef<T>> {

    const AnswerComponent = await this.loadAnswerComponent();

    container.clear();

    const componentRef = container.createComponent(AnswerComponent as Type<T>);

    (componentRef.instance as any).isMultipleAnswer = multipleAnswer;

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
