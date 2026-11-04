# Ecosystems wave 2: PyPI, Go, Cargo and Pub

Objective: the upgrade pane lists, groups and upgrades libraries of Python, Go, Rust and Dart/Flutter projects as it does for npm.
Branch: `feat/ecosystems-wave-2` · Delivery: `ask-on-risk` · Tests: `claude plugin test .`, type-check with tsc, `claude plugin validate .`

## Specs

- **S1** The user's request, as wave 2 was planned in this conversation: "2. **PyPI, Go, Cargo y Pub.** Tienen registros con APIs JSON sencillas." Each ecosystem's adapter follows the shared contract: `detect`, `parse`, `latest`, `importPattern` (the planned contract), plus an install command for the bump group.
- **S2** Data sources, as planned: PyPI `pyproject.toml`, `requirements.txt`, `poetry.lock`/`uv.lock` against `pypi.org JSON API`; Go `go.mod` against `proxy.golang.org`; Cargo `Cargo.toml` + `Cargo.lock` against `crates.io API`; Pub `pubspec.yaml` + `.lock` against `pub.dev API`.
- **S3** Existing behaviour stays: npm and Expo grouping, peer and pin checks, the bump button, Haiku reasons, the copy buttons, the commit/push/PR button and the auto-open rule ("el panel solo deberia abrirse automaticamente cuando haya versiones por actualizar, ya de resto que deba abrirse con /upgrades").
- **S4** The commit/push/PR button works for every ecosystem: what is pending comes from the manifests compared with `HEAD`, and the commit holds the manifests and lockfiles of the ecosystems that changed.
- **S5** Haiku's reason for a major upgrade works for every ecosystem: release notes from the repository each registry records, and the project's imports found with git grep.
- Assumption: peer dependency and exact-pin checks stay npm-only; Go majors are new module paths (`/v2`), so a Go major is found by probing `<module>/vN/@latest`.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S3, S4 | inline | done | a95eb07 |
| T2 | S1, S2 (Cargo) | inline | done | bbe6519 |
| T3 | S1, S2 (PyPI) | inline | done | 8ae479e |
| T4 | S1, S2 (Go) | inline | done | 90f8502 |
| T5 | S1, S2 (Pub) | inline | done | 503ba95 |
| T6 | S5, docs, version | inline | done | the closing commit |

T1: the scan, the bump install and the pending check go through an adapter per ecosystem; npm becomes the first adapter with no change in behaviour. T2-T5: one adapter each, with fixtures and registry-shaped tests. T6: release notes and import patterns per ecosystem, README, version 0.9.0.

Route evidence: every unit depends on T1's contract and each adapter is about 100-150 lines, so no writer reason applies; all run inline.

## Log

- **L1** (2026-11-04) User: "camos con la oleada 2", then "espera primero sube a github - main y luego sigue con la oleada 2".
- **L2** main pushed to github.com/davshn/upgrade-mod as 1bf736a. No Python, Cargo or Dart toolchain and no project of those ecosystems on this machine: adapters are checked with fixtures and against the live registries only. Registries probed: PyPI `info.version`/`info.project_urls.Source`, Go proxy `@latest` `Version` (and 404 for a missing `/v2`), crates.io `crate.max_stable_version`/`repository` (needs a User-Agent), pub.dev `latest.version`/`latest.pubspec.repository`.
- **L3** T1-T6 done. Checks per task: claude plugin test (66 tests across 5 files), tsc, claude plugin validate. Found while building: rewriteCargo kept only the last upgrade per line (fixed, covered by its test); Go majors skip versions (chi v1 to v5 with v2-v4 published), so the scan walks each next major path until a 404 (MAX_MAJOR_HOPS = 6); the PyPI and npm test disks matched package.json before node_modules/x/package.json (test-only, longest path first). Not checked: no Python, Cargo or Dart toolchain here, so the install commands never ran for real.
