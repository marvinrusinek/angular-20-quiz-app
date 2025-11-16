import { animate, keyframes, style, transition, trigger } from '@angular/animations';

/***************************************
 * Slide Left → Right (Intro)
 ***************************************/
export const SlideLeftToRightAnimation = {
  slideLeftToRight: trigger('slideLeftToRight', [
    transition(':enter', [
      style({ transform: 'translateX(-100%)' }),
      // 500 → 900 ms (almost double, feels natural)
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
      // 800 → 1500 ms (this is the sweet spot — finally slow enough)
      animate(
        '1500ms cubic-bezier(0.4, 0.0, 0.2, 1)',
        keyframes([
          style({ transform: 'scale(1)',   offset: 0 }),
          style({ transform: 'scale(1.25)', offset: 0.35 }), // lower peak looks smoother
          style({ transform: 'scale(1.35)', offset: 0.55 }), // extended bounce “hang”
          style({ transform: 'scale(1)',    offset: 1 })
        ])
      )
    ])
  ])
};
