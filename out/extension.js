"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = exports.parseComp = void 0;

const vscode = require("vscode");

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

function stripComments(s) {
    s = s.replace(/\/\/[^\n]*/g, '');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '');
    return s;
}

function extractDoc(s) {
    const triple = s.match(/"""([\s\S]*?)"""/);
    if (triple) return triple[1].trim();
    const single = s.match(/"((?:[^"\\]|\\.)*)"/);
    if (single) return single[1];
    return undefined;
}

function halNameToC(halName) {
    let c = halName.replace(/[._-]*#+/g, '');
    c = c.replace(/[.\-]/g, '_');
    c = c.replace(/__+/g, '_');
    return c;
}

function halNameToHal(halName) {
    return halName.replace(/_/g, '-').replace(/[-.]$/, '');
}

function parseComp(document) {
    const declarations = [];
    let separatorLine = -1;
    let componentName = '';
    let hasLicense = false;
    let hasFunction = false;
    let isUserspace = false;
    let hasSingleton = false;

    const lines = document.getText().split('\n');

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

        while (!raw.includes(';') && i + 1 < declEnd) {
            i++;
            raw += ' ' + lines[i];
        }

        const clean = stripComments(raw).trim();
        const lineRange = new vscode.Range(startLine, 0, i, (lines[i] || '').length);

        if (!clean || clean === ';') { i++; continue; }

        const compM = clean.match(/^component\s+([A-Za-z_][A-Za-z0-9_-]*)([\s\S]*?);/);
        if (compM) {
            componentName = compM[1];
            declarations.push({ kind: 'component', name: compM[1], doc: extractDoc(compM[2]), line: startLine, range: lineRange });
            i++; continue;
        }

        const pinM = clean.match(/^pin\s+(in|out|io)\s+(bit|signed|unsigned|float|s32|u32)\s+([A-Za-z_][A-Za-z0-9_.#-]*)([\s\S]*?);/);
        if (pinM) {
            const rest = pinM[4];
            const arrayM = rest.match(/\[([^\]]+)\]/);
            const condM = rest.match(/\bif\s+(.+?)(?:\s*=|\s*"|\s*$)/);
            const defM = rest.match(/=\s*([^";\s]+)/);
            declarations.push({
                kind: 'pin', name: halNameToC(pinM[3]), halName: halNameToHal(pinM[3]),
                direction: pinM[1], type: pinM[2], doc: extractDoc(rest),
                isArray: !!arrayM, arraySize: arrayM ? arrayM[1] : undefined,
                conditional: condM ? condM[1].trim() : undefined,
                startValue: defM ? defM[1] : undefined,
                line: startLine, range: lineRange
            });
            i++; continue;
        }

        const paramM = clean.match(/^param\s+(r|rw)\s+(bit|signed|unsigned|float|s32|u32)\s+([A-Za-z_][A-Za-z0-9_.#-]*)([\s\S]*?);/);
        if (paramM) {
            const rest = paramM[4];
            const arrayM = rest.match(/\[([^\]]+)\]/);
            const defM = rest.match(/=\s*([^";\s]+)/);
            declarations.push({
                kind: 'param', name: halNameToC(paramM[3]), halName: halNameToHal(paramM[3]),
                direction: paramM[1], type: paramM[2], doc: extractDoc(rest),
                isArray: !!arrayM, arraySize: arrayM ? arrayM[1] : undefined,
                startValue: defM ? defM[1] : undefined,
                line: startLine, range: lineRange
            });
            i++; continue;
        }

        const fnM = clean.match(/^function\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(fp|nofp)?([\s\S]*?);/);
        if (fnM) {
            hasFunction = true;
            declarations.push({
                kind: 'function', name: halNameToC(fnM[1]), halName: halNameToHal(fnM[1]),
                qualifier: fnM[2] || 'fp', doc: extractDoc(fnM[3]),
                line: startLine, range: lineRange
            });
            i++; continue;
        }

        const varM = clean.match(/^variable\s+(\S+)\s+(\*?)([A-Za-z_][A-Za-z0-9_]*)([\s\S]*?);/);
        if (varM) {
            const rest = varM[4];
            const arrayM = rest.match(/\[([^\]]+)\]/);
            const defM = rest.match(/=\s*([^;]+)/);
            declarations.push({
                kind: 'variable', name: varM[2] + varM[3], type: varM[1],
                isArray: !!arrayM, arraySize: arrayM ? arrayM[1] : undefined,
                startValue: defM ? defM[1].trim() : undefined,
                line: startLine, range: lineRange
            });
            i++; continue;
        }

        const optM = clean.match(/^option\s+(\S+)\s*(.*?)\s*;/);
        if (optM) {
            const optName = optM[1];
            const optVal = optM[2].trim();
            if (optName === 'userspace' && optVal !== 'no') isUserspace = true;
            if (optName === 'singleton' && optVal !== 'no') hasSingleton = true;
            declarations.push({ kind: 'option', name: optName, doc: optVal || undefined, line: startLine, range: lineRange });
            i++; continue;
        }

        const licM = clean.match(/^license\s+([\s\S]*?);/);
        if (licM) {
            hasLicense = true;
            declarations.push({ kind: 'license', name: extractDoc(licM[1]) || licM[1].trim(), line: startLine, range: lineRange });
            i++; continue;
        }

        const authM = clean.match(/^author\s+([\s\S]*?);/);
        if (authM) {
            declarations.push({ kind: 'author', name: extractDoc(authM[1]) || authM[1].trim(), line: startLine, range: lineRange });
            i++; continue;
        }

        const docDeclM = clean.match(/^(description|examples|notes|see_also)\s+([\s\S]*?);/);
        if (docDeclM) {
            declarations.push({ kind: 'description', name: docDeclM[1], doc: extractDoc(docDeclM[2]), line: startLine, range: lineRange });
            i++; continue;
        }

        i++;
    }

    return { declarations, separatorLine, componentName, hasLicense, hasFunction, isUserspace, hasSingleton };
}
exports.parseComp = parseComp;

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

function getDiagnostics(document) {
    const diags = [];
    const parsed = parseComp(document);
    const lines = document.getText().split('\n');

    const err  = (range, msg) => new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error);
    const warn = (range, msg) => new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
    const hint = (range, msg) => new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Hint);
    const zero = new vscode.Range(0, 0, 0, 0);

    const hasComponent = parsed.declarations.some(d => d.kind === 'component');
    if (!hasComponent)
        diags.push(err(zero, 'Missing "component" declaration'));

    if (!parsed.hasLicense)
        diags.push(warn(zero, 'Missing "license" declaration (required by halcompile)'));

    if (parsed.separatorLine < 0) {
        const last = document.lineCount - 1;
        diags.push(err(new vscode.Range(last, 0, last, (lines[last] || '').length),
            'Missing ";;" separator — declarations must be followed by ";;" then C code'));
    }

    if (!parsed.isUserspace && !parsed.hasFunction && hasComponent)
        diags.push(warn(zero,
            'No "function" declared (required for realtime components; add "option userspace yes;" for non-realtime)'));

    if (parsed.isUserspace && parsed.hasFunction) {
        const fnDecl = parsed.declarations.find(d => d.kind === 'function');
        if (fnDecl) diags.push(err(fnDecl.range, 'Userspace components cannot declare functions'));
    }

    const seen = new Map();
    for (const decl of parsed.declarations) {
        if (decl.kind === 'pin' || decl.kind === 'param' || decl.kind === 'function' || decl.kind === 'variable') {
            if (seen.has(decl.name)) {
                diags.push(err(decl.range,
                    `Duplicate identifier "${decl.name}" (first declared at line ${seen.get(decl.name) + 1})`));
            } else {
                seen.set(decl.name, decl.line);
            }
        }
    }

    for (const decl of parsed.declarations) {
        if ((decl.kind === 'pin' || decl.kind === 'param' || decl.kind === 'variable') && RESERVED_NAMES.has(decl.name))
            diags.push(err(decl.range, `"${decl.name}" is a reserved name in halcompile`));
        if (decl.kind === 'variable' && decl.name.startsWith('_comp'))
            diags.push(err(decl.range, 'Names beginning with "_comp" are reserved'));
    }

    for (const decl of parsed.declarations) {
        if ((decl.kind === 'pin' || decl.kind === 'param') && (decl.type === 's32' || decl.type === 'u32'))
            diags.push(hint(decl.range,
                `"${decl.type}" is deprecated; prefer "${decl.type === 's32' ? 'signed' : 'unsigned'}"`));
    }

    const declEnd = parsed.separatorLine >= 0 ? parsed.separatorLine : lines.length;
    for (let li = 0; li < declEnd; li++) {
        const raw = lines[li];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

        const kwMatch = trimmed.match(/^([a-z_]+)/);
        if (kwMatch && !VALID_DECL_KEYWORDS.has(kwMatch[1])) {
            const col = raw.indexOf(kwMatch[1]);
            diags.push(warn(new vscode.Range(li, col, li, col + kwMatch[1].length),
                `Unknown declaration keyword "${kwMatch[1]}"`));
        }

        if (/^\s*pin\s+in\s+\S+\s+in\b/.test(raw))
            diags.push(warn(new vscode.Range(li, 0, li, raw.length),
                'Pin named "in" collides with C keyword; consider appending "_"'));

        if (/^\s*param\s+rw\s/.test(raw) && !raw.includes('=') && raw.includes(';'))
            diags.push(hint(new vscode.Range(li, 0, li, raw.length),
                'Read-write parameter has no default value (will default to 0/FALSE)'));
    }

    return diags;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOVER
// ─────────────────────────────────────────────────────────────────────────────

const KEYWORD_DOCS = {
    component: '### `component NAME "doc";`\n\nDeclares the HAL component. The component name **must match the filename** (without `.comp`).',
    pin: '### `pin DIRECTION TYPE NAME [...] [if COND] [= DEFAULT] "doc";`\n\nDeclares a HAL pin.\n\n**Directions:** `in` (component reads), `out` (component writes), `io` (bidirectional)\n\n**Types:** `bit`, `float`, `signed` (s32), `unsigned` (u32)\n\nArray example: `pin out bit out-#[4]` → HAL pins `component.0.out-0` … `out-3`',
    param: '### `param DIRECTION TYPE NAME [...] [= DEFAULT] "doc";`\n\nDeclares a HAL parameter.\n\n**Directions:** `r` (read-only from HAL), `rw` (settable from HAL)',
    function: '### `function NAME [fp|nofp] "doc";`\n\nDeclares a realtime function.\n\n- `fp` — uses floating-point (default)\n- `nofp` — integer-only calculations\n\nUse `function _` to auto-name: `componentname.<num>`',
    option: '### `option NAME [VALUE];`\n\nSets a component option.\n\n| Option | Default | Description |\n|---|---|---|\n| `singleton` | no | One instance only |\n| `userspace` | no | Non-realtime component |\n| `extra_setup` | no | Enable `EXTRA_SETUP()` |\n| `extra_cleanup` | no | Enable `EXTRA_CLEANUP()` |\n| `count_function` | no | Use `get_count()` |\n| `rtapi_app` | yes | Auto-generate app main/exit |\n| `default_count` | 1 | Default instance count |\n| `homemod` | no | Custom homing module |\n| `tpmod` | no | Custom TP module |',
    variable: '### `variable CTYPE NAME [SIZE] [= DEFAULT];`\n\nDeclares a per-instance C variable. Each instance gets its own copy.\n\nPointer: `variable int *myptr;` (no space before `*`)',
    license: '### `license "LICENSE";`\n\nSpecifies the module license. **Required.** Example: `license "GPL";`',
    author: '### `author "AUTHOR";`\n\nSpecifies the module author for documentation.',
    include: '### `include <header.h>;` or `include "header.h";`\n\nIncludes a C header in the generated code.',
    description: '### `description "DOC";`\n\nLong description in groff -man format.',
    in: '`in` — Input pin direction. Component reads this value from HAL.',
    out: '`out` — Output pin direction. Component writes this value to HAL.',
    io: '`io` — Bidirectional pin. Component may read or write.',
    r: '`r` — Read-only parameter. Component sets the value; HAL can only read.',
    rw: '`rw` — Read-write parameter. Both HAL and component can read/write.',
    bit: '`bit` — Boolean HAL type. Values: `TRUE` (1) or `FALSE` (0).',
    float: '`float` — 64-bit IEEE 754 double-precision floating-point.',
    signed: '`signed` (s32) — 32-bit signed integer. Range: −2,147,483,648 to 2,147,483,647.',
    unsigned: '`unsigned` (u32) — 32-bit unsigned integer. Range: 0 to 4,294,967,295.',
    s32: '`s32` — 32-bit signed integer *(deprecated; prefer `signed`)*.',
    u32: '`u32` — 32-bit unsigned integer *(deprecated; prefer `unsigned`)*.',
    fp: '`fp` — Function uses floating-point calculations (default).',
    nofp: '`nofp` — Function uses integer-only calculations. Using FP in an `nofp` function is undefined behavior.',
    personality: '`personality` — Per-instance integer set at `loadrt` time. Used with `if` conditions and variable-size arrays.',
    if: '`if CONDITION` — Pin or parameter is only created when condition (usually `personality & MASK`) is nonzero.',
    FUNCTION: '### `FUNCTION(name) { ... }`\n\nDefines the body of a realtime function declared with `function`.\nThe implicit `period` parameter (ns) and `fperiod` (seconds) are available.',
    EXTRA_SETUP: '### `EXTRA_SETUP() { ... }`\n\nPer-instance setup, called after pins/params are created.\nReturn `0` for success, negative `errno` on failure.',
    EXTRA_CLEANUP: '### `EXTRA_CLEANUP() { ... }`\n\nCalled when the module is unloaded. Must clean up **all** instances.',
    FOR_ALL_INSTS: '### `FOR_ALL_INSTS() { ... }`\n\nIterates over all instances. For userspace components only.',
    fperiod: '`fperiod` — Floating-point seconds between realtime function calls (`period * 1e-9`). Available inside `FUNCTION()`.',
};

function provideHover(document, position) {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    const parsed = parseComp(document);
    const inC = parsed.separatorLine >= 0 && position.line > parsed.separatorLine;

    if (KEYWORD_DOCS[word])
        return new vscode.Hover(new vscode.MarkdownString(KEYWORD_DOCS[word]), wordRange);

    const decl = parsed.declarations.find(d =>
        inC ? d.name === word : (d.name === word || d.halName === word)
    );

    if (decl) {
        const md = new vscode.MarkdownString();
        if (decl.kind === 'pin') {
            md.appendMarkdown(`**pin** \`${decl.name}\`\n\nDirection: \`${decl.direction}\`  \nType: \`${decl.type}\``);
            if (decl.isArray) md.appendMarkdown(`  \nArray size: \`${decl.arraySize}\``);
            if (decl.conditional) md.appendMarkdown(`  \nCondition: \`if ${decl.conditional}\``);
            if (decl.startValue) md.appendMarkdown(`  \nDefault: \`${decl.startValue}\``);
            if (decl.doc) md.appendMarkdown(`\n\n${decl.doc}`);
            if (decl.halName) md.appendMarkdown(`\n\n*HAL name: \`${decl.halName}\`*`);
        } else if (decl.kind === 'param') {
            md.appendMarkdown(`**param** \`${decl.name}\`\n\nDirection: \`${decl.direction}\`  \nType: \`${decl.type}\``);
            if (decl.startValue) md.appendMarkdown(`  \nDefault: \`${decl.startValue}\``);
            if (decl.doc) md.appendMarkdown(`\n\n${decl.doc}`);
            if (decl.halName) md.appendMarkdown(`\n\n*HAL name: \`${decl.halName}\`*`);
        } else if (decl.kind === 'variable') {
            md.appendMarkdown(`**variable** \`${decl.name}\`  \nC type: \`${decl.type}\``);
            if (decl.isArray) md.appendMarkdown(`  \nArray size: \`${decl.arraySize}\``);
            if (decl.startValue) md.appendMarkdown(`  \nDefault: \`${decl.startValue}\``);
        } else if (decl.kind === 'function') {
            md.appendMarkdown(`**function** \`${decl.name}\`  \nQualifier: \`${decl.qualifier || 'fp'}\``);
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

const DECL_KEYWORDS = [
    { label: 'component',   detail: 'Declare the component',           snippet: 'component ${1:name} "${2:description}";' },
    { label: 'pin',         detail: 'Declare a HAL pin',               snippet: 'pin ${1|in,out,io|} ${2|bit,float,signed,unsigned|} ${3:name} "${4:description}";' },
    { label: 'param',       detail: 'Declare a HAL parameter',         snippet: 'param ${1|r,rw|} ${2|bit,float,signed,unsigned|} ${3:name} = ${4:0} "${5:description}";' },
    { label: 'function',    detail: 'Declare a realtime function',     snippet: 'function ${1:_} ${2|fp,nofp|};' },
    { label: 'option',      detail: 'Set a component option',          snippet: 'option ${1|singleton,userspace,extra_setup,extra_cleanup|} ${2|yes,no|};' },
    { label: 'variable',    detail: 'Declare a per-instance variable', snippet: 'variable ${1:double} ${2:name} = ${3:0};' },
    { label: 'license',     detail: 'Module license (required)',       snippet: 'license "GPL"; // indicates GPL v2 or later' },
    { label: 'author',      detail: 'Module author',                   snippet: 'author "${1:Your Name}";' },
    { label: 'description', detail: 'Long component description',      snippet: 'description "${1:description}";' },
    { label: 'include',     detail: 'Include a header file',           snippet: 'include <${1:rtapi_math.h}>;' },
];

const OPTION_NAMES = [
    { label: 'singleton',      detail: 'Only one instance',            snippet: 'singleton yes;' },
    { label: 'userspace',      detail: 'Non-realtime component',       snippet: 'userspace yes;' },
    { label: 'extra_setup',    detail: 'Enable EXTRA_SETUP()',         snippet: 'extra_setup yes;' },
    { label: 'extra_cleanup',  detail: 'Enable EXTRA_CLEANUP()',       snippet: 'extra_cleanup yes;' },
    { label: 'count_function', detail: 'Use get_count() for count',    snippet: 'count_function yes;' },
    { label: 'default_count',  detail: 'Default instance count',       snippet: 'default_count ${1:1};' },
    { label: 'rtapi_app',      detail: 'Auto rtapi_app_main/exit',     snippet: 'rtapi_app no;' },
    { label: 'homemod',        detail: 'Custom homing module',         snippet: 'homemod yes;' },
    { label: 'tpmod',          detail: 'Custom TP module',             snippet: 'tpmod yes;' },
];

const C_MACROS = [
    { label: 'FUNCTION',      detail: 'Realtime function body',    snippet: 'FUNCTION(${1:_}) {\n\t$0\n}' },
    { label: 'EXTRA_SETUP',   detail: 'Per-instance setup',       snippet: 'EXTRA_SETUP() {\n\t$0\n\treturn 0;\n}' },
    { label: 'EXTRA_CLEANUP', detail: 'Module cleanup',           snippet: 'EXTRA_CLEANUP() {\n\t$0\n}' },
    { label: 'FOR_ALL_INSTS', detail: 'Iterate all instances',    snippet: 'FOR_ALL_INSTS() {\n\t$0\n}' },
    { label: 'fperiod',       detail: 'Period in seconds (float)', snippet: 'fperiod' },
];

function makeSnippetItem(item, kind) {
    const ci = new vscode.CompletionItem(item.label, kind);
    ci.insertText = new vscode.SnippetString(item.snippet);
    ci.detail = item.detail;
    return ci;
}

function makeKwItem(label, detail) {
    const ci = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
    if (detail) ci.detail = detail;
    return ci;
}

function provideCompletions(document, position) {
    const parsed = parseComp(document);
    const line = document.lineAt(position.line).text;
    const trimBefore = line.substring(0, position.character).trim();
    const inC = parsed.separatorLine >= 0 && position.line > parsed.separatorLine;

    if (inC) {
        const items = [];
        for (const m of C_MACROS)
            items.push(makeSnippetItem(m, vscode.CompletionItemKind.Snippet));
        for (const decl of parsed.declarations) {
            if (decl.kind === 'pin' || decl.kind === 'param' || decl.kind === 'variable') {
                const ci = new vscode.CompletionItem(decl.name, vscode.CompletionItemKind.Variable);
                ci.detail = `${decl.kind} (${decl.type || ''})`;
                if (decl.doc) ci.documentation = new vscode.MarkdownString(decl.doc);
                items.push(ci);
            }
            if (decl.kind === 'function') {
                const ci = new vscode.CompletionItem(`FUNCTION(${decl.name})`, vscode.CompletionItemKind.Function);
                ci.insertText = new vscode.SnippetString(`FUNCTION(${decl.name}) {\n\t$0\n}`);
                ci.detail = `function body (${decl.qualifier || 'fp'})`;
                items.push(ci);
            }
        }
        return items;
    }

    if (/^option\s+\w*$/.test(trimBefore) || /^option\s*$/.test(trimBefore))
        return OPTION_NAMES.map(o => makeSnippetItem(o, vscode.CompletionItemKind.Property));

    if (/^option\s+\S+\s+\w*$/.test(trimBefore))
        return ['yes', 'no'].map(v => makeKwItem(v));

    if (/^pin\s*$/.test(trimBefore))
        return [makeKwItem('in', 'Input (component reads)'), makeKwItem('out', 'Output (component writes)'), makeKwItem('io', 'Bidirectional')];

    if (/^param\s*$/.test(trimBefore))
        return [makeKwItem('r', 'Read-only'), makeKwItem('rw', 'Read-write')];

    if (/^(pin\s+(in|out|io)|param\s+(r|rw))\s*$/.test(trimBefore)) {
        return [
            makeKwItem('bit', 'Boolean (TRUE/FALSE)'),
            makeKwItem('float', '64-bit float'),
            makeKwItem('signed', '32-bit signed int'),
            makeKwItem('unsigned', '32-bit unsigned int'),
            makeKwItem('s32', '32-bit signed int (deprecated)'),
            makeKwItem('u32', '32-bit unsigned int (deprecated)'),
        ];
    }

    if (/^function\s+\S+\s*$/.test(trimBefore))
        return [makeKwItem('fp', 'Uses floating-point (default)'), makeKwItem('nofp', 'Integer-only')];

    if (!trimBefore || /^[a-z_]*$/.test(trimBefore))
        return DECL_KEYWORDS.map(k => makeSnippetItem(k, vscode.CompletionItemKind.Keyword));

    return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// GO-TO DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

function provideDefinition(document, position) {
    const parsed = parseComp(document);
    if (parsed.separatorLine < 0 || position.line <= parsed.separatorLine) return null;

    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    const decl = parsed.declarations.find(d =>
        d.name === word || (d.halName && d.halName.replace(/-/g, '_') === word)
    );

    return decl ? new vscode.Location(document.uri, decl.range.start) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTER
// ─────────────────────────────────────────────────────────────────────────────

function splitTrailingComment(s) {
    let inStr = false, inTriple = false;
    for (let i = 0; i < s.length; i++) {
        if (!inStr && s[i] === '"' && s[i+1] === '"' && s[i+2] === '"') {
            inTriple = !inTriple; i += 2; continue;
        }
        if (!inTriple && s[i] === '"') { inStr = !inStr; continue; }
        if (!inStr && !inTriple && s[i] === '/' && s[i+1] === '/') {
            return [s.slice(0, i).trimEnd(), ' ' + s.slice(i).trim()];
        }
    }
    return [s, ''];
}

function extractDocAndMiddle(s) {
    // Triple-quoted doc string
    const triM = s.match(/(r?"""[\s\S]*?""")\s*;?\s*$/);
    if (triM) {
        const idx = s.lastIndexOf(triM[1]);
        return [triM[1], s.slice(0, idx).trim()];
    }
    // Single-quoted doc string
    const sinM = s.match(/(r?"(?:[^"\\]|\\.)*")\s*;?\s*$/);
    if (sinM) {
        const idx = s.lastIndexOf(sinM[1]);
        return [sinM[1], s.slice(0, idx).trim()];
    }
    return ['', s.replace(/\s*;?\s*$/, '').trim()];
}

function parsePinParam(line, kw) {
    const parts = splitTrailingComment(line.trim());
    const comment = parts[1];
    let s = parts[0].trim();
    if (!s.startsWith(kw)) return null;
    s = s.slice(kw.length).trim();

    const dirRe = kw === 'pin' ? /^(in|out|io)\s+/ : /^(r|rw)\s+/;
    const dirM = s.match(dirRe);
    if (!dirM) return null;
    const direction = dirM[1];
    s = s.slice(dirM[0].length).trim();

    const typeM = s.match(/^(bit|signed|unsigned|float|s32|u32)\s+/);
    if (!typeM) return null;
    const type = typeM[1];
    s = s.slice(typeM[0].length).trim();

    const nameM = s.match(/^([A-Za-z_][A-Za-z0-9_.#-]*)/);
    if (!nameM) return null;
    const name = nameM[1];
    s = s.slice(nameM[0].length);

    const dm = extractDocAndMiddle(s);
    return { keyword: kw, direction: direction, type: type, name: name, middle: dm[1], doc: dm[0], comment: comment };
}

function strPad(s, n) {
    if (s.length >= n) return s;
    return s + ' '.repeat(n - s.length);
}

function reassemblePinParam(p, dirW, typeW, nameW) {
    let line = p.keyword + ' ';
    line += strPad(p.direction, dirW) + ' ';
    line += strPad(p.type, typeW) + ' ';
    const hasAfter = p.middle || p.doc;
    line += hasAfter ? strPad(p.name, nameW) : p.name;
    if (p.middle) line += ' ' + p.middle.replace(/\s+/g, ' ');
    if (p.doc)    line += ' ' + p.doc;
    line += ';';
    if (p.comment) line += p.comment;
    return line;
}

function alignPinParamBlock(lines, kw) {
    const parsed = lines.map(function(l) { return parsePinParam(l, kw); });
    if (parsed.some(function(p) { return p === null; })) {
        return lines.map(normalizeDeclSpacing);
    }
    const dirW  = Math.max.apply(null, parsed.map(function(p) { return p.direction.length; }));
    const typeW = Math.max.apply(null, parsed.map(function(p) { return p.type.length; }));
    const nameW = Math.max.apply(null, parsed.map(function(p) { return (p.middle || p.doc) ? p.name.length : 0; }));
    return parsed.map(function(p) { return reassemblePinParam(p, dirW, typeW, nameW); });
}

function parseFunctionDecl(line) {
    const parts = splitTrailingComment(line.trim());
    const comment = parts[1];
    let s = parts[0].trim();
    if (!s.startsWith('function')) return null;
    s = s.slice('function'.length).trim();
    const nameM = s.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (!nameM) return null;
    const name = nameM[1];
    s = s.slice(nameM[0].length).trim();
    let qualifier = '';
    const qualM = s.match(/^(fp|nofp)\b/);
    if (qualM) { qualifier = qualM[1]; s = s.slice(qualM[0].length).trim(); }
    const dm = extractDocAndMiddle(s);
    return { name: name, qualifier: qualifier, doc: dm[0], comment: comment };
}

function alignFunctionBlock(lines) {
    const parsed = lines.map(parseFunctionDecl);
    if (parsed.some(function(p) { return p === null; })) return lines.map(normalizeDeclSpacing);
    const nameW = Math.max.apply(null, parsed.map(function(p) { return p.name.length; }));
    const qualW = Math.max.apply(null, parsed.map(function(p) { return p.qualifier.length; }));
    return parsed.map(function(p) {
        let line = 'function ' + ((p.qualifier || p.doc) ? strPad(p.name, nameW) : p.name);
        if (p.qualifier) line += ' ' + (p.doc ? strPad(p.qualifier, qualW) : p.qualifier);
        if (p.doc)       line += ' ' + p.doc;
        line += ';';
        if (p.comment) line += p.comment;
        return line;
    });
}

function parseVariableDecl(line) {
    const parts = splitTrailingComment(line.trim());
    const comment = parts[1];
    let s = parts[0].trim();
    if (!s.startsWith('variable')) return null;
    s = s.slice('variable'.length).trim();
    const typeM = s.match(/^(\S+)\s+/);
    if (!typeM) return null;
    const ctype = typeM[1];
    s = s.slice(typeM[0].length).trim();
    const nameM = s.match(/^(\*?)([A-Za-z_][A-Za-z0-9_]*)/);
    if (!nameM) return null;
    const name = nameM[1] + nameM[2];
    s = s.slice(nameM[0].length).replace(/\s*;?\s*$/, '').trim();
    return { ctype: ctype, name: name, middle: s, comment: comment };
}

function alignVariableBlock(lines) {
    const parsed = lines.map(parseVariableDecl);
    if (parsed.some(function(p) { return p === null; })) return lines.map(normalizeDeclSpacing);
    const typeW = Math.max.apply(null, parsed.map(function(p) { return p.ctype.length; }));
    const nameW = Math.max.apply(null, parsed.map(function(p) { return p.middle ? p.name.length : 0; }));
    return parsed.map(function(p) {
        let line = 'variable ' + strPad(p.ctype, typeW) + ' ';
        line += p.middle ? strPad(p.name, nameW) : p.name;
        if (p.middle) line += ' ' + p.middle.replace(/\s+/g, ' ');
        line += ';';
        if (p.comment) line += p.comment;
        return line;
    });
}

function normalizeDeclSpacing(line) {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return trimmed;
    let result = '';
    let i = 0;
    while (i < trimmed.length) {
        // Triple-quoted string
        const isTriple = (trimmed[i] === '"' && trimmed[i+1] === '"' && trimmed[i+2] === '"') ||
                         (trimmed[i] === 'r' && trimmed[i+1] === '"' && trimmed[i+2] === '"' && trimmed[i+3] === '"');
        if (isTriple) {
            const prefix = trimmed[i] === 'r' ? 4 : 3;
            const from = i + prefix;
            let end = trimmed.indexOf('"""', from);
            if (end < 0) end = trimmed.length - 3;
            if (result.length > 0 && result[result.length - 1] !== ' ') result += ' ';
            result += trimmed.slice(i, end + 3);
            i = end + 3; continue;
        }
        // Single-quoted string
        if (trimmed[i] === '"' || (trimmed[i] === 'r' && trimmed[i+1] === '"')) {
            const prefix = trimmed[i] === 'r' ? 2 : 1;
            let j = i + prefix;
            while (j < trimmed.length) {
                if (trimmed[j] === '\\') { j += 2; continue; }
                if (trimmed[j] === '"') { j++; break; }
                j++;
            }
            if (result.length > 0 && result[result.length - 1] !== ' ') result += ' ';
            result += trimmed.slice(i, j);
            i = j; continue;
        }
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

function getDeclKeyword(line) {
    const m = line.trim().match(/^(pin|param|function|variable|component|option|license|author|description|examples|notes|see_also|include)\b/);
    return m ? m[1] : '';
}

function formatDeclSection(lines) {
    const result = [];
    let i = 0;
    while (i < lines.length) {
        const kw = getDeclKeyword(lines[i]);
        if (kw === 'pin' || kw === 'param' || kw === 'function' || kw === 'variable') {
            const block = [lines[i]];
            let j = i + 1;
            while (j < lines.length && getDeclKeyword(lines[j]) === kw) {
                block.push(lines[j]); j++;
            }
            let aligned;
            if (kw === 'pin' || kw === 'param') aligned = alignPinParamBlock(block, kw);
            else if (kw === 'function')          aligned = alignFunctionBlock(block);
            else                                 aligned = alignVariableBlock(block);
            result.push.apply(result, aligned);
            i = j;
        } else {
            result.push(normalizeDeclSpacing(lines[i]));
            i++;
        }
    }
    return result;
}

function formatComp(text) {
    const lines = text.split('\n');
    let sepIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*;;/.test(lines[i])) { sepIdx = i; break; }
    }
    const declLines = sepIdx >= 0 ? lines.slice(0, sepIdx) : lines;
    const cLines    = sepIdx >= 0 ? lines.slice(sepIdx)    : [];

    const formattedDecl = formatDeclSection(declLines);

    // Collapse excess blank lines (max 1 consecutive)
    const collapsed = [];
    let blankRun = 0;
    for (let k = 0; k < formattedDecl.length; k++) {
        if (formattedDecl[k] === '') {
            blankRun++;
            if (blankRun <= 1) collapsed.push('');
        } else {
            blankRun = 0;
            collapsed.push(formattedDecl[k]);
        }
    }

    // C section: only strip trailing whitespace
    const formattedC = cLines.map(function(l) { return l.trimEnd(); });
    return collapsed.concat(formattedC).join('\n');
}

function provideDocumentFormatting(document) {
    try {
        const original = document.getText();
        const formatted = formatComp(original);
        if (formatted === original) return [];
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(original.length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
    } catch (err) {
        vscode.window.showErrorMessage('LinuxCNC Comp formatter error: ' + String(err));
        return [];
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATION
// ─────────────────────────────────────────────────────────────────────────────

function activate(context) {
    const diagCollection = vscode.languages.createDiagnosticCollection('linuxcnc-comp');
    context.subscriptions.push(diagCollection);

    function refreshDiags(doc) {
        if (doc.languageId === 'linuxcnc-comp')
            diagCollection.set(doc.uri, getDiagnostics(doc));
    }

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'linuxcnc-comp' },
            { provideCompletionItems(doc, pos) { return provideCompletions(doc, pos); } },
            ' ', '\t'
        )
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'linuxcnc-comp' },
            { provideHover(doc, pos) { return provideHover(doc, pos); } }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'linuxcnc-comp' },
            { provideDefinition(doc, pos) { return provideDefinition(doc, pos); } }
        )
    );

    vscode.workspace.onDidOpenTextDocument(doc => refreshDiags(doc), null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(e => refreshDiags(e.document), null, context.subscriptions);
    vscode.workspace.onDidCloseTextDocument(doc => diagCollection.delete(doc.uri), null, context.subscriptions);
    // Formatter
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            { language: 'linuxcnc-comp' },
            { provideDocumentFormattingEdits(doc) { return provideDocumentFormatting(doc); } }
        )
    );

    vscode.workspace.textDocuments.forEach(doc => refreshDiags(doc));
}
exports.activate = activate;

function deactivate() {}
exports.deactivate = deactivate;
