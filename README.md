# Narsil Check

<p align="center">
  <img src="https://raw.githubusercontent.com/davshn/narsil-pet/main/assets/readme/searching-claro.svg" width="150" alt="Narsil revisando el proyecto (modo claro)">
  <img src="https://raw.githubusercontent.com/davshn/narsil-pet/main/assets/readme/searching-oscuro.svg" width="150" alt="Narsil revisando el proyecto (modo oscuro)">
</p>

Narsil Check es el compañero de [Narsil](https://github.com/davshn/narsil-pet): un panel lateral, con sus mismos colores, que revisa el proyecto en el que trabajas. Muestra el entorno de la sesión (repositorio, carpeta, rama, conectores, control remoto y Auto-fix), qué librerías se pueden actualizar y cuánto cuesta hacerlo, qué vulnerabilidades conocidas tienen los paquetes instalados y una lista de tareas pendientes del proyecto. Con él puedes ocultar la barra de sesión de la app de escritorio y quedarte con un solo panel.

Lee proyectos de JavaScript y TypeScript (npm y Expo), Python (PyPI), Go, Rust (Cargo), Dart o Flutter (Pub), Kotlin y Java (Gradle y Maven), C# (NuGet), Ruby (RubyGems) y Swift (SwiftPM).

Es un mod de Claude Code de **código abierto**, publicado bajo la licencia [GPL v3](#licencia).

## Índice

- [Funcionalidades](#funcionalidades)
- [Ecosistemas](#ecosistemas)
- [Instalación](#instalación)
- [Comandos](#comandos)
- [Sistemas compatibles](#sistemas-compatibles)
- [Desarrollo](#desarrollo)
- [Licencia](#licencia)

## Funcionalidades

### El panel
El panel se abre al empezar cada sesión, aunque no haya nada que revisar. Arriba, centrados, están el título **● Narsil Check** y Narsil bebé debajo (en su versión clara u oscura, según el tema de la app; la terminal no dibuja imágenes), y después cada revisión como una sección que se pliega y se despliega con su cabecera (`▾ Actualizaciones · 3` / `▸ Actualizaciones · 3`). El punto de color de cada sección dice lo más urgente que tiene, con la paleta de Narsil: rojo si algo bloquea o falla, amarillo si algo te espera, verde si está al día y azul para lo informativo.

Cada sesión empieza igual: **Entorno** desplegado, **Conectores** plegado, y **Actualizaciones**, **Vulnerabilidades** y **Pendientes** plegadas hasta que tienen algo, momento en que se despliegan solas.

Dentro de **Actualizaciones** y **Vulnerabilidades**, cada grupo (**Bloqueada**, **Versión mayor**, **Crítica**, **Alta**...) también se pliega con su propia cabecera (`▾ Bloqueada (2)` / `▸ Bloqueada (2)`), y el panel recuerda cuáles cerraste. Un clic en una librería o en una vulnerabilidad la copia al portapapeles: la librería con su salto y lo que la bloquea o la razón de Haiku, y la vulnerabilidad con su gravedad, el arreglo y el enlace a OSV.

Al final del panel, **Actualizar rama** hace `git pull -r` en la rama en la que estás: trae lo nuevo de la remota y vuelve a poner encima tus commits locales. Si git no puede hacerlo (un conflicto o cambios sin commit), lo dice y muestra el motivo. Lo ejecuta el mod directamente, sin pasar por los permisos de la app, y después vuelve a revisar las librerías.

Cada revisión de librerías (al abrir la sesión, con **Revisar de nuevo** o con `/narsil-check upgrade`) también hace `git fetch` y cuenta los commits que la remota de tu rama tiene y tú no. Si te falta alguno, arriba del todo aparece un aviso rojo, *"⚠ La rama feat/login está 3 commits detrás de su remota: actualízala antes de seguir."*, con su propio botón **Actualizar rama**. Sin rama remota, sin red o con `HEAD` separado no se muestra nada. Tras un pull correcto se revisa de nuevo y el aviso desaparece.

### Entorno
Lo que enseña la barra de sesión de la app de escritorio, para que puedas ocultarla:

| Fila | Qué muestra | Al hacer clic |
| --- | --- | --- |
| **Repositorio** | La dirección web del remoto `origin` (`github.com/davshn/narsil-check`), sea SSH o HTTPS. | La abre en el navegador. |
| **Carpeta** | La carpeta de trabajo de la sesión. | Abre el selector de carpetas y mueve la sesión a la que elijas. |
| **Rama** | La rama de git actual. | Abre una pestaña de terminal en la carpeta de trabajo. |
| **Control remoto** | Un interruptor: `●━━ desactivado` en gris, `━━● activado` en verde. | Lo activa o lo desactiva. |
| **CI** | Solo con un PR abierto: los pasos de GitHub Actions del último commit de su rama (`✓ Lint`, `◐ Typecheck`, `○ Build`, `✗` si falló), sin los pasos internos de GitHub (`Set up job`, `Post …`). La línea resume el avance: `CI · 2/4 · Typecheck`, `CI · pasó`, `CI · falló`, o `esperando el CI del último push` si la rama tiene un commit que ningún run tomó todavía. Mientras corre, se vuelve a leer cada 10 segundos con `gh` y se deja de leer al terminar. | Pliega o despliega los pasos; queda como lo dejaste. |
| **Auto-fix** | Un interruptor igual para el PR abierto de la sesión: con él activado, la app despierta a Claude cuando falla el CI, hay un conflicto o llega un comentario de revisión. Sin PR abierto dice `sin PR abierto`. | Lo activa o lo desactiva; la app puede pedirte permiso antes. |

### Conectores
Los servidores MCP de la sesión: primero los conectados, con cuántas herramientas tiene cada uno (`engram · 19 herramientas`), y después los demás con su estado (`Gmail · needs_auth`).

Entorno, Conectores y el control remoto se leen de los servidores MCP propios de la app de escritorio. Al empezar la sesión el panel muestra «Leyendo la sesión…» y les pregunta una sola vez, a los diez segundos. Si la app recibe una llamada antes de confirmar qué servidor ofrece la herramienta, pide permiso aunque estés en modo de omitir permisos. Si esa lectura falla, se repite al empezar tu primer turno, sin reintentos rápidos. Al terminar cada turno vuelve a leer la carpeta y la rama con git, así que una rama que cambió durante el turno aparece sin hacer nada. A los servidores de la app solo les pregunta otra vez si el turno usó una herramienta que cambia su respuesta (control remoto, worktree, carpeta, conectores o el PR de la sesión, también un `gh pr` o un `git push` en la terminal) o si la lectura anterior falló. La app puede vincular el PR después de que termina el turno que lo abrió: si tras un `gh pr` o un `git push` todavía no aparece ningún PR, el panel vuelve a preguntar solo por el PR a los 5, 15 y 30 segundos, y deja de hacerlo apenas lo encuentra o cuando termina la sesión (también con `/clear`). Al abrir cada desplegable lo lee todo de nuevo. Cada pregunta a esos servidores les llega a los demás mods como una llamada a herramienta, por eso se hacen pocas.

### Actualizaciones
Las librerías desactualizadas, en cuatro grupos:

| Grupo | Cuándo | Qué hacer |
| --- | --- | --- |
| **Fuera del SDK de Expo** | La versión instalada no cumple el rango que fija el SDK de Expo del proyecto. | `npx expo install --fix` |
| **Bloqueada** | Algo impide subirla sola: una dependencia que no la acepta, un plugin del compilador atado a la versión actual, un comentario que la fija a propósito o una versión publicada hace menos de 24 horas. El motivo aparece debajo. | Resolver primero lo que la bloquea. |
| **Versión mayor** | Hay una versión major nueva (o un salto de minor por debajo de 1.0.0). | Leer los cambios: pueden romper la API. |
| **Solo subir la versión** | Hay un parche o una minor nueva. | Subir la versión. |

Las librerías al día no aparecen. En un proyecto Expo, una librería que el SDK fija no se ofrece para actualizar aunque npm tenga una versión más nueva: se sube junto con el SDK.

Las versiones salen del registro de cada ecosistema, no de un modelo. Cada respuesta se guarda 6 horas, y el botón **Revisar de nuevo** fuerza una consulta nueva. Si el proyecto usa más de un ecosistema, cada librería lleva el suyo al lado (`zod 3.22.4 → 3.25.1 · npm`).

### Dependencias que se bloquean entre sí
Solo en npm. Antes de clasificar una actualización, el panel hace tres comprobaciones con los datos del registro, de `node_modules` y de `package-lock.json`, sin usar un modelo:

- **Lo que pide la versión nueva**: si `eslint-plugin-astro` 3.2.1 necesita `eslint >=10.0.0` y tienes eslint 9, no se puede subir sola.
- **Lo que piden los paquetes instalados**: si `eslint-config-love` exige `eslint ^9.35.0`, eslint 10 no se puede subir sola. Se lee de `node_modules`; si todavía no instalaste (un repositorio recién clonado o creado desde una plantilla), de `package-lock.json` o `pnpm-lock.yaml`, así que el resultado es el mismo antes y después de instalar.
- **Versiones fijadas en el árbol**: si un paquete instalado, aunque no lo declares tú, fija la librería en una versión exacta, subirla dejaría dos copias. Por ejemplo, `typescript-eslint` 8.71.0 fija `@typescript-eslint/parser` 8.71.0: subir el parser a 8.72.1 hace que ESLint cargue el plugin dos veces ("Cannot redefine plugin"). No cuenta si quien la fija sube en el mismo lote a la misma versión, como la familia `@tailwindcss/*` con `tailwindcss`. Un rango que no es una versión exacta (`^8.53.0`) no se marca: una copia anidada ahí suele ser inofensiva. Esta comprobación usa `package-lock.json`, así que con yarn, pnpm o bun no se hace.

Cualquier actualización con un conflicto, sea de parche, menor o mayor, va al grupo **Bloqueada**, con cada conflicto escrito debajo, y el botón **Actualizar las N** nunca la incluye. Un peer que el proyecto no tiene instalado no cuenta como conflicto: es npm quien lo añade. Los conflictos se comparan con las versiones instaladas ahora; si subes varias juntas, puede que el bloqueo se resuelva entre ellas.

### Espera de 24 horas
En todos los ecosistemas, una versión publicada hace menos de 24 horas va a **Bloqueada**, por ejemplo con *"Publicada hace 3 h: Narsil Check espera 24 h antes de subirla"*. Así una versión recién publicada, que todavía nadie ha probado o que puede venir de una cuenta comprometida, no entra sola en el proyecto. La fecha sale del registro de cada ecosistema:

| Ecosistema | De dónde sale la fecha |
| --- | --- |
| npm y Expo | `time` del registro de npm; si no llega (paquetes de ~10 MB como astro), `pnpm view` o `npm view` |
| PyPI | el primer archivo subido de esa versión |
| Go | `Time` del proxy de Go |
| Cargo | `created_at` de crates.io |
| Pub | `published` de pub.dev |
| NuGet | `published` del registro de NuGet (el de SemVer 1, y si no está, el de SemVer 2) |
| RubyGems | `created_at` de rubygems.org |
| Gradle y Maven | la fecha del POM (`Last-Modified`) en Maven Central, Google Maven o el Gradle Plugin Portal |
| SwiftPM | cuándo GitHub publicó el *release* de ese tag. Es una fecha que pone GitHub, no la del commit, que el autor podría falsificar |

No hay excepciones: nada sube sin prueba de que esperó. Cuando la fecha no se puede leer (un tag sin *release*, un paquete Swift fuera de GitHub, un registro que no responde), la prueba es **cuándo vio el panel esa versión por primera vez**: una versión nunca es más nueva que el momento en que apareció, así que 24 horas después ya lleva al menos un día publicada. Mientras tanto queda bloqueada con *"No pude leer cuándo se publicó y la vi por primera vez hace 3 h: Narsil Check espera 24 h antes de subirla"*. Así una librería sin fecha nunca queda bloqueada para siempre. Una respuesta que no es una fecha nunca se guarda, así que el siguiente escaneo vuelve a preguntar. Cuando la versión cumple el día, deja de estar bloqueada en el siguiente escaneo.

En un proyecto Expo, una librería que el SDK fija se sube con `npx expo install --fix`, que instala la versión más nueva que cumple el rango del SDK. Esa versión también espera el día, o el `minimumReleaseAge` de pnpm si es más largo; mientras tanto la librería va a **Bloqueada** con la versión y el comando: *"El SDK de Expo pide 17.0.8 (npx expo install --fix). Publicada hace 1 h: …"*.

En un proyecto con pnpm cuenta además su `minimumReleaseAge`, si es más largo que un día, con el aviso *"pnpm espera 48 h para instalarla (minimumReleaseAge)"*. Si se instalara antes, el `pnpm install --frozen-lockfile` del CI la rechazaría. El valor se lee de `pnpm-workspace.yaml` (o de `minimum-release-age` en `.npmrc`) tal como está en `HEAD`, porque eso es lo que ve el CI. Un valor menor que un día no baja la espera. `minimumReleaseAgeExclude` se ignora, esté en `HEAD` o sin commit.

La espera también cubre las dependencias que arrastra una actualización, donde la herramienta lo permite:

- **pnpm** instala con `minimumReleaseAge` en modo estricto y sin excepciones. Una dependencia demasiado nueva hace fallar la instalación en vez de quedar en el lockfile con una excepción escrita en `pnpm-workspace.yaml`. El panel lo marca como *"Bloqueada por minimumReleaseAge"* con las versiones que pnpm rechazó, y no se actualiza nada.
- **npm** instala con `before` puesto un día atrás, así que cada rango se resuelve a versiones de hace al menos un día. Si un rango no tiene ninguna, el panel lo marca como *"Bloqueada por la espera de 24 h"* y no se actualiza nada.
- **yarn, bun, Cargo, Go, uv, Poetry, Pub, NuGet, Bundler, SwiftPM, Gradle y Maven** no tienen una opción así, así que la espera se aplica a la librería que sube, no a lo que arrastra.

### Versiones fijadas a propósito
En cualquier ecosistema cuyo manifest admite comentarios (todos menos npm, cuyo `package.json` no los tiene), una librería se bloquea si un comentario dice que se mantiene a propósito, en la línea de su versión o en la de arriba. Cuentan las palabras *pin*, *pinned*, *hold*, *keep*, *freeze*, *do not upgrade* y, en español, *fijar*, *fijado*, *congelado* o *no actualizar*. El panel muestra el comentario como motivo:

```toml
[versions]
# Fijar 2.4.20 hasta confirmar soporte de SKIE para 2.4.21
kotlin = "2.4.20"
ktor = "3.6.1" # pinned: 3.7 breaks auth
```

### Kotlin y los plugins del compilador
Un plugin del compilador de Kotlin solo funciona con las versiones de Kotlin para las que se publicó: si no coinciden, el proyecto no compila (con SKIE, el framework de iOS). Por eso, si el proyecto declara uno, Kotlin pasa a **Bloqueada** aunque el salto sea un parche, por ejemplo con *"SKIE 0.10.16 es un plugin del compilador de Kotlin: confirma que soporta Kotlin 2.4.21"*. Se reconocen SKIE, KSP, Mokkery, Realm, Metro, kotlinx-rpc y Anvil, por sus coordenadas o por la clave del catálogo (`mokkery = "3.6.0"` cuenta aunque solo lo lea un módulo de `build-logic`). KSP se comprueba exactamente: su versión lleva dentro la de Kotlin para la que se hizo (`2.4.20-1.0.30`), y una de KSP2 sin Kotlin en el nombre (`2.3.0`) sirve para cualquiera. Las librerías `kotlinx` (coroutines, serialization) no cuentan como Kotlin: suben por su cuenta.

### Gradle, AGP, Kotlin y Compose Multiplatform
En un proyecto Android o Kotlin Multiplatform, estas herramientas dependen unas de otras, igual que los módulos de Expo dependen del SDK. Subir una sola puede romper el build, así que va a **Bloqueada** cuando la otra no llega al mínimo:

| Sube | Necesita | Fuente |
| --- | --- | --- |
| Android Gradle Plugin | la versión de Gradle mínima de esa AGP, comparada con la que fija `gradle/wrapper/gradle-wrapper.properties` (o `android/gradle/wrapper/…` en React Native). Ejemplo: *"AGP 8.13.0 necesita Gradle 8.13 o más; el wrapper usa 8.11.1"* | [Google](https://developer.android.com/build/releases/about-agp) |
| AGP 9, desde 8.x | que ningún módulo combine `org.jetbrains.kotlin.multiplatform` con `com.android.library` o `com.android.application` (pasan a `com.android.kotlin.multiplatform.library`) y que no se use kapt | [Google](https://developer.android.com/build/migrate-to-built-in-kotlin) |
| Kotlin | la AGP y el Gradle mínimos de su plugin de Gradle (Kotlin 2.4 necesita AGP 8.5.2) | [JetBrains](https://kotlinlang.org/docs/gradle-configure-project.html) |
| Compose Multiplatform | el Kotlin mínimo para iOS y web (1.10 necesita Kotlin 2.2, 1.11 y 1.12 necesitan 2.3) y AGP 8.1 desde 1.7 | [JetBrains](https://github.com/JetBrains/compose-multiplatform/blob/master/CHANGELOG.md) |
| KSP 2.3.12 o más | AGP 8.12.0 | [KSP](https://github.com/google/ksp/releases) |

Solo se comprueban los mínimos. Los máximos que publica JetBrains son lo que tiene soporte completo, no un fallo, y Google mismo combina versiones que los pasan. Una versión de AGP o de Compose Multiplatform más nueva que las tablas que conoce el panel también queda bloqueada, con *"confirma qué Gradle necesita"*. Lo mismo pasa con una actualización de AGP cuando el proyecto no tiene el wrapper de Gradle. El wrapper solo se lee: nunca entra en el commit del PR.

### Por qué una versión mayor no es trivial
Debajo de cada librería con versión mayor, el panel muestra la dificultad (baja, media o alta) y la razón, en una o dos frases. Para eso, Haiku recibe:

- **Las notas de las versiones que rompen**: el release de GitHub de cada nueva versión mayor (hasta tres), buscado como `v19.0.0`, `@scope/nombre@19.0.0` o `19.0.0`. Si no hay release, se usa el `CHANGELOG.md` del paquete desde la versión instalada.
- **Cómo usa tu proyecto la librería**: los archivos y las líneas que la importan, sacados con `git grep`.

Se le pide que se base solo en eso y que no invente cambios. La razón de cada salto (por ejemplo, `react 18.2.0 → 19.2.0`) se pide una vez y se guarda; no se vuelve a pedir en otras sesiones. Un clic en una versión mayor la copia con su dificultad y su razón, y uno en una bloqueada, con lo que la bloquea.

La API de GitHub sin sesión permite 60 consultas por hora. Si se agotan, el análisis usa el `CHANGELOG.md` o dice que no encontró notas.

### Actualizar las triviales
El grupo **Solo subir la versión** tiene un botón que sube todas sus librerías de una vez, cada ecosistema con su herramienta (ver [Ecosistemas](#ecosistemas)). Cada librería conserva el operador de su rango (`^3.22.0` pasa a `^3.25.1`, `>=2.31,<3` pasa a `>=2.34.2,<3`) y su sección. Las versiones mayores y las de Expo no se tocan: hay que revisarlas. Si la instalación falla, el panel muestra el final del error. Después de actualizar, ejecuta los tests antes de hacer commit.

### Crear el PR
Cuando los manifests (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pubspec.yaml`...) tienen rangos de dependencias distintos de los de `HEAD`, el panel los lista con un botón para subirlos, da igual si los actualizó el panel o lo hiciste a mano. Lo que hace el botón depende de la rama en la que estás:

- **En una rama de trabajo** (**Commit y push a &lt;rama&gt;**): hace el commit y el push a esa misma rama, y nada más. El PR lo gestionas tú.
- **En la rama principal** (**Crear rama, commit y PR**), la que indica `origin/HEAD` o, si no hay, `main` o `master`:
  1. Crea la rama `chore/upgrade-deps-AAAA-MM-DD`. Si ese nombre ya existe, le agrega la hora.
  2. Hace el commit y sube la rama a `origin`.
  3. Abre el PR con `gh` contra la rama principal.
  4. Vuelve a la rama principal (`git switch`) y revisa de nuevo las librerías. Ahí los manifests tienen las versiones viejas y lo instalado (`node_modules`) puede tener las nuevas: reinstala si vas a seguir trabajando en la principal. Si git no puede cambiar de rama, te quedas en la nueva y el panel dice por qué.

En los dos casos, el commit lleva solo los manifests y lockfiles de los ecosistemas que cambiaron, con el mensaje `chore(deps): upgrade N dependencies` y la lista de cambios. El resto de tus cambios sin commit no se incluye. Claude Code ejecuta git con los hooks del repositorio desactivados, así que los hooks de commit (por ejemplo, husky) no corren.

### Vulnerabilidades
La sección **Vulnerabilidades** lista las vulnerabilidades conocidas de los paquetes del proyecto según [OSV.dev](https://osv.dev), la base abierta que reúne los avisos de GitHub (los mismos de `npm audit`), PyPI, Go, crates.io, RubyGems y el resto. Una sola consulta sirve para los nueve ecosistemas, sin instalar `pnpm audit`, `pip-audit`, `cargo-audit` ni `govulncheck`.

- **Qué se revisa**: todo el árbol instalado donde hay un lockfile que lo dice (`package-lock.json`, `Cargo.lock`, `uv.lock` o `poetry.lock`, `Gemfile.lock`, `pubspec.lock`, `Package.resolved` y los `require` de `go.mod`, también los indirectos); en Maven y NuGet, las dependencias declaradas. Un paquete que no declaras tú lleva la marca *indirecta*.
- **Gravedad**: la del propio aviso (Crítica, Alta, Moderada, Baja) y, si no la trae, la que da la nota de su vector CVSS v3. Sin ninguna de las dos, *Sin clasificar*. Un mismo problema con dos identificadores (GHSA y PYSEC) cuenta una vez.
- **Cada aviso** muestra el paquete y su versión, su identificador, el resumen y la primera versión que lo corrige.
- **Copiar**: un clic en un aviso lo pone en el portapapeles con su gravedad, el arreglo y el enlace a OSV.
- **Con Actualizaciones**: si la actualización que ofrece el panel corrige vulnerabilidades, la fila lo dice en rojo (`lodash 4.17.20 → 4.17.21 · corrige 2 vulnerabilidades`) y sube al principio de su grupo.
- **Cuándo**: después de cada revisión de actualizaciones (al abrir la sesión, con el botón o con el comando), con su propio botón **Consultar de nuevo** y con `/narsil-check vulns`. Los detalles de cada aviso se guardan y solo se piden de nuevo cuando OSV dice que cambiaron.

El número de vulnerabilidades es el de avisos, no el de paquetes: `npm audit` cuenta además los paquetes que solo dependen de uno vulnerable, que aquí no se repiten.

### Pendientes
Una lista de tareas del proyecto para apuntar lo que se te ocurre mientras trabajas en otra cosa. Cada tarea tiene un nombre y, si quieres, un contenido:

```
▾ Pendientes · 2
  ○ ▾ Subir TypeScript a 7.0.0
       En narsil-check hubo que cambiar moduleResolution a bundler…
  ○ Revisar el README
  [ Nueva tarea (nombre: contenido) ]
```

- **Añadir**: escribe en el campo y pulsa Enter. Lo que va después de los primeros dos puntos es el contenido (`Subir TypeScript: revisar los tipos`); sin dos puntos, la tarea solo tiene nombre.
- **Leer**: un clic en el nombre muestra u oculta el contenido. Una tarea sin contenido no se despliega.
- **Terminar**: un clic en `○` la quita de la lista. No se guarda historial de tareas hechas.
- **Con Claude**: Claude tiene sus propias herramientas para listar, añadir y terminar tareas (`todo_list`, `todo_add`, `todo_done`). Pídele "apunta en pendientes…" o "haz la tarea de…", y la tacha él mismo al terminarla. No las lee en cada mensaje, así que no gastan contexto hasta que las usa.

La lista se guarda en `.atl/narsil-check/pendientes.json`, dentro del proyecto. La primera vez, el panel añade esa carpeta a `.git/info/exclude`, la lista de archivos ignorados local de git: nunca entra en un commit y no toca tu `.gitignore`. Si ese archivo no se puede escribir, la tarea se guarda igual.

Se lee al empezar la sesión y se escribe con cada cambio. Dentro de una sesión los cambios van de uno en uno y cada uno vuelve a leer el archivo justo antes de escribirlo, así que puedes añadir o terminar tareas mientras Claude trabaja, y una tarea que otra sesión haya guardado antes no se pierde. Lo que no está protegido es que dos sesiones del mismo proyecto escriban en el mismo instante: entonces el último cambio puede pisar al otro.

Si el archivo se daña (por ejemplo, tras editarlo a mano con un error), el panel no lo trata como una lista vacía: lo deja como está y dice que no se puede leer. Al siguiente cambio guarda una copia junto a él (`pendientes.danado-<fecha>.json`) y empieza una lista nueva, así que no se pierde nada.

#### Tareas para una plantilla
Cuando en un proyecto haces algo que también conviene hacer en la plantilla de la que salió (por ejemplo, una actualización complicada), díselo a Claude con:

```
/narsil-check template "en backendTemplate crea la tarea de actualizar TypeScript a 7.0.0, explica lo que tuviste que hacer"
```

Claude busca la carpeta de la plantilla junto a este proyecto (sin distinguir mayúsculas, guiones ni espacios; también acepta una ruta absoluta), escribe la explicación, porque sabe cómo se hizo, y crea la tarea en **Pendientes** de la plantilla con la herramienta `todo_add_to_template`. Si no encuentra la carpeta o hay varias parecidas, te pregunta cuál es.

## Ecosistemas

| Ecosistema | Lee | Versión instalada | Registro | El botón ejecuta |
| --- | --- | --- | --- | --- |
| **npm** (JS, TS) y Expo | `package.json` | `node_modules`, luego `package-lock.json` o `pnpm-lock.yaml` | registry.npmjs.org | `npm install` (o pnpm, yarn, bun según el lockfile) |
| **PyPI** (Python) | `pyproject.toml` (PEP 621, grupos PEP 735, Poetry), `requirements.txt`, `requirements-dev.txt` | `uv.lock` o `poetry.lock`; si no, el pin `==` | pypi.org | reescribe el rango y luego `uv lock` o `poetry lock` |
| **Go** | los `require` directos de `go.mod` | `go.mod` | proxy.golang.org | `go get módulo@versión` y `go mod tidy` |
| **Cargo** (Rust) | `Cargo.toml` (dependencies, dev, build y target) | `Cargo.lock` | crates.io | reescribe el requisito y luego `cargo update -p` |
| **Pub** (Dart, Flutter) | `pubspec.yaml` | `pubspec.lock` | pub.dev | reescribe la restricción y luego `flutter pub get` o `dart pub get` |
| **Maven** (Kotlin, Java) | `gradle/libs.versions.toml`, cada `build.gradle(.kts)` y `pom.xml` del árbol | la versión escrita | Google Maven, Gradle Plugin Portal o Maven Central | reescribe la versión donde está escrita; Gradle y Maven la descargan en el siguiente build |
| **NuGet** (C#, F#, VB) | cada `.csproj`, `.fsproj` y `.vbproj` del árbol, `Directory.Packages.props` | la versión escrita | api.nuget.org | reescribe el `Version` y luego `dotnet restore` |
| **RubyGems** (Ruby) | `Gemfile` | `Gemfile.lock` | rubygems.org | reescribe el requisito y luego `bundle update --conservative` |
| **SwiftPM** (Swift) | `Package.swift`, el `project.pbxproj` de cada proyecto de Xcode | `Package.resolved` (v1, v2 y v3), también el del workspace de Xcode | los tags de git de cada paquete (`git ls-remote`) | reescribe la versión mínima y luego `swift package update`, o `xcodebuild -resolvePackageDependencies` en una app de Xcode |
| **Gradle wrapper** | `gradle/wrapper/gradle-wrapper.properties` de la raíz | la versión escrita | services.gradle.org | reescribe la distribución; Gradle la descarga en la siguiente ejecución |
| **GitHub Actions** | los `uses:` de `.github/workflows` y `.github/actions` | la versión del tag o del comentario junto al commit | los tags de git de cada acción (`git ls-remote`) | reescribe el tag, o el commit y su comentario |

Algunos detalles:

- **Go**: una versión mayor a partir de la v2 es otra ruta de módulo (`github.com/go-chi/chi/v5`). El panel pregunta por cada mayor siguiente hasta que una no existe, así que `chi` 1.5.4 aparece con 5.5.0. Esa actualización exige cambiar los imports, y el botón no la hace.
- **PyPI**: con solo `requirements.txt` no hay lockfile, así que el botón reescribe los pins y no instala nada: instala tú en tu entorno (`pip install -r requirements.txt`). Para buscar los imports se usa el nombre del módulo (`PyYAML` se importa como `yaml`); algunos nombres poco comunes pueden no encontrarse.
- **Gradle**: el catálogo de versiones se lee exacto. Una versión que comparten varias librerías o plugins es una sola fila (`ktor (8)`, `kotlin (6)`) y el botón la sube una vez. En los `build.gradle(.kts)` solo se leen las coordenadas escritas como texto (`"io.mockk:mockk:1.13.10"`, `id("x") version "1.2"`): una versión guardada en una variable (`$kotlinVersion`) es código y queda fuera. También queda fuera una versión del catálogo que ninguna librería ni plugin usa, por ejemplo una que lee el `build-logic` con `libs.versions.x`: sin coordenadas no hay a qué registro preguntar. Solo cuentan las versiones estables: el `<release>` de Maven puede ser una alfa (lifecycle `2.12.0-alpha05`), así que se mira la lista completa.
- **Maven**: se leen las `<dependency>` y los `<plugin>` con versión propia o una `${propiedad}` de `<properties>`. Una versión que gestiona un POM padre o un BOM queda fuera.
- **NuGet**: los manifests se buscan en todo el árbol (`src/Api/Api.csproj`). Un analizador (`PrivateAssets="all"`) cuenta como dependencia de desarrollo. Una versión con una propiedad de MSBuild (`$(X)`) o un rango (`[1.0,2.0)`) queda fuera.
- **RubyGems**: los grupos `:development` y `:test` cuentan como desarrollo, también dentro de un bloque `platforms`. Una gema sin requisito no se reescribe: la sube Bundler. Las versiones de cuatro partes (`8.1.4.1`) se comparan completas.
- **SwiftPM**: no hay registro central; un paquete es su URL de git. La última versión sale de `git ls-remote --tags` sobre el propio repositorio, sin pasar por la API de GitHub, así que no hay límite de consultas y sirve con cualquier host. Cuentan solo los tags de una versión final (sin `-beta`). Se leen todas las formas de requisito (`from:`, `.upToNextMajor`, `.upToNextMinor`, `exact:` y rangos `"1.0.0"..<"2.0.0"`); los de `branch:`, `revision:` o `path:` quedan fuera. Para buscar los imports se usa el nombre del repositorio sin `swift-` y sin distinguir mayúsculas (`swift-nio-ssl` encuentra `import NIOSSL`).
- **Gradle wrapper**: solo cambia la versión en `gradle-wrapper.properties`; el `gradle-wrapper.jar` y los scripts se quedan hasta que ejecutes `./gradlew wrapper`. Un wrapper con `distributionSha256Sum` queda bloqueado, porque la suma también cambia. El wrapper de `android/` lo deciden React Native o Flutter y no se revisa. No pasa por la revisión de vulnerabilidades, porque OSV no lo conoce.
- **GitHub Actions**: se leen las acciones fijadas a un tag completo (`@v6.1.0`) o a un commit con su versión en un comentario (`@b843ebf… # v6.1.0`). Un tag móvil (`@v6`) ya sigue su versión mayor, y una rama o un commit sin comentario no dicen qué comparar: quedan fuera. Si no se puede leer el commit de un tag nuevo, los workflows quedan como estaban. Subir cambios en `.github/workflows` por HTTPS exige un token con el permiso `workflow`.
- **Bloqueadas aunque el salto sea pequeño**: una librería de Gradle que un `gradle.lockfile` fija en otra versión (también si la fija para otra librería que comparte su `version.ref`), porque un build con bloqueo la rechaza hasta regenerar el lock con `--write-locks`; y un paquete de Swift fijado a una versión exacta (`exact:`, `exactVersion`), porque suele ser una decisión a propósito. "Trivial" solo significa que el salto no es mayor y que no choca con lo que el panel sabe: no garantiza que el proyecto compile.
- **Sin la herramienta en el equipo** (`xcodebuild` fuera de un Mac, `cargo` sin instalar): ese ecosistema no se actualiza, sus archivos quedan como estaban y el panel dice cuál fue; los demás siguen. Así no se sube un manifest con la versión nueva junto a un lockfile viejo.
- **Expo, peerDependencies y versiones fijadas** se revisan solo en npm.
- Las dependencias de ruta, de git o del workspace no se revisan, porque no vienen de un registro.

## Instalación

Necesitas [Claude Code](https://claude.com/claude-code). Dentro de Claude Code, ejecuta:

```
/plugin marketplace add davshn/narsil-check
/plugin install narsil-check@narsil-check
```

El panel aparece en la siguiente conversación.

Para actualizarlo a la última versión:

```
/plugin marketplace update narsil-check
/plugin update narsil-check@narsil-check
```

Crear el PR necesita, además, [GitHub CLI](https://cli.github.com) (`gh`) instalado y con sesión iniciada.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `/narsil-check` | Muestra la lista de revisiones. También responde así a un argumento que no conoce. |
| `/narsil-check upgrade` | Abre el panel con **Actualizaciones** desplegada y vuelve a revisar. Es la forma de abrirlo de nuevo si lo cierras. |
| `/narsil-check vulns` | Abre el panel con **Vulnerabilidades** desplegada y vuelve a consultar OSV.dev. |
| `/narsil-check template "…"` | Le pide a Claude que cree una tarea, con su explicación, en **Pendientes** de una plantilla. |

## Sistemas compatibles

Actualizaciones y Vulnerabilidades funcionan dondequiera que Claude Code dibuje el panel: terminal, app de escritorio, VS Code y app móvil. Entorno, Conectores y el control remoto se leen de los servidores propios de la app de escritorio:

| | App de escritorio | Terminal, VS Code y otros |
| --- | --- | --- |
| Actualizaciones y Vulnerabilidades | Sí | Sí |
| Entorno y Conectores | Sí | No: la sección dice por qué no pudo leerlos |
| Control remoto y Auto-fix | Sí | No |
| CI del PR | Sí, con `gh` instalado y con sesión iniciada; si falta, el pliegue dice por qué | No |
| Clic en la carpeta y en la rama | Sí | No |
| Pendientes | Sí | Sí; en la app móvil no hay campo para escribir: las tareas se añaden pidiéndoselo a Claude |

## Desarrollo

Narsil Check es de código abierto y las contribuciones son bienvenidas: abre un *issue* o un *pull request* en [GitHub](https://github.com/davshn/narsil-check).

Para trabajar sobre una copia local, añade su carpeta como marketplace; los cambios llegan con `/reload-plugins`, sin reinstalar:

```
claude plugin marketplace add <ruta-a-tu-copia>
claude plugin validate .
claude plugin test .
```

- `hooks/register.tsx`: los hooks del mod (el panel, sus secciones, los botones y los comandos).
- `hooks/words.ts`: cómo lo dice el panel (nombres de las secciones, colores, resúmenes, ayuda del comando).
- `hooks/session.ts`: la sección de la sesión (Entorno, Conectores y los interruptores del control remoto y del Auto-fix).
- `hooks/ci.ts`: el CI del PR paso a paso (los runs y pasos que da `gh`, sus marcas y el resumen del pliegue).
- `hooks/todos.ts`: Pendientes (el archivo de la lista, el formato `nombre: contenido`, la exclusión de git y la búsqueda de plantillas).
- `hooks/ecosystems.ts` y `hooks/adapter.ts`: la lista de ecosistemas y lo que cada uno tiene que saber hacer.
- `hooks/npm.ts`, `pypi.ts`, `golang.ts`, `cargo.ts`, `pub.ts`, `maven.ts`, `nuget.ts`, `rubygems.ts` y `swiftpm.ts`: cada ecosistema (leer el manifest, preguntar al registro y reescribir la versión).
- `hooks/semver.ts` y `hooks/toml.ts`: las versiones y los rangos, y la lectura de TOML.
- `hooks/explain.ts`: el análisis de Haiku de cada versión mayor.
- `hooks/osv.ts`: las vulnerabilidades de OSV.dev.
- `hooks/git.ts`: la rama, el commit y el PR.
- `hooks/narsil-art.ts`: el dibujo de Narsil bebé, claro y oscuro, generado a partir del arte de [Narsil](https://github.com/davshn/narsil-pet).
- `tests/`: los tests.

## Licencia

Narsil Check es software libre: puedes redistribuirlo y modificarlo bajo los términos de la [Licencia Pública General de GNU, versión 3](LICENSE) (GPL v3) o, a tu elección, cualquier versión posterior, publicada por la Free Software Foundation.

En resumen: puedes usarlo, estudiarlo, modificarlo y compartirlo libremente, pero si distribuyes una versión modificada debes publicarla también como código abierto bajo la misma licencia. Se distribuye sin ninguna garantía. Consulta el archivo [LICENSE](LICENSE) para ver el texto completo.

Copyright © 2026 Davshn
