# RepoLens 🔭

> **Visual codebase explorer & architecture mapper — 100% local, nothing uploaded.**

RepoLens turns an unfamiliar repository into an interactive architecture map right inside your browser. Choose a local folder or drop a ZIP, then explore files, modules, imports, symbols, likely entry points, and an AI-style onboarding summary — without uploading a single line of source code.

![RepoLens – Architecture Canvas](https://img.shields.io/badge/RepoLens-Visual%20Codebase%20Explorer-6c63ff?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyQTEwIDEwIDAgMCAwIDIgMTJhMTAgMTAgMCAwIDAgMTAgMTAgMTAgMTAgMCAwIDAgMTAtMTBBMTAgMTAgMCAwIDAgMTIgMm0wIDJhOCA4IDAgMCAxIDggOCA4IDggMCAwIDEtOCA4IDggOCAwIDAgMS04LTggOCA4IDAgMCAxIDgtOG0wIDJhNiA2IDAgMCAwLTYgNiA2IDYgMCAwIDAgNiA2IDYgNiAwIDAgMCA2LTYgNiA2IDAgMCAwLTYtNnoiLz48L3N2Zz4=)
[![Node.js](https://img.shields.io/badge/Node.js-22.23.3-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## ✨ Features

- **📁 Local folder & ZIP import** — source files never leave your browser
- **🗺️ Interactive architecture canvas** — module, domain, API, function, sequence, and file views
- **🔍 Ranked command-palette search** — search files, symbols, entry points, modules, warnings, and relationships
- **📊 Architecture health dashboard** — dependency depth, cycle detection, hotspots, and large-module warnings
- **⚡ Entry-point detection** — ranked by runtime signals with confidence levels (High / Likely / Low)
- **🔗 Impact analysis** — direct and transitive dependent counts per node
- **🕰️ Snapshot diffing** — compare structural snapshots when a new repo index replaces the current one
- **📝 Exportable reports** — Markdown & JSON architecture reports; JSON, SVG, and PNG map exports
- **🌿 Git context** — reads `.git` metadata (branch, HEAD, remote, recent commits) from imported repos
- **💾 Saved projects & views** — reopen recent repos, save custom map layouts, and annotate nodes
- **🔄 Undo / redo** — bounded local history for layout, lock, and mode changes
- **🚀 Large-repo mode** — background-worker analysis with progressive + incremental rendering
- **⌨️ Keyboard-first** — full command palette and keyboard shortcuts throughout

### Language Support

Primary: **JavaScript / TypeScript**
Fallbacks: Python, Go, Rust, Java, C#, PHP, Kotlin, Swift, C, C++

The graph model is language-agnostic — additional parser adapters can be added without touching the UI.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** `22.23.3` (version pinned in [`.nvmrc`](.nvmrc))
- **npm** 10+

If you use nvm:
```bash
nvm install   # reads .nvmrc automatically
nvm use
```

### Install & run

```bash
# 1. Clone the repo
git clone https://github.com/<your-username>/RepoLens.git
cd RepoLens

# 2. Install dependencies
npm ci

# 3. Start the dev server
npm run dev
```

Open the local URL printed by Vite. RepoLens launches with a repository picker — choose a local folder or ZIP.

> **Privacy note:** Source files stay entirely in the browser. No data is sent to any server.

---

## 🧪 Testing & Building

The single offline verification command runs TypeScript type-checking, the full Vitest suite, and a production build:

```bash
npm run check
```

If GNU Make is installed, `make test` is an equivalent convenience command.

Individual commands:

```bash
npm run typecheck         # TypeScript validation only
npm run test -- --run     # Vitest suite (single run, no watch)
npm run build             # Production bundle to dist/
npm run preview           # Preview the production build
npm run benchmark:map     # Large-map graph benchmark (2,000 nodes / 24,000 edges)
```

> After `npm ci`, `npm run check` runs fully offline — no network access needed.

---

## 🐳 Docker

Build and run the production preview in a container:

```bash
docker build -t repolens .
docker run --rm -p 4173:4173 repolens
```

Then open <http://localhost:4173>.

---

## 🪟 Windows desktop app

RepoLens can also be distributed as a Windows desktop application powered by Tauri. The desktop app keeps the same local-only behavior: repositories are selected from the user's computer and analyzed in the app window. It uses the Windows WebView2 runtime instead of bundling a second browser engine, with a custom RepoLens title bar rather than the default native frame.

### Run the Tauri desktop shell locally

Desktop development additionally requires Rust `1.90+` and the Windows WebView2 runtime.

```bash
npm ci
npm run desktop
```

### Build the Windows installer EXE

Run this on Windows:

```bash
npm ci
npm run desktop:package
```

The installer is written under `src-tauri/target/release/bundle/nsis/` as `RepoLens_<version>_x64-setup.exe`. It installs the local desktop app and does not upload repository source files. Code signing is not configured, so Windows may show its normal SmartScreen warning for locally built installers.

### Web version

The browser version remains a separate static build for Render or another static host:

```bash
npm ci
npm run build
npm run preview
```

Deploy the generated `dist/` directory as the web version. Users can choose the browser version or install the Tauri desktop app.

---

## 🏗️ Project Structure

```
RepoLens/
├── src/
│   ├── App.tsx                          # Root shell, navigation, dialogs
│   ├── InteractiveArchitectureCanvas.tsx # Main canvas with XY Flow
│   ├── ArchitectureWorkspace.tsx        # Workspace layout
│   ├── analyzer.ts                      # Repository analysis engine
│   ├── analyzer.worker.ts               # Web Worker wrapper for large repos
│   ├── architectureLenses.ts            # Module/domain/API/function/sequence views
│   ├── canvasLayout.ts                  # Layout persistence + undo/redo
│   ├── snapshotStore.ts                 # Structural snapshot persistence
│   ├── snapshotDiff.ts                  # Snapshot comparison engine
│   ├── search.ts                        # Command-palette search index
│   ├── mapFeatures.ts                   # Node features, hotspots, isolates
│   ├── mapExport.ts                     # JSON / SVG / PNG export
│   ├── impactAnalysis.ts                # Transitive dependent counts
│   ├── healthDashboard.ts               # Architecture health scoring
│   ├── gitMetadata.ts                   # .git metadata extraction
│   ├── projects.ts                      # Saved projects persistence
│   ├── savedViews.ts                    # Saved map views
│   ├── annotations.ts                   # Per-node annotations
│   ├── repositoryHistory.ts             # Recent repositories list
│   ├── dependencyReport.ts              # Per-node dependency reports
│   ├── architectureReport.ts            # Full-repo Markdown/JSON reports
│   ├── onboarding.ts                    # First-run onboarding state
│   ├── sampleRepository.ts              # Built-in demo repository data
│   ├── types.ts                         # Shared TypeScript types
│   └── styles.css                       # Complete UI stylesheet
├── index.html                           # App entry point
├── src-tauri/                            # Tauri desktop shell and Windows bundle
├── vite.config.ts                       # Vite configuration
├── vitest.config.ts                     # Vitest configuration
├── tsconfig.json                        # TypeScript root config
├── Dockerfile                           # Production container
├── Makefile                             # Convenience commands
└── .nvmrc                               # Node.js version pin
```

---

## 🛠️ Development Notes

- **State**: All persistent state uses `localStorage` under the `repolens:` namespace.
- **No backend**: The app is entirely client-side. There is no API server, database, or authentication.
- **Build tool**: [Vite](https://vitejs.dev/) with the React plugin and `tsc -b` for type-checking.
- **Test runner**: [Vitest](https://vitest.dev/) with `@testing-library/react`.
- **Graph library**: [@xyflow/react](https://reactflow.dev/) for the interactive canvas.

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes and add tests if applicable
4. Run `make test` to ensure everything passes
5. Open a pull request describing your changes

---

## 📄 License

MIT © 2026 — See [LICENSE](LICENSE) for details.
