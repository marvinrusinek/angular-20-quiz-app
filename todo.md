# Remaining Tasks

## Priority: StackBlitz Navigation & Persistence

### ✅ Completed Updates:
- **Tab Visibility Handler (`QuizComponent`)**:
  - Implemented logic to explicitely re-emit `combinedQuestionDataSubject` when tab becomes visible. This forces the template (`async` pipe) to re-render potentially cleared views.
  - Added strict `sessionStorage` persistence for selections to survive iframe reloads. (Fix applied in `onOptionSelected` to save, and `fetchAndSetQuestionData` to restore).
- **Selection Persistence**:
  - `selectedOptionIndices` are now saved to `sessionStorage` per question.
  - On init/reload, these are restored into `SelectedOptionService` *before* the component determines if the question is "answered".
- **Formatting**: `SharedOptionComponent` HTML formatting is fixed.
- **UI Tweaks**: "Next Question" tooltip updated to `»`.

### Verification Steps (for User):
1.  Open the app in StackBlitz.
2.  Select an option for Q1.
3.  Navigate to a different browser tab.
4.  Navigate back.
    - EXPECT: Q1 text, selections, and explanation are visible.
5.  Refresh the StackBlitz preview window manually.
    - EXPECT: Q1 selections and explanation state are restored (persisted).

### Next Steps:
- Monitor for any other "state loss" issues.
