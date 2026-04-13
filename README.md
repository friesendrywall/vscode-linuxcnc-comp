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

### Quick Install (recommended)

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

The script will:
1. Run `npm install`
2. Compile TypeScript
3. Package as a `.vsix` and install, **or** symlink the folder for development

### Manual Installation

```bash
npm install
npm run compile
npx vsce package --no-dependencies
code --install-extension linuxcnc-comp-0.1.0.vsix
```

Then **Reload Window** in VSCode (`Ctrl+Shift+P` → `Developer: Reload Window`).

### Development Mode (no packaging needed)
Copy or symlink this folder to `~/.vscode/extensions/linuxcnc-comp-local/` and reload VSCode.

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
