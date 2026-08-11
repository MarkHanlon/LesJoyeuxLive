export const DRINK_ICONS: Record<string, string> = {
  pastis: '🌿', kir: '💜', kir_royale: '🥂', cremant: '🍾',
  lillet: '🍸', suze: '🌼', red_wine: '🍷', white_wine: '🫗',
  rose: '🌸', gt: '🧊', beer: '🍺', sparkling: '💧',
  oj: '🍊', mango: '🥭', lemonade: '🍋', cola: '🥤', coke_zero: '🥤',
  rum_coke: '🥃', rum_coke_zero: '🥃', vodka_coke: '🍹', vodka_coke_zero: '🍹',
  gin_orange: '🍊', cuba_libre: '🌴', cuba_libre_zero: '🌴', skinny_bitch: '💅',
};

export const DRINK_LABELS: Record<string, string> = {
  pastis: 'Pastis', kir: 'Kir', kir_royale: 'Kir Royale', cremant: 'Crémant',
  lillet: 'Lillet', suze: 'Suze', red_wine: 'Red Wine', white_wine: 'White Wine',
  rose: 'Rosé', gt: 'G&T', beer: 'Beer', sparkling: 'Sparkling Water',
  oj: 'Orange Juice', mango: 'Mango Juice', lemonade: 'Lemonade', cola: 'Cola', coke_zero: 'Coke Zero',
  rum_coke: 'Rum & Coke', rum_coke_zero: 'Rum & Coke Zero',
  vodka_coke: 'Vodka & Coke', vodka_coke_zero: 'Vodka & Coke Zero',
  gin_orange: 'Gin & Orange', cuba_libre: 'Cuba Libre', cuba_libre_zero: 'Cuba Libre (Coke Zero)',
  skinny_bitch: 'Skinny Bitch',
};

// After-lunch / after-dinner hot drinks. Each person picks ONE per sitting (or
// none). `key` is stored on the visit (lunch_drink / dinner_drink); `label` is
// shown to people and staff. Order here is the order shown everywhere.
export const HOT_DRINKS = [
  { key: 'coffee',     label: 'Coffee' },
  { key: 'decaf',      label: 'Decaf coffee' },
  { key: 'tea',        label: 'Tea' },
  { key: 'herbal',     label: 'Herbal tea' },
  { key: 'peppermint', label: 'Peppermint tea' },
] as const;

export type HotDrinkKey = typeof HOT_DRINKS[number]['key'];

export const HOT_DRINK_KEYS: string[] = HOT_DRINKS.map(d => d.key);
export const HOT_DRINK_LABEL: Record<string, string> =
  Object.fromEntries(HOT_DRINKS.map(d => [d.key, d.label]));
