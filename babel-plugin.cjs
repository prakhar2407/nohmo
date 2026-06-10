'use strict'

/**
 * Nohmo Babel plugin — React Native autocapture.
 *
 * Automatically tracks:
 *  - onPress / onLongPress on any component
 *  - Screen views via NavigationContainer (onStateChange + onReady injected)
 *
 * Usage (babel.config.js):
 *   plugins: ['nohmo/babel-plugin']
 */

const PRESS_PROPS = new Set(['onPress', 'onLongPress'])
const WRAP_ID = '__nohmoWrap'
const NAV_STATE_ID = '__nohmoNavStateChange'
const NAV_READY_ID = '__nohmoMakeReady'
const IMPORT_SOURCE = 'nohmo/react-native/autocapture'

// Stop collecting after this many text fragments — keeps the injected
// expression small for deeply-nested buttons (runtime also caps the string).
const MAX_FRAGMENTS = 6

/**
 * True if an expression node contains (or may evaluate to) JSX — e.g. a badge
 * `{count > 0 ? <View/> : null}` nested in a <Text>. Such fragments stringify to
 * "[object Object]" at runtime, so we skip them rather than capture noise.
 * Walks generically via VISITOR_KEYS so all expression shapes are covered.
 */
function containsJSX(node, t) {
  if (!node || typeof node.type !== 'string') return false
  if (t.isJSXElement(node) || t.isJSXFragment(node)) return true
  const keys = t.VISITOR_KEYS[node.type] || []
  for (const key of keys) {
    const v = node[key]
    if (Array.isArray(v)) {
      for (const c of v) if (containsJSX(c, t)) return true
    } else if (v && typeof v.type === 'string') {
      if (containsJSX(v, t)) return true
    }
  }
  return false
}

/**
 * Walk JSX children and collect text fragments into `out`. A fragment is either
 * a string literal (static JSXText or a "..."-valued expression) or a dynamic
 * expression node (variable / i18n t() call / ternary / template string).
 * Descends into intrinsics and <Text>, but skips other custom components —
 * mirroring how the original static extractor scoped its walk.
 */
function collectFragments(children, t, out) {
  for (const child of children) {
    if (out.length >= MAX_FRAGMENTS) return
    if (t.isJSXText(child)) {
      const v = child.value.replace(/\s+/g, ' ').trim()
      if (v) out.push(t.stringLiteral(v))
    } else if (t.isJSXExpressionContainer(child)) {
      const e = child.expression
      if (t.isStringLiteral(e)) {
        const v = e.value.replace(/\s+/g, ' ').trim()
        if (v) out.push(t.stringLiteral(v))
      } else if (t.isExpression(e) && !t.isJSXEmptyExpression(e) && !containsJSX(e, t)) {
        out.push(e)
      }
    } else if (t.isJSXElement(child)) {
      // Descend into any child component (not just <Text>) so text wrapped in
      // a design-system component — <AppText>, <ThemedText>, etc. — is read.
      collectFragments(child.children, t, out)
    }
  }
}

/**
 * Build an AST node for a JSX element's child text:
 *  - all-static  → one trimmed string literal (≤60 chars)
 *  - any dynamic → a template literal joining each fragment with spaces, so
 *                  i18n / variable / emoji+label children resolve at runtime
 *  - no text     → null
 */
function textNodeFromChildren(children, t) {
  const frags = []
  collectFragments(children, t, frags)
  if (frags.length === 0) return null

  if (frags.every((f) => t.isStringLiteral(f))) {
    const joined = frags.map((f) => f.value).join(' ').replace(/\s+/g, ' ').trim()
    return joined ? t.stringLiteral(joined.slice(0, 60)) : null
  }

  // Template literal needs (expressions + 1) quasis; separate fragments with a
  // single space, empty at the ends. Clone fragments to avoid AST aliasing.
  const quasis = []
  for (let i = 0; i <= frags.length; i++) {
    const raw = i === 0 || i === frags.length ? '' : ' '
    quasis.push(t.templateElement({ raw, cooked: raw }, i === frags.length))
  }
  return t.templateLiteral(quasis, frags.map((f) => t.cloneNode(f, true)))
}

