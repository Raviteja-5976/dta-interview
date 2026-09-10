/**
 * The LeetCode-style harness — the candidate writes one method, and this file
 * supplies the program around it.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * Problems used to be whole programs: read stdin, call a function, print the
 * answer, with starter code for each language written by the model. That broke
 * in ways that had nothing to do with the candidate — scaffolding that did not
 * compile, a Java class the sandbox could not find (Judge0 runs `Main`), output
 * printed in a shape the grader did not expect — and it could only ever offer
 * the languages the model happened to write scaffolding for.
 *
 * Now a problem is a SIGNATURE plus tests in a fixed format, and everything
 * else is generated here, the same way for every problem:
 *
 *   templates  — what the editor opens with, per language (buildStarterCode)
 *   drivers    — the hidden main() that reads the tests, calls the method and
 *                prints what it returns (buildProgram)
 *   judging    — reading that output back into per-test verdicts
 *                (judgeHarnessRun)
 *
 * ── The wire format ─────────────────────────────────────────────────────────
 *   stdin:  the number of cases, then for each case one JSON value per line,
 *           one line per parameter.
 *   stdout: one line per case — the JSON of what the method returned.
 *
 * All cases run in ONE program execution. One sandbox submission per click
 * rather than one per test is what keeps repeated runs inside the runner's rate
 * limits and inside the host's 30-second request limit, and the JVM or the C++
 * compiler is paid for once instead of a dozen times.
 *
 * The candidate's own print statements are diverted to stderr while their
 * method runs, so debugging output can never be mistaken for an answer. It comes
 * back separately as the run's log.
 */

import type {
  CodeRunResult,
  FunctionSignature,
  LanguageId,
  TestCase,
  TestResult,
  TestVerdict,
  ValueType,
} from './types';
import { VALUE_TYPES } from './types';

/** Every language gets starter code, in the order the picker shows them. */
export const HARNESS_LANGUAGES: LanguageId[] = ['python', 'javascript', 'java', 'cpp', 'c'];

// ── Signatures ───────────────────────────────────────────────────────────────

/**
 * Names no parameter or method may take: keywords in any of the five
 * languages, the types the harness declares, and C library functions a method
 * name would collide with. Compared lower-cased, so `String` is caught too.
 */
const RESERVED = new Set(
  [
    // Python
    'and', 'as', 'assert', 'async', 'await', 'def', 'del', 'elif', 'except', 'from', 'global', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'with', 'yield', 'none', 'self', 'print', 'input',
    'len', 'str', 'list', 'dict', 'set', 'map', 'range', 'type', 'object', 'id',
    // JavaScript
    'arguments', 'await', 'debugger', 'delete', 'eval', 'export', 'function', 'import', 'instanceof', 'let',
    'typeof', 'var', 'void', 'undefined', 'nan', 'infinity', 'require', 'process', 'console', 'module',
    // Java
    'abstract', 'boolean', 'byte', 'extends', 'final', 'finally', 'implements', 'interface', 'native',
    'package', 'private', 'protected', 'public', 'super', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'string', 'integer', 'math', 'system', 'main', 'solution',
    // C and C++
    'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do',
    'double', 'else', 'enum', 'extern', 'false', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long',
    'namespace', 'new', 'null', 'operator', 'register', 'return', 'short', 'signed', 'sizeof', 'static',
    'struct', 'switch', 'template', 'true', 'try', 'typedef', 'union', 'unsigned', 'using', 'virtual',
    'volatile', 'while', 'std', 'vector', 'nullptr',
    // libc names a method would redeclare
    'index', 'abs', 'labs', 'round', 'floor', 'ceil', 'pow', 'log', 'exp', 'sqrt', 'printf', 'time', 'rand',
    'qsort', 'bsearch', 'exit', 'free', 'malloc', 'calloc', 'realloc', 'read', 'write', 'close', 'open',
    'strlen', 'strcmp', 'atoi', 'select', 'remove', 'rename', 'signal', 'raise', 'kill', 'div',
    // what the harness itself declares
    'returnsize', 'returncolumnsizes',
  ].map((w) => w.toLowerCase()),
);

function isArrayType(t: ValueType): boolean {
  return t.endsWith('[]');
}

/** The extra names C derives from an array parameter, which must stay free too. */
function derivedNames(name: string, type: ValueType): string[] {
  if (type === 'int[][]') return [`${name}Size`, `${name}ColSize`];
  return isArrayType(type) ? [`${name}Size`] : [];
}

function safeIdentifier(raw: string, fallback: string, type: ValueType | null, taken: Set<string>): string {
  let name = raw.replace(/[^A-Za-z0-9_]/g, '');
  if (!/^[A-Za-z]/.test(name)) name = fallback;
  if (name.toLowerCase().startsWith('h_')) name = `v${name}`;
  if (RESERVED.has(name.toLowerCase())) name = `${name}Value`;

  const clashes = (n: string) =>
    taken.has(n.toLowerCase()) || (type !== null && derivedNames(n, type).some((d) => taken.has(d.toLowerCase())));
  while (clashes(name)) name = `${name}X`;

  taken.add(name.toLowerCase());
  if (type !== null) for (const d of derivedNames(name, type)) taken.add(d.toLowerCase());
  return name;
}

/**
 * Makes a model-written signature safe to emit in all five languages: valid
 * identifiers, no keywords, no two names alike, no collision with the harness.
 */
export function sanitiseSignature(signature: FunctionSignature): FunctionSignature {
  const taken = new Set<string>();
  const functionName = safeIdentifier(signature.function_name, 'solve', null, taken);
  const params = signature.params.map((p, i) => ({
    name: safeIdentifier(p.name, `arg${i + 1}`, p.type, taken),
    type: p.type,
  }));
  return { function_name: functionName, params, return_type: signature.return_type };
}

