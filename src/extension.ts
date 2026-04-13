import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type DeclKind = 'component' | 'pin' | 'param' | 'function' | 'option' | 'variable' | 'license' | 'author' | 'description';

interface CompDecl {
  kind: DeclKind;
  name: string;          // C identifier form
  halName?: string;      // HAL identifier form (dashes instead of underscores)
  direction?: string;    // pin: in/out/io  param: r/rw
  type?: string;         // HAL type or C type
  qualifier?: string;    // fp / nofp for functions
  doc?: string;          // documentation string
  startValue?: string;   // default value
  isArray?: boolean;
  arraySize?: string;
  conditional?: string;  // if condition expression
  line: number;
  range: vscode.Range;
}

interface ParsedComp {
  declarations: CompDecl[];
  separatorLine: number;   // line of ;;, -1 if absent
  componentName: string;
  hasLicense: boolean;
  hasFunction: boolean;
  isUserspace: boolean;
  hasSingleton: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

// Strip line (//) and block (/* ... */) comments from a declaration string
function stripComments(s: string): string {
  // Strip // line comments
  s = s.replace(/\/\/[^\n]*/g, '');
  // Strip /* */ block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  return s;
}

/** Extract the first quoted string value (single or triple quoted) */
function extractDoc(s: string): string | undefined {
  const triple = s.match(/"""([\s\S]*?)"""/);
  if (triple) return triple[1].trim();
  const single = s.match(/"((?:[^"\\]|\\.)*)"/);
  if (single) return single[1];
  return undefined;
}

