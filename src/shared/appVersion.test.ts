import { describe, expect, it } from 'vitest'
import { compareVersions, isOutdated } from './appVersion'

describe('compareVersions', () => {
  it('compara cada parte como número, não como texto', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })

  it('recusa versões fora do formato MAJOR.MINOR.PATCH', () => {
    expect(() => compareVersions('1.2', '1.2.0')).toThrow()
  })
})

describe('isOutdated', () => {
  it('bloqueia só quando a versão instalada é menor que a mínima', () => {
    expect(isOutdated('1.2.0', '2.0.0')).toBe(true)
    expect(isOutdated('2.0.0', '2.0.0')).toBe(false)
    expect(isOutdated('2.1.0', '2.0.0')).toBe(false)
  })

  it('não bloqueia sem regra ou com regra ilegível', () => {
    expect(isOutdated('1.2.0', null)).toBe(false)
    expect(isOutdated('1.2.0', '')).toBe(false)
    expect(isOutdated('1.2.0', 'dois')).toBe(false)
  })
})
