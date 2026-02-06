/**
 * Template transformations for Vue 2 → Vue 3
 * Handles template-specific changes:
 * - Scoped slots syntax
 * - v-model in templates
 * - Filters in templates
 * - $listeners in templates
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

  // Transform v-for and v-if precedence
  // Vue 2: v-if evaluated before v-for
  // Vue 3: v-for evaluated before v-if (precedence changed)
  // Old: <div v-for="item in items" v-if="item.visible">
  // New: <template v-for="item in items"><div v-if="item.visible"></div></template>
  const vForVIfRegex =
    /<(\w+)([^>]*)\s+v-for\s*=\s*["']([^"']+)["']([^>]*)\s+v-if\s*=\s*["']([^"']+)["']([^>]*)>/gi;
  transformed = transformed.replace(
    vForVIfRegex,
    (_match, tag, attrs1, vForExpr, attrs2, vIfExpr, attrs3) => {
      // Extract key if present
      const allAttrs = attrs1 + attrs2 + attrs3;
      const keyMatch = allAttrs.match(/(?::key|key)\s*=\s*["']([^"']+)["']/);
      const keyAttr = keyMatch ? ` :key="${keyMatch[1]}"` : '';

      // Remove key and v-for/v-if from inner element attributes
      const cleanVForAttrs = (attrs1 + attrs2)
        .replace(/\s*(?::key|key)\s*=\s*["'][^"']+["']/, '')
        .replace(/\s*v-for\s*=\s*["'][^"']+["']/, '');
      const cleanVIfAttrs = attrs3.replace(/\s*v-if\s*=\s*["'][^"']+["']/, '');

      result.modified = true;
      result.issues.push('v-for and v-if precedence changed - wrapped in template');
      return `<template v-for="${vForExpr}"${keyAttr}><${tag}${cleanVForAttrs} v-if="${vIfExpr}"${cleanVIfAttrs}>`;
    }
  );

  // Transform transition-group root element
  // Vue 3: <transition-group> must have single root element
  // Old: <transition-group><div></div><div></div></transition-group>
  // New: <transition-group><div><div></div><div></div></div></transition-group>
  const transitionGroupRegex = /<transition-group([^>]*)>([\s\S]*?)<\/transition-group>/gi;
  transformed = transformed.replace(transitionGroupRegex, (_match, attrs, content) => {
    // Count root-level elements (not nested)
    const rootElements = content.match(/<[^/!][^>]*>/g) || [];
    const closingTags = content.match(/<\/[^>]+>/g) || [];

    // Simple heuristic: if we have multiple root elements, wrap them
    if (rootElements.length > 1 && closingTags.length >= rootElements.length) {
      // Check if already wrapped
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

  // Transform v-else-if key requirement
  // Vue 3 may require keys on v-else-if in some cases
  // Add key if missing in v-if/v-else-if chain
  const vIfChainRegex =
    /<(\w+)([^>]*)\s+v-if\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/\1>([\s\S]*?)(?:<(\w+)([^>]*)\s+v-else-if\s*=\s*["']([^"']+)["']([^>]*)>)/gi;
  let vIfChainMatch;
  const processedChains = new Set<string>();
  while ((vIfChainMatch = vIfChainRegex.exec(transformed)) !== null) {
    const chainKey = vIfChainMatch.index.toString();
    if (processedChains.has(chainKey)) continue;
    processedChains.add(chainKey);

    const vIfAttrs = vIfChainMatch[2] + vIfChainMatch[4];
    const vElseIfTag = vIfChainMatch[7];
    const vElseIfAttrs = vIfChainMatch[8] + vIfChainMatch[10];

    // Check if v-if has key but v-else-if doesn't
    const vIfHasKey = vIfAttrs.includes(':key') || vIfAttrs.includes('key');
    const vElseIfHasKey = vElseIfAttrs.includes(':key') || vElseIfAttrs.includes('key');

    if (vIfHasKey && !vElseIfHasKey) {
      // Extract key from v-if
      const keyMatch = vIfAttrs.match(/(?::key|key)\s*=\s*["']([^"']+)["']/);
      if (keyMatch) {
        const keyValue = keyMatch[1];
        transformed = transformed.replace(
          new RegExp(`<${vElseIfTag}([^>]*)\\s+v-else-if`, 'g'),
          (_match, attrs) => {
            if (!attrs.includes(':key') && !attrs.includes('key')) {
              result.modified = true;
              return `<${vElseIfTag}${attrs} :key="${keyValue}" v-else-if`;
            }
            return _match;
          }
        );
      }
    }
  }

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

  // Transform keyboard modifiers: keycodes removed in Vue 3, use key names
  // Old: v-on:keyup.112="handler" or @keyup.112="handler"
  // New: v-on:keyup.f1="handler" or @keyup.f1="handler"
  const KEYCODE_TO_KEY: Record<string, string> = {
    '8': 'backspace',
    '9': 'tab',
    '13': 'enter',
    '27': 'esc',
    '32': 'space',
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

  // Transform functional components
  // Old: <template functional>
  // New: Remove functional and convert to regular component structure
  if (transformed.includes('functional')) {
    // Remove functional attribute
    transformed = transformed.replace(/<template\s+functional([^>]*)>/gi, '<template$1>');
    transformed = transformed.replace(/<(\w+)([^>]*)\s+functional([^>]*)>/gi, '<$1$2$3>');

    // Note: Full conversion to regular component requires script changes (handled by composition-api transform)
    result.modified = true;
    result.issues.push('Functional components converted - verify component structure');
  }

  result.template = transformed;
  return result;
}
