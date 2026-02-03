/**
 * TypeScript type inference and annotation helpers for Vuex → Pinia store transform.
 */

function inferTypeFromASTValue(valueAST: any): string {
  if (!valueAST) return "any";
  if (
    valueAST.type === "StringLiteral" ||
    (valueAST.type === "Literal" && typeof valueAST.value === "string")
  ) {
    return "string";
  }
  if (
    valueAST.type === "NumericLiteral" ||
    (valueAST.type === "Literal" && typeof valueAST.value === "number")
  ) {
    return "number";
  }
  if (
    valueAST.type === "BooleanLiteral" ||
    (valueAST.type === "Literal" && typeof valueAST.value === "boolean")
  ) {
    return "boolean";
  }
  if (valueAST.type === "ArrayExpression") return "any[]";
  if (valueAST.type === "ObjectExpression") {
    const props = extractObjectProperties(valueAST);
    if (props.length > 0) return `{\n    ${props.join("\n    ")}\n  }`;
    return "Record<string, any>";
  }
  if (
    valueAST.type === "NullLiteral" ||
    (valueAST.type === "Literal" && valueAST.value === null)
  ) {
    return "null";
  }
  if (valueAST.type === "Identifier") return "any";
  return "any";
}

function inferTypeFromASTExpression(expressionAST: any): string {
  if (!expressionAST) return "any";
  if (expressionAST.type === "BinaryExpression") {
    const operator = expressionAST.operator;
    if (["+", "-", "*", "/", "%"].includes(operator)) return "number";
    if (["==", "===", "!=", "!==", "<", ">", "<=", ">="].includes(operator)) return "boolean";
    if (operator === "+") {
      const leftType = inferTypeFromASTExpression(expressionAST.left);
      const rightType = inferTypeFromASTExpression(expressionAST.right);
      if (leftType === "string" || rightType === "string") return "string";
      return "number";
    }
  }
  if (expressionAST.type === "UnaryExpression") {
    if (expressionAST.operator === "!") return "boolean";
    if (["-", "+"].includes(expressionAST.operator)) return "number";
  }
  if (expressionAST.type === "MemberExpression") {
    const property = expressionAST.property;
    if (property && property.name === "length") return "number";
    if (property) {
      const propName = property.name || property.value;
      if (propName && typeof propName === "string") {
        const lowerName = propName.toLowerCase();
        if (
          ["count", "id", "index", "number", "size", "age", "price", "amount", "quantity"].some(
            (k) => lowerName.includes(k)
          )
        ) {
          return "number";
        }
      }
      if (["name", "email", "title", "description", "message"].includes(propName)) return "string";
      if (["age", "count", "id", "price", "index"].includes(propName)) return "number";
      if (["isActive", "enabled", "visible", "isAuthenticated"].includes(propName)) return "boolean";
    }
    return "any";
  }
  if (expressionAST.type === "CallExpression") {
    const callee = expressionAST.callee;
    if (callee?.type === "MemberExpression") {
      const object = callee.object;
      const property = callee.property;
      if (object?.name === "Math" && property) return "number";
      if (property && ["map", "filter"].includes(property.name)) return "any[]";
      if (property?.name === "toString") return "string";
    }
    return "any";
  }
  if (expressionAST.type === "ConditionalExpression") {
    const consequentType = inferTypeFromASTExpression(expressionAST.consequent);
    const alternateType = inferTypeFromASTExpression(expressionAST.alternate);
    if (consequentType !== "any") return consequentType;
    if (alternateType !== "any") return alternateType;
    return "any";
  }
  return inferTypeFromASTValue(expressionAST);
}

function extractObjectProperties(objectAST: any): string[] {
  if (!objectAST || objectAST.type !== "ObjectExpression") return [];
  const properties: string[] = [];
  const props = objectAST.properties || [];
  props.forEach((prop: any) => {
    if (prop?.key) {
      const propName = prop.key.name || prop.key.value;
      if (propName) properties.push(`${propName}: ${inferTypeFromASTValue(prop.value)};`);
    }
  });
  return properties;
}

function pluralToSingularInterface(pluralName: string): string {
  const irregularPlurals: Record<string, string> = {
    children: "Child",
    people: "Person",
    men: "Man",
    women: "Woman",
    feet: "Foot",
    teeth: "Tooth",
    mice: "Mouse",
    geese: "Goose",
    data: "Datum",
  };
  const lowerName = pluralName.toLowerCase();
  if (irregularPlurals[lowerName]) return irregularPlurals[lowerName];
  if (/([a-z])([A-Z])/.test(pluralName)) {
    let result = pluralName.charAt(0).toUpperCase() + pluralName.slice(1);
    if (result.endsWith("s") && result.length > 1) {
      const secondLast = result[result.length - 2];
      if (secondLast && secondLast === secondLast.toLowerCase()) result = result.slice(0, -1);
    }
    return result;
  }
  if (lowerName.endsWith("ies") && lowerName.length > 3) {
    const base = lowerName.slice(0, -3);
    return base.charAt(0).toUpperCase() + base.slice(1) + "y";
  }
  if (lowerName.endsWith("es") && lowerName.length > 2) {
    const base = lowerName.slice(0, -2);
    if (base.length > 0) return base.charAt(0).toUpperCase() + base.slice(1);
  }
  if (lowerName.endsWith("s") && lowerName.length > 1) {
    const singular = lowerName.slice(0, -1);
    return singular.charAt(0).toUpperCase() + singular.slice(1);
  }
  return pluralName.charAt(0).toUpperCase() + pluralName.slice(1);
}

