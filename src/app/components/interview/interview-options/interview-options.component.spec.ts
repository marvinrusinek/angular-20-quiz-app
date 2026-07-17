import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Option } from '../../../shared/models/Option.model';
import { InterviewOptionsComponent } from './interview-options.component';

describe('InterviewOptionsComponent', () => {
  let fixture: ComponentFixture<InterviewOptionsComponent>;
  let component: InterviewOptionsComponent;

  const single: Option[] = [
    { text: 'A', correct: true, optionId: 1 },
    { text: 'B', optionId: 2 },
    { text: 'C', optionId: 3 }
  ];
  const multi: Option[] = [
    { text: 'A', correct: true, optionId: 1 },
    { text: 'B', correct: true, optionId: 2 },
    { text: 'C', optionId: 3 }
  ];

  function setup(options: Option[], selectedIds: number[] = []) {
    fixture = TestBed.createComponent(InterviewOptionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('selectedIds', selectedIds);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InterviewOptionsComponent] }).compileComponents();
  });

  it('renders radios for a single-answer question', () => {
    setup(single);
    expect(component.isMultiSelect()).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('input[type="radio"]').length).toBe(3);
  });

  it('renders checkboxes for a multiple-answer question', () => {
    setup(multi);
    expect(component.isMultiSelect()).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('input[type="checkbox"]').length).toBe(3);
  });

  it('single-answer selection replaces the prior choice', () => {
    setup(single, [2]);
    const emitted: number[][] = [];
    component.selectionChange.subscribe((ids) => emitted.push(ids));
    component.onToggle(single[0]);
    expect(emitted).toEqual([[1]]);
  });

  it('multiple-answer selection adds and removes', () => {
    setup(multi, [1]);
    const emitted: number[][] = [];
    component.selectionChange.subscribe((ids) => emitted.push(ids));
    component.onToggle(multi[1]);                 // add 2
    expect([...emitted[0]].sort()).toEqual([1, 2]);

    setup(multi, [1, 2]);
    const removed: number[][] = [];
    component.selectionChange.subscribe((ids) => removed.push(ids));
    component.onToggle(multi[0]);                 // remove 1
    expect(removed[0]).toEqual([2]);
  });

  it('pins "All of the above" last', () => {
    const opts: Option[] = [
      { text: 'A', optionId: 1 },
      { text: 'All of the above', correct: true, optionId: 2 },
      { text: 'B', optionId: 3 }
    ];
    setup(opts);
    expect(component.displayOptions().map((o) => o.text)).toEqual(['A', 'B', 'All of the above']);
  });

  it('reflects selectedIds and never renders correctness classes', () => {
    setup(single, [3]);
    expect(component.isSelected(single[2])).toBe(true);
    expect(component.isSelected(single[0])).toBe(false);
    expect(fixture.nativeElement.innerHTML).not.toMatch(/correct-option|incorrect-option/);
  });
});
