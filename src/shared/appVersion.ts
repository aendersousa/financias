// Comparação de versões "MAJOR.MINOR.PATCH" para o aviso de atualização (decisão 15).

function parse(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) throw new Error(`Versão inválida: ${!pa ? a : b}`)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

// Uma regra de versão ilegível nunca bloqueia o app: na dúvida, deixa usar.
export function isOutdated(current: string, minimum: string | null | undefined): boolean {
  if (!minimum) return false
  try {
    return compareVersions(current, minimum) < 0
  } catch {
    return false
  }
}
