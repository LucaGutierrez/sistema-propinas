import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const SRC_DIR = join(PACKAGE_DIR, 'src');

/** Removes comments and the contents of string/template literals, keeping code (incl. ${...}). */
function stripCommentsAndLiterals(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  const modes: ('code' | 'template')[] = ['code'];
  const depths: number[] = []; // brace depth inside each open ${ ... }

  while (i < n) {
    const mode = modes[modes.length - 1];
    const ch = source[i] as string;
    const next = source[i + 1];

    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        while (i < n && source[i] !== '\n') i += 1;
      } else if (ch === '/' && next === '*') {
        i += 2;
        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
        i += 2;
      } else if (ch === "'" || ch === '"') {
        i += 1;
        while (i < n && source[i] !== ch) i += source[i] === '\\' ? 2 : 1;
        i += 1;
        out += ' ';
      } else if (ch === '`') {
        modes.push('template');
        i += 1;
        out += ' ';
      } else if (ch === '{') {
        if (depths.length > 0) depths[depths.length - 1] = (depths[depths.length - 1] ?? 0) + 1;
        out += ch;
        i += 1;
      } else if (ch === '}') {
        if (depths.length > 0 && depths[depths.length - 1] === 0) {
          depths.pop();
          modes.pop(); // back to the enclosing template literal
          out += ' ';
        } else {
          if (depths.length > 0) depths[depths.length - 1] = (depths[depths.length - 1] ?? 1) - 1;
          out += ch;
        }
        i += 1;
      } else {
        out += ch;
        i += 1;
      }
    } else if (ch === '\\') {
      i += 2;
    } else if (ch === '`') {
      modes.pop();
      i += 1;
    } else if (ch === '$' && next === '{') {
      modes.push('code');
      depths.push(0);
      i += 2;
      out += ' ';
    } else {
      i += 1;
    }
  }
  return out;
}

const FORBIDDEN_IDENTIFIERS =
  /\b(Number|parseFloat|parseInt|Math|Date|Intl|process|Buffer|require|globalThis|console|setTimeout|setInterval|fetch|window|document)\b/;
const FORBIDDEN_METHODS = /\.(toFixed|toLocaleString|toPrecision)\b/;
const FLOAT_LITERAL = /(?<![\w.])\d+\.\d+(?!\w)/;
const DYNAMIC_IMPORT = /\bimport\s*\(/;
const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;

function violations(source: string): string[] {
  const code = stripCommentsAndLiterals(source);
  const found: string[] = [];
  const identifier = FORBIDDEN_IDENTIFIERS.exec(code);
  if (identifier) found.push(`forbidden identifier: ${identifier[1]}`);
  const method = FORBIDDEN_METHODS.exec(code);
  if (method) found.push(`forbidden method: .${method[1]}`);
  if (FLOAT_LITERAL.test(code)) found.push('floating-point literal');
  if (DYNAMIC_IMPORT.test(code)) found.push('dynamic import');
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? '';
    if (!specifier.startsWith('./')) found.push(`non-relative import: ${specifier}`);
  }
  return found;
}

const sourceFiles = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'));

describe('the engine is pure and float-free (src/)', () => {
  it('has source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(9);
  });

  it.each(sourceFiles)('%s: no Number/Math/Date/floats/Node/external imports', (file) => {
    const source = readFileSync(join(SRC_DIR, file), 'utf8');
    expect(violations(source)).toEqual([]);
  });

  it('package.json declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
  });
});

describe('the purity scanner itself detects what it should (self-test)', () => {
  it.each([
    ['Number(x)', 'forbidden identifier: Number'],
    ['const a = Math.floor(b);', 'forbidden identifier: Math'],
    ['parseFloat("1.5")', 'forbidden identifier: parseFloat'],
    ['new Date()', 'forbidden identifier: Date'],
    ['process.env.X', 'forbidden identifier: process'],
    ['const a = 0.5;', 'floating-point literal'],
    ['x.toFixed(2)', 'forbidden method: .toFixed'],
    ['import fs from "node:fs";', 'non-relative import: node:fs'],
    ["import { PrismaClient } from '@prisma/client';", 'non-relative import: @prisma/client'],
    ['import React from "react";', 'non-relative import: react'],
    ['const m = await import("x");', 'dynamic import'],
    ['const v = `${Number(a)}`;', 'forbidden identifier: Number'],
  ])('flags %s', (source, expected) => {
    expect(violations(source)).toContain(expected);
  });

  it.each([
    ['// Number(x) and 0.5 in a comment'],
    ['/* Math.floor(1.5) */ const a = 1n;'],
    ['const msg = "Number of Date and 1.5 in a string";'],
    ['const msg = `Date ${a} 0.5`;'],
    ["import { a } from './a';"],
    ["export type * from './types';"],
    ['const grouped = 10n ** BigInt(scale);'],
  ])('does not flag %s', (source) => {
    expect(violations(source)).toEqual([]);
  });
});
