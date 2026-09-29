/**
 * Minimal, non-validating XML reader for Oracle Forms (frmf2xml) and Reports
 * (rwconverter) exports. Handles attributes, entities, CDATA, comments and
 * processing instructions. Good enough for well-formed tool output; it never
 * executes or resolves external entities.
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
  line: number;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '', line: 1 };
  const stack: XmlNode[] = [root];
  let i = 0;
  let line = 1;
  const advance = (to: number) => {
    for (let k = i; k < to; k++) if (src.charCodeAt(k) === 10) line++;
    i = to;
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      stack.at(-1)!.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack.at(-1)!.text += decodeEntities(src.slice(i, lt));
    advance(lt);
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      advance(end === -1 ? src.length : end + 3);
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      stack.at(-1)!.text += src.slice(i + 9, end === -1 ? src.length : end);
      advance(end === -1 ? src.length : end + 3);
    } else if (src.startsWith('<?', i) || src.startsWith('<!', i)) {
      const end = src.indexOf('>', i + 2);
      advance(end === -1 ? src.length : end + 1);
    } else if (src[i + 1] === '/') {
      const end = src.indexOf('>', i);
      const name = src.slice(i + 2, end).trim();
      // Pop to the matching element; tolerate small nesting errors.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.name === name) {
          stack.length = k;
          break;
        }
      }
      advance(end === -1 ? src.length : end + 1);
    } else {
      // Find the end of the tag, respecting quoted attribute values.
      let j = i + 1;
      let quote: string | null = null;
      while (j < src.length) {
        const ch = src[j]!;
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
        j++;
      }
      const raw = src.slice(i + 1, j);
      const selfClosing = raw.endsWith('/');
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const nameMatch = body.match(/^\s*([^\s/>]+)/);
      const node: XmlNode = { name: nameMatch?.[1] ?? '', attrs: {}, children: [], text: '', line };
      for (const a of body.slice(nameMatch?.[0].length ?? 0).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        node.attrs[a[1]!] = decodeEntities(a[3] ?? a[4] ?? '');
      }
      stack.at(-1)!.children.push(node);
      if (!selfClosing) stack.push(node);
      advance(j + 1);
    }
  }
  return root;
}

/** Depth-first search for elements by (case-insensitive) name. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const target = name.toLowerCase();
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name.toLowerCase() === target) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function attr(node: XmlNode, ...names: string[]): string | undefined {
  for (const n of names) {
    const hit = Object.keys(node.attrs).find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit) return node.attrs[hit];
  }
  return undefined;
}

/** Concatenated text of a node and its descendants (CDATA included). */
export function deepText(node: XmlNode): string {
  return node.text + node.children.map(deepText).join('');
}
