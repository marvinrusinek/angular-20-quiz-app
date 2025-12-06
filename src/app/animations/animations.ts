import { animate, keyframes, style, transition, trigger } from '@angular/animations';

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
        '450ms cubic-bezier(0.4, 0.0, 0.2, 1)',
        keyframes([
          style({ transform: 'scale(1)', offset: 0 }),
          style({ transform: 'scale(1.08)', offset: 0.4 }),
          style({ transform: 'scale(1.12)', offset: 0.6 }),
          style({ transform: 'scale(1)', offset: 1 })
        ])
      )
    ])
  ])
};
