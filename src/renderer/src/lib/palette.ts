export const categoricalPaletteLight = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948'
]

export const categoricalPaletteDark = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767'
]

export const statusGood = '#0ca30c'
export const statusWarning = '#fab219'
export const statusCritical = '#d03b3b'

/** Assigns a stable color to an entity (e.g. category id) so it doesn't repaint when sibling entities come and go. */
export function colorForKey(key: string | number, palette: string[]): string {
  const str = String(key)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  }
  return palette[hash % palette.length]
}
