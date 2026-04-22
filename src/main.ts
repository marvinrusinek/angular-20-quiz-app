import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideZonelessChangeDetection } from '@angular/core';

import { routes } from './app/router/quiz-routing.routes';
import { AppComponent } from './app/app.component';
import { installGlobalFetWatchdog } from './app/shared/utils/fet-watchdog';

installGlobalFetWatchdog();

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    provideAnimations(),
  ],
}).catch((err) => console.error(err));