/** Runtime check for a signature read back from a JSON column. */
export function isFunctionSignature(value: unknown): value is FunctionSignature {
  const s = value as FunctionSignature | null;
  const known = (t: unknown) => (VALUE_TYPES as readonly unknown[]).includes(t);
  return (
    !!s &&
    typeof s.function_name === 'string' &&
    known(s.return_type) &&
    Array.isArray(s.params) &&
    s.params.length > 0 &&
    s.params.every((p) => p && typeof p.name === 'string' && known(p.type))
  );
}

// ── Test data ────────────────────────────────────────────────────────────────

function fitsType(value: unknown, type: ValueType): boolean {
  switch (type) {
    case 'int':
      return Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647;
    case 'long':
      return Number.isSafeInteger(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'int[]':
      return Array.isArray(value) && value.every((x) => fitsType(x, 'int'));
    case 'long[]':
      return Array.isArray(value) && value.every((x) => fitsType(x, 'long'));
    case 'string[]':
      return Array.isArray(value) && value.every((x) => fitsType(x, 'string'));
    case 'int[][]':
      return Array.isArray(value) && value.every((row) => fitsType(row, 'int[]'));
  }
}

/** One JSON value of a known type. A bare word is accepted where a string is expected. */
function parseValue(text: string, type: ValueType): unknown {
  try {
    return JSON.parse(text);
  } catch {
    if (type === 'string') return text;
    throw new Error('not JSON');
  }
}

/**
 * A test in canonical form — compact JSON, one parameter per line — or null
 * when it does not match the signature. Used both when a problem is generated
 * (malformed tests are dropped) and when it is run.
 */
export function normaliseTest(signature: FunctionSignature, test: TestCase): TestCase | null {
  const lines = test.input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== signature.params.length) return null;

  try {
    const args = lines.map((line, i) => parseValue(line, signature.params[i].type));
    if (!args.every((a, i) => fitsType(a, signature.params[i].type))) return null;

    const expected = parseValue(test.expected.trim(), signature.return_type);
    if (!fitsType(expected, signature.return_type)) return null;

    return { input: args.map((a) => JSON.stringify(a)).join('\n'), expected: JSON.stringify(expected) };
  } catch {
    return null;
  }
}

export function normaliseTests(signature: FunctionSignature, tests: TestCase[]): TestCase[] {
  return tests.flatMap((t) => {
    const n = normaliseTest(signature, t);
    return n ? [n] : [];
  });
}

/**
 * Adds starter code for every language to a generated problem, after making its
 * signature safe and dropping any test that does not match it.
 *
 * Throws when a problem is left with no visible or no hidden tests — a problem
 * nobody can be graded on is worse than the built-in fallback that replaces it.
 */
export function finaliseCodingChallenge<
  T extends { title: string; signature: FunctionSignature; visible_tests: TestCase[]; hidden_tests: TestCase[] },
>(draft: T): T & { starter_code: Array<{ language: LanguageId; code: string }> } {
  const signature = sanitiseSignature(draft.signature);
  const visible = normaliseTests(signature, draft.visible_tests);
  const hidden = normaliseTests(signature, draft.hidden_tests);

  const dropped = draft.visible_tests.length + draft.hidden_tests.length - visible.length - hidden.length;
  if (dropped > 0) console.warn(`[P7] "${draft.title}": dropped ${dropped} test(s) that did not match the signature`);

  if (visible.length === 0 || hidden.length === 0) {
    throw new Error(`"${draft.title}" has no usable ${visible.length === 0 ? 'visible' : 'hidden'} tests`);
  }

  return {
    ...draft,
    signature,
    visible_tests: visible,
    hidden_tests: hidden,
    starter_code: buildStarterCode(signature),
  };
}

// ── Starter code ─────────────────────────────────────────────────────────────

const PY_TYPE: Record<ValueType, string> = {
  int: 'int',
  long: 'int',
  bool: 'bool',
  string: 'str',
  'int[]': 'List[int]',
  'long[]': 'List[int]',
  'string[]': 'List[str]',
  'int[][]': 'List[List[int]]',
};

const JS_DOC: Record<ValueType, string> = {
  int: 'number',
  long: 'number',
  bool: 'boolean',
  string: 'string',
  'int[]': 'number[]',
  'long[]': 'number[]',
  'string[]': 'string[]',
  'int[][]': 'number[][]',
};

const JAVA_TYPE: Record<ValueType, string> = {
  int: 'int',
  long: 'long',
  bool: 'boolean',
  string: 'String',
  'int[]': 'int[]',
  'long[]': 'long[]',
  'string[]': 'String[]',
  'int[][]': 'int[][]',
};

const JAVA_DEFAULT: Record<ValueType, string> = {
  int: '0',
  long: '0L',
  bool: 'false',
  string: '""',
  'int[]': 'new int[0]',
  'long[]': 'new long[0]',
  'string[]': 'new String[0]',
  'int[][]': 'new int[0][0]',
};

const CPP_TYPE: Record<ValueType, string> = {
  int: 'int',
  long: 'long long',
  bool: 'bool',
  string: 'string',
  'int[]': 'vector<int>',
  'long[]': 'vector<long long>',
  'string[]': 'vector<string>',
  'int[][]': 'vector<vector<int>>',
};

const CPP_DEFAULT: Record<ValueType, string> = {
  int: '0',
  long: '0',
  bool: 'false',
  string: '""',
  'int[]': '{}',
  'long[]': '{}',
  'string[]': '{}',
  'int[][]': '{}',
};

