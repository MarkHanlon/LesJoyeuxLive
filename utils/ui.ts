export const AVATAR_PALETTE = ['#C85A2E', '#2D5A3D', '#C8973D', '#7B3F6E', '#3A6B8A', '#8B4513'];

export function avatarColor(name: string): string {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

export function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
