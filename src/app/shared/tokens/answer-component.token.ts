import { InjectionToken, Type } from '@angular/core';

/**
 * The dynamically-rendered AnswerComponent class, provided at the app root so
 * DynamicComponentService can create it WITHOUT importing it directly. Importing
 * AnswerComponent into the service created a circular dependency (AnswerComponent
 * extends BaseQuestion, and the service sits mid-graph), which broke bootstrap
 * with "Class extends value undefined". Providing it via this token from main.ts
 * — the bootstrap entry that nothing imports — bundles it eagerly (no lazy chunk
 * to fetch, fixing the StackBlitz cold-load "Failed to fetch dynamically imported
 * module" failure) while keeping the import out of the cyclic graph.
 */
export const ANSWER_COMPONENT = new InjectionToken<Type<any>>('ANSWER_COMPONENT');