/** C parameters, LeetCode's convention: an array travels with its size. */
function cParams(p: { name: string; type: ValueType }): string {
  switch (p.type) {
    case 'int':
      return `int ${p.name}`;
    case 'long':
      return `long long ${p.name}`;
    case 'bool':
      return `bool ${p.name}`;
    case 'string':
      return `char* ${p.name}`;
    case 'int[]':
      return `int* ${p.name}, int ${p.name}Size`;
    case 'long[]':
      return `long long* ${p.name}, int ${p.name}Size`;
    case 'string[]':
      return `char** ${p.name}, int ${p.name}Size`;
    case 'int[][]':
      return `int** ${p.name}, int ${p.name}Size, int* ${p.name}ColSize`;
  }
}

const C_RETURN: Record<ValueType, string> = {
  int: 'int',
  long: 'long long',
  bool: 'bool',
  string: 'char*',
  'int[]': 'int*',
  'long[]': 'long long*',
  'string[]': 'char**',
  'int[][]': 'int**',
};

function template(language: LanguageId, sig: FunctionSignature): string {
  const fn = sig.function_name;
  const ret = sig.return_type;

  switch (language) {
    case 'python': {
      const params = ['self', ...sig.params.map((p) => `${p.name}: ${PY_TYPE[p.type]}`)].join(', ');
      return `class Solution:\n    def ${fn}(${params}) -> ${PY_TYPE[ret]}:\n        pass\n`;
    }

    case 'javascript': {
      const doc = [
        '/**',
        ...sig.params.map((p) => ` * @param {${JS_DOC[p.type]}} ${p.name}`),
        ` * @return {${JS_DOC[ret]}}`,
        ' */',
      ].join('\n');
      return `${doc}\nvar ${fn} = function(${sig.params.map((p) => p.name).join(', ')}) {\n    \n};\n`;
    }

    case 'java': {
      const params = sig.params.map((p) => `${JAVA_TYPE[p.type]} ${p.name}`).join(', ');
      return (
        `class Solution {\n    public ${JAVA_TYPE[ret]} ${fn}(${params}) {\n` +
        `        // Write your code here\n        return ${JAVA_DEFAULT[ret]};\n    }\n}\n`
      );
    }

    case 'cpp': {
      const params = sig.params
        .map((p) => `${CPP_TYPE[p.type]}${isArrayType(p.type) ? '&' : ''} ${p.name}`)
        .join(', ');
      return (
        `class Solution {\npublic:\n    ${CPP_TYPE[ret]} ${fn}(${params}) {\n` +
        `        // Write your code here\n        return ${CPP_DEFAULT[ret]};\n    }\n};\n`
      );
    }

    case 'c': {
      const params = sig.params.map(cParams);
      if (isArrayType(ret)) params.push('int* returnSize');
      if (ret === 'int[][]') params.push('int** returnColumnSizes');

      const note =
        ret === 'int[][]'
          ? '/**\n * Return an array of arrays of size *returnSize.\n * The sizes of the arrays are returned as *returnColumnSizes array.\n * Note: Both returned array and *columnSizes array must be malloced, assume caller calls free().\n */\n'
          : isArrayType(ret)
            ? '/**\n * Note: The returned array must be malloced, assume caller calls free().\n */\n'
            : '';

      const body =
        ret === 'int[][]'
          ? '    *returnSize = 0;\n    *returnColumnSizes = NULL;\n    return NULL;'
          : isArrayType(ret)
            ? '    *returnSize = 0;\n    return NULL;'
            : ret === 'bool'
              ? '    return false;'
              : ret === 'string'
                ? '    return "";'
                : '    return 0;';

      return `${note}${C_RETURN[ret]} ${fn}(${params.join(', ')}) {\n    // Write your code here\n${body}\n}\n`;
    }
  }
}

/**
 * What the editor opens with, for every language.
 *
 * Each template compiles and runs as it stands — it returns a placeholder, so
 * the first "Run" before writing anything reports wrong answers rather than a
 * compile error the candidate did not cause.
 */
export function buildStarterCode(signature: FunctionSignature): Array<{ language: LanguageId; code: string }> {
  return HARNESS_LANGUAGES.map((language) => ({ language, code: template(language, signature) }));
}

// ── Drivers ──────────────────────────────────────────────────────────────────

/**
 * Imports and includes placed above the candidate's code. Kept to what that
 * language's LeetCode environment provides, so code that works there works here.
 */
const HEADER: Record<LanguageId, string> = {
  python:
    'from typing import *; from collections import *; import heapq, math, bisect, itertools, functools, re, string, sys\n',
  javascript: '',
  java: 'import java.util.*;\nimport java.io.*;\n',
  cpp: '#include <bits/stdc++.h>\n#include <unistd.h>\nusing namespace std;\n',
  c: '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <stdbool.h>\n#include <limits.h>\n#include <math.h>\n#include <ctype.h>\n#include <unistd.h>\n',
};

function pythonDriver(sig: FunctionSignature): string {
  return String.raw`


# ---- test harness ----
import json as _h_json, contextlib as _h_ctx, sys as _h_sys


def _h_plain(v):
    if isinstance(v, (list, tuple, set)):
        return [_h_plain(x) for x in v]
    return v


def _h_run():
    _h_sys.setrecursionlimit(100000)
    # Bytes, decoded explicitly: the sandbox's locale is not guaranteed UTF-8.
    _h_lines = _h_sys.stdin.buffer.read().decode("utf-8").split("\n")
    _h_t = int(_h_lines[0].strip())
    _h_pos = 1
    _h_out = _h_sys.stdout
    for _ in range(_h_t):
        _h_args = [_h_json.loads(_h_lines[_h_pos + _h_k]) for _h_k in range(${sig.params.length})]
        _h_pos += ${sig.params.length}
        with _h_ctx.redirect_stdout(_h_sys.stderr):
            _h_res = Solution().${sig.function_name}(*_h_args)
        _h_out.write(_h_json.dumps(_h_plain(_h_res), separators=(",", ":")) + "\n")
        _h_out.flush()


_h_run()
`;
}

