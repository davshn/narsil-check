# Vulnerabilities check

Objective: Narsil Check lists the known vulnerabilities of the project's packages, by severity, in a collapsible section beside Actualizaciones, for all nine ecosystems.
Branch: `feat/vulnerabilities` · Delivery: `ask-on-risk` · Tests: `claude plugin test .`, type-check with tsc, `claude plugin validate .`

## Specs

- **S1** The user's request: "podemos checkear vulnerabilidades de la misma forma? es decir crear un sub menu de vulnerabilidades que haga pnpm audit o similar?", answered with the proposal they accepted ("si"): OSV.dev instead of each ecosystem's audit tool; the full tree from the lockfile where one is read, direct dependencies elsewhere; a collapsible section "▾ Vulnerabilidades · N" under Actualizaciones, its dot red for critical or high, yellow for moderate, green for none; each finding with package, version, severity, identifier, summary and the version that fixes it; an upgrade whose new version fixes a vulnerability marked as a priority; a command `/narsil-check vulns`.
- **S2** "solo agregar que me gustaria la opcion de copiar las vulnerabilidades por criticidad al porta papeles, como esta en el upgrade".
- Assumption: severity comes from the advisory's own rating (GitHub's CRITICAL, HIGH, MODERATE, LOW) and, failing that, from its CVSS v3 vector's base score; a finding with neither is "sin clasificar". Advisories that are the same issue under two ids (GHSA and PYSEC) count once.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1 | inline | done | the closing commit |
| T2 | S1 | inline | done | the closing commit |
| T3 | S1, S2 | inline | done | the closing commit |
| T4 | S1, docs, version | inline | done | the closing commit |

T1: hooks/osv.ts (queries, CVSS score, fixed version, dedupe, copy text) and each adapter's full package list from its lockfile. T2: the audit runs after each scan and by command, its own state, auto-open when it finds something. T3: the section, copy per severity and the upgrade marks. T4: tests, real checks, README, version 0.14.0.

## Log

- **L1** (2026-11-05) User: the S1 and S2 messages above.
- **L2** Probes: one OSV querybatch answered npm, PyPI, Go, Maven, NuGet and crates.io together (lodash 4.17.20: 4, jackson-databind 2.9.8: 60); the batch returns ids only, details come from /v1/vulns/{id} with database_specific.severity, severity[] CVSS vectors, aliases and affected ranges with "fixed" events; Swift packages are ecosystem SwiftURL named github.com/owner/repo. Local tools: npm and pnpm only, no pip-audit, cargo-audit or govulncheck.
- **L3** T1-T4 done in one commit (each task alone does not run: the module, the flow and the section depend on each other); 113 tests across 13 files, tsc and validate clean. Real check: portfolio-v3's package-lock.json gives 881 packages; OSV finds 30 advisories in 7 of them (astro 11, undici 8, vite 5, sharp 3, esbuild 1, minimatch 1, zod 1; 1 critical, 11 high, 14 moderate, 4 low), the same 30 advisories npm audit reports on those 7 packages, which it lists among 14 because it also names the packages that only depend on them (@typescript-eslint/*, eslint-config-love through minimatch). mobileTemplate: 27 declared Maven packages, none affected.
