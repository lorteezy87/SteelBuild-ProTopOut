/**
 * Safe formula language for custom fields (no eval).
 *
 * Grammar (precedence low → high):
 *   ternary   : or ('?' ternary ':' ternary)?
 *   or        : and (('||' | 'or') and)*
 *   and       : equality (('&&' | 'and') equality)*
 *   equality  : compare (('==' | '!=') compare)*
 *   compare   : additive (('<' | '<=' | '>' | '>=') additive)*
 *   additive  : mult (('+' | '-') mult)*
 *   mult      : unary (('*' | '/' | '%') unary)*
 *   unary     : ('-' | '!' | 'not') unary | call
 *   call      : primary ('(' args ')')?
 *   primary   : number | string | true | false | null | ident('.' ident)* | '(' ternary ')'
 *
 * Identifiers resolve against the context, e.g. `me.budget`, `me.cf_total`.
 */

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

export class FormulaError extends Error {}

const OPS = ["<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "<", ">", "!", "?", ":", "(", ")", ","];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (Number.isNaN(v)) throw new FormulaError(`Bad number at ${i}`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError("Unterminated string");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new FormulaError(`Unexpected '${c}' at ${i}`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  out.push({ t: "eof" });
  return out;
}

type Node =
  | { k: "lit"; v: unknown }
  | { k: "ref"; path: string[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "tern"; c: Node; a: Node; b: Node }
  | { k: "call"; name: string; args: Node[] };

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => {
    const t = peek();
    return t.t === "op" && t.v === v;
  };
  const isWord = (v: string) => {
    const t = peek();
    return t.t === "id" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected '${v}'`);
    p++;
  };

  const ternary = (): Node => {
    const c = or();
    if (isOp("?")) {
      p++;
      const a = ternary();
      expect(":");
      const b = ternary();
      return { k: "tern", c, a, b };
    }
    return c;
  };
  const or = (): Node => {
    let a = and();
    while (isOp("||") || isWord("or")) {
      p++;
      a = { k: "bin", op: "||", a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = equality();
    while (isOp("&&") || isWord("and")) {
      p++;
      a = { k: "bin", op: "&&", a, b: equality() };
    }
    return a;
  };
  const equality = (): Node => {
    let a = compare();
    while (isOp("==") || isOp("!=")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: compare() };
    }
    return a;
  };
  const compare = (): Node => {
    let a = additive();
    while (isOp("<") || isOp("<=") || isOp(">") || isOp(">=")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: additive() };
    }
    return a;
  };
  const additive = (): Node => {
    let a = mult();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: mult() };
    }
    return a;
  };
  const mult = (): Node => {
    let a = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return { k: "un", op: "-", a: unary() };
    }
    if (isOp("!") || isWord("not")) {
      p++;
      return { k: "un", op: "!", a: unary() };
    }
    return call();
  };
  const call = (): Node => {
    const t = peek();
    if (t.t === "id" && toks[p + 1]?.t === "op" && (toks[p + 1] as { v: string }).v === "(") {
      p += 2;
      const args: Node[] = [];
      if (!isOp(")")) {
        args.push(ternary());
        while (isOp(",")) {
          p++;
          args.push(ternary());
        }
      }
      expect(")");
      return { k: "call", name: t.v, args };
    }
    return primary();
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      return { k: "ref", path: t.v.split(".") };
    }
    if (t.t === "op" && t.v === "(") {
      const e = ternary();
      expect(")");
      return e;
    }
    throw new FormulaError("Unexpected end of formula");
  };

  const root = ternary();
  if (peek().t !== "eof") throw new FormulaError("Unexpected trailing input");
  return root;
}

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
};

const dayMs = 86_400_000;
const toTime = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

export type FormulaContext = Record<string, unknown> & { today?: string };

const FUNCS: Record<string, (args: unknown[], ctx: FormulaContext) => unknown> = {
  round: ([x]) => Math.round(num(x)),
  roundTo: ([x, n]) => {
    const f = 10 ** num(n);
    return Math.round(num(x) * f) / f;
  },
  ceil: ([x]) => Math.ceil(num(x)),
  floor: ([x]) => Math.floor(num(x)),
  abs: ([x]) => Math.abs(num(x)),
  min: args => Math.min(...args.map(num)),
  max: args => Math.max(...args.map(num)),
  if: ([c, a, b]) => (c ? a : b),
  isEmpty: ([x]) => x == null || x === "" || (Array.isArray(x) && x.length === 0),
  contains: ([s, sub]) => String(s ?? "").toLowerCase().includes(String(sub ?? "").toLowerCase()),
  concat: args => args.map(a => (a == null ? "" : String(a))).join(""),
  today: (_a, ctx) => ctx.today ?? new Date().toISOString().slice(0, 10),
  daysBetween: ([a, b]) => {
    const ta = toTime(a);
    const tb = toTime(b);
    if (ta == null || tb == null) return null;
    return Math.round((tb - ta) / dayMs);
  },
  formatCurrency: ([x]) =>
    num(x).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
  formatNumber: ([x, d]) => num(x).toLocaleString("en-US", { maximumFractionDigits: d == null ? 2 : num(d) }),
};

function evalNode(n: Node, ctx: FormulaContext): unknown {
  switch (n.k) {
    case "lit":
      return n.v;
    case "ref": {
      let cur: unknown = ctx;
      for (const part of n.path) {
        if (cur == null || typeof cur !== "object") return null;
        cur = (cur as Record<string, unknown>)[part];
      }
      return cur ?? null;
    }
    case "un": {
      const a = evalNode(n.a, ctx);
      return n.op === "-" ? -num(a) : !a;
    }
    case "tern":
      return evalNode(n.c, ctx) ? evalNode(n.a, ctx) : evalNode(n.b, ctx);
    case "call": {
      const f = FUNCS[n.name];
      if (!f) throw new FormulaError(`Unknown function '${n.name}'`);
      return f(
        n.args.map(a => evalNode(a, ctx)),
        ctx
      );
    }
    case "bin": {
      if (n.op === "&&") return evalNode(n.a, ctx) && evalNode(n.b, ctx);
      if (n.op === "||") return evalNode(n.a, ctx) || evalNode(n.b, ctx);
      const a = evalNode(n.a, ctx);
      const b = evalNode(n.b, ctx);
      switch (n.op) {
        case "+":
          return typeof a === "string" || typeof b === "string" ? `${a ?? ""}${b ?? ""}` : num(a) + num(b);
        case "-":
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/":
          return num(b) === 0 ? null : num(a) / num(b);
        case "%":
          return num(b) === 0 ? null : num(a) % num(b);
        case "==":
          return a == b; // eslint-disable-line eqeqeq
        case "!=":
          return a != b; // eslint-disable-line eqeqeq
        case "<":
          return compareVals(a, b) < 0;
        case "<=":
          return compareVals(a, b) <= 0;
        case ">":
          return compareVals(a, b) > 0;
        case ">=":
          return compareVals(a, b) >= 0;
      }
    }
  }
  return null;
}

function compareVals(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return num(a) - num(b);
}

const cache = new Map<string, Node>();

export function compileFormula(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    n = parse(src);
    if (cache.size > 500) cache.clear();
    cache.set(src, n);
  }
  return n;
}

export function evaluateFormula(src: string, ctx: FormulaContext): unknown {
  const v = evalNode(compileFormula(src), ctx);
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  return v;
}

export function validateFormula(src: string): string | null {
  try {
    compileFormula(src);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid formula";
  }
}