function javascriptDriver(sig: FunctionSignature): string {
  return String.raw`

// ---- test harness ----
(function () {
  var h_lines = require('fs').readFileSync(0, 'utf8').split('\n');
  var h_t = parseInt(h_lines[0], 10);
  var h_pos = 1;
  var h_saved = [console.log, console.info, console.debug];
  var h_toErr = function () {
    var parts = Array.prototype.map.call(arguments, function (a) {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    });
    process.stderr.write(parts.join(' ') + '\n');
  };
  for (var h_c = 0; h_c < h_t; h_c++) {
    var h_args = [];
    for (var h_k = 0; h_k < ${sig.params.length}; h_k++) h_args.push(JSON.parse(h_lines[h_pos + h_k]));
    h_pos += ${sig.params.length};
    console.log = console.info = console.debug = h_toErr;
    var h_res;
    try {
      h_res = ${sig.function_name}.apply(null, h_args);
    } finally {
      console.log = h_saved[0];
      console.info = h_saved[1];
      console.debug = h_saved[2];
    }
    process.stdout.write(JSON.stringify(h_res === undefined ? null : h_res) + '\n');
  }
})();
`;
}

const JAVA_CONVERT: Record<ValueType, string> = {
  int: 'h_int',
  long: 'h_long',
  bool: 'h_bool',
  string: 'h_str',
  'int[]': 'h_intArr',
  'long[]': 'h_longArr',
  'string[]': 'h_strArr',
  'int[][]': 'h_intMat',
};

const JAVA_RUNTIME = String.raw`

// ---- test harness ----
public class Main {
    private static String h_s;
    private static int h_p;

    private static void h_ws() {
        while (h_p < h_s.length() && Character.isWhitespace(h_s.charAt(h_p))) h_p++;
    }

    private static Object h_parse(String s) {
        h_s = s;
        h_p = 0;
        return h_value();
    }

    private static Object h_value() {
        h_ws();
        char c = h_s.charAt(h_p);
        if (c == '[') {
            h_p++;
            List<Object> list = new ArrayList<>();
            h_ws();
            if (h_s.charAt(h_p) == ']') { h_p++; return list; }
            while (true) {
                list.add(h_value());
                h_ws();
                if (h_s.charAt(h_p++) == ']') return list;
            }
        }
        if (c == '"') return h_string();
        if (h_s.startsWith("true", h_p)) { h_p += 4; return Boolean.TRUE; }
        if (h_s.startsWith("false", h_p)) { h_p += 5; return Boolean.FALSE; }
        if (h_s.startsWith("null", h_p)) { h_p += 4; return null; }
        int start = h_p;
        while (h_p < h_s.length() && "+-0123456789".indexOf(h_s.charAt(h_p)) >= 0) h_p++;
        return Long.parseLong(h_s.substring(start, h_p));
    }

    private static String h_string() {
        h_p++;
        StringBuilder b = new StringBuilder();
        while (h_s.charAt(h_p) != '"') {
            char c = h_s.charAt(h_p++);
            if (c != '\\') { b.append(c); continue; }
            char e = h_s.charAt(h_p++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u': b.append((char) Integer.parseInt(h_s.substring(h_p, h_p + 4), 16)); h_p += 4; break;
                default: b.append(e);
            }
        }
        h_p++;
        return b.toString();
    }

    private static int h_int(Object o) { return (int) (long) (Long) o; }
    private static long h_long(Object o) { return (Long) o; }
    private static boolean h_bool(Object o) { return (Boolean) o; }
    private static String h_str(Object o) { return (String) o; }

    private static int[] h_intArr(Object o) {
        List<?> l = (List<?>) o;
        int[] r = new int[l.size()];
        for (int i = 0; i < r.length; i++) r[i] = h_int(l.get(i));
        return r;
    }

    private static long[] h_longArr(Object o) {
        List<?> l = (List<?>) o;
        long[] r = new long[l.size()];
        for (int i = 0; i < r.length; i++) r[i] = h_long(l.get(i));
        return r;
    }

    private static String[] h_strArr(Object o) {
        List<?> l = (List<?>) o;
        String[] r = new String[l.size()];
        for (int i = 0; i < r.length; i++) r[i] = h_str(l.get(i));
        return r;
    }

    private static int[][] h_intMat(Object o) {
        List<?> l = (List<?>) o;
        int[][] r = new int[l.size()][];
        for (int i = 0; i < r.length; i++) r[i] = h_intArr(l.get(i));
        return r;
    }

    private static String h_q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\t') b.append("\\t");
            else if (c == '\r') b.append("\\r");
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    private static String h_w(int v) { return Integer.toString(v); }
    private static String h_w(long v) { return Long.toString(v); }
    private static String h_w(boolean v) { return v ? "true" : "false"; }
    private static String h_w(String v) { return h_q(v); }

    private static String h_w(int[] v) {
        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i]); }
        return b.append(']').toString();
    }

    private static String h_w(long[] v) {
        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i]); }
        return b.append(']').toString();
    }

    private static String h_w(String[] v) {
        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(h_q(v[i])); }
        return b.append(']').toString();
    }

    private static String h_w(int[][] v) {
        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(h_w(v[i])); }
        return b.append(']').toString();
    }
`;

function javaDriver(sig: FunctionSignature): string {
  const decls = sig.params
    .map(
      (p, i) =>
        `            ${JAVA_TYPE[p.type]} h_a${i} = ${JAVA_CONVERT[p.type]}(h_parse(h_lines.get(h_pos + ${i})));`,
    )
    .join('\n');
  const args = sig.params.map((_, i) => `h_a${i}`).join(', ');

  return (
    JAVA_RUNTIME +
    String.raw`
    public static void main(String[] args) throws Exception {
        BufferedReader h_in = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
        List<String> h_lines = new ArrayList<>();
        String h_line;
        while ((h_line = h_in.readLine()) != null) h_lines.add(h_line);
        int h_t = Integer.parseInt(h_lines.get(0).trim());
        int h_pos = 1;
        PrintStream h_out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        System.setOut(System.err);
        for (int h_c = 0; h_c < h_t; h_c++) {
${decls}
            h_pos += ${sig.params.length};
            ${JAVA_TYPE[sig.return_type]} h_res = new Solution().${sig.function_name}(${args});
            h_out.println(h_w(h_res));
        }
        h_out.flush();
    }
}
`
  );
}