/** Convert a HALNAME to its C identifier form */
function halNameToC(halName: string): string {
  // Remove # chars and any . _ - immediately before them
  let c = halName.replace(/[._-]*#+/g, '');
  // Replace . and - with _
  c = c.replace(/[.\-]/g, '_');
  // Collapse repeated _
  c = c.replace(/__+/g, '_');
  return c;
}

/** Convert a HALNAME to HAL identifier form */
function halNameToHal(halName: string): string {
  // Replace _ with - then strip trailing - or .
  return halName.replace(/_/g, '-').replace(/[-.]$/, '');
}

export function parseComp(document: vscode.TextDocument): ParsedComp {
  const declarations: CompDecl[] = [];
  let separatorLine = -1;
  let componentName = '';
  let hasLicense = false;
  let hasFunction = false;
  let isUserspace = false;
  let hasSingleton = false;

  const lines = document.getText().split('\n');

  // Find the ;; separator
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*;;/.test(lines[i])) {
      separatorLine = i;
      break;
    }
  }

  const declEnd = separatorLine >= 0 ? separatorLine : lines.length;
  let i = 0;

  while (i < declEnd) {
    const startLine = i;
    let raw = lines[i];

    // Accumulate until we see a semicolon (statements can span lines)
    while (!raw.includes(';') && i + 1 < declEnd) {
      i++;
      raw += ' ' + lines[i];
    }

    const clean = stripComments(raw).trim();
    const lineRange = new vscode.Range(startLine, 0, i, lines[i]?.length ?? 0);

    if (!clean || clean === ';') { i++; continue; }

    // ── component ──────────────────────────────────────────────────────────
    const compM = clean.match(/^component\s+([A-Za-z_][A-Za-z0-9_-]*)([\s\S]*?);/);
    if (compM) {
      componentName = compM[1];
      declarations.push({
        kind: 'component', name: compM[1],
        doc: extractDoc(compM[2]),
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── pin ────────────────────────────────────────────────────────────────
    const pinM = clean.match(
      /^pin\s+(in|out|io)\s+(bit|signed|unsigned|float|s32|u32)\s+([A-Za-z_][A-Za-z0-9_.#-]*)([\s\S]*?);/
    );
    if (pinM) {
      const rest = pinM[4];
      const arrayM = rest.match(/\[([^\]]+)\]/);
      const condM = rest.match(/\bif\s+(.+?)(?:\s*=|\s*"|\s*$)/);
      const defM = rest.match(/=\s*([^";\s]+)/);
      declarations.push({
        kind: 'pin', name: halNameToC(pinM[3]),
        halName: halNameToHal(pinM[3]),
        direction: pinM[1], type: pinM[2],
        doc: extractDoc(rest),
        isArray: !!arrayM, arraySize: arrayM?.[1],
        conditional: condM?.[1]?.trim(),
        startValue: defM?.[1],
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── param ──────────────────────────────────────────────────────────────
    const paramM = clean.match(
      /^param\s+(r|rw)\s+(bit|signed|unsigned|float|s32|u32)\s+([A-Za-z_][A-Za-z0-9_.#-]*)([\s\S]*?);/
    );
    if (paramM) {
      const rest = paramM[4];
      const arrayM = rest.match(/\[([^\]]+)\]/);
      const defM = rest.match(/=\s*([^";\s]+)/);
      declarations.push({
        kind: 'param', name: halNameToC(paramM[3]),
        halName: halNameToHal(paramM[3]),
        direction: paramM[1], type: paramM[2],
        doc: extractDoc(rest),
        isArray: !!arrayM, arraySize: arrayM?.[1],
        startValue: defM?.[1],
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── function ───────────────────────────────────────────────────────────
    const fnM = clean.match(/^function\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(fp|nofp)?([\s\S]*?);/);
    if (fnM) {
      hasFunction = true;
      declarations.push({
        kind: 'function', name: halNameToC(fnM[1]),
        halName: halNameToHal(fnM[1]),
        qualifier: fnM[2] || 'fp',
        doc: extractDoc(fnM[3]),
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── variable ───────────────────────────────────────────────────────────
    const varM = clean.match(/^variable\s+(\S+)\s+(\*?)([A-Za-z_][A-Za-z0-9_]*)([\s\S]*?);/);
    if (varM) {
      const rest = varM[4];
      const arrayM = rest.match(/\[([^\]]+)\]/);
      const defM = rest.match(/=\s*([^;]+)/);
      declarations.push({
        kind: 'variable', name: varM[2] + varM[3],
        type: varM[1],
        isArray: !!arrayM, arraySize: arrayM?.[1],
        startValue: defM?.[1]?.trim(),
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── option ─────────────────────────────────────────────────────────────
    const optM = clean.match(/^option\s+(\S+)\s*(.*?)\s*;/);
    if (optM) {
      const optName = optM[1];
      const optVal = optM[2].trim();
      if (optName === 'userspace' && optVal !== 'no') isUserspace = true;
      if (optName === 'singleton' && optVal !== 'no') hasSingleton = true;
      declarations.push({
        kind: 'option', name: optName,
        doc: optVal || undefined,
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── license ────────────────────────────────────────────────────────────
    const licM = clean.match(/^license\s+([\s\S]*?);/);
    if (licM) {
      hasLicense = true;
      declarations.push({
        kind: 'license', name: extractDoc(licM[1]) || licM[1].trim(),
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── author ─────────────────────────────────────────────────────────────
    const authM = clean.match(/^author\s+([\s\S]*?);/);
    if (authM) {
      declarations.push({
        kind: 'author', name: extractDoc(authM[1]) || authM[1].trim(),
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    // ── description / examples / notes / see_also ──────────────────────────
    const docM = clean.match(/^(description|examples|notes|see_also)\s+([\s\S]*?);/);
    if (docM) {
      declarations.push({
        kind: 'description', name: docM[1],
        doc: extractDoc(docM[2]),
        line: startLine, range: lineRange
      });
      i++; continue;
    }

    i++;
  }

  return { declarations, separatorLine, componentName, hasLicense, hasFunction, isUserspace, hasSingleton };
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────

const RESERVED_NAMES = new Set([
  '_comp', 'comp_id', 'fperiod', 'rtapi_app_main', 'rtapi_app_exit',
  'extra_setup', 'extra_cleanup', 'period'
]);

const VALID_DECL_KEYWORDS = new Set([
  'component', 'pin', 'param', 'function', 'option', 'variable',
  'description', 'examples', 'notes', 'see_also', 'license', 'author', 'include'
]);

function getDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
  const diags: vscode.Diagnostic[] = [];
  const parsed = parseComp(document);
  const lines = document.getText().split('\n');

  const err = (range: vscode.Range, msg: string) =>
    new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error);
  const warn = (range: vscode.Range, msg: string) =>
    new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
  const hint = (range: vscode.Range, msg: string) =>
    new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Hint);

  const zeroRange = new vscode.Range(0, 0, 0, 0);

  // Missing component declaration
  const hasComponent = parsed.declarations.some(d => d.kind === 'component');
  if (!hasComponent) {
    diags.push(err(zeroRange, 'Missing "component" declaration'));
  }

  // Missing license (required by halcompile)
  if (!parsed.hasLicense) {
    diags.push(warn(zeroRange, 'Missing "license" declaration (required by halcompile)'));
  }

  // Missing ;; separator
  if (parsed.separatorLine < 0) {
    const lastLine = document.lineCount - 1;
    diags.push(err(
      new vscode.Range(lastLine, 0, lastLine, lines[lastLine]?.length ?? 0),
      'Missing ";;" separator — declarations must be followed by ";;" then C code'
    ));
  }

  // Missing function for realtime components
  if (!parsed.isUserspace && !parsed.hasFunction && hasComponent) {
    diags.push(warn(zeroRange, 'No "function" declaration (required for realtime components; add "option userspace yes;" for non-realtime)'));
  }

  // Userspace components must not declare functions
  if (parsed.isUserspace && parsed.hasFunction) {
    const fnDecl = parsed.declarations.find(d => d.kind === 'function');
    if (fnDecl) {
      diags.push(err(fnDecl.range, 'Userspace components cannot declare functions'));
    }
  }

  // Duplicate names among pins / params / functions / variables
  const seen = new Map<string, number>();
  for (const decl of parsed.declarations) {
    if (decl.kind === 'pin' || decl.kind === 'param' || decl.kind === 'function' || decl.kind === 'variable') {
      if (seen.has(decl.name)) {
        diags.push(err(
          decl.range,
          `Duplicate identifier "${decl.name}" (first declared at line ${seen.get(decl.name)! + 1})`
        ));
      } else {
        seen.set(decl.name, decl.line);
      }
    }
  }

  // Reserved names
  for (const decl of parsed.declarations) {
    if ((decl.kind === 'pin' || decl.kind === 'param' || decl.kind === 'variable') &&
        RESERVED_NAMES.has(decl.name)) {
      diags.push(err(decl.range, `"${decl.name}" is a reserved name in halcompile`));
    }
    if (decl.kind === 'variable' && decl.name.startsWith('_comp')) {
      diags.push(err(decl.range, 'Names beginning with "_comp" are reserved'));
    }
  }

  // s32/u32 deprecation hints (prefer signed/unsigned)
  for (const decl of parsed.declarations) {
    if ((decl.kind === 'pin' || decl.kind === 'param') &&
        (decl.type === 's32' || decl.type === 'u32')) {
      diags.push(hint(
        decl.range,
        `"${decl.type}" is deprecated; prefer "${decl.type === 's32' ? 'signed' : 'unsigned'}"`
      ));
    }
  }

  // Per-line checks in the declaration section
  const declEnd = parsed.separatorLine >= 0 ? parsed.separatorLine : lines.length;
  for (let lineIdx = 0; lineIdx < declEnd; lineIdx++) {
    const raw = lines[lineIdx];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

    // Unknown top-level keyword
    const kwMatch = trimmed.match(/^([a-z_]+)/);
    if (kwMatch && !VALID_DECL_KEYWORDS.has(kwMatch[1])) {
      const col = raw.indexOf(kwMatch[1]);
      diags.push(warn(
        new vscode.Range(lineIdx, col, lineIdx, col + kwMatch[1].length),
        `Unknown declaration keyword "${kwMatch[1]}"`
      ));
    }

    // Pin with 'in' direction named 'in' (C keyword collision)
    if (/^\s*pin\s+in\s+\S+\s+in\b/.test(raw)) {
      diags.push(warn(
        new vscode.Range(lineIdx, 0, lineIdx, raw.length),
        'Pin named "in" collides with C keyword; consider appending "_" (e.g. "in_")'
      ));
    }

    // param with rw direction but no '=' default (not an error but helpful)
    if (/^\s*param\s+rw\s/.test(raw) && !raw.includes('=') && raw.includes(';')) {
      diags.push(hint(
        new vscode.Range(lineIdx, 0, lineIdx, raw.length),
        'Read-write parameter has no default value (will default to 0/FALSE)'
      ));
    }
  }

  return diags;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOVER DOCUMENTATION
// ─────────────────────────────────────────────────────────────────────────────

const KEYWORD_DOCS: Record<string, string> = {
  component: [
    '### `component NAME "doc";`',
    'Declares the HAL component. The component name **must match the filename** (without `.comp`).',
  ].join('\n'),
  pin: [
    '### `pin DIRECTION TYPE NAME [...] [if COND] [= DEFAULT] "doc";`',
    'Declares a HAL pin.',
    '',
    '**Directions:** `in` (component reads), `out` (component writes), `io` (bidirectional)',
    '',
    '**Types:** `bit`, `float`, `signed` (s32), `unsigned` (u32)',
    '',
    'Array: `pin out bit out-#[4]` → pins `component.0.out-0` … `out-3`',
  ].join('\n'),
  param: [
    '### `param DIRECTION TYPE NAME [...] [= DEFAULT] "doc";`',
    'Declares a HAL parameter.',
    '',
    '**Directions:** `r` (read-only from HAL), `rw` (settable from HAL)',
  ].join('\n'),
  function: [
    '### `function NAME [fp|nofp] "doc";`',
    'Declares a realtime function.',
    '',
    '- `fp` — uses floating-point (default)',
    '- `nofp` — integer-only calculations',
    '',
    'Use `function _` to auto-name the function `componentname.<num>`.',
  ].join('\n'),
  option: [
    '### `option NAME [VALUE];`',
    'Sets a component option. Valid options:',
    '',
    '| Option | Default | Description |',
    '|--------|---------|-------------|',
    '| `singleton` | no | Only one instance |',
    '| `userspace` | no | Non-realtime component |',
    '| `extra_setup` | no | Enable `EXTRA_SETUP()` per instance |',
    '| `extra_cleanup` | no | Enable `EXTRA_CLEANUP()` |',
    '| `count_function` | no | Use `get_count()` for instance count |',
    '| `rtapi_app` | yes | Auto-generate `rtapi_app_main/exit` |',
    '| `default_count` | 1 | Default number of instances |',
    '| `homemod` | no | Custom homing module |',
    '| `tpmod` | no | Custom trajectory planning module |',
  ].join('\n'),
  variable: [
    '### `variable CTYPE NAME [SIZE] [= DEFAULT];`',
    'Declares a per-instance C variable. Each instance gets its own copy.',
    '',
    'Pointer form: `variable int *myptr;` (no space before `*`)',
  ].join('\n'),
  license: '### `license "LICENSE";`\n\nSpecifies the module license. **Required.** Example: `license "GPL";`',
  author: '### `author "AUTHOR";`\n\nSpecifies the module author for documentation.',
  include: '### `include <header.h>;` or `include "header.h";`\n\nIncludes a C header file in the generated code.',
  description: '### `description "DOC";`\n\nLong description of the component, in groff -man format.',
  // Directions
  in: '`in` — Input pin direction. Component reads this value from HAL.',
  out: '`out` — Output pin direction. Component writes this value to HAL.',
  io: '`io` — Bidirectional pin. Component may read or write this value.',
  r: '`r` — Read-only parameter. Component sets the value; HAL can only read it.',
  rw: '`rw` — Read-write parameter. Both HAL and component can read/write.',
  // Types
  bit: '`bit` — Boolean HAL type. Values: `TRUE` (1) or `FALSE` (0).',
  float: '`float` — 64-bit IEEE 754 double-precision floating-point.',
  signed: '`signed` (s32) — 32-bit signed integer. Range: −2,147,483,648 to 2,147,483,647.',
  unsigned: '`unsigned` (u32) — 32-bit unsigned integer. Range: 0 to 4,294,967,295.',
  s32: '`s32` — 32-bit signed integer *(deprecated; prefer `signed`)*.',
  u32: '`u32` — 32-bit unsigned integer *(deprecated; prefer `unsigned`)*.',
  // Qualifiers
  fp: '`fp` — Function uses floating-point calculations (default).',
  nofp: '`nofp` — Function uses integer-only calculations. Using FP in an `nofp` function causes undefined behavior.',
  // Conditions
  personality: '`personality` — Per-instance integer set at `loadrt` time. Used with `if` conditions and variable-size arrays to create pins/params conditionally.',
  if: '`if CONDITION` — Pin or parameter is only created when `personality & MASK` is nonzero.',
  // C macros
  FUNCTION: '### `FUNCTION(name) { ... }`\n\nDefines the body of a realtime function declared with `function`.\nThe implicit `period` parameter (nanoseconds) and `fperiod` (seconds) are available.',
  EXTRA_SETUP: '### `EXTRA_SETUP() { ... }`\n\nPer-instance setup function, called after pins/params are created.\nReturn `0` for success or a negative `errno` value on failure.',
  EXTRA_CLEANUP: '### `EXTRA_CLEANUP() { ... }`\n\nCalled when the module is unloaded. Must clean up **all** instances.',
  FOR_ALL_INSTS: '### `FOR_ALL_INSTS() { ... }`\n\nIterates over all instances (userspace components only). Inside the loop, pin/param macros work normally.',
  fperiod: '`fperiod` — Floating-point seconds between realtime function calls (`period * 1e-9`). Available inside `FUNCTION()`.',
};

function provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!wordRange) return null;

  const word = document.getText(wordRange);
  const parsed = parseComp(document);
  const inC = parsed.separatorLine >= 0 && position.line > parsed.separatorLine;

  // Keyword hover
  if (KEYWORD_DOCS[word]) {
    return new vscode.Hover(new vscode.MarkdownString(KEYWORD_DOCS[word]), wordRange);
  }

  // Declared item hover
  const decl = parsed.declarations.find(d => {
    if (inC) {
      // In C section, match by C identifier form
      return d.name === word;
    }
    return d.name === word || d.halName === word;
  });

  if (decl) {
    const md = new vscode.MarkdownString();
    if (decl.kind === 'pin') {
      md.appendMarkdown(`**pin** \`${decl.name}\`\n\n`);
      md.appendMarkdown(`Direction: \`${decl.direction}\`  \nType: \`${decl.type}\``);
      if (decl.isArray) md.appendMarkdown(`  \nArray size: \`${decl.arraySize}\``);
      if (decl.conditional) md.appendMarkdown(`  \nCondition: \`if ${decl.conditional}\``);
      if (decl.startValue) md.appendMarkdown(`  \nDefault: \`${decl.startValue}\``);
      if (decl.doc) md.appendMarkdown(`\n\n${decl.doc}`);
      if (decl.halName) md.appendMarkdown(`\n\n*HAL name: \`${decl.halName}\`*`);
    } else if (decl.kind === 'param') {
      md.appendMarkdown(`**param** \`${decl.name}\`\n\n`);
      md.appendMarkdown(`Direction: \`${decl.direction}\`  \nType: \`${decl.type}\``);
      if (decl.startValue) md.appendMarkdown(`  \nDefault: \`${decl.startValue}\``);
      if (decl.doc) md.appendMarkdown(`\n\n${decl.doc}`);
      if (decl.halName) md.appendMarkdown(`\n\n*HAL name: \`${decl.halName}\`*`);
    } else if (decl.kind === 'variable') {
      md.appendMarkdown(`**variable** \`${decl.name}\`  \nC type: \`${decl.type}\``);
      if (decl.isArray) md.appendMarkdown(`  \nArray size: \`${decl.arraySize}\``);
      if (decl.startValue) md.appendMarkdown(`  \nDefault: \`${decl.startValue}\``);
    } else if (decl.kind === 'function') {
      md.appendMarkdown(`**function** \`${decl.name}\`  \nQualifier: \`${decl.qualifier ?? 'fp'}\``);
      if (decl.doc) md.appendMarkdown(`\n\n${decl.doc}`);
    } else if (decl.kind === 'component') {
      md.appendMarkdown(`**component** \`${decl.name}\``);
      if (decl.doc) md.appendMarkdown(`\n\n${decl.doc}`);
    }
    if (md.value) return new vscode.Hover(md, wordRange);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETION
// ─────────────────────────────────────────────────────────────────────────────

interface KwItem { label: string; detail: string; snippet: string; doc?: string; }

const DECL_KEYWORDS: KwItem[] = [
  { label: 'component', detail: 'Declare the component',            snippet: 'component ${1:name} "${2:description}";' },
  { label: 'pin',       detail: 'Declare a HAL pin',                snippet: 'pin ${1|in,out,io|} ${2|bit,float,signed,unsigned|} ${3:name} "${4:description}";' },
  { label: 'param',     detail: 'Declare a HAL parameter',          snippet: 'param ${1|r,rw|} ${2|bit,float,signed,unsigned|} ${3:name} = ${4:0} "${5:description}";' },
  { label: 'function',  detail: 'Declare a realtime function',      snippet: 'function ${1:_} ${2|fp,nofp|};' },
  { label: 'option',    detail: 'Set a component option',           snippet: 'option ${1|singleton,userspace,extra_setup,extra_cleanup|} ${2|yes,no|};' },
  { label: 'variable',  detail: 'Declare a per-instance variable',  snippet: 'variable ${1:double} ${2:name} = ${3:0};' },
  { label: 'license',   detail: 'Module license (required)',        snippet: 'license "GPL"; // indicates GPL v2 or later' },
  { label: 'author',    detail: 'Module author',                    snippet: 'author "${1:Your Name}";' },
  { label: 'description', detail: 'Long component description',     snippet: 'description "${1:description}";' },
  { label: 'include',   detail: 'Include a header file',            snippet: 'include <${1:rtapi_math.h}>;' },
];

const PIN_DIRECTIONS   = ['in', 'out', 'io'];
const PARAM_DIRECTIONS = ['r', 'rw'];
const HAL_TYPES        = ['bit', 'float', 'signed', 'unsigned', 's32', 'u32'];
const BOOL_VALUES      = ['yes', 'no'];
const FN_QUALIFIERS    = ['fp', 'nofp'];

const OPTION_NAMES: KwItem[] = [
  { label: 'singleton',          detail: 'Only one instance created', snippet: 'singleton yes;' },
  { label: 'userspace',          detail: 'Non-realtime component',     snippet: 'userspace yes;' },
  { label: 'extra_setup',        detail: 'Enable EXTRA_SETUP()',       snippet: 'extra_setup yes;' },
  { label: 'extra_cleanup',      detail: 'Enable EXTRA_CLEANUP()',     snippet: 'extra_cleanup yes;' },
  { label: 'count_function',     detail: 'Use get_count() for instance count', snippet: 'count_function yes;' },
  { label: 'default_count',      detail: 'Default instance count',    snippet: 'default_count ${1:1};' },
  { label: 'rtapi_app',          detail: 'Auto rtapi_app_main/exit',  snippet: 'rtapi_app no;' },
  { label: 'homemod',            detail: 'Custom homing module',      snippet: 'homemod yes;' },
  { label: 'tpmod',              detail: 'Custom TP module',          snippet: 'tpmod yes;' },
];

const C_MACROS: KwItem[] = [
  { label: 'FUNCTION',        detail: 'Realtime function body',       snippet: 'FUNCTION(${1:_}) {\n\t$0\n}' },
  { label: 'EXTRA_SETUP',     detail: 'Per-instance setup',          snippet: 'EXTRA_SETUP() {\n\t$0\n\treturn 0;\n}' },
  { label: 'EXTRA_CLEANUP',   detail: 'Module cleanup',              snippet: 'EXTRA_CLEANUP() {\n\t$0\n}' },
  { label: 'FOR_ALL_INSTS',   detail: 'Iterate all instances',       snippet: 'FOR_ALL_INSTS() {\n\t$0\n}' },
  { label: 'fperiod',         detail: 'Period in seconds (float)',   snippet: 'fperiod' },
];

function makeSnippet(item: KwItem, kind: vscode.CompletionItemKind): vscode.CompletionItem {
  const ci = new vscode.CompletionItem(item.label, kind);
  ci.insertText = new vscode.SnippetString(item.snippet);
  ci.detail = item.detail;
  if (item.doc) ci.documentation = new vscode.MarkdownString(item.doc);
  return ci;
}

function makeKw(label: string, detail?: string): vscode.CompletionItem {
  const ci = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
  if (detail) ci.detail = detail;
  return ci;
}

function provideCompletions(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] {

  const parsed = parseComp(document);
  const line = document.lineAt(position.line).text;
  const before = line.substring(0, position.character);
  const trimBefore = before.trim();

  const inC = parsed.separatorLine >= 0 && position.line > parsed.separatorLine;

  // ── C section completions ──────────────────────────────────────────────────
  if (inC) {
    const items: vscode.CompletionItem[] = [];

    // Macro snippets
    for (const m of C_MACROS) {
      items.push(makeSnippet(m, vscode.CompletionItemKind.Snippet));
    }

    // All declared identifiers (pins, params, variables) as completions
    for (const decl of parsed.declarations) {
      if (decl.kind === 'pin' || decl.kind === 'param' || decl.kind === 'variable') {
        const ci = new vscode.CompletionItem(decl.name, vscode.CompletionItemKind.Variable);
        ci.detail = `${decl.kind} (${decl.type ?? ''})`;
        if (decl.doc) ci.documentation = new vscode.MarkdownString(decl.doc);
        items.push(ci);
      }
      if (decl.kind === 'function') {
        const macro = `FUNCTION(${decl.name})`;
        const ci = new vscode.CompletionItem(macro, vscode.CompletionItemKind.Function);
        ci.insertText = new vscode.SnippetString(`FUNCTION(${decl.name}) {\n\t$0\n}`);
        ci.detail = `function body (${decl.qualifier ?? 'fp'})`;
        items.push(ci);
      }
    }
    return items;
  }

  // ── Declaration section completions ───────────────────────────────────────

  // After 'option '
  if (/^option\s+\w*$/.test(trimBefore)) {
    return OPTION_NAMES.map(o => makeSnippet(o, vscode.CompletionItemKind.Property));
  }

  // After 'option NAME '
  if (/^option\s+\S+\s+\w*$/.test(trimBefore)) {
    return BOOL_VALUES.map(v => makeKw(v));
  }

  // After 'pin '
  if (/^pin\s*$/.test(trimBefore)) {
    return PIN_DIRECTIONS.map(d => makeKw(d, d === 'in' ? 'Input (component reads)' : d === 'out' ? 'Output (component writes)' : 'Bidirectional'));
  }

  // After 'param '
  if (/^param\s*$/.test(trimBefore)) {
    return PARAM_DIRECTIONS.map(d => makeKw(d, d === 'r' ? 'Read-only' : 'Read-write'));
  }

  // After 'pin DIR ' or 'param DIR '
  if (/^(pin\s+(in|out|io)|param\s+(r|rw))\s*$/.test(trimBefore)) {
    return HAL_TYPES.map(t => {
      const ci = makeKw(t);
      const desc: Record<string, string> = {
        bit: 'Boolean (TRUE/FALSE)', float: '64-bit float',
        signed: '32-bit signed int', unsigned: '32-bit unsigned int',
        s32: '32-bit signed int (deprecated)', u32: '32-bit unsigned int (deprecated)'
      };
      ci.detail = desc[t];
      return ci;
    });
  }

  // After 'function NAME '
  if (/^function\s+\S+\s*$/.test(trimBefore)) {
    return FN_QUALIFIERS.map(q => makeKw(q, q === 'fp' ? 'Uses floating-point (default)' : 'Integer-only'));
  }

  // At start of line (empty or partial keyword)
  if (!trimBefore || /^[a-z_]*$/.test(trimBefore)) {
    return DECL_KEYWORDS.map(k => makeSnippet(k, vscode.CompletionItemKind.Keyword));
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// GO-TO DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

function provideDefinition(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Location | null {

  const parsed = parseComp(document);
  // Only useful in C section
  if (parsed.separatorLine < 0 || position.line <= parsed.separatorLine) return null;

  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
  if (!wordRange) return null;

  const word = document.getText(wordRange);

  const decl = parsed.declarations.find(d =>
    d.name === word ||
    (d.halName && d.halName.replace(/-/g, '_') === word)
  );

  if (decl) {
    return new vscode.Location(document.uri, decl.range.start);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATION
// ─────────────────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const diagCollection = vscode.languages.createDiagnosticCollection('linuxcnc-comp');
  context.subscriptions.push(diagCollection);

  function refreshDiags(doc: vscode.TextDocument): void {
    if (doc.languageId === 'linuxcnc-comp') {
      diagCollection.set(doc.uri, getDiagnostics(doc));
    }
  }

  // Completion
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'linuxcnc-comp' },
      {
        provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position) {
          return provideCompletions(doc, pos);
        }
      },
      ' ', '\t'
    )
  );

  // Hover
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'linuxcnc-comp' },
      {
        provideHover(doc: vscode.TextDocument, pos: vscode.Position) {
          return provideHover(doc, pos);
        }
      }
    )
  );

  // Go-to definition
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { language: 'linuxcnc-comp' },
      {
        provideDefinition(doc: vscode.TextDocument, pos: vscode.Position) {
          return provideDefinition(doc, pos);
        }
      }
    )
  );

  // Diagnostics on open / change / close
  vscode.workspace.onDidOpenTextDocument(
    (doc: vscode.TextDocument) => refreshDiags(doc), null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument(
    (e: vscode.TextDocumentChangeEvent) => refreshDiags(e.document), null, context.subscriptions);
  vscode.workspace.onDidCloseTextDocument(
    (doc: vscode.TextDocument) => diagCollection.delete(doc.uri), null, context.subscriptions);

  // Formatter
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: 'linuxcnc-comp' },
      {
        provideDocumentFormattingEdits(doc: vscode.TextDocument) {
          return provideDocumentFormatting(doc);
        }
      }
    )
  );

  // Run on already-open docs
  vscode.workspace.textDocuments.forEach(refreshDiags);
}

export function deactivate(): void { /* nothing */ }

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTER
// ─────────────────────────────────────────────────────────────────────────────

interface PinParamParts {
  keyword: string;
  direction: string;
  type: string;
  name: string;
  middle: string;   // array size, if condition, = default
  doc: string;      // quoted doc string
  comment: string;  // trailing // comment
}

interface FunctionParts {
  name: string;
  qualifier: string;
  doc: string;
  comment: string;
}

interface VariableParts {
  ctype: string;
  name: string;
  middle: string;   // array and/or = default
  comment: string;
}

/** Extract a trailing // comment and return [withoutComment, comment] */
function splitTrailingComment(s: string): [string, string] {
  // Don't strip // inside quoted strings
  let inStr = false;
  let inTriple = false;
  for (let i = 0; i < s.length; i++) {
    if (!inStr && s.slice(i, i + 3) === '"""') { inTriple = !inTriple; i += 2; continue; }
    if (!inTriple && s[i] === '"') { inStr = !inStr; continue; }
    if (!inStr && !inTriple && s.slice(i, i + 2) === '//') {
      return [s.slice(0, i).trimEnd(), ' ' + s.slice(i).trim()];
    }
  }
  return [s, ''];
}

/** Extract the last quoted string (single or triple) before a semicolon */
function extractDocAndMiddle(s: string): [string, string] {
  // Try triple-quoted
  const triM = s.match(/(r?"""[\s\S]*?""")\s*;?\s*$/);
  if (triM) {
    const idx = s.lastIndexOf(triM[1]);
    return [triM[1], s.slice(0, idx).trim()];
  }
  // Try single-quoted
  const sinM = s.match(/(r?"(?:[^"\\]|\\.)*")\s*;?\s*$/);
  if (sinM) {
    const idx = s.lastIndexOf(sinM[1]);
    return [sinM[1], s.slice(0, idx).trim()];
  }
  return ['', s.replace(/\s*;?\s*$/, '').trim()];
}

function parsePinParam(line: string, kw: string): PinParamParts | null {
  const [noComment, comment] = splitTrailingComment(line.trim());
  let s = noComment.trim();

  // Strip keyword
  if (!s.startsWith(kw)) return null;
  s = s.slice(kw.length).trim();

  // Direction
  const dirRe = kw === 'pin' ? /^(in|out|io)\s+/ : /^(r|rw)\s+/;
  const dirM = s.match(dirRe);
  if (!dirM) return null;
  const direction = dirM[1];
  s = s.slice(dirM[0].length).trim();

  // Type
  const typeM = s.match(/^(bit|signed|unsigned|float|s32|u32)\s+/);
  if (!typeM) return null;
  const type = typeM[1];
  s = s.slice(typeM[0].length).trim();

  // Name
  const nameM = s.match(/^([A-Za-z_][A-Za-z0-9_.#-]*)/);
  if (!nameM) return null;
  const name = nameM[1];
  s = s.slice(nameM[0].length);

  const [doc, middle] = extractDocAndMiddle(s);
  return { keyword: kw, direction, type, name, middle, doc, comment };
}

function reassemblePinParam(
  p: PinParamParts,
  dirW: number, typeW: number, nameW: number
): string {
  let line = p.keyword + ' ';
  line += p.direction.padEnd(dirW) + ' ';
  line += p.type.padEnd(typeW) + ' ';
  // Only pad name if there's something after it
  const hasAfter = p.middle || p.doc;
  line += hasAfter ? p.name.padEnd(nameW) : p.name;
  if (p.middle) line += ' ' + p.middle;
  if (p.doc)    line += ' ' + p.doc;
  line += ';';
  if (p.comment) line += p.comment;
  return line;
}

function alignPinParamBlock(lines: string[], kw: string): string[] {
  const parsed = lines.map(l => parsePinParam(l, kw));
  if (parsed.some(p => p === null)) return lines.map(l => normalizeDeclSpacing(l));

  const ps = parsed as PinParamParts[];
  const dirW  = Math.max(...ps.map(p => p.direction.length));
  const typeW = Math.max(...ps.map(p => p.type.length));
  const nameW = Math.max(...ps.map(p => (p.middle || p.doc) ? p.name.length : 0));

  return ps.map(p => reassemblePinParam(p, dirW, typeW, nameW));
}

function parseFunctionDecl(line: string): FunctionParts | null {
  const [noComment, comment] = splitTrailingComment(line.trim());
  let s = noComment.trim();
  if (!s.startsWith('function')) return null;
  s = s.slice('function'.length).trim();

  const nameM = s.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
  if (!nameM) return null;
  const name = nameM[1];
  s = s.slice(nameM[0].length).trim();

  let qualifier = '';
  const qualM = s.match(/^(fp|nofp)\b/);
  if (qualM) { qualifier = qualM[1]; s = s.slice(qualM[0].length).trim(); }

  const [doc] = extractDocAndMiddle(s);
  return { name, qualifier, doc, comment };
}

function alignFunctionBlock(lines: string[]): string[] {
  const parsed = lines.map(l => parseFunctionDecl(l));
  if (parsed.some(p => p === null)) return lines.map(l => normalizeDeclSpacing(l));

  const ps = parsed as FunctionParts[];
  const nameW = Math.max(...ps.map(p => p.name.length));
  const qualW = Math.max(...ps.map(p => p.qualifier.length));

  return ps.map(p => {
    let line = 'function ' + (p.qualifier || p.doc ? p.name.padEnd(nameW) : p.name);
    if (p.qualifier) line += ' ' + (p.doc ? p.qualifier.padEnd(qualW) : p.qualifier);
    if (p.doc)       line += ' ' + p.doc;
    line += ';';
    if (p.comment) line += p.comment;
    return line;
  });
}

function parseVariableDecl(line: string): VariableParts | null {
  const [noComment, comment] = splitTrailingComment(line.trim());
  let s = noComment.trim();
  if (!s.startsWith('variable')) return null;
  s = s.slice('variable'.length).trim();

  // C type (one word)
  const typeM = s.match(/^(\S+)\s+/);
  if (!typeM) return null;
  const ctype = typeM[1];
  s = s.slice(typeM[0].length).trim();

  // Name (with optional leading *)
  const nameM = s.match(/^(\*?)([A-Za-z_][A-Za-z0-9_]*)/);
  if (!nameM) return null;
  const name = nameM[1] + nameM[2];
  s = s.slice(nameM[0].length).replace(/\s*;?\s*$/, '').trim();

  return { ctype, name, middle: s, comment };
}

function alignVariableBlock(lines: string[]): string[] {
  const parsed = lines.map(l => parseVariableDecl(l));
  if (parsed.some(p => p === null)) return lines.map(l => normalizeDeclSpacing(l));

  const ps = parsed as VariableParts[];
  const typeW = Math.max(...ps.map(p => p.ctype.length));
  const nameW = Math.max(...ps.map(p => p.middle ? p.name.length : 0));

  return ps.map(p => {
    let line = 'variable ' + p.ctype.padEnd(typeW) + ' ';
    line += p.middle ? p.name.padEnd(nameW) : p.name;
    if (p.middle) line += ' ' + p.middle;
    line += ';';
    if (p.comment) line += p.comment;
    return line;
  });
}

/** Normalize spacing inside a single declaration line (no alignment) */
function normalizeDeclSpacing(line: string): string {
  const trimmed = line.trim();
  // Preserve blank lines
  if (!trimmed) return '';
  // Preserve comment-only lines as-is (trimmed)
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return trimmed;
  }
  // For declaration lines: collapse runs of whitespace to one space,
  // but preserve quoted strings verbatim.
  let result = '';
  let i = 0;
  while (i < trimmed.length) {
    // Triple-quoted string
    if (trimmed.slice(i, i + 3) === '"""' || trimmed.slice(i, i + 4) === 'r"""') {
      const start = trimmed[i] === 'r' ? i : i;
      const prefix = trimmed[i] === 'r' ? 'r"""' : '"""';
      const from = i + prefix.length;
      const end = trimmed.indexOf('"""', from);
      if (end >= 0) {
        if (result.length > 0 && result[result.length - 1] !== ' ') result += ' ';
        result += trimmed.slice(i, end + 3);
        i = end + 3;
        continue;
      }
    }
    // Single-quoted string
    if (trimmed[i] === '"' || (trimmed[i] === 'r' && trimmed[i + 1] === '"')) {
      const prefix = trimmed[i] === 'r' ? 2 : 1;
      let j = i + prefix;
      while (j < trimmed.length) {
        if (trimmed[j] === '\\') { j += 2; continue; }
        if (trimmed[j] === '"') { j++; break; }
        j++;
      }
      if (result.length > 0 && result[result.length - 1] !== ' ') result += ' ';
      result += trimmed.slice(i, j);
      i = j;
      continue;
    }
    // Whitespace: collapse to single space
    if (/\s/.test(trimmed[i])) {
      if (result.length > 0 && result[result.length - 1] !== ' ') result += ' ';
      while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
      continue;
    }
    result += trimmed[i];
    i++;
  }
  return result.trimEnd();
}

function getDeclKeyword(line: string): string {
  const m = line.trim().match(/^(pin|param|function|variable|component|option|license|author|description|examples|notes|see_also|include)\b/);
  return m ? m[1] : '';
}

function formatDeclSection(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const kw = getDeclKeyword(lines[i]);

    // Collect a consecutive block of the same alignable keyword
    if (kw === 'pin' || kw === 'param' || kw === 'function' || kw === 'variable') {
      const block: string[] = [lines[i]];
      let j = i + 1;
      while (j < lines.length) {
        const nextKw = getDeclKeyword(lines[j]);
        const nextLine = lines[j].trim();
        // Allow a single blank line within a block but stop at other keywords or comments
        if (nextKw === kw) {
          block.push(lines[j]);
          j++;
        } else if (!nextLine && j + 1 < lines.length && getDeclKeyword(lines[j + 1]) === kw) {
          // blank line separator within a block — flush block, start fresh
          break;
        } else {
          break;
        }
      }

      let aligned: string[];
      if      (kw === 'pin' || kw === 'param') aligned = alignPinParamBlock(block, kw);
      else if (kw === 'function')               aligned = alignFunctionBlock(block);
      else                                       aligned = alignVariableBlock(block);

      result.push(...aligned);
      i = j;
    } else {
      // Non-alignable line: just normalize spacing
      result.push(normalizeDeclSpacing(lines[i]));
      i++;
    }
  }

  return result;
}

function formatComp(text: string): string {
  const lines = text.split('\n');

  // Find separator
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*;;/.test(lines[i])) { sepIdx = i; break; }
  }

  const declLines = sepIdx >= 0 ? lines.slice(0, sepIdx) : lines;
  const cLines    = sepIdx >= 0 ? lines.slice(sepIdx)    : [];

  // Format declaration section
  const formattedDecl = formatDeclSection(declLines);

  // Collapse more than 2 consecutive blank lines in decl section
  const collapsed: string[] = [];
  let blankRun = 0;
  for (const l of formattedDecl) {
    if (l === '') { blankRun++; if (blankRun <= 1) collapsed.push(l); }
    else          { blankRun = 0; collapsed.push(l); }
  }

  // C section: only strip trailing whitespace — never reformat C code
  const formattedC = cLines.map(l => l.trimEnd());

  return [...collapsed, ...formattedC].join('\n');
}

function provideDocumentFormatting(document: vscode.TextDocument): vscode.TextEdit[] {
  const original = document.getText();
  const formatted = formatComp(original);
  if (formatted === original) return [];
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(original.length)
  );
  return [vscode.TextEdit.replace(fullRange, formatted)];
}
