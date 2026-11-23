/**
 * The context a `when` expression reads: `view` (the view a context menu is for), `activeView`
 * (the focused view), `inputFocus` (a text field has the focus), and whatever a host adds.
 */
export type WhenContext = Readonly<Record<string, string | boolean | undefined>>;

/**
 * Evaluate a `when` expression against `context`. The language is deliberately small: terms
 * joined by `&&` and `||` (`&&` binds tighter), each `key`, `!key`, `key == value` or
 * `key != value`, values bare or quoted (`'...'`, `"..."`). A missing key is false, and so is
 * an expression that cannot be read. No expression holds everywhere.
 */
export function evaluateWhen(expression: string | undefined, context: WhenContext = {}): boolean {
  if (expression === undefined || expression.trim() === "") return true;
  return expression
    .split("||")
    .some((alternative) =>
      alternative.split("&&").every((term) => evaluateTerm(term.trim(), context)),
    );
}

const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2");

function evaluateTerm(term: string, context: WhenContext): boolean {
  const comparison = /^([\w.-]+)\s*(==|!=)\s*(.+)$/.exec(term);
  if (comparison) {
    const [, key = "", operator, raw = ""] = comparison;
    const actual = context[key];
    const equal = actual !== undefined && String(actual) === unquote(raw.trim());
    return operator === "==" ? equal : !equal;
  }
  const flag = /^(!?)\s*([\w.-]+)$/.exec(term);
  if (!flag) return false;
  const value = context[flag[2] ?? ""];
  const truthy = value !== undefined && value !== false && value !== "";
  return flag[1] ? !truthy : truthy;
}
