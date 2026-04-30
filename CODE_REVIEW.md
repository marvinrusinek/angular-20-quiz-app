# Angular Quiz App - Code Review

**Date:** 2026-04-30
**Angular Version:** 20.3.14 | **TypeScript:** 5.8.2

---

## Summary

| Category | Status |
|----------|--------|
| Architecture | Strong - modern standalone components, service-oriented |
| Type Safety | Strong - 37 models/types/enums, comprehensive typing |
| State Management | Good - hybrid Signals + RxJS (modern Angular pattern) |
| Theme Support | Good - CSS custom properties, light/dark mode |
| PWA | Enabled with Service Worker |
| Test Coverage | None (0 spec files) |
| Code Complexity | High - many oversized services and components |
| Production Readiness | Needs work (console logging, no tests, large files) |

---

## Strengths

- Modern Angular 20 with Signals + RxJS
- All 25 components are standalone (no NgModules)
- Comprehensive service architecture (81 services organized by function)
- Well-typed TypeScript codebase with 37 models/types/enums
- Good separation of concerns (data/flow/features/state/options/ui)
- OnPush change detection used consistently
- Theme support (light/dark) via CSS custom properties
- PWA-enabled with Service Worker
- Backward-compatible routing with redirect routes
- QuizGuard validates quizId, question index, and normalizes indexing

---

## Critical Issues

### 1. No Test Coverage

Zero spec files in `src/app/`. No karma.conf.js, jest.config.js, or test scripts.

**Recommendation:** Add unit tests at minimum for:
- Core services (quiz, state, options)
- Guards (quiz-guard)
- Pipes (join)
- Critical components (quiz-question, answer)

### 2. Oversized Files (>1000 lines)

| File | Lines | Notes |
|------|-------|-------|
| `selectedoption.service.ts` | 3,335 | Manages multiple storage layers, Maps, Sets - needs splitting into 5-6 focused services |
| `cqc-orchestrator.service.ts` | 2,452 | Bloated orchestrator |
| `qqc-component-orchestrator.service.ts` | 1,938 | Should split into 3-4 services |
| `quiz-setup.service.ts` | 1,504 | Complex initialization |
| `quiz-content-loader.service.ts` | 1,444 | Needs extraction |
| `qqc-question-loader.service.ts` | 1,289 | Too complex |
| `shared-option-click.service.ts` | 1,254 | Needs decomposition |
| `quizquestionloader.service.ts` | 1,252 | Possible duplication with qqc-question-loader |
| `explanation-display-state.service.ts` | 1,214 | Oversized |
| `shared/quiz.ts` | 1,121 | Hardcoded quiz data |
| `qqc-option-selection.service.ts` | 1,103 | High complexity |
| `quiz.service.ts` | 1,083 | Core service, needs refactoring |

Additionally, 18 more services are between 600-1000 lines.

### 3. Excessive Console Logging

**1,133 console.log/warn/error statements** across the codebase. These should be removed for production or moved behind a debug service/flag.

Examples: `[🔁 NavigationEnd]`, `[🛡️ QuizGuard]`, `[❌ QuizId=...]`

### 4. Large Components

| Component | Lines | Dependencies |
|-----------|-------|-------------|
| `shared-option.component.ts` | 742 | Should be split |
| `option-item.component.ts` | 729 | Too large for a single option item |
| `answer.component.ts` | 712 | Split into sub-components |
| `quiz-question.component.ts` | 585 | 35+ service dependencies injected |

---

## Moderate Issues

### 5. Duplicate Functionality

`quizquestionloader.service.ts` (1,252 lines) and `qqc-question-loader.service.ts` (1,289 lines) appear to overlap in purpose. Consolidate into a single service.

### 6. Deprecated APIs Still Present

