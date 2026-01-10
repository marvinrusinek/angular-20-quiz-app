import {
  animate, keyframes, style, transition, trigger
} from '@angular/animations';

/***************************************
 * Slide Left → Right (Intro)
 ***************************************/
export const SlideLeftToRightAnimation = {
  slideLeftToRight: trigger('slideLeftToRight', [
    transition(':enter', [
      style({ transform: 'translateX(-100%)' }),
      animate(
        '900ms cubic-bezier(0.4, 0.0, 0.2, 1)',
        style({ transform: 'translateX(0%)' })
      )
    ])
  ])
};

/***************************************
 * Scale/Bounce (Quiz transition)
 ***************************************/
export const ChangeRouteAnimation = {
  changeRoute: trigger('changeRoute', [
    transition('* <=> *', [
      animate(
        '1500ms cubic-bezier(0.4, 0.0, 0.2, 1)',
        keyframes([
          style({ transform: 'scale(1)', offset: 0 }),
          style({ transform: 'scale(1.25)', offset: 0.35 }),
          style({ transform: 'scale(1.35)', offset: 0.55 }),
          style({ transform: 'scale(1)', offset: 1 })
        ])
      )
    ])
  ])
};


export const correctAnswerAnim = trigger('correctAnswer', [
  transition(':enter', [
    style({
      transform: 'scale(0.92)',
      opacity: 0
    }),
    animate(
      '180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
      style({
        transform: 'scale(1)',
        opacity: 1
      })
    )
  ])
]);