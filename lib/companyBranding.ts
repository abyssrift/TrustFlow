export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() : 'CO';
}
