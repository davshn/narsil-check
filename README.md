# Narsil Check

<p align="center">
  <img src="assets/readme/searching-claro.svg" width="150" alt="Narsil checking the project (light mode)">
  <img src="assets/readme/searching-oscuro.svg" width="150" alt="Narsil checking the project (dark mode)">
</p>

> **Narsil Workshop · [narsil.davshn.tech](https://narsil.davshn.tech)**
>
> A free workshop, in English, Spanish, Italian, French, and Brazilian Portuguese, that teaches step by step how to build Claude Code mods like [Narsil](https://github.com/davshn/narsil-pet) and Narsil Check, and how to build a Narsil desk bot with a body: an ESP32-P4 touch screen in the belly and a holographic ESP32-S3 head, which talks through Xiaozhi and Claude on your own server and shows your GitHub pull requests and the Narsil status. No sign-up, no analytics, and it never asks for tokens or keys.

Narsil Check is the companion of [Narsil](https://github.com/davshn/narsil-pet): a side pane, in her same colors, that checks the project you are working on. It shows an animated map of what Claude is doing, the session environment (repository, folder, branch, connectors, remote control, and Auto-fix), which libraries can be upgraded and how much effort it takes, which known vulnerabilities the installed packages have, and a list of the project's pending tasks. With it you can hide the desktop app's session bar and keep a single pane.

It reads JavaScript and TypeScript (npm and Expo), Python (PyPI), Go, Rust (Cargo), Dart or Flutter (Pub), Kotlin and Java (Gradle and Maven), C# (NuGet), Ruby (RubyGems), and Swift (SwiftPM) projects.

It is an **open source** Claude Code mod, released under the [GPL v3](#license) license.

> **Language note:** the pane's labels and messages are in Spanish. This README keeps them as they appear on screen, with their English meaning next to them the first time they show up.

## Contents

- [Features](#features)
- [Ecosystems](#ecosystems)
- [Installation](#installation)
- [Commands](#commands)
- [Supported systems](#supported-systems)
- [Development](#development)
- [License](#license)

## Features

### The pane
The pane opens when each session starts, even if there is nothing to check. At the top, centered, is the title **● Narsil Check**, and then each check as a section that collapses and expands with its header (`▾ Actualizaciones · 3` / `▸ Actualizaciones · 3`). Each section's colored dot shows the most urgent thing in it, with Narsil's palette: red if something is blocking or failing, yellow if something is waiting for you, green if it is up to date, and blue for information.

Every session starts the same way: **Mapa mental** (work map) and **Entorno** (environment) expanded, **Conectores** (connectors) collapsed, and **Actualizaciones** (upgrades), **Vulnerabilidades** (vulnerabilities), and **Pendientes** (pending tasks) collapsed until they have something, at which point they expand on their own.

Inside **Actualizaciones** and **Vulnerabilidades**, each group (**Bloqueada** (blocked), **Versión mayor** (major version), **Crítica** (critical), **Alta** (high)...) also collapses with its own header (`▾ Bloqueada (2)` / `▸ Bloqueada (2)`), and the pane remembers which ones you closed. A click on a library or a vulnerability copies it to the clipboard: the library with its jump and what blocks it or Haiku's reasoning, and the vulnerability with its severity, the fix, and the OSV link.

At the bottom of the pane, **Actualizar rama** (update branch) runs `git pull -r` on your current branch: it brings in what is new on the remote and puts your local commits back on top. If git cannot do it (a conflict or uncommitted changes), it says so and shows the reason. The mod runs it directly, without going through the app's permissions, and then checks the libraries again.

Each library check (when the session opens, with **Revisar de nuevo** (check again), or with `/narsil-check upgrade`) also runs `git fetch` and counts the commits your branch's remote has and you do not. If you are missing any, a red warning appears at the very top, *"⚠ La rama feat/login está 3 commits detrás de su remota: actualízala antes de seguir."* (*the branch feat/login is 3 commits behind its remote: update it before continuing*), with its own **Actualizar rama** button. With no remote branch, no network, or a detached `HEAD`, nothing is shown. After a successful pull it checks again and the warning goes away.

### Work map
The first section, **Mapa mental**, is an animated map of Claude's work in the session, with baby Narsil in the center (in her light or dark version, depending on the app theme). Around her are ten stations: **Tú** (you), **Modelo** (model), **Memoria** (memory), **Archivos** (files), **Terminal**, **Red** (network), **Navegador** (browser), **Agentes** (agents), **Skills**, and **Hooks**. Each tool call leaves Narsil as a pulse toward its station, which lights up while it works and shows how many times it was used.

- **The spokes** thicken with use, and **the route** joins the last stations visited and fades over time.
- **Two clock hands** around a station show how long a long call has been running.
- **A red dot** marks an error or a hook rejection, until your next message.
- **A ring** around Narsil shows how much context is left: amber at 70 % and red at 90 %. The model and the percentage appear below.
- **Subagents** that are still working orbit **Agentes**.
- **A background task** (a command, a monitor, or an agent launched separately) stays lit until it reports that it finished. If it does not report within an hour, it is considered closed at the end of the turn.

The map never makes a tool wait: it records each call while it runs. The pane redraws it at most every 400 ms, so a burst of calls is a single redraw.

The section's dot is blue while something is working, red if something failed, and green at rest. The map only uses names: for a file, the last two parts of the path; for a website, the domain; for a command, its description or its name. It never shows what is written, searched, or saved to memory. The terminal does not draw images, so the section does not appear there.

The map comes from [lot-map](https://github.com/alexeyw/lot-map), by Aleksei Volodin (MIT license), adapted to Narsil's colors.

### Environment
What the desktop app's session bar shows, so you can hide it:

| Row | What it shows | On click |
| --- | --- | --- |
| **Repositorio** (repository) | The web address of the `origin` remote (`github.com/davshn/narsil-check`), whether SSH or HTTPS. | Opens it in the browser. |
| **Carpeta** (folder) | The session's working folder. | Opens the folder picker and moves the session to the one you choose. |
| **Rama** (branch) | The current git branch. | Opens a terminal tab in the working folder. |
| **Control remoto** (remote control) | A switch: `●━━ desactivado` (off) in gray, `━━● activado` (on) in green. | Turns it on or off. |
| **CI** | Only with an open PR: the GitHub Actions steps of the last commit on its branch (`✓ Lint`, `◐ Typecheck`, `○ Build`, `✗` if it failed), without GitHub's internal steps (`Set up job`, `Post …`). The line sums up the progress: `CI · 2/4 · Typecheck`, `CI · pasó` (passed), `CI · falló` (failed), or `esperando el CI del último push` (waiting for the CI of the last push) if the branch has a commit no run has picked up yet. While it runs, it is read again every 10 seconds with `gh`, and reading stops when it finishes. | Collapses or expands the steps; it stays as you left it. |
| **Auto-fix** | The same kind of switch for the session's open PR: with it on, the app wakes Claude up when CI fails, there is a conflict, or a review comment arrives. With no open PR it says `sin PR abierto` (no open PR). | Turns it on or off; the app may ask you for permission first. |

### Connectors
The session's MCP servers: first the connected ones, with how many tools each has (`engram · 19 herramientas`, *19 tools*), and then the rest with their status (`Gmail · needs_auth`).

Environment, Connectors, and remote control are read from the desktop app's own MCP servers. When the session starts, the pane shows "Leyendo la sesión…" (*reading the session…*) and asks them only once, after ten seconds. If the app receives a call before it confirms which server offers the tool, it asks for permission even in bypass permissions mode. If that read fails, it is repeated when your first turn starts, without quick retries. At the end of each turn it reads the folder and the branch again with git, so a branch that changed during the turn shows up without you doing anything. It only asks the app's servers again if the turn used a tool that changes their answer (remote control, worktree, folder, connectors, or the session's PR, including a `gh pr` or a `git push` in the terminal) or if the previous read failed. The app may link the PR after the turn that opened it ends: if no PR shows up yet after a `gh pr` or a `git push`, the pane asks again only about the PR at 5, 15, and 30 seconds, and stops as soon as it finds it or when the session ends (also with `/clear`). Opening each dropdown reads everything again. Each question to those servers reaches the other mods as a tool call, which is why there are few of them.

### Upgrades
Outdated libraries, in four groups:

| Group | When | What to do |
| --- | --- | --- |
| **Fuera del SDK de Expo** (outside the Expo SDK) | The installed version does not meet the range set by the project's Expo SDK. | `npx expo install --fix` |
| **Bloqueada** (blocked) | Something prevents upgrading it on its own: a dependency that does not accept it, a compiler plugin tied to the current version, a comment that pins it on purpose, or a version published less than 24 hours ago. The reason appears below. | Resolve what blocks it first. |
| **Versión mayor** (major version) | There is a new major version (or a minor jump below 1.0.0). | Read the changes: they may break the API. |
| **Solo subir la versión** (just bump the version) | There is a new patch or minor. | Bump the version. |

Libraries that are up to date do not appear. In an Expo project, a library the SDK pins is not offered for upgrade even if npm has a newer version: it is upgraded together with the SDK.

Versions come from each ecosystem's registry, not from a model. Each answer is cached for 6 hours, and the **Revisar de nuevo** button forces a new query. If the project uses more than one ecosystem, each library shows its own next to it (`zod 3.22.4 → 3.25.1 · npm`).

### Dependencies that block each other
npm only. Before classifying an upgrade, the pane runs three checks with data from the registry, `node_modules`, and `package-lock.json`, without using a model:

- **What the new version requires**: if `eslint-plugin-astro` 3.2.1 needs `eslint >=10.0.0` and you have eslint 9, it cannot be upgraded on its own.
- **What the installed packages require**: if `eslint-config-love` requires `eslint ^9.35.0`, eslint 10 cannot be upgraded on its own. It is read from `node_modules`; if you have not installed yet (a freshly cloned repository or one created from a template), from `package-lock.json` or `pnpm-lock.yaml`, so the result is the same before and after installing.
- **Versions pinned in the tree**: if an installed package, even one you do not declare, pins the library to an exact version, upgrading it would leave two copies. For example, `typescript-eslint` 8.71.0 pins `@typescript-eslint/parser` 8.71.0: upgrading the parser to 8.72.1 makes ESLint load the plugin twice ("Cannot redefine plugin"). It does not count if the package that pins it is upgraded in the same batch to the same version, like the `@tailwindcss/*` family with `tailwindcss`. A range that is not an exact version (`^8.53.0`) is not flagged: a nested copy there is usually harmless. This check uses `package-lock.json`, so it is not done with yarn, pnpm, or bun.

Any upgrade with a conflict, whether patch, minor, or major, goes to the **Bloqueada** group, with each conflict written below, and the **Actualizar las N** (update the N) button never includes it. A peer the project does not have installed does not count as a conflict: npm adds it. Conflicts are compared with the versions installed now; if you upgrade several together, the block may resolve between them.

### 24-hour wait
In every ecosystem, a version published less than 24 hours ago goes to **Bloqueada**, for example with *"Publicada hace 3 h: Narsil Check espera 24 h antes de subirla"* (*published 3 h ago: Narsil Check waits 24 h before upgrading it*). That way a freshly published version, which nobody has tested yet or which may come from a compromised account, does not get into the project on its own. The date comes from each ecosystem's registry:

| Ecosystem | Where the date comes from |
| --- | --- |
| npm and Expo | `time` from the npm registry; if it does not arrive (~10 MB packages like astro), `pnpm view` or `npm view` |
| PyPI | the first file uploaded for that version |
| Go | `Time` from the Go proxy |
| Cargo | `created_at` from crates.io |
| Pub | `published` from pub.dev |
| NuGet | `published` from the NuGet registry (the SemVer 1 one, and if it is not there, the SemVer 2 one) |
| RubyGems | `created_at` from rubygems.org |
| Gradle and Maven | the POM's date (`Last-Modified`) on Maven Central, Google Maven, or the Gradle Plugin Portal |
| SwiftPM | when GitHub published the release for that tag. It is a date set by GitHub, not the commit's, which the author could fake |

There are no exceptions: nothing gets upgraded without proof that it waited. When the date cannot be read (a tag with no release, a Swift package outside GitHub, a registry that does not respond), the proof is **when the pane first saw that version**: a version is never newer than the moment it appeared, so 24 hours later it has been published for at least a day. Meanwhile it stays blocked with *"No pude leer cuándo se publicó y la vi por primera vez hace 3 h: Narsil Check espera 24 h antes de subirla"* (*I could not read when it was published and first saw it 3 h ago*). That way a library with no date is never blocked forever. An answer that is not a date is never cached, so the next scan asks again. When the version reaches one day, it stops being blocked on the next scan.

In an Expo project, a library the SDK pins is upgraded with `npx expo install --fix`, which installs the newest version that meets the SDK's range. That version also waits the day, or pnpm's `minimumReleaseAge` if it is longer; meanwhile the library goes to **Bloqueada** with the version and the command: *"El SDK de Expo pide 17.0.8 (npx expo install --fix). Publicada hace 1 h: …"* (*the Expo SDK asks for 17.0.8*).

In a pnpm project, its `minimumReleaseAge` also counts if it is longer than a day, with the notice *"pnpm espera 48 h para instalarla (minimumReleaseAge)"* (*pnpm waits 48 h to install it*). If it were installed earlier, the CI's `pnpm install --frozen-lockfile` would reject it. The value is read from `pnpm-workspace.yaml` (or from `minimum-release-age` in `.npmrc`) as it is at `HEAD`, because that is what CI sees. A value shorter than a day does not lower the wait. `minimumReleaseAgeExclude` is ignored, whether at `HEAD` or uncommitted.

The wait also covers the dependencies an upgrade pulls in, where the tool allows it:

- **pnpm** installs with `minimumReleaseAge` in strict mode and with no exceptions. A dependency that is too new makes the install fail instead of ending up in the lockfile with an exception written in `pnpm-workspace.yaml`. The pane marks it as *"Bloqueada por minimumReleaseAge"* (*blocked by minimumReleaseAge*) with the versions pnpm rejected, and nothing is upgraded.
- **npm** installs with `before` set one day back, so each range resolves to versions at least one day old. If a range has none, the pane marks it as *"Bloqueada por la espera de 24 h"* (*blocked by the 24 h wait*) and nothing is upgraded.
- **yarn, bun, Cargo, Go, uv, Poetry, Pub, NuGet, Bundler, SwiftPM, Gradle, and Maven** have no such option, so the wait applies to the library being upgraded, not to what it pulls in.

### Versions pinned on purpose
In any ecosystem whose manifest allows comments (all but npm, whose `package.json` has none), a library is blocked if a comment says it is kept on purpose, on its version's line or the line above. The words that count are *pin*, *pinned*, *hold*, *keep*, *freeze*, *do not upgrade* and, in Spanish, *fijar*, *fijado*, *congelado*, or *no actualizar*. The pane shows the comment as the reason:

```toml
[versions]
# Fijar 2.4.20 hasta confirmar soporte de SKIE para 2.4.21
kotlin = "2.4.20"
ktor = "3.6.1" # pinned: 3.7 breaks auth
```

### Kotlin and compiler plugins
A Kotlin compiler plugin only works with the Kotlin versions it was published for: if they do not match, the project does not compile (with SKIE, the iOS framework). That is why, if the project declares one, Kotlin goes to **Bloqueada** even if the jump is a patch, for example with *"SKIE 0.10.16 es un plugin del compilador de Kotlin: confirma que soporta Kotlin 2.4.21"* (*SKIE 0.10.16 is a Kotlin compiler plugin: confirm it supports Kotlin 2.4.21*). SKIE, KSP, Mokkery, Realm, Metro, kotlinx-rpc, and Anvil are recognized, by their coordinates or by their catalog key (`mokkery = "3.6.0"` counts even if only a `build-logic` module reads it). KSP is checked exactly: its version contains the Kotlin version it was made for (`2.4.20-1.0.30`), and a KSP2 version without Kotlin in its name (`2.3.0`) works with any of them. The `kotlinx` libraries (coroutines, serialization) do not count as Kotlin: they are upgraded on their own.

### Gradle, AGP, Kotlin, and Compose Multiplatform
In an Android or Kotlin Multiplatform project, these tools depend on each other, just as Expo modules depend on the SDK. Upgrading only one can break the build, so it goes to **Bloqueada** when the other does not reach the minimum:

| Upgrade | Needs | Source |
| --- | --- | --- |
| Android Gradle Plugin | that AGP's minimum Gradle version, compared with the one set by `gradle/wrapper/gradle-wrapper.properties` (or `android/gradle/wrapper/…` in React Native). Example: *"AGP 8.13.0 necesita Gradle 8.13 o más; el wrapper usa 8.11.1"* (*AGP 8.13.0 needs Gradle 8.13 or later; the wrapper uses 8.11.1*) | [Google](https://developer.android.com/build/releases/about-agp) |
| AGP 9, from 8.x | that no module combines `org.jetbrains.kotlin.multiplatform` with `com.android.library` or `com.android.application` (they move to `com.android.kotlin.multiplatform.library`) and that kapt is not used | [Google](https://developer.android.com/build/migrate-to-built-in-kotlin) |
| Kotlin | the minimum AGP and Gradle of its Gradle plugin (Kotlin 2.4 needs AGP 8.5.2) | [JetBrains](https://kotlinlang.org/docs/gradle-configure-project.html) |
| Compose Multiplatform | the minimum Kotlin for iOS and web (1.10 needs Kotlin 2.2, 1.11 and 1.12 need 2.3) and AGP 8.1 from 1.7 | [JetBrains](https://github.com/JetBrains/compose-multiplatform/blob/master/CHANGELOG.md) |
| KSP 2.3.12 or later | AGP 8.12.0 | [KSP](https://github.com/google/ksp/releases) |

Only the minimums are checked. The maximums JetBrains publishes are what has full support, not a failure, and Google itself combines versions that exceed them. An AGP or Compose Multiplatform version newer than the tables the pane knows is also blocked, with *"confirma qué Gradle necesita"* (*confirm which Gradle it needs*). The same happens with an AGP upgrade when the project has no Gradle wrapper. The wrapper is only read: it never goes into the PR's commit.

### Why a major version is not trivial
Under each library with a major version, the pane shows the difficulty (low, medium, or high) and the reason, in one or two sentences. For that, Haiku receives:

- **The notes of the breaking versions**: the GitHub release of each new major version (up to three), searched as `v19.0.0`, `@scope/name@19.0.0`, or `19.0.0`. If there is no release, the package's `CHANGELOG.md` from the installed version on is used.
- **How your project uses the library**: the files and lines that import it, found with `git grep`.

It is asked to rely only on that and not to make up changes. The reason for each jump (for example, `react 18.2.0 → 19.2.0`) is requested once and cached; it is not requested again in other sessions. A click on a major version copies it with its difficulty and reason, and one on a blocked version, with what blocks it.

GitHub's API without a session allows 60 queries per hour. If they run out, the analysis uses the `CHANGELOG.md` or says it found no notes.

### Upgrading the trivial ones
The **Solo subir la versión** group has a button that upgrades all its libraries at once, each ecosystem with its own tool (see [Ecosystems](#ecosystems)). Each library keeps its range operator (`^3.22.0` becomes `^3.25.1`, `>=2.31,<3` becomes `>=2.34.2,<3`) and its section. Major versions and Expo ones are not touched: they need a review. If the install fails, the pane shows the end of the error. After upgrading, run the tests before committing.

### Creating the PR
When the manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pubspec.yaml`...) have dependency ranges different from those at `HEAD`, the pane lists them with a button to push them, whether the pane upgraded them or you did it by hand. What the button does depends on your current branch:

- **On a work branch** (**Commit y push a &lt;rama&gt;**, *commit and push to &lt;branch&gt;*): it commits and pushes to that same branch, and nothing else. You manage the PR.
- **On the main branch** (**Crear rama, commit y PR**, *create branch, commit, and PR*), the one `origin/HEAD` points to or, if there is none, `main` or `master`:
  1. Creates the `chore/upgrade-deps-YYYY-MM-DD` branch. If that name already exists, it adds the time.
  2. Commits and pushes the branch to `origin`.
  3. Opens the PR with `gh` against the main branch.
  4. Goes back to the main branch (`git switch`) and checks the libraries again. There the manifests have the old versions and what is installed (`node_modules`) may have the new ones: reinstall if you will keep working on the main branch. If git cannot switch branches, you stay on the new one and the pane says why.

In both cases, the commit only contains the manifests and lockfiles of the ecosystems that changed, with the message `chore(deps): upgrade N dependencies` and the list of changes. The rest of your uncommitted changes are not included. Claude Code runs git with the repository's hooks disabled, so commit hooks (for example, husky) do not run.

### Vulnerabilities
The **Vulnerabilidades** section lists the known vulnerabilities of the project's packages according to [OSV.dev](https://osv.dev), the open database that gathers the advisories from GitHub (the same ones as `npm audit`), PyPI, Go, crates.io, RubyGems, and the rest. A single query covers all nine ecosystems, without installing `pnpm audit`, `pip-audit`, `cargo-audit`, or `govulncheck`.

- **What is checked**: the whole installed tree wherever a lockfile records it (`package-lock.json`, `Cargo.lock`, `uv.lock` or `poetry.lock`, `Gemfile.lock`, `pubspec.lock`, `Package.resolved`, and the `require` entries in `go.mod`, including indirect ones); in Maven and NuGet, the declared dependencies. A package you do not declare yourself is marked *indirecta* (indirect).
- **Severity**: the advisory's own (Crítica, Alta, Moderada, Baja: critical, high, moderate, low) and, if it has none, the one given by its CVSS v3 vector score. With neither, *Sin clasificar* (unclassified). The same problem with two identifiers (GHSA and PYSEC) counts once.
- **Each advisory** shows the package and its version, its identifier, the summary, and the first version that fixes it.
- **Copy**: a click on an advisory puts it on the clipboard with its severity, the fix, and the OSV link.
- **With Upgrades**: if the upgrade the pane offers fixes vulnerabilities, the row says so in red (`lodash 4.17.20 → 4.17.21 · corrige 2 vulnerabilidades`, *fixes 2 vulnerabilities*) and moves to the top of its group.
- **When**: after each upgrade check (when the session opens, with the button, or with the command), with its own **Consultar de nuevo** (query again) button, and with `/narsil-check vulns`. Each advisory's details are cached and only requested again when OSV says they changed.

The number of vulnerabilities is the number of advisories, not of packages: `npm audit` also counts the packages that only depend on a vulnerable one, which are not repeated here.

### Pending tasks
A project task list to jot down what comes to mind while you work on something else. Each task has a name and, if you want, a body:

```
▾ Pendientes · 2
  ○ ▾ Subir TypeScript a 7.0.0
       En narsil-check hubo que cambiar moduleResolution a bundler…
  ○ Revisar el README
  [ Nueva tarea (nombre: contenido) ]
```

- **Add**: type in the field and press Enter. What comes after the first colon is the body (`Upgrade TypeScript: check the types`); with no colon, the task only has a name.
- **Read**: a click on the name shows or hides the body. A task with no body does not expand.
- **Finish**: a click on `○` removes it from the list. No history of finished tasks is kept.
- **With Claude**: Claude has its own tools to list, add, and finish tasks (`todo_list`, `todo_add`, `todo_done`). Ask it "add to pending tasks…" or "do the task about…", and it checks the task off itself when it is done. It does not read them on every message, so they use no context until it uses them.

The list is saved in `.atl/narsil-check/pendientes.json`, inside the project. The first time, the pane adds that folder to `.git/info/exclude`, git's local list of ignored files: it never goes into a commit and does not touch your `.gitignore`. If that file cannot be written, the task is saved anyway.

It is read when the session starts and written with each change. Within a session, changes go one at a time and each one reads the file again right before writing it, so you can add or finish tasks while Claude works, and a task another session saved earlier is not lost. What is not protected is two sessions of the same project writing at the very same moment: then the last change may overwrite the other.

If the file gets corrupted (for example, after editing it by hand with a mistake), the pane does not treat it as an empty list: it leaves it as it is and says it cannot be read. On the next change it saves a copy next to it (`pendientes.danado-<date>.json`) and starts a new list, so nothing is lost.

#### Tasks for a template
When you do something in a project that is also worth doing in the template it came from (for example, a tricky upgrade), tell Claude with:

```
/narsil-check template "in backendTemplate create the task to upgrade TypeScript to 7.0.0, explain what you had to do"
```

Claude looks for the template's folder next to this project (ignoring case, hyphens, and spaces; it also accepts an absolute path), writes the explanation, because it knows how it was done, and creates the task in the template's **Pendientes** with the `todo_add_to_template` tool. If it cannot find the folder or there are several similar ones, it asks you which one.

## Ecosystems

| Ecosystem | Reads | Installed version | Registry | The button runs |
| --- | --- | --- | --- | --- |
| **npm** (JS, TS) and Expo | `package.json` | `node_modules`, then `package-lock.json` or `pnpm-lock.yaml` | registry.npmjs.org | `npm install` (or pnpm, yarn, bun depending on the lockfile) |
| **PyPI** (Python) | `pyproject.toml` (PEP 621, PEP 735 groups, Poetry), `requirements.txt`, `requirements-dev.txt` | `uv.lock` or `poetry.lock`; otherwise the `==` pin | pypi.org | rewrites the range and then `uv lock` or `poetry lock` |
| **Go** | the direct `require` entries in `go.mod` | `go.mod` | proxy.golang.org | `go get module@version` and `go mod tidy` |
| **Cargo** (Rust) | `Cargo.toml` (dependencies, dev, build, and target) | `Cargo.lock` | crates.io | rewrites the requirement and then `cargo update -p` |
| **Pub** (Dart, Flutter) | `pubspec.yaml` | `pubspec.lock` | pub.dev | rewrites the constraint and then `flutter pub get` or `dart pub get` |
| **Maven** (Kotlin, Java) | `gradle/libs.versions.toml`, every `build.gradle(.kts)` and `pom.xml` in the tree | the written version | Google Maven, Gradle Plugin Portal, or Maven Central | rewrites the version where it is written; Gradle and Maven download it on the next build |
| **NuGet** (C#, F#, VB) | every `.csproj`, `.fsproj`, and `.vbproj` in the tree, `Directory.Packages.props` | the written version | api.nuget.org | rewrites the `Version` and then `dotnet restore` |
| **RubyGems** (Ruby) | `Gemfile` | `Gemfile.lock` | rubygems.org | rewrites the requirement and then `bundle update --conservative` |
| **SwiftPM** (Swift) | `Package.swift`, the `project.pbxproj` of each Xcode project | `Package.resolved` (v1, v2, and v3), including the Xcode workspace's | each package's git tags (`git ls-remote`) | rewrites the minimum version and then `swift package update`, or `xcodebuild -resolvePackageDependencies` in an Xcode app |
| **Gradle wrapper** | the root `gradle/wrapper/gradle-wrapper.properties` | the written version | services.gradle.org | rewrites the distribution; Gradle downloads it on the next run |
| **GitHub Actions** | the `uses:` entries in `.github/workflows` and `.github/actions` | the version of the tag or of the comment next to the commit | each action's git tags (`git ls-remote`) | rewrites the tag, or the commit and its comment |

Some details:

- **Go**: a major version from v2 on is a different module path (`github.com/go-chi/chi/v5`). The pane asks for each next major until one does not exist, so `chi` 1.5.4 shows up with 5.5.0. That upgrade requires changing the imports, and the button does not do it.
- **PyPI**: with only `requirements.txt` there is no lockfile, so the button rewrites the pins and installs nothing: install it yourself in your environment (`pip install -r requirements.txt`). The module name is used to search for imports (`PyYAML` is imported as `yaml`); some uncommon names may not be found.
- **Gradle**: the version catalog is read exactly. A version shared by several libraries or plugins is a single row (`ktor (8)`, `kotlin (6)`) and the button upgrades it once. In `build.gradle(.kts)` files only coordinates written as text are read (`"io.mockk:mockk:1.13.10"`, `id("x") version "1.2"`): a version stored in a variable (`$kotlinVersion`) is code and is left out. A catalog version that no library or plugin uses is also left out, for example one that `build-logic` reads with `libs.versions.x`: with no coordinates there is no registry to ask. Only stable versions count: Maven's `<release>` can be an alpha (lifecycle `2.12.0-alpha05`), so the full list is checked.
- **Maven**: `<dependency>` and `<plugin>` entries with their own version or a `${property}` from `<properties>` are read. A version managed by a parent POM or a BOM is left out.
- **NuGet**: manifests are searched for across the whole tree (`src/Api/Api.csproj`). An analyzer (`PrivateAssets="all"`) counts as a development dependency. A version with an MSBuild property (`$(X)`) or a range (`[1.0,2.0)`) is left out.
- **RubyGems**: the `:development` and `:test` groups count as development, also inside a `platforms` block. A gem with no requirement is not rewritten: Bundler upgrades it. Four-part versions (`8.1.4.1`) are compared in full.
- **SwiftPM**: there is no central registry; a package is its git URL. The latest version comes from `git ls-remote --tags` on the repository itself, without going through the GitHub API, so there is no query limit and it works with any host. Only tags of a final version (without `-beta`) count. All requirement forms are read (`from:`, `.upToNextMajor`, `.upToNextMinor`, `exact:`, and `"1.0.0"..<"2.0.0"` ranges); those with `branch:`, `revision:`, or `path:` are left out. To search for imports, the repository name without `swift-` is used, ignoring case (`swift-nio-ssl` finds `import NIOSSL`).
- **Gradle wrapper**: only the version in `gradle-wrapper.properties` changes; `gradle-wrapper.jar` and the scripts stay until you run `./gradlew wrapper`. A wrapper with `distributionSha256Sum` is blocked, because the checksum changes too. The `android/` wrapper is decided by React Native or Flutter and is not checked. It does not go through the vulnerability check, because OSV does not know it.
- **Blocked even if the jump is small**: a Gradle library that a `gradle.lockfile` pins to another version (also if it pins it for another library that shares its `version.ref`), because a locked build rejects it until the lock is regenerated with `--write-locks`; and a Swift package pinned to an exact version (`exact:`, `exactVersion`), because it is usually a deliberate decision. "Trivial" only means the jump is not major and does not clash with what the pane knows: it does not guarantee that the project compiles.
- **Without the tool on the machine** (`xcodebuild` outside a Mac, `cargo` not installed): that ecosystem is not upgraded, its files stay as they were, and the pane says which one it was; the others go ahead. That way a manifest with the new version is never pushed alongside an old lockfile.
- **Expo, peerDependencies, and pinned versions** are only checked in npm.
- Path, git, and workspace dependencies are not checked, because they do not come from a registry.

## Installation

You need [Claude Code](https://claude.com/claude-code). Inside Claude Code, run:

```
/plugin marketplace add davshn/narsil-check
/plugin install narsil-check@narsil-check
```

The pane appears in the next conversation.

To update to the latest version:

```
/plugin marketplace update narsil-check
/plugin update narsil-check@narsil-check
```

Creating the PR also needs [GitHub CLI](https://cli.github.com) (`gh`) installed and signed in.

## Commands

| Command | What it does |
| --- | --- |
| `/narsil-check` | Shows the list of checks. It also answers this way to an argument it does not know. |
| `/narsil-check upgrade` | Opens the pane with **Actualizaciones** expanded and checks again. It is the way to open it again if you close it. |
| `/narsil-check vulns` | Opens the pane with **Vulnerabilidades** expanded and queries OSV.dev again. |
| `/narsil-check template "…"` | Asks Claude to create a task, with its explanation, in a template's **Pendientes**. |

## Supported systems

Upgrades and Vulnerabilities work wherever Claude Code draws the pane: terminal, desktop app, VS Code, and mobile app. Environment, Connectors, and remote control are read from the desktop app's own servers:

| | Desktop app | Terminal, VS Code, and others |
| --- | --- | --- |
| Upgrades and Vulnerabilities | Yes | Yes |
| Environment and Connectors | Yes | No: the section says why it could not read them |
| Remote control and Auto-fix | Yes | No |
| The PR's CI | Yes, with `gh` installed and signed in; if it is missing, the fold says why | No |
| Click on the folder and the branch | Yes | No |
| Pending tasks | Yes | Yes; in the mobile app there is no field to type in: tasks are added by asking Claude |

## Development

Narsil Check is open source and contributions are welcome: open an issue or a pull request on [GitHub](https://github.com/davshn/narsil-check).

To work on a local copy, add its folder as a marketplace; changes arrive with `/reload-plugins`, without reinstalling:

```
claude plugin marketplace add <path-to-your-copy>
claude plugin validate .
claude plugin test .
```

- `hooks/register.tsx`: the mod's hooks (the pane, its sections, the buttons, and the commands).
- `hooks/words.ts`: how the pane says things (section names, colors, summaries, the command's help).
- `hooks/map/`: the work map, adapted from lot-map (`classify.ts` assigns each call to its station, `board.ts` keeps what happened, `hooks.ts` listens to the events, and `draw.ts` draws the animated SVG).
- `hooks/session.ts`: the session section (Environment, Connectors, and the remote control and Auto-fix switches).
- `hooks/ci.ts`: the PR's CI step by step (the runs and steps `gh` returns, their marks, and the fold's summary).
- `hooks/todos.ts`: Pending tasks (the list file, the `name: body` format, the git exclusion, and the template search).
- `hooks/ecosystems.ts` and `hooks/adapter.ts`: the list of ecosystems and what each one has to know how to do.
- `hooks/npm.ts`, `pypi.ts`, `golang.ts`, `cargo.ts`, `pub.ts`, `maven.ts`, `nuget.ts`, `rubygems.ts`, and `swiftpm.ts`: each ecosystem (reading the manifest, asking the registry, and rewriting the version).
- `hooks/semver.ts` and `hooks/toml.ts`: versions and ranges, and TOML parsing.
- `hooks/explain.ts`: Haiku's analysis of each major version.
- `hooks/osv.ts`: the OSV.dev vulnerabilities.
- `hooks/git.ts`: the branch, the commit, and the PR.
- `hooks/narsil-art.ts`: baby Narsil's drawing, light and dark, generated from [Narsil](https://github.com/davshn/narsil-pet)'s art.
- `tests/`: the tests.

## License

Narsil Check is free software: you can redistribute it and modify it under the terms of the [GNU General Public License, version 3](LICENSE) (GPL v3) or, at your option, any later version, as published by the Free Software Foundation.

In short: you can use, study, modify, and share it freely, but if you distribute a modified version you must also publish it as open source under the same license. It comes with no warranty. See the [LICENSE](LICENSE) file for the full text.

Copyright © 2026 Davshn

The work map (`hooks/map/`) adapts code from [lot-map](https://github.com/alexeyw/lot-map), Copyright © 2026 Aleksei Volodin, released under the MIT license. Its copyright and permission notice is in [hooks/map/LICENSE-lot-map.txt](hooks/map/LICENSE-lot-map.txt).
