// A deliberately tiny, strict template engine for the site's pages. No dependencies.
//
//   {{a.b}}                 the value at a.b, HTML-escaped (text and attribute safe). A string or a number only.
//   {{js:a.b}}              the value as a JavaScript string literal (JSON, with < > & U+2028 U+2029 escaped).
//   {{#each a.b}}…{{/each}} repeat for every item of a list; inside, names resolve on the item first, then outwards.
//                           {{.}} is the item itself.
//   {{#if a.b}}…{{else}}…{{/if}}  truthy = non-empty string, true, a number other than 0, a non-empty list.
//
// A block tag alone on its line takes its indentation and its line break with it, so a template reads like the page.
// Nothing here ever inserts HTML from the data: every value goes through escapeHtml (or the JS-literal encoder).
// A name that resolves to nothing is an ERROR — a missing field must fail the build loudly, never print "".

export function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function jsLiteral(v) {
  return JSON.stringify(String(v))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const TAG = /\{\{\s*([^{}]*?)\s*\}\}/g;
const NAME = /^(?:\.|\.?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/;

function stripStandalone(src) {
  return src.replace(/^[ \t]*(\{\{\s*(?:[#/](?:each|if)\b[^{}]*?|else)\s*\}\})[ \t]*\r?\n/gm, '$1');
}

export function parse(src, file = 'template') {
  const text = stripStandalone(src);
  const root = { type: 'root', children: [] };
  const stack = [root];
  let last = 0;
  let m;
  TAG.lastIndex = 0;
  const target = (n) => (n.inElse ? n.elseChildren : n.children);
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  while ((m = TAG.exec(text))) {
    if (m.index > last) target(stack[stack.length - 1]).push({ type: 'text', value: text.slice(last, m.index) });
    last = TAG.lastIndex;
    const body = m[1];
    const top = stack[stack.length - 1];
    const where = `${file}:${lineOf(m.index)}`;
    let mm;
    if ((mm = /^#(each|if)\s+(\S+)$/.exec(body))) {
      if (!NAME.test(mm[2])) throw new Error(`${where}: bad name «${mm[2]}»`);
      const node = { type: mm[1], name: mm[2], children: [], elseChildren: null, where };
      target(top).push(node);
      stack.push(node);
    } else if (body === 'else') {
      if (top.type !== 'if' || top.elseChildren) throw new Error(`${where}: {{else}} outside {{#if}}`);
      top.elseChildren = [];
      top.inElse = true;
    } else if ((mm = /^\/(each|if)$/.exec(body))) {
      if (top.type !== mm[1]) throw new Error(`${where}: {{/${mm[1]}}} does not close ${top.type === 'root' ? 'anything' : `{{#${top.type}}}`}`);
      stack.pop();
    } else if ((mm = /^js:(\S+)$/.exec(body))) {
      if (!NAME.test(mm[1])) throw new Error(`${where}: bad name «${mm[1]}»`);
      target(top).push({ type: 'js', name: mm[1], where });
      continue;
    } else if (NAME.test(body)) {
      target(top).push({ type: 'var', name: body, where });
      continue;
    } else {
      throw new Error(`${where}: unknown tag {{${body}}}`);
    }
  }
  if (last < text.length) target(stack[stack.length - 1]).push({ type: 'text', value: text.slice(last) });
  if (stack.length !== 1) throw new Error(`${file}: {{#${stack[stack.length - 1].type}}} opened at ${stack[stack.length - 1].where} is never closed`);
  return root;
}

function lookup(name, ctx, where) {
  if (name === '.') return ctx[0];
  const parts = name.replace(/^\./, '').split('.');
  for (const scope of name.startsWith('.') ? [ctx[0]] : ctx) {
    if (scope !== null && typeof scope === 'object' && Object.prototype.hasOwnProperty.call(scope, parts[0])) {
      let v = scope;
      for (const p of parts) {
        if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, p)) {
          throw new Error(`${where}: «${name}» is missing`);
        }
        v = v[p];
      }
      return v;
    }
  }
  throw new Error(`${where}: «${name}» is missing`);
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined && v !== false && v !== '' && v !== 0;
}

function scalar(v, name, where) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  throw new Error(`${where}: «${name}» is not text (got ${v === null ? 'null' : typeof v})`);
}

function renderNodes(nodes, ctx, out) {
  for (const n of nodes) {
    if (n.type === 'text') out.push(n.value);
    else if (n.type === 'var') out.push(escapeHtml(scalar(lookup(n.name, ctx, n.where), n.name, n.where)));
    else if (n.type === 'js') out.push(jsLiteral(scalar(lookup(n.name, ctx, n.where), n.name, n.where)));
    else if (n.type === 'if') {
      const v = lookup(n.name, ctx, n.where);
      if (truthy(v)) renderNodes(n.children, ctx, out);
      else if (n.elseChildren) renderNodes(n.elseChildren, ctx, out);
    } else if (n.type === 'each') {
      const list = lookup(n.name, ctx, n.where);
      if (!Array.isArray(list)) throw new Error(`${n.where}: «${n.name}» is not a list`);
      for (const item of list) renderNodes(n.children, [item, ...ctx], out);
    }
  }
}

export function render(src, view, file) {
  const ast = parse(src, file);
  const out = [];
  renderNodes(ast.children, [view], out);
  return out.join('');
}
