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
| T1 | S3 | inline | pending | |
| T2 | S1, S2 (Maven/Gradle) | inline | pending | |
| T3 | S1, S2 (NuGet) | inline | pending | |
| T4 | S1, S2 (RubyGems) | inline | pending | |
| T5 | S3, docs, version | inline | pending | |

T1: four-part versions (`8.1.4.1`), manifests found by pattern anywhere in the tree, rows that stand for a shared version (`display`, `source`), and an `infoUrl` for release notes where the latest answer names no repository. T2-T4: one adapter each, with fixtures, registry-shaped tests and a check against a real project where one exists (mobileTemplate for Gradle, Algoritmo for NuGet). T5: README, version 0.10.0, merge and reinstall.

Route evidence: every adapter depends on T1's contract changes and is about 150-250 lines, so no writer reason applies; all run inline.

## Log

- **L1** (2026-11-04) User: "dale a la oleada 3".
- **L2** Probes: Maven `maven-metadata.xml` `<release>` can be a prerelease (lifecycle 2.12.0-alpha05, AGP 9.6.0-alpha02), so the stable max comes from `<versions>`; ktor's POM names its repository in `<scm><url>`; NuGet `v3-flatcontainer/<id>/index.json` lists versions, the nuspec holds `<repository url>`; RubyGems `versions/<name>/latest.json` and `gems/<name>.json` (`source_code_uri`); Rails versions have four parts. Local tools: java 17 and dotnet 8, no mvn, gradle, ruby or bundle. Real projects: mobileTemplate (KMP, version catalog, nine modules), Algoritmo (one csproj with no packages).
