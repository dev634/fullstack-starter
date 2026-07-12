/** Fills `{name}` placeholders in a dictionary string, e.g. format(t.common.pageOf, { page: 2, total: 5 }). */
export function format(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}