const CPP_CONVERT: Record<ValueType, string> = {
  int: 'asInt',
  long: 'asLong',
  bool: 'asBool',
  string: 'asStr',
  'int[]': 'asIntVec',
  'long[]': 'asLongVec',
  'string[]': 'asStrVec',
  'int[][]': 'asIntMat',
};

const CPP_RUNTIME = String.raw`

// ---- test harness ----
namespace h_harness {
struct Value {
    int kind = 0;  // 0 null, 1 number, 2 bool, 3 string, 4 array
    long long num = 0;
    bool flag = false;
    std::string str;
    std::vector<Value> items;
};

static std::string h_s;
static size_t h_p = 0;

static void h_ws() {
    while (h_p < h_s.size() && isspace((unsigned char) h_s[h_p])) h_p++;
}

static std::string h_string() {
    h_p++;
    std::string out;
    while (h_p < h_s.size() && h_s[h_p] != '"') {
        char c = h_s[h_p++];
        if (c != '\\') { out += c; continue; }
        char e = h_s[h_p++];
        if (e == 'n') out += '\n';
        else if (e == 't') out += '\t';
        else if (e == 'r') out += '\r';
        else if (e == 'b') out += '\b';
        else if (e == 'f') out += '\f';
        else if (e == 'u') {
            unsigned cp = (unsigned) std::stoul(h_s.substr(h_p, 4), nullptr, 16);
            h_p += 4;
            if (cp < 0x80) out += (char) cp;
            else if (cp < 0x800) { out += (char) (0xC0 | (cp >> 6)); out += (char) (0x80 | (cp & 0x3F)); }
            else { out += (char) (0xE0 | (cp >> 12)); out += (char) (0x80 | ((cp >> 6) & 0x3F)); out += (char) (0x80 | (cp & 0x3F)); }
        } else out += e;
    }
    h_p++;
    return out;
}

static Value h_value() {
    h_ws();
    Value v;
    char c = h_s[h_p];
    if (c == '[') {
        h_p++;
        v.kind = 4;
        h_ws();
        if (h_s[h_p] == ']') { h_p++; return v; }
        while (true) {
            v.items.push_back(h_value());
            h_ws();
            if (h_s[h_p++] == ']') return v;
        }
    }
    if (c == '"') { v.kind = 3; v.str = h_string(); return v; }
    if (h_s.compare(h_p, 4, "true") == 0) { h_p += 4; v.kind = 2; v.flag = true; return v; }
    if (h_s.compare(h_p, 5, "false") == 0) { h_p += 5; v.kind = 2; return v; }
    if (h_s.compare(h_p, 4, "null") == 0) { h_p += 4; return v; }
    size_t start = h_p;
    while (h_p < h_s.size() && (isdigit((unsigned char) h_s[h_p]) || h_s[h_p] == '-' || h_s[h_p] == '+')) h_p++;
    v.kind = 1;
    v.num = std::stoll(h_s.substr(start, h_p - start));
    return v;
}

static Value parse(const std::string& s) { h_s = s; h_p = 0; return h_value(); }

static int asInt(const Value& v) { return (int) v.num; }
static long long asLong(const Value& v) { return v.num; }
static bool asBool(const Value& v) { return v.flag; }
static std::string asStr(const Value& v) { return v.str; }

static std::vector<int> asIntVec(const Value& v) {
    std::vector<int> r;
    for (const Value& x : v.items) r.push_back((int) x.num);
    return r;
}

static std::vector<long long> asLongVec(const Value& v) {
    std::vector<long long> r;
    for (const Value& x : v.items) r.push_back(x.num);
    return r;
}

static std::vector<std::string> asStrVec(const Value& v) {
    std::vector<std::string> r;
    for (const Value& x : v.items) r.push_back(x.str);
    return r;
}

static std::vector<std::vector<int>> asIntMat(const Value& v) {
    std::vector<std::vector<int>> r;
    for (const Value& x : v.items) r.push_back(asIntVec(x));
    return r;
}

static std::string quote(const std::string& s) {
    std::string out = "\"";
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') { out += '\\'; out += (char) c; }
        else if (c == '\n') out += "\\n";
        else if (c == '\t') out += "\\t";
        else if (c == '\r') out += "\\r";
        else if (c < 0x20) { char buf[8]; snprintf(buf, sizeof buf, "\\u%04x", c); out += buf; }
        else out += (char) c;
    }
    return out + "\"";
}

static std::string w(int v) { return std::to_string(v); }
static std::string w(long long v) { return std::to_string(v); }
static std::string w(bool v) { return v ? "true" : "false"; }
static std::string w(const std::string& v) { return quote(v); }

static std::string w(const std::vector<int>& v) {
    std::string out = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) out += ','; out += std::to_string(v[i]); }
    return out + "]";
}

static std::string w(const std::vector<long long>& v) {
    std::string out = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) out += ','; out += std::to_string(v[i]); }
    return out + "]";
}

static std::string w(const std::vector<std::string>& v) {
    std::string out = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) out += ','; out += quote(v[i]); }
    return out + "]";
}

static std::string w(const std::vector<std::vector<int>>& v) {
    std::string out = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) out += ','; out += w(v[i]); }
    return out + "]";
}

// The candidate's own output goes to stderr while their method runs.
static int h_saved = -1;
static void divert() { std::cout.flush(); fflush(stdout); h_saved = dup(1); dup2(2, 1); }
static void restore() { std::cout.flush(); fflush(stdout); dup2(h_saved, 1); close(h_saved); }
}  // namespace h_harness
`;

