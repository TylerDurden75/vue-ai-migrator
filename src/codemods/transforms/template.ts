/**
 * Template transformations for Vue 2 → Vue 3 (Composition API / script setup migration target)
 * Handles template-specific changes:
 * - Scoped slots syntax
 * - v-model in templates
 * - Filters in templates
 * - $listeners in templates
 * - Transition classes, props, group root element
 * - KeyCode modifiers
 */

export interface TemplateTransformResult {
  template: string;
  modified: boolean;
  issues: string[];
}

/**
 * Transform Vue 2 template to Vue 3 template
 */
export function transformTemplate(template: string): TemplateTransformResult {
  const result: TemplateTransformResult = {
    template,
    modified: false,
    issues: [],
  };

  let transformed = template;

  // Transform scoped slots: slot-scope → v-slot
  // Old: <template slot-scope="props">
  // New: <template v-slot="props">
  const slotScopeRegex = /<template\s+slot-scope\s*=\s*["']([^"']+)["']/gi;
  if (slotScopeRegex.test(transformed)) {
    transformed = transformed.replace(
      /<template\s+slot-scope\s*=\s*["']([^"']+)["']/gi,
      '<template v-slot="$1"'
    );
    result.modified = true;
  }

  // Transform named scoped slots: slot="name" slot-scope → v-slot:name
  // Old: <template slot="name" slot-scope="props">
  // New: <template v-slot:name="props">
  const namedSlotScopeRegex =
    /<template\s+slot\s*=\s*["']([^"']+)["']\s+slot-scope\s*=\s*["']([^"']+)["']/gi;
  if (namedSlotScopeRegex.test(transformed)) {
    transformed = transformed.replace(
      /<template\s+slot\s*=\s*["']([^"']+)["']\s+slot-scope\s*=\s*["']([^"']+)["']/gi,
      '<template v-slot:$1="$2"'
    );
    result.modified = true;
  }

  // Transform slot attribute to v-slot (non-scoped)
  // Old: <div slot="name">content</div> inside component
  // New: <template v-slot:name><div>content</div></template>
  // Note: Nested same-name tags may need manual review (regex limitation)
  const slotAttrRegex = /<(\w+)([^>]*)\s+slot\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi;
  transformed = transformed.replace(slotAttrRegex, (match, tag, attrs1, slotName, attrs2, content) => {
    const fullAttrs = (attrs1 + attrs2).replace(/\s*slot\s*=\s*["'][^"']+["']/, '').trim();
    result.modified = true;
    return `<template v-slot:${slotName}><${tag}${fullAttrs ? ' ' + fullAttrs : ''}>${content}</${tag}></template>`;
  });

  // Transform filters in templates (supports chained filters)
  // Old: {{ value | filterName }} or {{ value | f1 | f2 }}
  // New: {{ filterName(value) }} or {{ f2(f1(value)) }}
  // Process each {{ }} block to avoid matching | outside mustaches
  let filterModified = false;
  const mustacheRegex = /\{\{([^}]*)\}\}/g;
  transformed = transformed.replace(mustacheRegex, (fullMatch, inner) => {
    if (!inner.includes('|')) return fullMatch;
    // Match (value) | (filter) - skip whitespace-only value to avoid " " | "f"
    const singleFilterRegex = /([^|{}]+)\s*\|\s*(\w+)(?:\(([^)]*)\))?/g;
    let prev = '';
    let innerResult = inner;
    while (prev !== innerResult) {
      prev = innerResult;
      innerResult = innerResult.replace(singleFilterRegex, (_m: string, value: string, filterName: string, args?: string) => {
        const trimmedValue = value.trim();
        if (!trimmedValue) return _m;
        filterModified = true;
        const trimmedArgs = args ? args.trim() : '';
        if (trimmedArgs) {
          return `${filterName}(${trimmedValue}, ${trimmedArgs})`;
        }
        return `${filterName}(${trimmedValue})`;
      });
    }
    return `{{ ${innerResult.trim()} }}`;
  });
  if (filterModified) {
    result.modified = true;
    result.issues.push('Filters converted to function calls - ensure filter functions exist');
  }

  // Transform $listeners to $attrs in templates
  // Old: v-on="$listeners"
  // New: v-bind="$attrs" (listeners merged into attrs in Vue 3)
  if (transformed.includes('$listeners')) {
    transformed = transformed.replace(/\$listeners/g, '$attrs');
    result.modified = true;
    result.issues.push('$listeners replaced with $attrs - verify event handling');
  }

  // Transition props (Vue 3: Transition Class Change breaking)
  // enter-class → enter-from-class, leave-class → leave-from-class
  if (transformed.includes('enter-class') || transformed.includes('leave-class')) {
    transformed = transformed.replace(/\benter-class\b/g, 'enter-from-class');
    transformed = transformed.replace(/\bleave-class\b/g, 'leave-from-class');
    result.modified = true;
    result.issues.push('Transition props: enter-class → enter-from-class, leave-class → leave-from-class');
  }

  // Custom Elements Interop: is attribute on non-<component> tags (Vue 3 breaking)
  // Vue 2: <tag is="component-name"> rendered the component. Vue 3: is restricted to <component> only.
  // - Restricted elements (tr, li, option, etc.): use vue: prefix for in-DOM parsing
  // - Other elements: use <component is="..."> instead
  const RESTRICTED_HTML_ELEMENTS = new Set([
    'tr', 'td', 'th', 'li', 'option', 'colgroup', 'tbody', 'thead', 'tfoot', 'col'
  ]);
  const isAttrRegex = /<(\w+)([^>]*)\s+is\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>/gi;
  transformed = transformed.replace(isAttrRegex, (match, tag, attrs1, isValue, attrs2, content) => {
    if (tag.toLowerCase() === 'component') return match;
    if (isValue.startsWith('vue:')) return match; // already migrated
    result.modified = true;
    result.issues.push('Fixed is attribute for Vue 3 Custom Elements Interop');
    const fullAttrs = (attrs1 + attrs2).replace(/\s*is\s*=\s*["'][^"']+["']/, '').trim();
    const isRestricted = RESTRICTED_HTML_ELEMENTS.has(tag.toLowerCase());
    const newTag = isRestricted ? tag : 'component';
    const newIs = isRestricted ? `is="vue:${isValue}"` : `is="${isValue}"`;
    const attrsStr = fullAttrs ? ` ${fullAttrs}` : '';
    return `<${newTag}${attrsStr} ${newIs}>${content}</${newTag}>`;
  });

  // Transform v-for and v-if on same element (Vue 3 breaking change)
  // Vue 2: v-for had precedence (iterate then filter)
  // Vue 3: v-if has precedence (breaks Vue 2 behavior when both on same element)
  // Solution: wrap in <template v-for> with v-if on inner element
  // Handles both orders: v-for v-if and v-if v-for
  const wrapVForVIf = (
    tag: string,
    allAttrs: string,
    vForExpr: string,
    vIfExpr: string
  ) => {
    const keyMatch = allAttrs.match(/(?::key|key)\s*=\s*["']([^"']+)["']/);
    const keyAttr = keyMatch ? ` :key="${keyMatch[1]}"` : '';
    const cleanAttrs = allAttrs
      .replace(/\s*(?::key|key)\s*=\s*["'][^"']+["']/, '')
      .replace(/\s*v-for\s*=\s*["'][^"']+["']/, '')
      .replace(/\s*v-if\s*=\s*["'][^"']+["']/, '')
      .trim();
    result.modified = true;
    result.issues.push('v-for and v-if on same element - wrapped in template (Vue 3 precedence)');
    return `<template v-for="${vForExpr}"${keyAttr}><${tag}${cleanAttrs ? ' ' + cleanAttrs : ''} v-if="${vIfExpr}">`;
  };

  // Order 1: v-for then v-if
  const vForThenVIfRegex =
    /<(\w+)([^>]*)\s+v-for\s*=\s*["']([^"']+)["']([^>]*)\s+v-if\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  transformed = transformed.replace(
    vForThenVIfRegex,
    (_m, tag, a1, vForExpr, a2, vIfExpr, a3) =>
      wrapVForVIf(tag, a1 + a2 + a3, vForExpr, vIfExpr)
  );

  // Order 2: v-if then v-for
  const vIfThenVForRegex =
    /<(\w+)([^>]*)\s+v-if\s*=\s*["']([^"']+)["']([^>]*)\s+v-for\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  transformed = transformed.replace(
    vIfThenVForRegex,
    (_m, tag, a1, vIfExpr, a2, vForExpr, a3) =>
      wrapVForVIf(tag, a1 + a2 + a3, vForExpr, vIfExpr)
  );

  // Transition Group Root Element (Vue 3 breaking): no longer renders root by default
  // Add tag="span" when missing to preserve Vue 2 behavior (default was <span>)
  const transitionGroupTagRegex = /<transition-group(\s+[^>]*)?>/gi;
  transformed = transformed.replace(transitionGroupTagRegex, (match) => {
    if (/tag\s*=\s*["'][^"']+["']/i.test(match)) return match;
    result.modified = true;
    result.issues.push('transition-group: added tag="span" (Vue 3 no longer renders root by default)');
    return match.replace(/<transition-group(\s*)/i, '<transition-group$1tag="span" ');
  });

  // Transform transition-group multiple root elements (wrap in single root when no tag)
  // With tag="span" (Vue 3), the tag provides the root - no wrap needed
  const transitionGroupRegex = /<transition-group([^>]*)>([\s\S]*?)<\/transition-group>/gi;
  transformed = transformed.replace(transitionGroupRegex, (_match, attrs, content) => {
    if (/tag\s*=\s*["'][^"']+["']/i.test(attrs)) return _match;
    const rootElements = content.match(/<[^/!][^>]*>/g) || [];
    const closingTags = content.match(/<\/[^>]+>/g) || [];
    if (rootElements.length > 1 && closingTags.length >= rootElements.length) {
      const trimmedContent = content.trim();
      if (!trimmedContent.match(/^<[^>]+>[\s\S]*<\/[^>]+>$/)) {
        result.modified = true;
        result.issues.push('transition-group wrapped with single root element');
        return `<transition-group${attrs}><div>${content}</div></transition-group>`;
      }
    }
    return _match;
  });

  // Transform v-model on custom components (in templates)
  // This is mainly handled in the component props/emits, but we can detect usage
  // Old: <CustomComponent v-model="value" />
  // New: <CustomComponent v-model="value" /> (same, but component needs modelValue/update:modelValue)
  // Detection only - actual transformation is in component code

  // Transform key usage in v-for with template
  // Vue 3 requires key on <template> when using v-for with template
  // Old: <template v-for="item in items"><div :key="item.id">
  // New: <template v-for="item in items" :key="item.id"><div>
  const vForTemplateKeyRegex =
    /<template\s+v-for\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)(<[^>]+\s+:key\s*=\s*["']([^"']+)["'])/gi;
  let vForTemplateMatch;
  while ((vForTemplateMatch = vForTemplateKeyRegex.exec(transformed)) !== null) {
    const fullMatch = vForTemplateMatch[0];
    const vForExpr = vForTemplateMatch[1];
    const templateAttrs = vForTemplateMatch[2];
    const innerContent = vForTemplateMatch[3];
    const keyElement = vForTemplateMatch[4];
    const keyValue = vForTemplateMatch[5];

    // Check if key is not already on template
    if (!templateAttrs.includes(':key') && !templateAttrs.includes('key')) {
      // Move key from inner element to template
      const newTemplate = `<template v-for="${vForExpr}" :key="${keyValue}"${templateAttrs}>${innerContent}${keyElement.replace(/\s*:key\s*=\s*["'][^"']+["']/, '')}`;
      transformed = transformed.replace(fullMatch, newTemplate);
      result.modified = true;
    }
  }

  // Also handle simpler case: <template v-for="..."><div :key="...">
  const simpleVForTemplateRegex =
    /<template\s+v-for\s*=\s*["']([^"']+)["']([^>]*)>\s*<(\w+)([^>]*)\s+:key\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  transformed = transformed.replace(
    simpleVForTemplateRegex,
    (match, vForExpr, templateAttrs, tag, tagAttrs1, keyValue, tagAttrs2) => {
      if (!templateAttrs.includes(':key') && !templateAttrs.includes('key')) {
        result.modified = true;
        const cleanTagAttrs =
          tagAttrs1.replace(/\s*:key\s*=\s*["'][^"']+["']/, '') +
          tagAttrs2.replace(/\s*:key\s*=\s*["'][^"']+["']/, '');
        return `<template v-for="${vForExpr}" :key="${keyValue}"${templateAttrs}><${tag}${cleanTagAttrs}>`;
      }
      return match;
    }
  );

  // Transform key on v-if/v-else/v-else-if (Vue 3)
  // Vue 3 auto-generates unique keys on conditional branches - keys are no longer recommended.
  // BREAKING: Same key on multiple branches (to force reuse) is no longer allowed.
  // Recommended: Remove keys from v-if/v-else/v-else-if.
  let keyRemovedFromConditional = false;
  const conditionalWithKeyRegex =
    /<(\w+)([^>]*(?:v-if|v-else-if|v-else)[^>]*)>/gi;
  transformed = transformed.replace(conditionalWithKeyRegex, (match) => {
    if (!/(?::key|key)\s*=\s*["']/.test(match)) return match;
    const cleaned = match.replace(/\s*(?::key|key)\s*=\s*["'][^"']+["']/, '').replace(/\s+/g, ' ').replace(/\s>/, '>');
    if (cleaned !== match) {
      result.modified = true;
      keyRemovedFromConditional = true;
      return cleaned;
    }
    return match;
  });
  if (keyRemovedFromConditional) {
    result.issues.push('Removed key from v-if/v-else/v-else-if (Vue 3 auto-generates keys)');
  }

  // Transform v-bind merge behavior (Vue 3)
  // Vue 2: individual attributes always overwrote v-bind="object"
  // Vue 3: order determines merge - last wins. To preserve Vue 2 behavior, put v-bind first.
  // Old: <div id="red" v-bind="{ id: 'blue' }"> (Vue 2: id=red. Vue 3: id=blue - breaking)
  // New: <div v-bind="{ id: 'blue' }" id="red"> (Vue 3: id=red - preserves Vue 2)
  const vBindObjectRegex =
    /<(\w+)([^>]*)\s+v-bind\s*=\s*(["'])([\s\S]*?)\3([^>]*)>/gi;
  transformed = transformed.replace(vBindObjectRegex, (match, tag, before, q, vBindExpr, after) => {
    if (!before.trim()) return match;
    const vBindAttr = `v-bind=${q}${vBindExpr}${q}`;
    const otherAttrs = (before + after).trim().replace(/\s+/g, ' ');
    result.modified = true;
    result.issues.push('Reordered v-bind before individual attrs (Vue 3 merge behavior)');
    return `<${tag} ${vBindAttr} ${otherAttrs}>`;
  });

  // Transform v-bind.sync to v-model:prop (Vue 3)
  // Old: <MyComponent v-bind:title.sync="myString" /> or :title.sync="myString"
  // New: <MyComponent v-model:title="myString" />
  const syncRegex = /(?:v-bind:|:)(\w+)\.sync\s*=\s*["']([^"']+)["']/g;
  if (syncRegex.test(transformed)) {
    transformed = transformed.replace(
      /(?:v-bind:|:)(\w+)\.sync\s*=\s*["']([^"']+)["']/g,
      'v-model:$1="$2"'
    );
    result.modified = true;
    result.issues.push('v-bind.sync converted to v-model:prop');
  }

  // Transform keyboard modifiers: keycodes removed in Vue 3, use kebab-case key names
  // Vue 2: @keyup.13, @keyup.112. Vue 3: @keyup.enter, @keyup.f1. config.keyCodes also removed.
  const KEYCODE_TO_KEY: Record<string, string> = {
    '8': 'backspace',
    '9': 'tab',
    '13': 'enter',
    '27': 'esc',
    '32': 'space',
    '33': 'page-up',
    '34': 'page-down',
    '35': 'end',
    '36': 'home',
    '37': 'left',
    '38': 'up',
    '39': 'right',
    '40': 'down',
    '46': 'delete',
    '112': 'f1',
    '113': 'f2',
    '114': 'f3',
    '115': 'f4',
    '116': 'f5',
    '117': 'f6',
    '118': 'f7',
    '119': 'f8',
    '120': 'f9',
    '121': 'f10',
    '122': 'f11',
    '123': 'f12',
  };
  const keycodeModifierRegex = /(v-on:|@)(key(?:up|down|press))\.(\d+)(?=\s|"|'|=|$)/gi;
  let hadKeycode = false;
  transformed = transformed.replace(keycodeModifierRegex, (match, prefix, event, code) => {
    const keyName = KEYCODE_TO_KEY[code];
    if (keyName) {
      result.modified = true;
      hadKeycode = true;
      return `${prefix}${event}.${keyName}`;
    }
    return match;
  });
  if (hadKeycode) {
    result.issues.push('Keycode modifiers converted to key names');
  }

  // Transform @hook:lifecycle to @vnode-lifecycle (Vue 3)
  // Old: <MyComponent @hook:mounted="foo" />
  // New: <MyComponent @vnode-mounted="foo" />
  const hookEventRegex = /@hook:(\w+)/g;
  if (hookEventRegex.test(transformed)) {
    transformed = transformed.replace(/@hook:(\w+)/g, '@vnode-$1');
    result.modified = true;
    result.issues.push('@hook:lifecycle converted to @vnode-lifecycle');
  }

  // Remove .native modifier (removed in Vue 3 - listeners are in $attrs)
  // Old: <MyComponent @click.native="handler" />
  // New: <MyComponent @click="handler" /> (or use inheritAttrs: false + v-bind="$attrs")
  if (transformed.includes('.native')) {
    transformed = transformed.replace(/\.native(?=\s|>|"|'|=)/g, '');
    result.modified = true;
    result.issues.push('.native modifier removed - verify event handling');
  }

  // Detect template refs with v-for (Vue 3 breaking change - ref returns array)
  // Old: <li v-for="item in items" ref="myNodes"> - this.$refs.myNodes was array
  // Vue 3: ref in v-for works differently, use ref() + function ref
  const refInVForRegex =
    /v-for\s*=[^>]*(?:ref|:ref)\s*=|(?:ref|:ref)\s*=[^>]*v-for\s*=/i;
  if (refInVForRegex.test(transformed)) {
    result.issues.push(
      'ref with v-for detected - Vue 3 behavior changed, consider ref() + function ref pattern'
    );
  }

  // Transform functional components (Vue 3 breaking: functional removed)
  // SFC: keep props (compatible with defineProps in script setup), attrs→$attrs, remove v-on="listeners"
  if (transformed.includes('functional')) {
    const beforeFunctional = transformed;
    transformed = transformed.replace(/<template\s+functional([^>]*)>([\s\S]*?)<\/template>/gi, (_, attrs, inner) => {
      let content = inner;
      content = content.replace(/\battrs\./g, '$attrs.');
      content = content.replace(/(^|[^\w$])attrs\b/g, '$1$attrs');
      content = content.replace(/\bv-bind\s*=\s*["']attrs["']/gi, 'v-bind="$attrs"');
      content = content.replace(/\s+v-on\s*=\s*["']listeners["']/gi, '');
      content = content.replace(/\s+v-on\s*=\s*["']data\.listeners["']/gi, '');
      content = content.replace(/\s+v-bind\s*=\s*["']data\.attrs["']/gi, ' v-bind="$attrs"');
      result.issues.push('Functional component: attrs→$attrs, listeners removed (props kept for script setup)');
      return `<template${attrs}>${content}</template>`;
    });
    transformed = transformed.replace(/<template\s+functional([^>]*)>/gi, '<template$1>');
    transformed = transformed.replace(/<(\w+)([^>]*)\s+functional([^>]*)>/gi, '<$1$2$3>');
    if (transformed !== beforeFunctional) {
      result.modified = true;
      result.issues.push('Functional components converted - verify component structure');
    }
  }

  result.template = transformed;
  return result;
}
