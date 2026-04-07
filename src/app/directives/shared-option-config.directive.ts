import { Directive, Input } from '@angular/core';
import { SharedOptionConfig } from '../shared/models/SharedOptionConfig.model';

@Directive({
  selector: '[sharedOptionConfig]',
  standalone: true
})
export class SharedOptionConfigDirective {
  @Input() sharedOptionConfig!: SharedOptionConfig;
}
