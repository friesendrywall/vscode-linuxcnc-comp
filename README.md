# linuxcnc-comp — VSCode Extension

Language support for **LinuxCNC HAL component** (`.comp`) files.

---

## Features

### Syntax Highlighting
- Full `.comp` declaration section: `component`, `pin`, `param`, `function`, `option`, `variable`, `license`, `author`, `include`, and more
- Direction keywords (`in`, `out`, `io`, `r`, `rw`) and HAL types (`bit`, `float`, `signed`, `unsigned`)
- Embedded **C code** section (everything after `;;`) highlighted as standard C
- HAL convenience macros (`FUNCTION`, `EXTRA_SETUP`, `EXTRA_CLEANUP`, `FOR_ALL_INSTS`, `fperiod`) highlighted distinctly
- Option names (`singleton`, `userspace`, `extra_setup`, …) and boolean values (`yes`/`no`)
- Triple-quoted and r-string doc strings

### IntelliSense / Autocomplete
- Declaration keyword completions with snippet templates at the start of a line
- Context-aware completions inside declarations:
  - After `pin`: `in` / `out` / `io`
  - After `param`: `r` / `rw`
  - After direction: `bit` / `float` / `signed` / `unsigned` / …
  - After `function NAME`: `fp` / `nofp`
  - After `option`: all valid option names
- C section: macro snippets (`FUNCTION`, `EXTRA_SETUP`, etc.) plus all declared pin/param/variable identifiers

### Hover Documentation
- Hover any declaration keyword for full usage docs and a syntax summary
- Hover any declared `pin`, `param`, `variable`, or `function` name to see its type, direction, default value, array info, and doc string
- Hover HAL type keywords (`bit`, `float`, `signed`, …) for type descriptions
- Hover C macros (`FUNCTION`, `fperiod`, …) for usage notes

### Go-to Definition
- In the C code section (`;;` onwards), **Ctrl+click** or **F12** on any pin/param/variable identifier to jump to its declaration line

### Diagnostics (Linting)
| Severity | Check |
|---|---|
| Error | Missing `component` declaration |
| Error | Missing `;;` separator |
| Error | Duplicate identifier names |
| Error | Use of reserved names (`comp_id`, `fperiod`, `rtapi_app_main`, …) |
| Error | `function` declared in a `userspace` component |
| Warning | Missing `license` declaration (required by `halcompile`) |
| Warning | No `function` declared in a realtime component |
| Warning | Unknown top-level keyword |
| Warning | Pin named `in` colliding with C keyword |
| Hint | `s32`/`u32` used (deprecated; prefer `signed`/`unsigned`) |
| Hint | Read-write `param` with no default value |

### Snippets
| Prefix | Description |
|---|---|
| `comp-skeleton` | Full realtime component boilerplate |
| `comp-userspace` | Userspace component boilerplate |
| `pin` | Pin declaration |
| `param` | Param declaration |
| `function` | Function declaration |
| `variable` | Variable declaration |
| `FUNCTION` | `FUNCTION(_) { }` body |
| `EXTRA_SETUP` | `EXTRA_SETUP()` body |
| `EXTRA_CLEANUP` | `EXTRA_CLEANUP()` body |
| `FOR_ALL_INSTS` | `FOR_ALL_INSTS()` loop |
| `pin-array` | Fixed-size array pin |
| `pin-conditional` | Personality-conditional pin |
| `license` | GPL license line |

---

## Installation

### Requirements
- [Node.js](https://nodejs.org/) ≥ 18
- VSCode ≥ 1.75

The extension bundles its own `clang-format` binary (via the `clang-format` npm package) for formatting the C section of `.comp` files. No separate installation of clang-format is required.

---

### Linux

```bash
git clone <repo-url>
cd linuxcnc-comp
chmod +x scripts/install.sh
./scripts/install.sh
```

The script will prompt you to choose between:
1. **Package as `.vsix` and install** — recommended for normal use
2. **Symlink the folder** — easier if you are actively editing the extension
3. **Compile only** — if you want to install manually

Then **Reload Window** in VSCode (`Ctrl+Shift+P` → `Developer: Reload Window`).

---

### Windows

Open a terminal (PowerShell or Git Bash) in the repository folder:

```powershell
npm install
npm run compile
npx vsce package
```

Then install the generated `.vsix` from inside VSCode:

1. Open the Extensions panel (`Ctrl+Shift+X`)
2. Click the `...` menu (top-right of the panel)
3. Select **Install from VSIX...**
4. Browse to the `.vsix` file in the repository folder and open it

Then **Reload Window** (`Ctrl+Shift+P` → `Developer: Reload Window`).

---

### Development Mode (either platform)
Symlink or copy this folder to your VSCode extensions directory and reload VSCode:

| Platform | Extensions directory |
|---|---|
| Linux / macOS | `~/.vscode/extensions/linuxcnc-comp-local/` |
| Windows | `%USERPROFILE%\.vscode\extensions\linuxcnc-comp-local\` |

On Linux:
```bash
ln -s "$(pwd)" ~/.vscode/extensions/linuxcnc-comp-local
```

On Windows (PowerShell, run as Administrator):
```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.vscode\extensions\linuxcnc-comp-local" -Target (Get-Location)
```

---

## Example File

```comp
component ddt "Compute the derivative of the input function";
pin in float in  "Input value";
pin out float out "Derivative output";
variable double old;
function _;
license "GPL"; // indicates GPL v2 or later
;;
float tmp = in;
out = (tmp - old) / fperiod;
old = tmp;
```

---

## References
- [HAL Component Generator docs](https://linuxcnc.org/docs/html/hal/comp.html)
- [Example components](https://github.com/LinuxCNC/linuxcnc/tree/master/src/hal/components)
