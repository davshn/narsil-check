# Ecosystems wave 4: SwiftPM

Objective: the upgrade pane lists, groups and upgrades the Swift packages of SwiftPM packages and Xcode apps as it does for the other ecosystems.
Branch: `feat/ecosystems-wave-4` · Delivery: `ask-on-risk` · Tests: `claude plugin test .`, type-check with tsc, `claude plugin validate .`

## Specs

- **S1** The user's request, as wave 4 was planned in this conversation: "4. **SwiftPM.** Lo dejo para el final porque depende de la API de GitHub, que tiene límite de peticiones." and "SwiftPM | Swift | `Package.swift`, `Package.resolved` | no tiene registro central: usa los tags de git de cada repo". The user then said: "dale a la oleada 4".
- **S2** Everything the earlier waves built keeps working for SwiftPM: grouping, the bump button, Haiku reasons, copy buttons, the commit/push/PR button and the auto-open rule.
- Assumption: tags are read with `git ls-remote --tags --refs <url>` instead of the GitHub API, which has no request limit and works for any git host; only plain releases count (no prerelease tags).
- Assumption: an Xcode app declares its packages in `project.pbxproj` (`XCRemoteSwiftPackageReference`), so those are read too, with their `Package.resolved` under the project's workspace.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2 | inline | pending | |
| T2 | S1 | inline | pending | |
| T3 | S2, docs, version | inline | pending | |

T1: an adapter can name a command that answers its latest version (`latestCommand`) and the repository a name stands for (`repoUrlFor`). T2: the SwiftPM adapter for Package.swift, project.pbxproj and Package.resolved (v1, v2, v3). T3: README, version 0.11.0, reinstall.

Route evidence: T2 depends on T1 and is about 200 lines, so no writer reason applies; all run inline.

## Log

- **L1** (2026-11-04) User: "dale a la oleada 4".
- **L2** Probes: `git ls-remote --tags --refs https://github.com/apple/swift-argument-parser` lists `refs/tags/1.8.2` and earlier with no API limit; Alamofire's tags end at 5.12.2; vapor's Package.swift writes `.package(url: ..., from: "2.101.3")`, prerelease minimums (`from: "5.0.0-beta"`) and `traits:` arguments. No swift toolchain here (Windows), so the install command cannot run for real.
