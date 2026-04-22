import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideZonelessChangeDetection, isDevMode } from '@angular/core';

import { routes } from './app/router/quiz-routing.routes';
import { AppComponent } from './app/app.component';
import { installGlobalFetWatchdog } from './app/shared/utils/fet-watchdog';
import { provideServiceWorker } from '@angular/service-worker';

installGlobalFetWatchdog();

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideAnimations(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}).catch((err) => console.error(err));
