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

// After-dinner hot drinks. `field` is the count property returned by the API
// (and stored per-day on the visit); `label` is what's shown to people/staff.
// Order here is the order shown on My Visit and in the Family tab summary.
export const HOT_DRINKS = [
  { key: 'coffee',     field: 'coffeeToday',     label: 'Coffee' },
  { key: 'decaf',      field: 'decafToday',      label: 'Decaf coffee' },
  { key: 'tea',        field: 'teaToday',        label: 'Tea' },
  { key: 'herbal',     field: 'herbalToday',     label: 'Herbal tea' },
  { key: 'peppermint', field: 'peppermintToday', label: 'Peppermint tea' },
] as const;

export type HotDrinkKey = typeof HOT_DRINKS[number]['key'];
export type HotDrinkField = typeof HOT_DRINKS[number]['field'];