function cppDriver(sig: FunctionSignature): string {
  const decls = sig.params
    .map(
      (p, i) =>
        `        ${CPP_TYPE[p.type]} h_a${i} = h_harness::${CPP_CONVERT[p.type]}(h_harness::parse(h_lines[h_pos + ${i}]));`,
    )
    .join('\n');
  const args = sig.params.map((_, i) => `h_a${i}`).join(', ');

  return (
    CPP_RUNTIME +
    String.raw`
int main() {
    std::vector<std::string> h_lines;
    std::string h_line;
    while (std::getline(std::cin, h_line)) {
        if (!h_line.empty() && h_line.back() == '\r') h_line.pop_back();
        h_lines.push_back(h_line);
    }
    int h_t = std::stoi(h_lines[0]);
    size_t h_pos = 1;
    for (int h_c = 0; h_c < h_t; h_c++) {
${decls}
        h_pos += ${sig.params.length};
        h_harness::divert();
        ${CPP_TYPE[sig.return_type]} h_res = Solution().${sig.function_name}(${args});
        h_harness::restore();
        std::string h_outLine = h_harness::w(h_res) + "\n";
        fwrite(h_outLine.data(), 1, h_outLine.size(), stdout);
        fflush(stdout);
    }
    return 0;
}
`
  );
}

const C_RUNTIME = String.raw`

/* ---- test harness ---- */
static const char* h_p;

static void h_ws(void) {
    while (*h_p == ' ' || *h_p == '\t' || *h_p == '\r' || *h_p == '\n') h_p++;
}

static long long h_num(void) {
    char* end;
    long long v;
    h_ws();
    v = strtoll(h_p, &end, 10);
    h_p = end;
    return v;
}

static bool h_bool(void) {
    h_ws();
    if (strncmp(h_p, "true", 4) == 0) { h_p += 4; return true; }
    h_p += 5;
    return false;
}

static void h_put(char** buf, size_t* len, size_t* cap, char c) {
    if (*len + 2 >= *cap) { *cap *= 2; *buf = (char*) realloc(*buf, *cap); }
    (*buf)[(*len)++] = c;
}

static char* h_str(void) {
    size_t cap = 16, len = 0;
    char* buf = (char*) malloc(cap);
    h_ws();
    if (*h_p == '"') h_p++;
    while (*h_p && *h_p != '"') {
        char c = *h_p++;
        if (c != '\\') { h_put(&buf, &len, &cap, c); continue; }
        c = *h_p++;
        if (c == 'n') h_put(&buf, &len, &cap, '\n');
        else if (c == 't') h_put(&buf, &len, &cap, '\t');
        else if (c == 'r') h_put(&buf, &len, &cap, '\r');
        else if (c == 'b') h_put(&buf, &len, &cap, '\b');
        else if (c == 'f') h_put(&buf, &len, &cap, '\f');
        else if (c == 'u') {
            char hex[5] = { h_p[0], h_p[1], h_p[2], h_p[3], 0 };
            unsigned cp = (unsigned) strtoul(hex, NULL, 16);
            h_p += 4;
            if (cp < 0x80) h_put(&buf, &len, &cap, (char) cp);
            else if (cp < 0x800) {
                h_put(&buf, &len, &cap, (char) (0xC0 | (cp >> 6)));
                h_put(&buf, &len, &cap, (char) (0x80 | (cp & 0x3F)));
            } else {
                h_put(&buf, &len, &cap, (char) (0xE0 | (cp >> 12)));
                h_put(&buf, &len, &cap, (char) (0x80 | ((cp >> 6) & 0x3F)));
                h_put(&buf, &len, &cap, (char) (0x80 | (cp & 0x3F)));
            }
        } else h_put(&buf, &len, &cap, c);
    }
    if (*h_p == '"') h_p++;
    buf[len] = 0;
    return buf;
}

/* Consumes '['. True when the array has at least one element. */
static bool h_open(void) {
    h_ws();
    h_p++;
    h_ws();
    if (*h_p == ']') { h_p++; return false; }
    return true;
}

/* After an element: true on ',', false on the closing ']'. */
static bool h_more(void) {
    h_ws();
    if (*h_p == ',') { h_p++; return true; }
    h_p++;
    return false;
}

static int* h_int_arr(int* size) {
    int cap = 8, n = 0;
    int* a = (int*) malloc(sizeof(int) * cap);
    if (h_open()) {
        do {
            if (n == cap) { cap *= 2; a = (int*) realloc(a, sizeof(int) * cap); }
            a[n++] = (int) h_num();
        } while (h_more());
    }
    *size = n;
    return a;
}

static long long* h_long_arr(int* size) {
    int cap = 8, n = 0;
    long long* a = (long long*) malloc(sizeof(long long) * cap);
    if (h_open()) {
        do {
            if (n == cap) { cap *= 2; a = (long long*) realloc(a, sizeof(long long) * cap); }
            a[n++] = h_num();
        } while (h_more());
    }
    *size = n;
    return a;
}

static char** h_str_arr(int* size) {
    int cap = 8, n = 0;
    char** a = (char**) malloc(sizeof(char*) * cap);
    if (h_open()) {
        do {
            if (n == cap) { cap *= 2; a = (char**) realloc(a, sizeof(char*) * cap); }
            a[n++] = h_str();
        } while (h_more());
    }
    *size = n;
    return a;
}

static int** h_int_mat(int* size, int** colSizes) {
    int cap = 8, n = 0;
    int** a = (int**) malloc(sizeof(int*) * cap);
    int* cols = (int*) malloc(sizeof(int) * cap);
    if (h_open()) {
        do {
            if (n == cap) {
                cap *= 2;
                a = (int**) realloc(a, sizeof(int*) * cap);
                cols = (int*) realloc(cols, sizeof(int) * cap);
            }
            a[n] = h_int_arr(&cols[n]);
            n++;
        } while (h_more());
    }
    *size = n;
    *colSizes = cols;
    return a;
}

static void h_w_int(long long v) { printf("%lld", v); }
static void h_w_bool(bool v) { fputs(v ? "true" : "false", stdout); }

static void h_w_str(const char* s) {
    if (!s) { fputs("null", stdout); return; }
    putchar('"');
    for (; *s; s++) {
        unsigned char c = (unsigned char) *s;
        if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
        else if (c == '\n') fputs("\\n", stdout);
        else if (c == '\t') fputs("\\t", stdout);
        else if (c == '\r') fputs("\\r", stdout);
        else if (c < 0x20) printf("\\u%04x", c);
        else putchar(c);
    }
    putchar('"');
}

static void h_w_int_arr(const int* a, int n) {
    int i;
    putchar('[');
    for (i = 0; i < n; i++) { if (i) putchar(','); printf("%d", a[i]); }
    putchar(']');
}

static void h_w_long_arr(const long long* a, int n) {
    int i;
    putchar('[');
    for (i = 0; i < n; i++) { if (i) putchar(','); printf("%lld", a[i]); }
    putchar(']');
}

static void h_w_str_arr(char** a, int n) {
    int i;
    putchar('[');
    for (i = 0; i < n; i++) { if (i) putchar(','); h_w_str(a[i]); }
    putchar(']');
}

static void h_w_int_mat(int** a, int n, const int* cols) {
    int i;
    putchar('[');
    for (i = 0; i < n; i++) { if (i) putchar(','); h_w_int_arr(a[i], cols ? cols[i] : 0); }
    putchar(']');
}

/* The candidate's own output goes to stderr while their function runs. */
static int h_saved = -1;
static void h_divert(void) { fflush(stdout); h_saved = dup(1); dup2(2, 1); }
static void h_restore(void) { fflush(stdout); dup2(h_saved, 1); close(h_saved); }

static char* h_read_all(void) {
    size_t cap = 1 << 16, n = 0;
    char* b = (char*) malloc(cap);
    int ch;
    while ((ch = getchar()) != EOF) {
        if (n + 1 >= cap) { cap *= 2; b = (char*) realloc(b, cap); }
        b[n++] = (char) ch;
    }
    b[n] = 0;
    return b;
}

static char* h_next_line(char** cursor) {
    char* s = *cursor;
    char* e = strchr(s, '\n');
    if (e) { *e = 0; *cursor = e + 1; } else { *cursor = s + strlen(s); }
    return s;
}
`;

