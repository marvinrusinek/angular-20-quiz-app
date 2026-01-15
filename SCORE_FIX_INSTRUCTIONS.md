# Micro-Fix for Shuffled Score Decrement

This fix resolves the issue where the score drops by 1 when navigating between questions in Shuffled Mode. It does **not** change how answers are matched or graded (preserving Unshuffled logic).

## Step 1: Fix `checkIfAnsweredCorrectly` Guard

**File:** `src/app/shared/services/quiz.service.ts`
**Method:** `checkIfAnsweredCorrectly` (approx line 2268)

Add these lines at the very beginning of the function to prevent scoring during page transitions:

```typescript
  async checkIfAnsweredCorrectly(qIndex = -1): Promise<boolean> {
    // ⚡ ADD THIS GUARD:
    if (this.isNavigating) {
      console.warn(`[checkIfAnsweredCorrectly] 🚫 Navigation in progress. Aborting check.`);
      return false;
    }

    // ... existing code ...
```

## Step 2: Fix `incrementScore` Key Collision

**File:** `src/app/shared/services/quiz.service.ts`
**Method:** `incrementScore` (approx line 2308)

Replace the logic that calculates `scoringKey` to simply use `qIndex`. The old logic tried to map back to the original index, which caused conflicts.

**Find this block:**

```typescript
    // 🔒 SCORING KEY RESOLUTION
    let scoringKey = qIndex;

    if (this.shouldShuffle() && this.quizId) {
      const originalIndex = this.quizShuffleService.toOriginalIndex(this.quizId, qIndex);
      if (typeof originalIndex === 'number' && originalIndex >= 0) {
        scoringKey = originalIndex;
      }
    }
```

**Replace it with this ONE line:**

```typescript
    // 🔒 SCORING KEY RESOLUTION (SIMPLIFIED)
    const scoringKey = qIndex; // Always use the unique display index
```

---
**Why this works:**
*   Step 1 ensures we don't accidentally "grade" a question while it's unloading (which often looks like an incorrect empty answer).
*   Step 2 ensures that Question 1 and Question 2 don't accidentally share the same score ID, which caused one to overwrite the other.