10 deprecated methods found marked with `@deprecated` comments:
- `quiz-scoring.service.ts` - `correctAnswersCountSub`
- `selection-message.service.ts` - `selectionMessageSub`
- `quiz-navigation.service.ts` - `isNavigatingToPreviousSub`
- `quizquestionloader.service.ts` - 4 deprecated properties
- `quizquestionmgr.service.ts` - `shouldDisplayExplanationSub`
- `render-state.service.ts` - `optionsToDisplaySub`

### 7. Circular Dependency Risks

- Comment found: "Lazily resolved to avoid circular dependency" in `quiz-scoring.service.ts`
- High inter-service coupling among options, state, and flow services
- `quiz-setup`, `quiz-content-loader`, and `qqc-component-orchestrator` have complex dependency graphs

### 8. No Storage Abstraction

Direct `localStorage`/`sessionStorage` access scattered across 25+ locations. No encryption or secure storage wrapper.

**Recommendation:** Create a `StorageService` abstraction for all storage access.

### 9. Inconsistent State Management Patterns

Mixed approaches across services:
- Some services use Signals only
- Others use BehaviorSubject/ReplaySubject/Subject
- Others use a hybrid of both

---

## Dependency Issues

### 10. Unnecessary/Redundant Dependencies

| Dependency | Issue |
|-----------|-------|
| `lodash` | Only used in `quiz.service.ts` for `cloneDeep()` and `isEqual()` - replace with native `structuredClone()` and utility function |
| `bootstrap` | Included alongside Angular Material - likely redundant |
| `@ionic/angular` | In devDependencies but not used in app code |

### 11. Angular CLI Version Mismatch

Angular CLI is 19.1.7 but the build tool is 20.3.8. Update CLI to 20.x.

---

## Security Review

### No Critical Security Issues Found

- No hardcoded credentials or API keys
- No unsafe `[innerHTML]` bindings detected
- Angular's built-in XSS protection via property binding
- No backend API calls (static quiz data)

### Minor Concerns

- Quiz questions/answers hardcoded in bundle (`shared/quiz.ts`, 1,121 lines) - users can inspect answers via DevTools
- Direct storage access without abstraction
- Service Worker could cache sensitive data (current config looks safe)

### Recommendations

1. Add Content Security Policy headers
2. Consider moving quiz data to external API
3. Audit any future `[innerHTML]` bindings for sanitization

---

## Architecture Overview

### Codebase Stats

- **Components:** 25 (all standalone)
- **Services:** 81 (all `providedIn: 'root'`)
- **Pipes:** 1 (join)
- **Directives:** 3 (highlight, reset-background, shared-option-config)
- **Guards:** 1 (quiz-guard)
- **Models/Types/Enums:** 37
- **Total TypeScript:** ~52,900 lines

### Service Organization

| Category | Count | Purpose |
|----------|-------|---------|
| Data | 9 | Quiz data, loading, scoring |
| Flow | 14 | Navigation, initialization, orchestration |
| Features | 31 | Explanation, feedback, QQC, timer, etc. |
| Options | 16 | Option engine, policy, view |
| State | 6 | Selected option, quiz state, persistence |
| UI | 6 | Theme, sound, rendering, visibility |

### Routes

```
/quiz                              → QuizSelectionComponent
/quiz/intro/:quizId                → IntroductionComponent
/quiz/question/:quizId/:questionIndex → QuizComponent [QuizGuard, QuizResolver]
/quiz/results/:quizId              → ResultsComponent
```

---

## Refactoring Priority

1. **Break apart `selectedoption.service.ts`** (3,335 lines) into 5-6 focused services
2. **Remove or gate console logging** (1,133 statements)
3. **Add unit tests** for core services, guards, and pipes
4. **Consolidate duplicate services** (`quizquestionloader` vs `qqc-question-loader`)
5. **Remove deprecated APIs** (10 marked methods)
6. **Split large components** (quiz-question, shared-option, option-item, answer)
7. **Create StorageService** abstraction for localStorage/sessionStorage
8. **Remove unused dependencies** (lodash, bootstrap if not used, @ionic/angular)
9. **Update Angular CLI** to version 20.x
10. **Extract hardcoded quiz data** from bundle to external file or API
