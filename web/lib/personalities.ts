import data from '../../personalities.json';

export type Personality = {
  id: string;
  name: string;
  category: string;
  prompt: string;
};

export const PERSONALITIES: Personality[] = data.personalities;

export function getPersonality(id: string): Personality | undefined {
  return PERSONALITIES.find((p) => p.id === id);
}

export function personalitiesByCategory(): Array<{ category: string; items: Personality[] }> {
  const categories: string[] = [];
  const grouped = new Map<string, Personality[]>();

  for (const p of PERSONALITIES) {
    if (!grouped.has(p.category)) {
      grouped.set(p.category, []);
      categories.push(p.category);
    }
    grouped.get(p.category)!.push(p);
  }

  return categories.map((category) => ({ category, items: grouped.get(category)! }));
}