function cDecl(p: { type: ValueType }, i: number): { decl: string; args: string } {
  const a = `h_a${i}`;
  const parse = `h_p = h_next_line(&h_cur); `;
  switch (p.type) {
    case 'int':
      return { decl: `${parse}int ${a} = (int) h_num();`, args: a };
    case 'long':
      return { decl: `${parse}long long ${a} = h_num();`, args: a };
    case 'bool':
      return { decl: `${parse}bool ${a} = h_bool();`, args: a };
    case 'string':
      return { decl: `${parse}char* ${a} = h_str();`, args: a };
    case 'int[]':
      return { decl: `${parse}int ${a}_n; int* ${a} = h_int_arr(&${a}_n);`, args: `${a}, ${a}_n` };
    case 'long[]':
      return { decl: `${parse}int ${a}_n; long long* ${a} = h_long_arr(&${a}_n);`, args: `${a}, ${a}_n` };
    case 'string[]':
      return { decl: `${parse}int ${a}_n; char** ${a} = h_str_arr(&${a}_n);`, args: `${a}, ${a}_n` };
    case 'int[][]':
      return {
        decl: `${parse}int ${a}_n; int* ${a}_cols; int** ${a} = h_int_mat(&${a}_n, &${a}_cols);`,
        args: `${a}, ${a}_n, ${a}_cols`,
      };
  }
}

function cDriver(sig: FunctionSignature): string {
  const params = sig.params.map(cDecl);
  const decls = params.map((p) => `        ${p.decl}`).join('\n');
  const args = params.map((p) => p.args);
  const ret = sig.return_type;

  let setup = '';
  let call: string;
  let write: string;

  switch (ret) {
    case 'int':
    case 'long':
      call = `${C_RETURN[ret]} h_res = ${sig.function_name}(${args.join(', ')});`;
      write = 'h_w_int(h_res);';
      break;
    case 'bool':
      call = `bool h_res = ${sig.function_name}(${args.join(', ')});`;
      write = 'h_w_bool(h_res);';
      break;
    case 'string':
      call = `char* h_res = ${sig.function_name}(${args.join(', ')});`;
      write = 'h_w_str(h_res);';
      break;
    case 'int[]':
    case 'long[]':
    case 'string[]':
      setup = 'int h_rs = 0;';
      call = `${C_RETURN[ret]} h_res = ${sig.function_name}(${[...args, '&h_rs'].join(', ')});`;
      write =
        ret === 'int[]'
          ? 'h_w_int_arr(h_res, h_rs);'
          : ret === 'long[]'
            ? 'h_w_long_arr(h_res, h_rs);'
            : 'h_w_str_arr(h_res, h_rs);';
      break;
    case 'int[][]':
      setup = 'int h_rs = 0; int* h_rcs = NULL;';
      call = `int** h_res = ${sig.function_name}(${[...args, '&h_rs', '&h_rcs'].join(', ')});`;
      write = 'h_w_int_mat(h_res, h_rs, h_rcs);';
      break;
  }

  return (
    C_RUNTIME +
    String.raw`
int main(void) {
    char* h_all = h_read_all();
    char* h_cur = h_all;
    int h_t = atoi(h_next_line(&h_cur));
    int h_c;
    for (h_c = 0; h_c < h_t; h_c++) {
${decls}
        ${setup}
        h_divert();
        ${call}
        h_restore();
        ${write}
        putchar('\n');
        fflush(stdout);
    }
    return 0;
}
`
  );
}

