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

/** Walk JSX children and return the first static text string found. */
function extractText(children, t) {
  for (const child of children) {
    if (t.isJSXText(child)) {
      const v = child.value.replace(/\s+/g, ' ').trim()
      if (v) return v.slice(0, 60)
    }
    if (t.isJSXElement(child)) {
      const namePart = child.openingElement.name
      const name = t.isJSXIdentifier(namePart) ? namePart.name : null
      if (name && /^[A-Z]/.test(name) && name !== 'Text') continue
      const inner = extractText(child.children, t)
      if (inner) return inner
    }
    if (t.isJSXExpressionContainer(child) && t.isStringLiteral(child.expression)) {
      return child.expression.value.slice(0, 60)
    }
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

          // Inject onReady using the ref prop value so we can capture the initial screen
          if (!existingPropNames.has('onReady')) {
            const refAttr = attrs.find(
              (a) =>
                t.isJSXAttribute(a) &&
                t.isJSXIdentifier(a.name) &&
                a.name.name === 'ref'
            )
            if (refAttr && t.isJSXExpressionContainer(refAttr.value)) {
              const refExpr = refAttr.value.expression
              if (t.isExpression(refExpr) && !t.isJSXEmptyExpression(refExpr)) {
                attrs.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('onReady'),
                    t.jsxExpressionContainer(
                      t.callExpression(t.identifier(NAV_READY_ID), [refExpr])
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
        const extractedText =
          parentNode && t.isJSXElement(parentNode)
            ? extractText(parentNode.children, t)
            : null

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
            t.objectProperty(t.identifier('t'), extractedText ? t.stringLiteral(extractedText) : t.nullLiteral()),
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
