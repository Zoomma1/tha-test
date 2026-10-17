export function nameOf(raw: string): string {
  const parsed = JSON.parse(raw);
  return parsed.name;
}
