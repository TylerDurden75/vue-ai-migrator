/**
 * Helpers for Vuex → Pinia transform: state reference and commit() rewriting.
 */

export function transformStateReferencesInExpression(
  j: any,
  expression: any,
  stateProperties: Map<string, { isObject: boolean; value: any }>
): any {
  if (!expression) return expression;

  const exprCode = j(expression).toSource();
  let transformedCode = exprCode;

  const sortedProps = Array.from(stateProperties.entries()).sort((a, b) => {
    if (a[1].isObject && !b[1].isObject) return -1;
    if (!a[1].isObject && b[1].isObject) return 1;
    return 0;
  });

  sortedProps.forEach(([propName, info]) => {
    const escapedName = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (info.isObject) {
      const nestedPattern = new RegExp(
        `state\\.${escapedName}(\\.([a-zA-Z_$][a-zA-Z0-9_$]*))+`,
        "g"
      );
      transformedCode = transformedCode.replace(
        nestedPattern,
        (match: string) => match.replace(/^state\./, "")
      );
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        propName
      );
    } else {
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}\\.`, "g"),
        `${propName}.value.`
      );
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        `${propName}.value`
      );
    }
  });

  try {
    const newRoot = j(transformedCode);
    const program = newRoot.find(j.Program).paths()[0];
    if (program && program.value.body && program.value.body.length > 0) {
      const firstStmt = program.value.body[0];
      if (firstStmt.type === "ExpressionStatement") {
        return firstStmt.expression;
      }
      if (firstStmt.type === "ReturnStatement" && firstStmt.argument) {
        return firstStmt.argument;
      }
    }
  } catch {
    return expression;
  }

  return expression;
}

export function transformStateReferencesInBody(
  j: any,
  body: any,
  stateProperties: Map<string, { isObject: boolean; value: any }>
): any {
  if (!body || body.type !== "BlockStatement") return body;

  const bodyCode = j(body).toSource();
  let transformedCode = bodyCode;

  const sortedProps = Array.from(stateProperties.entries()).sort((a, b) => {
    if (a[1].isObject && !b[1].isObject) return -1;
    if (!a[1].isObject && b[1].isObject) return 1;
    return 0;
  });

  sortedProps.forEach(([propName, info]) => {
    const escapedName = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (info.isObject) {
      const nestedPattern = new RegExp(
        `state\\.${escapedName}(\\.([a-zA-Z_$][a-zA-Z0-9_$]*))+`,
        "g"
      );
      transformedCode = transformedCode.replace(
        nestedPattern,
        (match: string) => match.replace(/^state\./, "")
      );
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        propName
      );
    } else {
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}\\.`, "g"),
        `${propName}.value.`
      );
      transformedCode = transformedCode.replace(
        new RegExp(`state\\.${escapedName}(?!\\.)`, "g"),
        `${propName}.value`
      );
    }
  });

  try {
    const newRoot = j(transformedCode);
    const program = newRoot.find(j.Program).paths()[0];
    if (program && program.value.body && program.value.body.length > 0) {
      const statements = program.value.body;
      const cleanedStatements: any[] = [];
      statements.forEach((stmt: any) => {
        if (stmt.type === "BlockStatement" && stmt.body) {
          stmt.body.forEach((innerStmt: any) => cleanedStatements.push(innerStmt));
        } else if (stmt.type !== "EmptyStatement") {
          cleanedStatements.push(stmt);
        }
      });
      return j.blockStatement(
        cleanedStatements.length > 0 ? cleanedStatements : body.body
      );
    }
  } catch {
    return body;
  }

  return body;
}

export function transformCommitCalls(
  j: any,
  body: any,
  functionNames: Set<string>
): any {
  if (!body || body.type !== "BlockStatement") return body;

  const bodyCode = j(body).toSource();
  let transformedCode = bodyCode;

  functionNames.forEach((funcName) => {
    const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const commitWithPayload = new RegExp(
      `commit\\s*\\(\\s*['"]${escapedName}['"]\\s*,\\s*([^)]+)\\)`,
      "g"
    );
    transformedCode = transformedCode.replace(
      commitWithPayload,
      (_match: string, payload: string) => `${funcName}(${payload.trim()})`
    );
    const commitWithoutPayload = new RegExp(
      `commit\\s*\\(\\s*['"]${escapedName}['"]\\s*\\)`,
      "g"
    );
    transformedCode = transformedCode.replace(commitWithoutPayload, () => `${funcName}()`);
  });

  try {
    const newRoot = j(transformedCode);
    const program = newRoot.find(j.Program).paths()[0];
    if (program && program.value.body && program.value.body.length > 0) {
      const statements = program.value.body;
      const cleanedStatements: any[] = [];
      statements.forEach((stmt: any) => {
        if (stmt.type === "BlockStatement" && stmt.body) {
          stmt.body.forEach((innerStmt: any) => cleanedStatements.push(innerStmt));
        } else if (stmt.type !== "EmptyStatement") {
          cleanedStatements.push(stmt);
        }
      });
      return j.blockStatement(
        cleanedStatements.length > 0 ? cleanedStatements : body.body
      );
    }
  } catch {
    return body;
  }

  return body;
}