function inferParameterType(paramName: string): string {
  const lowerName = paramName.toLowerCase();
  if (["id", "index", "count"].some((k) => lowerName.includes(k))) return "number";
  if (["name", "text", "message", "title"].some((k) => lowerName.includes(k))) return "string";
  if (["is", "has", "should"].some((k) => lowerName.includes(k))) return "boolean";
  if (["list", "items", "array"].some((k) => lowerName.includes(k))) return "any[]";
  if (["obj", "data", "config"].some((k) => lowerName.includes(k))) return "Record<string, any>";
  if (lowerName.includes("event") || lowerName === "e") return "Event";
  return "any";
}

export function inferTypeFromValueString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return "string";
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return "number";
  if (trimmed === "true" || trimmed === "false") return "boolean";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return "any[]";
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return "object";
  if (trimmed === "null" || trimmed === "undefined") return "null";
  return "any";
}

export function inferTypeFromAST(astNode: any): string {
  if (!astNode) return "any";
  if (astNode.type === "BinaryExpression" || astNode.type === "UnaryExpression") {
    return inferTypeFromASTExpression(astNode);
  }
  if (astNode.type === "MemberExpression") {
    if (astNode.property?.name === "length") return "number";
    return inferTypeFromASTExpression(astNode);
  }
  const basicType = inferTypeFromASTValue(astNode);
  if (basicType !== "any" && basicType !== "any[]") return basicType;
  if (astNode.type === "ArrayExpression") {
    if (astNode.elements?.length > 0 && astNode.elements[0]?.type === "ObjectExpression") {
      return "any[]";
    }
    return "any[]";
  }
  if (astNode.type === "ObjectExpression") return "object";
  if (astNode.type === "NullLiteral" || (astNode.type === "Literal" && astNode.value === null)) {
    return "null";
  }
  return basicType;
}

export interface AddTypeScriptTypesContext {
  refProperties: string[];
  computedProperties: string[];
  functionNames: string[];
  statePropertyTypes?: Record<string, string>;
  computedReturnTypes?: Record<string, string>;
  objectPropertyDetails?: Record<string, any>;
}

