# Release age in every ecosystem

Objective: no upgrade goes up until its version has been published for 24 hours, in all nine ecosystems, with Expo's SDK-pinned versions held to the same wait.
Branch: `main` (the repository's recent convention) · Delivery: `single-pr`-sized commits on main, pushed by the user's call · Tests: `claude plugin test .`, `claude plugin validate .` (no tsc in this checkout)

## Specs

- **S1** The user's request: "deberíamos implementar algo similar para los otros lenguajes, es más seguro" — the minimumReleaseAge block (scan marks the upgrade **Bloqueada**, an unreadable date blocks too) for Kotlin/Java (Maven, Gradle), Go, Cargo, PyPI, Pub, NuGet, RubyGems and SwiftPM, not only pnpm.
- **S2** The wait: "24 horas está perfecto" — 24 hours (1440 minutes) for every ecosystem. In a pnpm project, a longer `minimumReleaseAge` wins; a shorter one never lowers the 24 hours.
- **S3** The Expo gap the user chose to close ("El primero me interesa"): a version the Expo SDK pins goes through `npx expo install --fix`, outside the mod's strict pnpm install; the version that range resolves to is held to the same 24 hours and marked **Bloqueada** while younger.
- **S4** Kept from the earlier fix: "siempre que haya minimumReleaseAge se bloquee la actualizacion automatica y se marque el bloqueo, sin excepcion alguna" — no exclusion list counts anywhere.
- **S5** The user, after hearing Compose Multiplatform and AGP were not covered: "antes de subir corrijamos KMP. Compose Multiplatform y el Android Gradle Plugin etc, ademas cuando termines lanza el verificador independiente con todo esto". Rules, from the official tables (L5): AGP needs the Gradle the wrapper runs to reach its minimum; crossing into AGP 9 refuses `org.jetbrains.kotlin.multiplatform` with `com.android.library`/`com.android.application` and kapt; Kotlin needs its Gradle plugin's minimum AGP and Gradle; Compose Multiplatform needs its minimum Kotlin (iOS/web) and AGP 8.1 from 1.7; KSP from 2.3.12 needs AGP 8.12.0. A version past the known tables, or AGP with no wrapper, is blocked to be confirmed. Maximums are not checked (JetBrains: "fully supported", not a failure).
- **S6** "lanza el verificador independiente con todo esto": one independent verifier over the whole feature (T1-T5) before pushing.
- Assumption: install-time protection of transitive dependencies exists where the tool offers it (pnpm strict mode, npm's `before`); Cargo, Go, uv/Poetry, Pub, NuGet, Bundler, SwiftPM and Gradle offer no such switch the mod drives, so there the direct upgrade is what is held. Stated in the README.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S2, S4 | inline | done | 1492ca5 |
| T2 | S3 | inline | done | ca13b3c |
| T3 | S1 | inline | done | 8c5f2a3 |
| T4 | S1-S4 | inline | done | bf5d9c8 |
| T5 | S5 | inline | done | the KMP commit |
| T6 | S6 | delegated (verifier, requested) | pending | |

T1: each adapter names where a version's publication date is (`releasedUrls`, `releasedOf`); the scan checks every upgrade against max(24 h, pnpm's policy), unreadable dates block. T2: Expo group: the version its SDK range resolves to, from the version-time map, held to the wait. T3: npm installs with `before` set to 24 hours ago. T4: tests, README, version.

Route evidence: one behavior across adapters sharing one helper; no writer reason (no parallel independent units), so inline.

## Log

- **L1** (2026-11-06) User: "Y el cuánto a expo, pasa igual con frameworks como kmp o alguno de los otros lenguajes? Tenemos que pensar en ellos?" and "El primero me interesa, deberíamos implementar algo similar para los otros lenguajes, es más seguro"; then "24 horas está perfecto".
- **L2** Probes, each with a real package: PyPI `/pypi/{name}/{version}/json` urls[0].upload_time_iso_8601; crates.io `/api/v1/crates/{name}/{version}` version.created_at; Go proxy `/{path}/@v/{version}.info` Time; pub.dev `/api/packages/{name}/versions/{version}` published; NuGet `/v3/registration5-semver1/{id}/{version}.json` published; RubyGems `/api/v2/rubygems/{name}/versions/{version}.json` created_at; GitHub `/repos/{owner}/{repo}/commits/{tag}` commit.committer.date for SwiftPM; Maven Central, Google Maven and the Plugin Portal answer a version's POM with Last-Modified.
- **L3** T1: 155 tests; every adapter test now answers dates through tests/released.ts (a year old by default). T2: the Expo test fails with the check disabled and passes with it. T3: npm 11.19.1 with npm_config_before a day back refused tailwindcss@^4.3.5 (ETARGET "with a date before") and resolved ^4.3.4 to 4.3.4, not the hour-old 4.3.5. 158 tests pass, validate clean.
- **L4** Not covered, found while checking KMP: Compose Multiplatform and the Android Gradle Plugin are coupled to Kotlin and Gradle versions like Expo modules to the SDK, and no rule here knows them (the compiler-plugin list has SKIE, KSP, Mokkery, Realm, Metro, kotlinx-rpc, Anvil). Left for the user to decide.
- **L5** (2026-11-06) Research worker, spot-checked: AGP->min Gradle table on developer.android.com/build/releases/about-agp matched row by row (9.5->9.6.0 ... 8.0->8.0, 7.x). KGP minimums from kotlinlang.org/docs/gradle-configure-project.html (2.4: AGP 8.5.2, Gradle 7.6.3; 2.3: AGP 8.2.2). CMP has no official per-version table; minimums from its CHANGELOG Migration Notes (1.9: Kotlin 2.1, 1.10: 2.2 native/web, 1.11: 2.3; 1.7: AGP 8.1.0); 1.12 states none (1.11's kept). KSP 2.3.12 raised min AGP to 8.12.0. Gradle module metadata (AGP .module, CMP runtime .module) states none of these, so tables are hardcoded with sources. AGP 9 rules apply only when crossing from 8.x (a test caught them re-firing on a project already on 9). Compose compiler lockstep with Kotlin left out: separate rows would block each other; catalogs share the kotlin version ref. 165 tests pass.
