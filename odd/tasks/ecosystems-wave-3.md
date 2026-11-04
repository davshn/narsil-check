# Ecosystems wave 3: Maven/Gradle, NuGet and RubyGems

Objective: the upgrade pane lists, groups and upgrades libraries of Kotlin/Java (Gradle and Maven), C# and Ruby projects as it does for the others.
Branch: `feat/ecosystems-wave-3` · Delivery: `ask-on-risk` · Tests: `claude plugin test .`, type-check with tsc, `claude plugin validate .`

## Specs

- **S1** The user's request, as wave 3 was planned in this conversation: "3. **Maven (Kotlin/Java), NuGet y RubyGems.** Gradle es lo más difícil de leer, porque `build.gradle.kts` es código. Leería el catálogo de versiones con exactitud y los `build.gradle.kts` lo mejor posible." The user then said: "dale a la oleada 3".
- **S2** Data sources, as planned: Maven `libs.versions.toml`, `build.gradle(.kts)`, `pom.xml` against `Maven Central + Google Maven`; NuGet `*.csproj`, `Directory.Packages.props` against `api.nuget.org`; RubyGems `Gemfile` + `Gemfile.lock` against `rubygems.org API`.
- **S3** Everything waves 1 and 2 built keeps working for every ecosystem: grouping, the bump button, Haiku reasons, copy buttons, the commit/push/PR button and the auto-open rule.
- Assumption: a version catalog's shared version (`ktor = "3.6.1"` used by eight libraries) is one row, raised once; Gradle plugins in the catalog are read from the Gradle Plugin Portal (Google Maven for `com.android.*`); only stable releases count (no alpha, beta, rc, milestone, snapshot, dev, eap, preview).
- Assumption: manifests that live anywhere in the tree (`app/build.gradle.kts`, `src/Api/Api.csproj`) are found with `git ls-files`.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S3 | inline | done | c50e830 |
| T2 | S1, S2 (Maven/Gradle) | inline | done | 4f9b8ea |
| T3 | S1, S2 (NuGet) | inline | done | 1362623 |
| T4 | S1, S2 (RubyGems) | inline | done | 06bcc49 |
| T5 | S3, docs, version | inline | done | the closing commit |

T1: four-part versions (`8.1.4.1`), manifests found by pattern anywhere in the tree, rows that stand for a shared version (`display`, `source`), and an `infoUrl` for release notes where the latest answer names no repository. T2-T4: one adapter each, with fixtures, registry-shaped tests and a check against a real project where one exists (mobileTemplate for Gradle, Algoritmo for NuGet). T5: README, version 0.10.0, merge and reinstall.

Route evidence: every adapter depends on T1's contract changes and is about 150-250 lines, so no writer reason applies; all run inline.

## Log

- **L1** (2026-11-04) User: "dale a la oleada 3".
- **L2** Probes: Maven `maven-metadata.xml` `<release>` can be a prerelease (lifecycle 2.12.0-alpha05, AGP 9.6.0-alpha02), so the stable max comes from `<versions>`; ktor's POM names its repository in `<scm><url>`; NuGet `v3-flatcontainer/<id>/index.json` lists versions, the nuspec holds `<repository url>`; RubyGems `versions/<name>/latest.json` and `gems/<name>.json` (`source_code_uri`); Rails versions have four parts. Local tools: java 17 and dotnet 8, no mvn, gradle, ruby or bundle. Real projects: mobileTemplate (KMP, version catalog, nine modules), Algoritmo (one csproj with no packages).
- **L3** T1-T5 done; 85 tests across 9 files, tsc and validate clean at each commit. Real checks: the Maven adapter on mobileTemplate against the live registries reads 9 manifests and 27 rows, all current but kotlin (6) 2.4.20 -> 2.4.21; ktlint-gradle is a plugin artifact on the Plugin Portal, not Central, so a 404 from Central now falls back to the Portal; mokkery and buildkonfig are catalog versions no coordinate uses, so they cannot be looked up (documented). The NuGet adapter end to end on a scratch console project: Newtonsoft.Json 13.0.1 -> 13.0.4 rewritten and resolved by a real dotnet restore, Serilog 4 left as a major, StyleCop.Analyzers dev and current (1.2 is beta). A test mock that simulated the npm install on every process call broke once the scan began calling git ls-files (fixed to npm calls only). Twice a node -e edit with Markdown backticks inside a double-quoted bash string ran them as command substitution; nothing was created or changed, and later edits went through the editor. Not checked: no mvn, gradle, ruby or bundle here, so those install paths never ran for real.
