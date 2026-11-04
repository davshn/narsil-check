# upgrade-mod

Un mod de Claude Code que, al abrir un proyecto con librerías desactualizadas, muestra en un panel qué se puede actualizar y cuánto cuesta hacerlo. Lee proyectos de JavaScript y TypeScript (npm y Expo), Python (PyPI), Go, Rust (Cargo), Dart o Flutter (Pub), Kotlin y Java (Gradle y Maven), C# (NuGet) y Ruby (RubyGems).

## Qué muestra

Las librerías desactualizadas, en cuatro grupos:

| Grupo | Cuándo | Qué hacer |
| --- | --- | --- |
| **Fuera del SDK de Expo** | La versión instalada no cumple el rango que fija el SDK de Expo del proyecto. | `npx expo install --fix` |
| **Bloqueada por otras dependencias** | La versión nueva y los paquetes instalados no coinciden en una peerDependency. | Subir primero lo que la bloquea. |
| **Versión mayor** | Hay una versión major nueva (o un salto de minor por debajo de 1.0.0). | Leer los cambios: pueden romper la API. |
| **Solo subir la versión** | Hay un parche o una minor nueva. | Subir la versión. |

Las librerías al día no aparecen. En un proyecto Expo, una librería que el SDK fija no se ofrece para actualizar aunque npm tenga una versión más nueva: se sube junto con el SDK.

Las versiones salen del registro de cada ecosistema, no de un modelo. Cada respuesta se guarda 6 horas, y el botón **Revisar de nuevo** fuerza una consulta nueva. Si el proyecto usa más de un ecosistema, cada librería lleva el suyo al lado (`zod 3.22.4 → 3.25.1 · npm`).

## Dependencias que se bloquean entre sí

Esta sección es solo de npm. Antes de clasificar una actualización, el panel hace tres comprobaciones, con los datos del registro, de `node_modules` y de `package-lock.json`, sin usar un modelo:

- **Lo que pide la versión nueva**: si `eslint-plugin-astro` 3.2.1 necesita `eslint >=10.0.0` y tienes eslint 9, no se puede subir sola.
- **Lo que piden los paquetes instalados**: si `eslint-config-love` exige `eslint ^9.35.0`, eslint 10 no se puede subir sola.
- **Versiones fijadas en el árbol**: si un paquete instalado, aunque no lo declares tú, fija la librería en una versión exacta, subirla dejaría dos copias. Por ejemplo, `typescript-eslint` 8.71.0 fija `@typescript-eslint/parser` 8.71.0: subir el parser a 8.72.1 hace que ESLint cargue el plugin dos veces ("Cannot redefine plugin"). No cuenta si quien la fija sube en el mismo lote a la misma versión, como la familia `@tailwindcss/*` con `tailwindcss`. Un rango que no es una versión exacta (`^8.53.0`) no se marca: una copia anidada ahí suele ser inofensiva. Esta comprobación usa `package-lock.json`, así que con yarn, pnpm o bun no se hace.

Cualquier actualización con un conflicto, sea de parche, menor o mayor, va al grupo **Bloqueada por otras dependencias**, con cada conflicto escrito debajo. El botón **Actualizar las N** nunca la incluye. Un peer que el proyecto no tiene instalado no cuenta como conflicto: es npm quien lo añade. Los conflictos se comparan con las versiones instaladas ahora; si subes varias juntas, puede que el bloqueo se resuelva entre ellas.

## Por qué una versión mayor no es trivial

Debajo de cada librería con versión mayor, el panel muestra la dificultad (baja, media o alta) y la razón, en una o dos frases. Para eso, Haiku recibe:

- **Las notas de las versiones que rompen**: el release de GitHub de cada nueva versión mayor (hasta tres), buscado como `v19.0.0`, `@scope/nombre@19.0.0` o `19.0.0`. Si no hay release, se usa el `CHANGELOG.md` del paquete desde la versión instalada.
- **Cómo usa tu proyecto la librería**: los archivos y las líneas que la importan, sacados con `git grep`.

Se le pide que se base solo en eso y que no invente cambios. La razón de cada salto (por ejemplo, `react 18.2.0 → 19.2.0`) se pide una vez y se guarda; no se vuelve a pedir en otras sesiones. Los grupos **Versión mayor** y **Bloqueada por otras dependencias** tienen cada uno un botón **Copiar con razones**, que copia solo las librerías de su grupo: las mayores con su dificultad y su razón, y las bloqueadas con lo que las bloquea.

La API de GitHub sin sesión permite 60 consultas por hora. Si se agotan, el análisis usa el `CHANGELOG.md` o dice que no encontró notas.

## Actualizar las triviales

El grupo **Solo subir la versión** tiene un botón que sube todas sus librerías de una vez, cada ecosistema con su herramienta (ver la tabla de abajo). Cada librería conserva el operador de su rango (`^3.22.0` pasa a `^3.25.1`, `>=2.31,<3` pasa a `>=2.34.2,<3`) y su sección. Las versiones mayores y las de Expo no se tocan: hay que revisarlas. Si la instalación falla, el panel muestra el final del error. Después de actualizar, ejecuta los tests antes de hacer commit.

## Crear el PR

