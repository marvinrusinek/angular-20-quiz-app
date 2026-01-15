# Debugging Status & Handoff

**Objective:** Fix Shuffled Mode Scoring bugs (Decrement on Navigation, Increment on 1st Multi Correct) while preserving Unshuffled functioning.

## Current State (As of Step 2428)
*   **Unshuffled:** User reports Q1/Q2 scoring is **BROKEN**.
*   **Shuffled:** Fixes were applied but partially reverted to restore Unshuffled stability.

## key Changes Applied (Review These)

1.  **`src/app/shared/services/quiz.service.ts`**
    *   **Matching:** Reverted to Text Match `(option.text || '').trim().toLowerCase()`.
    *   **Dedupe:** Removed/Disabled (Raw `this.answers` used).
    *   **Navigation Guard:** Removed from `checkIfAnsweredCorrectly`.
    *   **Scoring Key:** Logic to map Shuffled->Original index is **DISABLED** (Dead Code Block `if (false && ...)`). Scoring uses `qIndex`.
    *   **Increment Logic:** Reverted to legacy `+1 / -1`.

2.  **`src/app/shared/services/quiz-shuffle.service.ts`** (Step 2379)
    *   **Correct Flag:** Updated `cloneAndNormalizeOptions` to allow String `'true'` as correct.
    *   *Check:* Verify this didn't side-effect Unshuffled data normalization.

## Next Steps for Tomorrow
1.  **Fix Unshuffled Baseline:** The priority is to get Unshuffled Q1/Q2 scoring again.
    *   Check `determineCorrectAnswer` logic.
    *   Check if `numberOfCorrectAnswers` is calculating correctly (1 vs 0).
2.  **Re-Apply Shuffled Fixes (Carefully):**
    *   **Deduplication:** Enable *only* for Shuffled mode (`this.shouldShuffle()`).
    *   **Nav Guard:** Re-add if Decrement persists.