export interface HarnessProgram {
  source: string;
  /** Lines the harness put above the candidate's code, for fixing up error line numbers. */
  lineOffset: number;
}

/** The full program the sandbox runs: header, the candidate's code, the driver. */
export function buildProgram(language: LanguageId, signature: FunctionSignature, code: string): HarnessProgram {
  const header = HEADER[language];
  const lineOffset = header.split('\n').length - 1;

  let body = code.replace(/\r\n/g, '\n');
  // Judge0 compiles Main.java, where a public Solution class is a compile error.
  if (language === 'java') body = body.replace(/\bpublic\s+(final\s+)?class\s+Solution\b/, 'class Solution');

  const driver =
    language === 'python'
      ? pythonDriver(signature)
      : language === 'javascript'
        ? javascriptDriver(signature)
        : language === 'java'
          ? javaDriver(signature)
          : language === 'cpp'
            ? cppDriver(signature)
            : cDriver(signature);

  return { source: header + body + driver, lineOffset };
}

// ── Running and judging ──────────────────────────────────────────────────────

export interface PreparedRun {
  stdin: string;
  /** Normalised tests in run order; null where a stored test was malformed and skipped. */
  cases: Array<TestCase | null>;
}

/** stdin for one run: the case count, then each case's parameter lines. */
export function prepareHarnessRun(signature: FunctionSignature, tests: TestCase[]): PreparedRun {
  const cases = tests.map((t) => normaliseTest(signature, t));
  const runnable = cases.filter((c): c is TestCase => c !== null);
  const stdin = [String(runnable.length), ...runnable.map((c) => c.input)].join('\n') + '\n';
  return { stdin, cases };
}

/** What the sandbox reported, independent of which sandbox it was. */
export interface ExecutionOutcome {
  kind: 'ok' | 'compile_error' | 'runtime_error' | 'time_limit' | 'internal_error';
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  message: string | null;
}

/**
 * Error line numbers as the candidate sees them in the editor, not as the
 * compiler saw them in the full program with the header on top.
 */
export function adjustLineNumbers(text: string, offset: number): string {
  if (!offset) return text;
  const shift = (n: string) => String(Math.max(1, Number(n) - offset));
  return text
    .replace(/((?:main\.cpp|main\.c|Main\.java|script\.js|script\.py|prog\.\w+)[:(])(\d+)/g, (_, p, n) => p + shift(n))
    .replace(/(script\.py", line )(\d+)/g, (_, p, n) => p + shift(n));
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  }
  return a === b;
}

function sameAnswer(actual: string, expected: string): boolean {
  try {
    return jsonEqual(JSON.parse(actual), JSON.parse(expected));
  } catch {
    return actual.trim() === expected.trim();
  }
}

/**
 * Turns one harness run into per-test verdicts.
 *
 * Every case prints exactly one line, so line i IS case i. A program that
 * crashed or ran out of time part-way printed fewer lines: the cases before the
 * gap are judged on what they printed, the case it died in carries the error,
 * and the ones after it are reported as not run rather than as failures.
 */
export function judgeHarnessRun(
  outcome: ExecutionOutcome,
  tests: TestCase[],
  prepared: PreparedRun,
  lineOffset: number,
): CodeRunResult {
  const total = tests.length;

  if (outcome.kind === 'compile_error') {
    const message = adjustLineNumbers(
      (outcome.compileOutput || outcome.message || 'Compilation failed.').trim(),
      lineOffset,
    );
    return {
      results: tests.map((t) => ({ verdict: 'compile_error', input: t.input, expected: t.expected, actual: '' })),
      passed: 0,
      total,
      compileError: message,
      passRate: 0,
      runnerAvailable: true,
    };
  }

  const lines = (outcome.stdout ?? '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const stderr = outcome.stderr ? adjustLineNumbers(outcome.stderr.trim(), lineOffset) : '';
  const failureVerdict: TestVerdict =
    outcome.kind === 'time_limit' ? 'time_limit' : outcome.kind === 'internal_error' ? 'internal_error' : 'runtime_error';

  let lineIndex = 0;
  let stopped = false;

  const results: TestResult[] = tests.map((test, i) => {
    const normalised = prepared.cases[i];
    if (!normalised) {
      return {
        verdict: 'internal_error',
        input: test.input,
        expected: test.expected,
        actual: '',
        stderr: 'This test case is malformed and was skipped.',
      };
    }

    if (stopped) {
      return { verdict: 'not_run', input: normalised.input, expected: normalised.expected, actual: '' };
    }

    const line = lines[lineIndex++];
    if (line === undefined) {
      stopped = true;
      return {
        verdict: failureVerdict,
        input: normalised.input,
        expected: normalised.expected,
        actual: '',
        stderr:
          stderr ||
          outcome.message?.trim() ||
          (failureVerdict === 'time_limit' ? 'Time limit exceeded.' : 'The program stopped before returning an answer.'),
      };
    }

    return {
      verdict: sameAnswer(line, normalised.expected) ? 'passed' : 'wrong_answer',
      input: normalised.input,
      expected: normalised.expected,
      actual: line.trim(),
    };
  });

  const passed = results.filter((r) => r.verdict === 'passed').length;

  return {
    results,
    passed,
    total,
    passRate: total > 0 ? passed / total : 0,
    runnerAvailable: true,
    // Print statements, from a run that finished. A crash's stderr is already
    // attached to the case it happened in.
    log: !stopped && stderr ? stderr.slice(0, 4000) : undefined,
  };
}
