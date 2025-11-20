import { Injectable, ViewContainerRef, ComponentRef, Type } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DynamicComponentService {

  constructor() {}

  private async loadAnswerComponent(): Promise<Type<any>> {
    try {
      const module = await import(
        '../../components/question/answer/answer-component/answer.component'
      );
  
      if (!module || !module.AnswerComponent) {
        throw new Error('AnswerComponent export not found');
      }
  
      return module.AnswerComponent;
  
    } catch (err) {
      console.error('[DynamicComponentService] ❌ Failed to dynamically import AnswerComponent:', err);
      throw err;
    }
  }

  public async loadComponent<T>(
    container: ViewContainerRef,
    multipleAnswer: boolean,
    onOptionClicked: (event: any) => void
  ): Promise<ComponentRef<T>> {
  
    // Wait one frame (cold boot stabilization)
    await new Promise(res => requestAnimationFrame(res));
  
    const AnswerComponent = await this.loadAnswerComponent();
  
    container.clear();
  
    const componentRef = container.createComponent(AnswerComponent as Type<T>);
  
    // Let Angular wire bindings
    await new Promise(res => setTimeout(res, 0));
  
    const instance: any = componentRef.instance;
    instance.isMultipleAnswer = multipleAnswer;
  
    if (instance.optionClicked) {
      instance.optionClicked.subscribe((event: any) => {
        console.log('[⚡ DCS] Forwarding optionClicked:', event);
        onOptionClicked(event);
      });
    }
  
    componentRef.changeDetectorRef.detectChanges();
  
    return componentRef;
  }  
}
