<h1 align="center">🚀 Angular Quiz App</h1>

<p align="center">
A feature-rich quiz platform built with <strong>Angular 20</strong> that demonstrates
reactive state management with RxJS, modular Angular architecture,
and dynamic UI rendering.
</p>

<p align="center">
<img src="https://img.shields.io/badge/Angular-20-red">
<img src="https://img.shields.io/badge/TypeScript-Enabled-blue">
<img src="https://img.shields.io/badge/RxJS-Reactive-purple">
<img src="https://img.shields.io/badge/Status-Active%20Development-brightgreen">
</p>

<p align="center">
<a href="https://stackblitz.com/~/github.com/marvinrusinek/angular-20-quiz-app" target="_blank">
▶ Launch Live Demo
</a>
</p>

<hr>

<h2>💡 Why I Built This</h2>

<p>
This project was built to explore advanced Angular application design,
including reactive state management with RxJS, service-driven architecture,
and dynamic UI rendering patterns.
</p>

<p>
The goal was to create a quiz platform that functions both as an engaging
learning tool and as a demonstration of modern Angular engineering practices.
</p>

<p>
The application is currently being refactored to improve maintainability,
reduce component complexity, and further separate concerns across services
and UI layers. Ongoing work also includes preparing the codebase for
<strong>Angular Signals</strong> integration.
</p>

<hr>

<h2>🏆 Engineering Highlights</h2>

<ul>
<li>Built with <strong>Angular 20</strong>, <strong>TypeScript</strong>, and <strong>RxJS</strong></li>
<li>Implemented support for <strong>single-answer</strong> and <strong>multiple-answer</strong> quiz flows</li>
<li>Designed a reactive feedback and explanation system synchronized with quiz state</li>
<li>Integrated timer-driven quiz behavior and real-time score updates</li>
<li>Structured the application using modular, service-driven architecture</li>
<li>Designed with future <strong>Angular Signals</strong> adoption in mind</li>
</ul>

<hr>

<h2>✨ Core Features</h2>

<h3>🧠 Multiple Question Types</h3>
<p>
Supports both <strong>single-answer</strong> and <strong>multiple-answer</strong> questions,
each with independent selection logic and validation.
</p>

<h3>💡 Instant Feedback + Explanation Text</h3>
<p>
Provides immediate feedback and explanation text after answer selection,
turning the quiz into a learning experience.
</p>

<h3>⏱️ Timer-Based Quiz Flow</h3>
<p>
Each question can be timed, adding urgency and realism to the quiz experience.
</p>

<h3>📈 Live Score Tracking</h3>
<p>
Score updates dynamically as users progress through the quiz.
</p>

<h3>🔀 Shuffle Mode</h3>
<p>
Questions can be randomized while preserving accurate feedback
and explanation alignment.
</p>

<h3>📊 Results Summary</h3>
<p>
After completing the quiz, users can review their performance through
a structured results breakdown.
</p>

<hr>

<h2>🧭 Architecture Overview</h2>

<p>
The application follows a modular Angular architecture where container components
coordinate UI behavior and services manage state, logic, and data flow.
RxJS streams are used to synchronize state across the application.
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
[RxJS State Streams]
        ↓
[UI Updates]
Scoreboard / Feedback / Results
</code></pre>

<hr>

<h2>🛠️ Technology Stack</h2>

<ul>
<li><strong>Angular 20</strong></li>
<li><strong>TypeScript</strong></li>
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
<li>Angular Signals integration</li>
<li>Further modular refactoring</li>
<li>Improved mobile responsiveness and touch interactions</li>
<li>UI/UX enhancements</li>
<li>Expanded quiz content</li>
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