Cuando los manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pubspec.yaml`...) tienen rangos de dependencias distintos de los de `HEAD`, el panel los lista con un botón para subirlos. Da igual si los actualizó el panel o lo hiciste a mano. Lo que hace el botón depende de la rama en la que estás:

- **En una rama de trabajo** (**Commit y push a &lt;rama&gt;**): hace el commit y el push a esa misma rama, y nada más. El PR lo gestionas tú.
- **En la rama principal** (**Crear rama, commit y PR**), la que indica `origin/HEAD` o, si no hay, `main` o `master`:
  1. Crea la rama `chore/upgrade-deps-AAAA-MM-DD`. Si ese nombre ya existe, le agrega la hora.
  2. Hace el commit y sube la rama a `origin`.
  3. Abre el PR con `gh` contra la rama principal. Te quedas en la rama nueva: volver a la principal dejaría en `package.json` las versiones viejas mientras `node_modules` tiene las nuevas.

En los dos casos, el commit lleva solo los manifests y lockfiles de los ecosistemas que cambiaron, con el mensaje `chore(deps): upgrade N dependencies` y la lista de cambios. El resto de tus cambios sin commit no se incluye. Claude Code ejecuta git con los hooks del repositorio desactivados, así que los hooks de commit (por ejemplo, husky) no corren. El PR necesita `gh` instalado y con sesión iniciada.

## Ecosistemas

| Ecosistema | Lee | Versión instalada | Registro | El botón ejecuta |
| --- | --- | --- | --- | --- |
| **npm** (JS, TS) y Expo | `package.json` | `node_modules`, luego `package-lock.json` | registry.npmjs.org | `npm install` (o pnpm, yarn, bun según el lockfile) |
| **PyPI** (Python) | `pyproject.toml` (PEP 621, grupos PEP 735, Poetry), `requirements.txt`, `requirements-dev.txt` | `uv.lock` o `poetry.lock`; si no, el pin `==` | pypi.org | reescribe el rango y luego `uv lock` o `poetry lock` |
| **Go** | los `require` directos de `go.mod` | `go.mod` | proxy.golang.org | `go get módulo@versión` y `go mod tidy` |
| **Cargo** (Rust) | `Cargo.toml` (dependencies, dev, build y target) | `Cargo.lock` | crates.io | reescribe el requisito y luego `cargo update -p` |
| **Pub** (Dart, Flutter) | `pubspec.yaml` | `pubspec.lock` | pub.dev | reescribe la restricción y luego `flutter pub get` o `dart pub get` |
| **Maven** (Kotlin, Java) | `gradle/libs.versions.toml`, cada `build.gradle(.kts)` y `pom.xml` del árbol | la versión escrita | Google Maven, Gradle Plugin Portal o Maven Central | reescribe la versión donde está escrita; Gradle y Maven la descargan en el siguiente build |
| **NuGet** (C#, F#, VB) | cada `.csproj`, `.fsproj` y `.vbproj` del árbol, `Directory.Packages.props` | la versión escrita | api.nuget.org | reescribe el `Version` y luego `dotnet restore` |
| **RubyGems** (Ruby) | `Gemfile` | `Gemfile.lock` | rubygems.org | reescribe el requisito y luego `bundle update --conservative` |

Algunos detalles:

- **Go**: una versión mayor a partir de la v2 es otra ruta de módulo (`github.com/go-chi/chi/v5`). El panel pregunta por cada mayor siguiente hasta que una no existe, así que `chi` 1.5.4 aparece con 5.5.0. Esa actualización exige cambiar los imports, y el botón no la hace.
- **PyPI**: con solo `requirements.txt` no hay lockfile, así que el botón reescribe los pins y no instala nada: instala tú en tu entorno (`pip install -r requirements.txt`). Para buscar los imports se usa el nombre del módulo (`PyYAML` se importa como `yaml`); algunos nombres poco comunes pueden no encontrarse.
- **Gradle**: el catálogo de versiones se lee exacto. Una versión que comparten varias librerías o plugins es una sola fila (`ktor (8)`, `kotlin (6)`) y el botón la sube una vez. En los `build.gradle(.kts)` solo se leen las coordenadas escritas como texto (`"io.mockk:mockk:1.13.10"`, `id("x") version "1.2"`): una versión guardada en una variable (`$kotlinVersion`) es código y queda fuera. También queda fuera una versión del catálogo que ninguna librería ni plugin usa, por ejemplo una que lee el `build-logic` con `libs.versions.x`: sin coordenadas no hay a qué registro preguntar. Solo cuentan las versiones estables: el `<release>` de Maven puede ser una alfa (lifecycle `2.12.0-alpha05`), así que se mira la lista completa.
- **Maven**: se leen las `<dependency>` y los `<plugin>` con versión propia o una `${propiedad}` de `<properties>`. Una versión que gestiona un POM padre o un BOM queda fuera.
- **NuGet**: los manifests se buscan en todo el árbol (`src/Api/Api.csproj`). Un analizador (`PrivateAssets="all"`) cuenta como dependencia de desarrollo. Una versión con una propiedad de MSBuild (`$(X)`) o un rango (`[1.0,2.0)`) queda fuera.
- **RubyGems**: los grupos `:development` y `:test` cuentan como desarrollo, también dentro de un bloque `platforms`. Una gema sin requisito no se reescribe: la sube Bundler. Las versiones de cuatro partes (`8.1.4.1`) se comparan completas.
- **Expo, peerDependencies y versiones fijadas** se revisan solo en npm.
- Las dependencias de ruta, de git o del workspace no se revisan, porque no vienen de un registro.

## Comandos

- `/upgrades`: abre el panel y vuelve a revisar. Es la forma de abrirlo de nuevo si lo cierras.

El panel se abre solo al empezar una sesión cuando hay librerías para actualizar. Si todo está al día, no se abre: usa `/upgrades`.

## Instalación

```bash
claude plugin marketplace add davshn/upgrade-mod
```

```bash
claude plugin install upgrade-mod@upgrade-mod
```

## Desarrollo

Para trabajar sobre una copia local, añade la carpeta como marketplace: los cambios llegan con `/reload-plugins`, sin reinstalar.

```bash
claude plugin marketplace add <ruta-a-tu-copia>
```

```bash
claude plugin validate .
```

```bash
claude plugin test .
```