// Text-bearing props, in priority order. Many design-system buttons (and RN's
// core <Button />) carry their label in a prop rather than children.
const TEXT_PROPS = ['label', 'title', 'text', 'accessibilityLabel']

/**
 * Find a text-bearing prop on a JSX element and return an AST node for its value.
 * Static strings become a string literal; dynamic expressions (i18n t() calls,
 * ternaries, template strings) are cloned and embedded so they evaluate at
 * runtime — capturing the label the user actually sees. Returns null if none.
 * The clone matters: aliasing the original prop node breaks Hermes codegen.
 */
function textFromProps(attrs, t) {
  for (const propName of TEXT_PROPS) {
    const attr = attrs.find(
      (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === propName
    )
    if (!attr) continue
    if (t.isStringLiteral(attr.value)) {
      const v = attr.value.value.replace(/\s+/g, ' ').trim()
      if (v) return t.stringLiteral(v.slice(0, 60))
    }
    if (t.isJSXExpressionContainer(attr.value)) {
      const expr = attr.value.expression
      if (t.isExpression(expr) && !t.isJSXEmptyExpression(expr) && !containsJSX(expr, t)) {
        return t.cloneNode(expr, true)
      }
    }
  }
  return null
}

// Common icon component families (react-native-vector-icons / @expo/vector-icons).
const ICON_SETS = new Set([
  'Ionicons', 'MaterialIcons', 'MaterialCommunityIcons', 'FontAwesome', 'FontAwesome5',
  'FontAwesome6', 'Feather', 'AntDesign', 'Entypo', 'EvilIcons', 'Foundation',
  'Octicons', 'SimpleLineIcons', 'Zocial', 'Fontisto',
])

function isIconComponent(name) {
  return !!name && (ICON_SETS.has(name) || /icon/i.test(name))
}

/**
 * Last-resort fallback for icon-only buttons (trash / menu / close): find the
 * first icon-like child and use its `name` prop as the label, so the button is
 * still identifiable. Static names embed directly; dynamic ones run at runtime.
 */
function iconNameFromChildren(children, t) {
  for (const child of children) {
    if (!t.isJSXElement(child)) continue
    const namePart = child.openingElement.name
    const cname = t.isJSXIdentifier(namePart) ? namePart.name : null
    if (isIconComponent(cname)) {
      const nameAttr = child.openingElement.attributes.find(
        (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'name'
      )
      if (nameAttr) {
        if (t.isStringLiteral(nameAttr.value)) {
          const v = nameAttr.value.value.trim()
          if (v) return t.stringLiteral(v.slice(0, 60))
        } else if (t.isJSXExpressionContainer(nameAttr.value)) {
          const e = nameAttr.value.expression
          if (t.isExpression(e) && !t.isJSXEmptyExpression(e) && !containsJSX(e, t)) {
            return t.cloneNode(e, true)
          }
        }
      }
    }
    const inner = iconNameFromChildren(child.children, t)
    if (inner) return inner
  }
  return null
}

module.exports = function nohmoPlugin({ types: t }) {
  return {
    visitor: {
      // Inject a single import statement at the top of any file we touched
      Program: {
        exit(programPath, state) {
          const specifiers = []

          if (state.nohmoWrapUsed) {
            specifiers.push(
              t.importSpecifier(t.identifier(WRAP_ID), t.identifier(WRAP_ID))
            )
          }
          if (state.nohmoNavUsed) {
            specifiers.push(
              t.importSpecifier(t.identifier(NAV_STATE_ID), t.identifier('onNohmoStateChange')),
              t.importSpecifier(t.identifier(NAV_READY_ID), t.identifier('makeNohmoReadyHandler'))
            )
          }

          if (specifiers.length > 0) {
            programPath.unshiftContainer(
              'body',
              t.importDeclaration(specifiers, t.stringLiteral(IMPORT_SOURCE))
            )
          }
        },
      },

      JSXOpeningElement(path, state) {
        if (state.filename && state.filename.includes('node_modules')) return

        const attrs = path.node.attributes
        const nameNode = path.node.name
        const componentName = t.isJSXIdentifier(nameNode) ? nameNode.name : null

        // ── NavigationContainer: inject onStateChange + onReady ────────────
        if (componentName === 'NavigationContainer') {
          const existingPropNames = new Set(
            attrs
              .filter((a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name))
              .map((a) => a.name.name)
          )

          // Inject onStateChange (skip if the user already set it)
          if (!existingPropNames.has('onStateChange')) {
            attrs.push(
              t.jsxAttribute(
                t.jsxIdentifier('onStateChange'),
                t.jsxExpressionContainer(t.identifier(NAV_STATE_ID))
              )
            )
            state.nohmoNavUsed = true
          }

          // Inject onReady using the ref prop value so we can capture the initial screen.
          // Only inject when the ref is a simple Identifier (e.g. ref={navigationRef}).
          // Deep-clone the node — reusing the same AST node in two positions causes
          // malformed code generation on Hermes (ReferenceError: Property 'X' doesn't exist).
          if (!existingPropNames.has('onReady')) {
            const refAttr = attrs.find(
              (a) =>
                t.isJSXAttribute(a) &&
                t.isJSXIdentifier(a.name) &&
                a.name.name === 'ref'
            )
            if (refAttr && t.isJSXExpressionContainer(refAttr.value)) {
              const refExpr = refAttr.value.expression
              if (t.isIdentifier(refExpr)) {
                attrs.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('onReady'),
                    t.jsxExpressionContainer(
                      t.callExpression(t.identifier(NAV_READY_ID), [t.cloneNode(refExpr, true)])
                    )
                  )
                )
                state.nohmoNavUsed = true
              }
            }
          }

          return // NavigationContainer handled — skip press wrapping below
        }

        // ── Press props: wrap onPress / onLongPress ────────────────────────
        if (componentName && /^[a-z]/.test(componentName)) return // skip intrinsics

        const pressAttrs = attrs.filter(
          (attr) =>
            t.isJSXAttribute(attr) &&
            t.isJSXIdentifier(attr.name) &&
            PRESS_PROPS.has(attr.name.name)
        )
        if (pressAttrs.length === 0) return

        const parentNode = path.parentPath?.node
        const children =
          parentNode && t.isJSXElement(parentNode) ? parentNode.children : []
        // Fallback order: visible children text (static or dynamic) → a
        // text-bearing prop → an icon child's name (icon-only buttons). Dynamic
        // children/prop/name expressions are embedded for runtime evaluation, so
        // i18n / ternary / template / emoji+label labels capture as displayed.
        const textNode =
          textNodeFromChildren(children, t) ||
          textFromProps(attrs, t) ||
          iconNameFromChildren(children, t) ||
          t.nullLiteral()

        const filename = state.filename
          ? state.filename.replace(/.*[/\\]/, '').replace(/\.[jt]sx?$/, '')
          : null
        const line = path.node.loc?.start.line ?? null

        for (const attr of pressAttrs) {
          if (!t.isJSXAttribute(attr)) continue
          if (!t.isJSXExpressionContainer(attr.value)) continue
          const expr = attr.value.expression
          if (!t.isExpression(expr) || t.isJSXEmptyExpression(expr)) continue

          const metaProps = [
            t.objectProperty(t.identifier('c'), componentName ? t.stringLiteral(componentName) : t.nullLiteral()),
            t.objectProperty(t.identifier('p'), t.stringLiteral(attr.name.name)),
            t.objectProperty(t.identifier('t'), t.cloneNode(textNode, true)),
            t.objectProperty(t.identifier('f'), filename ? t.stringLiteral(filename) : t.nullLiteral()),
          ]
          if (line !== null) {
            metaProps.push(t.objectProperty(t.identifier('l'), t.numericLiteral(line)))
          }

          attr.value = t.jsxExpressionContainer(
            t.callExpression(t.identifier(WRAP_ID), [expr, t.objectExpression(metaProps)])
          )
          state.nohmoWrapUsed = true
        }
      },
    },
  }
}