export function addTypeScriptTypesToStore(code: string, context: AddTypeScriptTypesContext): string {
  let result = code;
  if (
    context.refProperties.length === 0 &&
    context.computedProperties.length === 0 &&
    context.functionNames.length === 0
  ) {
    return result;
  }

  const arrayInterfaces = new Map<string, string>();
  const objectInterfaces = new Map<string, { name: string; properties: string[] }>();

  if (context.statePropertyTypes && Object.keys(context.statePropertyTypes).length > 0) {
    const interfaceProps: string[] = [];
    Object.entries(context.statePropertyTypes).forEach(([propName, propType]) => {
      if (propType === "any[]") {
        const interfaceName = pluralToSingularInterface(propName);
        arrayInterfaces.set(interfaceName, propName);
        interfaceProps.push(`  ${propName}: ${interfaceName}[];`);
      } else if (propType === "object") {
        const interfaceName = propName.charAt(0).toUpperCase() + propName.slice(1);
        let objectProperties: string[] = [];
        if (context.objectPropertyDetails?.[propName]) {
          objectProperties = extractObjectProperties(context.objectPropertyDetails[propName]);
        }
        objectInterfaces.set(interfaceName, { name: interfaceName, properties: objectProperties });
        interfaceProps.push(`  ${propName}: ${interfaceName};`);
      } else {
        interfaceProps.push(`  ${propName}: ${propType};`);
      }
    });
    const arrayInterfaceCodes: string[] = [];
    arrayInterfaces.forEach((_, interfaceName) => {
      arrayInterfaceCodes.push(`interface ${interfaceName} {}`);
    });
    const objectInterfaceCodes: string[] = [];
    objectInterfaces.forEach(({ name, properties }) => {
      if (properties.length > 0) {
        objectInterfaceCodes.push(`interface ${name} {\n${properties.map((p) => `  ${p}`).join("\n")}\n}`);
      } else {
        objectInterfaceCodes.push(`interface ${name} {}`);
      }
    });
    const allInterfaces: string[] = [];
    if (interfaceProps.length > 0) {
      allInterfaces.push(`interface StoreState {\n${interfaceProps.join("\n")}\n}`);
    }
    allInterfaces.push(...arrayInterfaceCodes, ...objectInterfaceCodes);
    if (allInterfaces.length > 0) {
      const interfaceCode = allInterfaces.join("\n\n");
      const importRegex = /^import\s+.*$/gm;
      const imports = result.match(importRegex);
      if (imports && imports.length > 0) {
        const lastImport = imports[imports.length - 1]!;
        const lastImportIndex = result.lastIndexOf(lastImport);
        const afterLastImport = lastImportIndex + lastImport.length;
        result =
          result.slice(0, afterLastImport) + "\n\n" + interfaceCode + "\n" + result.slice(afterLastImport);
      } else {
        result = interfaceCode + "\n\n" + result;
      }
    }
  }

  context.refProperties.forEach((prop) => {
    const escapedProp = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const refPattern = new RegExp(
      `(const\\s+${escapedProp}\\s*=\\s*ref)(\\()([^)]+)(\\))`,
      "g"
    );
    result = result.replace(refPattern, (_match: string, before: string, openParen: string, value: string, closeParen: string) => {
      let type = inferTypeFromValueString(value.trim());
      if (context.statePropertyTypes) {
        const propType = context.statePropertyTypes[prop];
        if (propType === "any[]") type = `${pluralToSingularInterface(prop)}[]`;
        else if (propType === "object") type = prop.charAt(0).toUpperCase() + prop.slice(1);
        else if (propType === "null" || propType?.includes("| null")) {
          type = prop.endsWith("s") || /List|Items|Array$/i.test(prop)
            ? `${pluralToSingularInterface(prop)}[] | null`
            : `${prop.charAt(0).toUpperCase() + prop.slice(1)} | null`;
        }
      }
      if (value.trim() === "null" || value.trim() === "undefined") {
        if (!context.statePropertyTypes?.[prop]) {
          if (prop.endsWith("s") || /List|Items|Array$/i.test(prop)) {
            type = `${pluralToSingularInterface(prop)}[] | null`;
          } else if (prop !== "loading" && prop !== "isLoading") {
            type = `${prop.charAt(0).toUpperCase() + prop.slice(1)} | null`;
          } else {
            type = "boolean";
          }
        }
      }
      return `${before}<${type}>${openParen}${value}${closeParen}`;
    });
  });

  context.computedProperties.forEach((prop) => {
    const escapedProp = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const computedPattern = new RegExp(
      `(const\\s+${escapedProp}\\s*=\\s*computed)(\\()([^)]+)(\\))`,
      "g"
    );
    result = result.replace(
      computedPattern,
      (_match: string, before: string, openParen: string, fn: string, closeParen: string) => {
        let returnType = context.computedReturnTypes?.[prop];
        if (!returnType || returnType === "any") {
          const fnBody = fn.toString();
          const refValuePattern = /\(\)\s*=>\s*(\w+)\.value/;
          const refMatch = fnBody.match(refValuePattern);
          if (refMatch && context.statePropertyTypes) {
            const refType = context.statePropertyTypes[refMatch[1]];
            if (refType) returnType = refType.replace(/\s*\|\s*null/g, "");
          }
          const directRefPattern = /\(\)\s*=>\s*(\w+)(?!\.)/;
          const directRefMatch = fnBody.match(directRefPattern);
          if (directRefMatch && (!returnType || returnType === "any") && context.statePropertyTypes) {
            const refType = context.statePropertyTypes[directRefMatch[1]];
            if (refType) returnType = refType.replace(/\s*\|\s*null/g, "");
          }
          if (fnBody.includes(".length")) returnType = "number";
          if (fnBody.includes("Array.from")) returnType = "string[]";
          if (!returnType || returnType === "any") returnType = "any";
        }
        return `${before}<${returnType}>${openParen}${fn}${closeParen}`;
      }
    );
  });

  context.functionNames.forEach((funcName) => {
    const escapedFuncName = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const functionPattern = new RegExp(
      `(function\\s+${escapedFuncName}\\s*\\(([^)]*)\\)\\s*\\{)`,
      "g"
    );
    let match;
    while ((match = functionPattern.exec(result)) !== null) {
      const fullMatch = match[0];
      const paramList = (match[2] || "").trim();
      let typedParams = paramList;
      if (paramList) {
        typedParams = paramList
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean)
          .map((paramName: string) => `${paramName}: ${inferParameterType(paramName)}`)
          .join(", ");
      }
      result = result.replace(fullMatch, `function ${funcName}(${typedParams}): void {`);
      break;
    }
    const arrowPattern = new RegExp(
      `(const\\s+${escapedFuncName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*\\{)`,
      "g"
    );
    result = result.replace(arrowPattern, (_match: string, paramList: string) => {
      let typedParams = paramList.trim();
      if (typedParams) {
        typedParams = typedParams
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean)
          .map((paramName: string) => `${paramName}: ${inferParameterType(paramName)}`)
          .join(", ");
      }
      return `const ${funcName} = (${typedParams}): void => {`;
    });
  });

  return result;
}
