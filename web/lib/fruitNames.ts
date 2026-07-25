// Auto-assigned shard labels when an admin doesn't type one in -- easier to
// tell shards apart at a glance than "shard-3", and there's no operational
// meaning to a shard's name anyway (it's not derived from region/capacity).
const FRUITS = [
  'apple', 'apricot', 'avocado', 'banana', 'blackberry', 'blueberry',
  'cantaloupe', 'cherry', 'coconut', 'cranberry', 'date', 'dragonfruit',
  'elderberry', 'fig', 'grape', 'guava', 'honeydew', 'jackfruit', 'kiwi',
  'kumquat', 'lemon', 'lime', 'lychee', 'mango', 'mulberry', 'nectarine',
  'olive', 'orange', 'papaya', 'peach', 'pear', 'persimmon', 'plum',
  'pomegranate', 'quince', 'raspberry', 'starfruit', 'strawberry',
  'tangerine', 'watermelon',
];

export function nextFruitName(usedLabels: string[]): string {
  const used = new Set(usedLabels.map((l) => l.toLowerCase()));
  const available = FRUITS.find((fruit) => !used.has(fruit));
  return available || `fruit-${usedLabels.length + 1}`;
}
