import { Pipe, PipeTransform } from '@angular/core';
import { QuizQuestion } from '../shared/models/QuizQuestion.model';

@Pipe({
    name: 'mapToQuestion',
    standalone: true
})
export class MapToQuestionPipe implements PipeTransform {
    transform(value: any): QuizQuestion | null {
        if (value && typeof value === 'object' && 'question' in value) {
            return value.question;
        }
        return null;
    }
}
