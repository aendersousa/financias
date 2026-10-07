import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_APP_PAGES,
  countEnabledModules,
  getFirstEnabledModule,
  isPageDisabled,
  isPageEnabled,
  persistDisabledPages,
  readDisabledPages,
  readEnabledModules,
  togglePageStatus
} from './modules'

afterEach(() => vi.unstubAllGlobals())

describe('All App Pages and Modules management', () => {
  it('includes all navigation pages including Orçamentos', () => {
    const budgetPage = ALL_APP_PAGES.find((p) => p.id === 'budgets')
    expect(budgetPage).toBeDefined()
    expect(budgetPage?.label).toBe('Orçamentos')
    expect(budgetPage?.group).toBe('Planejamento')
  })

  it('enables all pages by default', () => {
    const disabled = readDisabledPages()
    expect(disabled).toEqual([])
    expect(isPageEnabled('budgets', disabled)).toBe(true)
    expect(isPageEnabled('dashboard', disabled)).toBe(true)
  })

  it('can disable Orçamentos and persist across storage', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    })

    let disabled = readDisabledPages()
    expect(isPageEnabled('budgets', disabled)).toBe(true)

    // Toggle off budgets
    disabled = togglePageStatus('budgets', disabled)
    persistDisabledPages(disabled)
    expect(isPageEnabled('budgets', disabled)).toBe(false)
    expect(isPageDisabled('budgets', disabled)).toBe(true)

    // Restores from localStorage
    const restored = readDisabledPages()
    expect(restored).toContain('budgets')
    expect(isPageEnabled('budgets', restored)).toBe(false)
    expect(isPageEnabled('dashboard', restored)).toBe(true)

    // Re-enable
    const reenabled = togglePageStatus('budgets', restored)
    expect(isPageEnabled('budgets', reenabled)).toBe(true)
  })

  it('propagates between alias IDs like budgets and budget', () => {
    const disabled = ['budgets']
    expect(isPageDisabled('budgets', disabled)).toBe(true)
    expect(isPageDisabled('budget', disabled)).toBe(true)
  })

  it('always keeps settings accessible', () => {
    const disabled = ['settings', 'budgets']
    expect(isPageEnabled('settings', disabled)).toBe(true)
  })

  it('keeps classification pages together under Organização', () => {
    const orgPages = ALL_APP_PAGES.filter(p => p.group === 'Organização')
    expect(orgPages.map(page => page.id)).toEqual(['categories', 'tags'])
    expect(ALL_APP_PAGES.some(p => p.id === 'notifications')).toBe(false)
    expect(ALL_APP_PAGES.some(p => p.id === 'audit')).toBe(false)
  })
})
