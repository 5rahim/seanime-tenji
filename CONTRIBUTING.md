# Seanime Tenji Contribution Guide

Contributions to Seanime Tenji are welcome. This guide outlines how to set up the repository for local development, run the application, and submit code changes.

---

## Local Setup

### System Prerequisites

To build and run Seanime Tenji, ensure your machine has the following tools installed:

* **Node.js** 22.13 or newer, or 24.3 or newer (required by Expo SDK 58)
* **npm** (for dependency management)
* **JDK** (for compiling Android native binaries)
* **Android Studio & Android SDK** (for Android emulator testing)
* **Xcode** (for iOS simulator or device builds; macOS required)

### Step-by-Step Installation

1. Clone the codebase:
   ```bash
   git clone https://github.com/5rahim/seanime-tenji.git
   cd seanime-tenji
   ```
2. Install npm packages:
   ```bash
   npm install
   ```

---

## Development Workflow

Seanime Tenji is built using Expo and React Native.

### Starting Metro

Metro is the JavaScript bundler for React Native. To start it, run:

```bash
npm run dev:start
```

### Developing on Android

To compile and run the debug application on a connected Android device or emulator:

```bash
npx expo run:android
```

### Developing on iOS

To compile and run the debug application on an iOS simulator:

```bash
npm run dev:ios
```

---

## Code Quality Standards

Before submitting a Pull Request, verify that your code conforms to these standards:

1. **TypeScript Strictness**: Write strictly typed code. Avoid using `any` and verify type definitions. Validate your changes pass TypeScript compilation:
   ```bash
   npx tsc --noEmit
   ```
2. **Styling and Layout**: We use Tailwind CSS v4 and `uniwind` for universal styling. Please leverage the existing layout utility tokens and spacing variables to maintain visual consistency.
3. **Cross-Platform Verification**: Verify that your interface looks correct and functions properly on both iOS and Android.

---

## Pull Request Submission

### Submission Checklist

1. Create a focused feature branch from the latest default branch.
2. Ensure your changes address a single feature or bug fix to simplify review.
3. Verify that the TypeScript compilation passes successfully.
4. Provide a clear description of the modification in the Pull Request, attaching screenshots or screen recordings for UI-related changes.

### AI Usage Guidelines

> [!IMPORTANT]
> If you used generative AI tools (such as Claude, ChatGPT, Cursor, or similar services) to assist in writing, refactoring, or documenting your code contribution, you must disclose this usage in your
> Pull Request description.

Please state:

* Which AI tools were utilized.
* The specific scope of their assistance (e.g., "AI assisted with writing TypeScript definitions", "Used Claude to generate helper utility functions", or "Used Cursor to help build the UI layout").

All contributors are fully responsible for the correctness, stability, and security of their submitted code, regardless of whether AI tools were used. All code must be validated and tested before
submission.
