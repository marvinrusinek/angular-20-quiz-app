<h1 align="center">🚀 Angular Quiz App</h1>

<p align="center">
A feature-rich quiz platform built with <strong>Angular 20</strong> that demonstrates
<strong>Signals-based state management</strong>, <strong>RxJS-powered reactive flows</strong>,
modular Angular architecture, and dynamic UI rendering.
</p>

<p align="center">
<img src="https://img.shields.io/badge/Angular-20-red">
<img src="https://img.shields.io/badge/TypeScript-Enabled-blue">
<img src="https://img.shields.io/badge/RxJS-Reactive-purple">
<img src="https://img.shields.io/badge/Signals-Integrated-orange">
<img src="https://img.shields.io/badge/Status-Active%20Development-brightgreen">
</p>

<p align="center">
<a href="https://stackblitz.com/~/github.com/marvinrusinek/angular-20-quiz-app" target="_blank">
▶ Launch Live Demo
</a>
</p>

<hr>

<h2>🎯 Goal / Purpose</h2>

<p>
This project explores advanced Angular application design through a real-world quiz platform
that combines <strong>Signals</strong>, <strong>RxJS</strong>, and a <strong>modular service-driven architecture</strong>.
</p>

<p>
It was built both as a practical learning project and as a demonstration of scalable frontend engineering patterns,
including dynamic UI rendering, reactive state synchronization, and maintainable application structure.
</p>

<p>
The app has been <strong>heavily refactored</strong> to reduce component complexity, improve separation of concerns,
and organize quiz behavior into focused services and UI layers.
</p>

<hr>

<h2>🏆 Engineering Highlights</h2>

<ul>
<li>Built with <strong>Angular 20</strong>, <strong>TypeScript</strong>, <strong>RxJS</strong>, and <strong>Angular Signals</strong></li>
<li>Supports <strong>single-answer</strong> and <strong>multiple-answer</strong> quiz flows with distinct interaction logic</li>
<li>Refactored large components into a more modular, service-oriented architecture</li>
<li>Combines <strong>Signals</strong> for local/reactive UI state and <strong>RxJS</strong> for async/event-driven flows</li>
<li>Implements timer-based quiz behavior, score tracking, feedback display, and explanation text handling</li>
<li>Designed to keep quiz logic, rendering, and state synchronization cleanly separated</li>
</ul>

<hr>

<h2>✨ Core Features</h2>

<h3>🧠 Multiple Question Types</h3>
<p>
Supports both <strong>single-answer</strong> and <strong>multiple-answer</strong> questions,
each with its own selection rules, validation flow, and feedback behavior.
</p>

<h3>💡 Feedback + Explanation Text</h3>
<p>
Displays immediate answer feedback and explanation text to make the quiz experience
more instructional and interactive.
</p>

<h3>⏱️ Timer-Based Quiz Flow</h3>
<p>
Includes timed question behavior to add urgency and simulate a more realistic quiz environment.
</p>

<h3>📈 Live Score Tracking</h3>
<p>
Updates the user’s score dynamically throughout the quiz experience.
</p>

<h3>🔀 Shuffle Mode</h3>
<p>
Supports randomized quiz/question flow while preserving consistent answer validation,
feedback, and explanation behavior.
</p>

<h3>📊 Results Summary</h3>
<p>
Provides a structured summary view so users can review performance after completing a quiz.
</p>

<hr>

<h2>🧭 Architecture Overview</h2>

<p>
The application follows a modular Angular architecture where container components coordinate UI behavior,
focused services manage quiz logic and state, and reactive primitives keep the interface synchronized.
</p>

<p>
It uses <strong>Angular Signals</strong> for direct reactive UI state and <strong>RxJS streams</strong> for asynchronous flows,
event coordination, and cross-component synchronization.
</p>

<h3>High-Level Flow</h3>

<pre><code>[User Interaction]
        ↓
[Container Components]
Introduction / Quiz / Results
        ↓
[Question + Answer Components]
        ↓
[Service Layer]
 ├── QuizService
 ├── QuizStateService
 ├── SelectedOptionService
 ├── ExplanationTextService
 ├── TimerService
 └── SelectionMessageService
        ↓
[Signals + RxJS State]
        ↓
[UI Updates]
Scoreboard / Feedback / Results
</code></pre>

<hr>

<h2>🛠️ Technology Stack</h2>

<ul>
<li><strong>Angular 20</strong></li>
<li><strong>TypeScript</strong></li>
<li><strong>Angular Signals</strong></li>
<li><strong>RxJS</strong></li>
<li><strong>Angular Material</strong></li>
<li><strong>SCSS</strong></li>
</ul>

<hr>

<h2>📁 Project Structure</h2>

<pre><code>src/
├── app/
│   ├── components/
│   ├── containers/
│   ├── shared/
│   │   ├── services/
│   │   ├── models/
│   │   └── utils/
│   ├── pipes/
│   ├── directives/
│   └── animations/
</code></pre>

<hr>

<h2>⚙️ Getting Started</h2>

<h3>Prerequisites</h3>

<ul>
<li>Node.js 18+</li>
<li>Angular CLI 20+</li>
</ul>

<h3>Installation</h3>

<pre><code>git clone https://github.com/marvinrusinek/angular-20-quiz-app.git
cd angular-20-quiz-app
npm install
</code></pre>

<h3>Run the App</h3>

<pre><code>ng serve</code></pre>

<p>Then open:</p>

<pre><code>http://localhost:4200</code></pre>

<hr>

<h2>🚧 Roadmap</h2>

<ul>
<li>Continue refining Signals usage across the application</li>
<li>Further reduce complexity in larger feature areas</li>
<li>Improve mobile responsiveness and touch interactions</li>
<li>Enhance UI/UX polish and animation consistency</li>
<li>Expand quiz content and results insights</li>
</ul>

<hr>

<h2>⭐ Support</h2>

<p>
If you find this project useful or interesting, consider giving it a ⭐ on GitHub.
</p>

<hr>

<h2>📄 License</h2>

<p>
Licensed under the <strong>MIT License</strong>.
</p>

<p>
See the <a href="./LICENSE">LICENSE</a> file for details.
</p>
