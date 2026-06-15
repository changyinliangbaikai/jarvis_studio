export function renderPrompt(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
}

export function extractVariables(content: string): string[] {
  return [...content.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index);
}
