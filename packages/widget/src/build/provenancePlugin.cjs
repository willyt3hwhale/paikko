/**
 * paikko provenance plugin (Babel).
 *
 * This is the "click -> source" unlock. At build time it injects two data
 * attributes onto every JSX host element (lowercase tag) it visits:
 *
 *   data-src="file:line:col"        - build-time provenance of the element, the
 *                                     same "file:line:col" shape used everywhere in
 *                                     the contract (ReportTarget.src, TraceQuery.src,
 *                                     TraceRequest.src). When a user clicks an
 *                                     element in <ReportButton>'s picker, this is
 *                                     read straight off the DOM node.
 *   data-paikko-component="Name"    - the nearest enclosing React component's
 *                                     display name, so the report can name the
 *                                     owning component without runtime fiber walking.
 *
 * Only host (DOM) elements get `data-src` (component elements forward props, they
 * aren't real DOM nodes); both host and component elements are tagged with the
 * enclosing component name so the attribute propagates intent. We skip <Fragment>
 * and elements that already carry a `data-src` (idempotent re-runs, hand-authored
 * overrides).
 *
 * ## Wire-up
 *
 * Babel route (.babelrc / babel.config.js) - add to `plugins`:
 *
 *   {
 *     "plugins": [
 *       ["./src/paikko/build/provenancePlugin.js", { "rootDir": "." }]
 *     ]
 *   }
 *
 * Note: adding a .babelrc opts the whole project out of Next's default SWC
 * compiler. If you want to keep SWC for everything else, instead run this as a
 * one-off codemod, or port it to an SWC plugin. For dev/preview builds where
 * provenance matters most, the Babel route is the simplest correct option.
 *
 * Next.js config (next.config.js) - if using SWC and you only need this in
 * development, you can gate it; with the Babel route Next picks up .babelrc
 * automatically. The plugin is build-time only and emits no runtime code beyond
 * the static attributes. By DEFAULT it no-ops in production builds (NODE_ENV ===
 * "production"), so the `data-src` paths never leak into shipped HTML; pass an
 * explicit `enabled` (see Options) to override.
 *
 * ## Options
 *
 *   rootDir   - base dir to relativize filenames against (default process.cwd()).
 *   attr      - override the src attribute name (default "data-src").
 *   componentAttr - override the component attribute (default "data-paikko-component").
 *   enabled   - tri-state gate for emitting the attributes:
 *                 true      -> always emit;
 *                 false     -> never emit (no-op);
 *                 undefined -> DEFAULT: emit only when NODE_ENV !== "production",
 *                              so provenance never leaks source paths into a prod
 *                              build unless you opt in explicitly. A JSON `.babelrc`
 *                              cannot read env vars - use `.babelrc.js` to pass an
 *                              explicit `enabled` if you need finer control.
 */

"use strict";

const path = require("path");

/**
 * Resolve the tri-state `enabled` option. Explicit booleans win; otherwise
 * default to dev-only so a production build does not ship `data-src` source
 * paths in its HTML.
 */
function isEnabled(opt) {
  if (opt === true) return true;
  if (opt === false) return false;
  return process.env.NODE_ENV !== "production";
}

module.exports = function provenancePlugin(babel) {
  const { types: t } = babel;

  /** Relativize an absolute filename to rootDir, with forward slashes. */
  function relFile(filename, rootDir) {
    if (!filename) return "unknown";
    const rel = path.relative(rootDir, filename);
    return rel.split(path.sep).join("/");
  }

  /** True if the JSX opening element already has an attribute named `name`. */
  function hasAttr(openingElement, name) {
    return openingElement.attributes.some(
      (attr) =>
        t.isJSXAttribute(attr) &&
        t.isJSXIdentifier(attr.name, { name }),
    );
  }

  /** JSX tag is a host (DOM) element if it's a lowercase identifier. */
  function isHostElement(openingElement) {
    const nameNode = openingElement.name;
    if (!t.isJSXIdentifier(nameNode)) return false; // member/namespaced => component
    const tag = nameNode.name;
    return /^[a-z]/.test(tag);
  }

  /** Tag name is <Fragment> / <React.Fragment> - skip those, they emit no node. */
  function isFragment(openingElement) {
    const nameNode = openingElement.name;
    if (t.isJSXIdentifier(nameNode)) return nameNode.name === "Fragment";
    if (t.isJSXMemberExpression(nameNode)) {
      return t.isJSXIdentifier(nameNode.property, { name: "Fragment" });
    }
    return false;
  }

  /**
   * Find the display name of the component enclosing this JSX. Walks up the path
   * to the nearest function/class declaration or variable-bound arrow/function and
   * returns its name. Returns null if anonymous / not found.
   */
  function enclosingComponentName(jsxPath) {
    let p = jsxPath;
    while (p) {
      const node = p.node;
      if (
        (t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) &&
        node.id &&
        t.isIdentifier(node.id)
      ) {
        return node.id.name;
      }
      if (
        (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) &&
        p.parentPath &&
        t.isVariableDeclarator(p.parentPath.node) &&
        t.isIdentifier(p.parentPath.node.id)
      ) {
        return p.parentPath.node.id.name;
      }
      p = p.parentPath;
    }
    return null;
  }

  /** Build a `data-foo="value"` JSX attribute node. */
  function stringAttr(name, value) {
    return t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value));
  }

  return {
    name: "paikko-provenance",
    visitor: {
      JSXOpeningElement(jsxPath, state) {
        const opts = state.opts || {};
        if (!isEnabled(opts.enabled)) return;

        const rootDir = opts.rootDir
          ? path.resolve(opts.rootDir)
          : process.cwd();
        const srcAttrName = opts.attr || "data-src";
        const componentAttrName =
          opts.componentAttr || "data-paikko-component";

        const opening = jsxPath.node;
        if (isFragment(opening)) return;

        const loc = opening.loc;
        if (!loc) return; // no source position (generated node) - nothing to point at

        const filename =
          (state.file && state.file.opts && state.file.opts.filename) || null;
        const file = relFile(filename, rootDir);
        const line = loc.start.line;
        // Babel columns are 0-based; the contract's "file:line:col" is 1-based.
        const col = loc.start.column + 1;
        const src = `${file}:${line}:${col}`;

        const host = isHostElement(opening);

        // data-src only on real DOM nodes (host elements). Component elements
        // forward props and would either error or leak the attr to their root.
        if (host && !hasAttr(opening, srcAttrName)) {
          opening.attributes.push(stringAttr(srcAttrName, src));
        }

        // data-paikko-component on host elements so the clicked DOM node knows its
        // owning component without a runtime fiber walk.
        if (host && !hasAttr(opening, componentAttrName)) {
          const component = enclosingComponentName(
            jsxPath.findParent(
              (p) =>
                p.isFunction() ||
                p.isClassMethod() ||
                p.isClassDeclaration(),
            ) || jsxPath,
          );
          if (component) {
            opening.attributes.push(stringAttr(componentAttrName, component));
          }
        }
      },
    },
  };
};
