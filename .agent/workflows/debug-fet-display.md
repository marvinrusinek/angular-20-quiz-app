---
description: Debug FET (Formatted Explanation Text) not displaying after answering questions
---

# FET Display Issue - Debug Guide

## Current Status (as of 2026-01-16)

### ✅ WORKING:
- Multi-answer banner "(X answers are correct)" displays correctly for both UNSHUFFLED and SHUFFLED quizzes

### ❌ NOT WORKING:
- FET (Formatted Explanation Text) does NOT display in the question box after answering a question
- The question text remains static instead of changing to the explanation text

## Root Cause Analysis

The browser testing confirmed:
1. `displayText$` observable **IS correctly emitting the FET** (verified via manual JS subscription)
2. `[subscribeToDisplayText]` console logs were **NOT appearing** 
3. The `h3.innerHTML` is **NOT being updated** despite the observable emitting

This indicates the subscription in `subscribeToDisplayText()` is either:
- Not receiving emissions (blocked by filters in the pipeline)
- Being cancelled before the FET emission arrives
- Or the `currentMode !== 'explanation'` condition is failing

## Key Files to Debug

### Primary File:
`src/app/containers/quiz/quiz-content/codelab-quiz-content.component.ts`

### Key Methods:
1. **`initDisplayTextPipeline()`** (lines ~396-580) - Creates the `displayText$` observable
2. **`subscribeToDisplayText()`** (lines ~595-627) - Subscribes and updates innerHTML
3. **FET display logic** (lines ~510-580) - Decides when to show FET vs question text

## Debug Steps

// turbo-all

### Step 1: Restart dev server to pick up latest changes
```bash
cd c:\Users\marvi\OneDrive\Desktop\angular-20-quiz-app
# Stop any running ng serve (Ctrl+C)
ng serve
```

### Step 2: Open browser console and navigate to quiz
1. Go to http://localhost:4200/quiz/question/dependency-injection/1
2. Open DevTools (F12) → Console tab
3. Filter console by "[subscribeToDisplayText]"

### Step 3: Look for these console logs
After page loads, you should see:
```
[subscribeToDisplayText] 🔄 Setting up subscription...
[subscribeToDisplayText] ✅ Subscription active
[subscribeToDisplayText] 🔔 RAW emission (XX chars): "..."
```

### Step 4: Answer a question and watch logs
Click an answer option and look for:
```
[displayText$] 📋 Q1 FET CHECK: isAnswered=true, currentMode=explanation
[subscribeToDisplayText] 🔔 RAW emission (XX chars): "Option X is correct..."
[subscribeToDisplayText] 📝 Processing text (XX chars)
[subscribeToDisplayText] ✅ Updated innerHTML to: "Option X is correct..."
```

### Step 5: If logs DON'T appear, check these conditions in the code

In `initDisplayTextPipeline()`, the FET is only shown when:
```typescript
const shouldShowFet = isAnswered && currentMode === 'explanation';
```

Verify:
- `isAnswered` returns true after answering (from `this.quizService.isAnswered(safeIdx)`)
- `currentMode` is 'explanation' (from `this.quizStateService.displayState$`)

## Key Code Locations with Logging

### Line ~512-516 (FET condition check):
```typescript
const currentMode = state?.mode || this.quizStateService.displayStateSubject.getValue().mode;
console.log(`[displayText$] 📋 Q${safeIdx+1} FET CHECK: isAnswered=${isAnswered}, currentMode=${currentMode}`);
const shouldShowFet = isAnswered && currentMode === 'explanation';
```

### Line ~601-627 (Subscription):
```typescript
console.log('[subscribeToDisplayText] 🔄 Setting up subscription...');
// ... subscription code with tap() logging
console.log('[subscribeToDisplayText] ✅ Subscription active');
```

## Suspected Issues

1. **displayState$ not changing to 'explanation' mode** when an answer is selected
   - Check: `this.quizStateService.setDisplayState({ mode: 'explanation', answered: true })` is called

2. **isAnswered returning false** even after answering
   - Check: `this.quizService.isAnswered(index)` logic

3. **Filters in combineLatest pipeline** blocking emissions
   - The filter at line ~419-433 waits for questions to be available
   - The filter at line ~420 checks `idx === this.currentIndex`

## Quick Fix Attempt

If the issue is `currentMode` not changing to 'explanation', search for where `setDisplayState` is called with `mode: 'explanation'` and ensure it's triggered after answer selection.

Search: `setDisplayState.*explanation`
