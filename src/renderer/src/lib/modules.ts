import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Bell,
  CalendarDays,
  CreditCard,
  History,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Repeat,
  Tags,
  Users,
  Wallet
} from 'lucide-react'

export interface AppNavPage {
  id: string
  label: string
  group: string
  icon: LucideIcon
  description: string
}

export const DISABLED_PAGES_STORAGE_KEY = 'financias:disabled_pages'

/**
 * Mapeamento de equivalências entre IDs do LedgerWorkspace e da Sidebar clássica.
 */
export const PAGE_ALIASES: Record<string, string[]> = {
  budgets: ['budget'],
  budget: ['budgets'],
  cards: ['creditCards'],
  creditCards: ['cards'],
  agenda: ['bills'],
  bills: ['agenda'],
  reserves: ['goals'],
  goals: ['reserves']
}

export const ALL_APP_PAGES: AppNavPage[] = [
  {
    id: 'dashboard',
    label: 'Visão geral',
    group: 'Principal',
    icon: LayoutDashboard,
    description: 'Painel principal com visão geral, saldos e gráficos consolidados.'
  },
  {
    id: 'transactions',
    label: 'Lançamentos',
    group: 'Movimentações',
    icon: ArrowLeftRight,
    description: 'Registro e extrato de receitas, despesas e transferências financeiras.'
  },
  {
    id: 'imports',
    label: 'Importar extrato',
    group: 'Movimentações',
    icon: ArrowLeftRight,
    description: 'Importação e conciliação de extratos bancários em arquivos OFX.'
  },
  {
    id: 'foreign_currency',
    label: 'Compras internacionais',
    group: 'Movimentações',
    icon: ArrowLeftRight,
    description: 'Compras no exterior em moeda estrangeira e conversão em reais.'
  },
  {
    id: 'agenda',
    label: 'Agenda',
    group: 'Planejamento',
    icon: CalendarDays,
    description: 'Contas a pagar e a receber com vencimentos e compromissos futuros.'
  },
  {
    id: 'recurrences',
    label: 'Recorrências',
    group: 'Planejamento',
    icon: Repeat,
    description: 'Despesas periódicas, assinaturas e receitas com repetição automática.'
  },
  {
    id: 'budgets',
    label: 'Orçamentos',
    group: 'Planejamento',
    icon: PiggyBank,
    description: 'Tetos mensais e limites planejados de gastos por categoria.'
  },
  {
    id: 'reserves',
    label: 'Metas e provisões',
    group: 'Planejamento',
    icon: Wallet,
    description: 'Objetivos financeiros, reservas de emergência e sonhos.'
  },
  {
    id: 'forecast',
    label: 'Previsão de saldo',
    group: 'Planejamento',
    icon: CalendarDays,
    description: 'Projeção do fluxo de caixa e saldo estimado para os próximos meses.'
  },
  {
    id: 'accounts',
    label: 'Contas',
    group: 'Contas e patrimônio',
    icon: Wallet,
    description: 'Contas bancárias, carteiras físicas, benefícios e investimentos.'
  },
  {
    id: 'cards',
    label: 'Cartões',
    group: 'Contas e patrimônio',
    icon: CreditCard,
    description: 'Cartões de crédito, limites, faturas e compras parceladas.'
  },
  {
    id: 'portfolio',
    label: 'Patrimônio',
    group: 'Contas e patrimônio',
    icon: Wallet,
    description: 'Acompanhamento do patrimônio líquido, bens e investimentos.'
  },
  {
    id: 'people',
    label: 'Pessoas',
    group: 'Pessoas e compartilhamento',
    icon: Users,
    description: 'Contatos, acertos de contas, valores a receber e a pagar com terceiros.'
  },
  {
    id: 'sharing',
    label: 'Compartilhamento',
    group: 'Pessoas e compartilhamento',
    icon: Users,
    description: 'Gestão de membros convidados e divisão de despesas do espaço.'
  },
  {
    id: 'reports',
    label: 'Relatórios',
    group: 'Análises',
    icon: History,
    description: 'Relatórios analíticos, gráficos e comparativos de evolução.'
  },
  {
    id: 'closing',
    label: 'Relatório mensal e fechamento',
    group: 'Análises',
    icon: History,
    description: 'Fechamento de meses e retratos consolidados dos períodos.'
  },
  {
    id: 'health',
    label: 'Saúde financeira',
    group: 'Análises',
    icon: Wallet,
    description: 'Indicadores de sustentabilidade financeira e taxa de poupança.'
  },
  {
    id: 'categories',
    label: 'Categorias',
    group: 'Organização',
    icon: Tags,
    description: 'Classificação organizada de receitas e despesas por categoria.'
  },
  {
    id: 'tags',
    label: 'Tags',
    group: 'Organização',
    icon: Tags,
    description: 'Etiquetas para classificar lançamentos por viagens ou projetos.'
  }
]
export function readDisabledPages(): string[] {
  try {
    const raw = localStorage.getItem(DISABLED_PAGES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id) => typeof id === 'string')
  } catch {
    return []
  }
}

export function persistDisabledPages(disabledList: string[]): void {
  try {
    localStorage.setItem(DISABLED_PAGES_STORAGE_KEY, JSON.stringify(disabledList))
  } catch {}
}

export function isPageDisabled(id: string, disabledList: string[]): boolean {
  if (disabledList.includes(id)) return true
  const aliases = PAGE_ALIASES[id]
  if (aliases && aliases.some((a) => disabledList.includes(a))) return true
  return false
}

export function isPageEnabled(id: string, disabledList: string[]): boolean {
  if (id === 'settings') return true // Configurações nunca pode ser desativada
  return !isPageDisabled(id, disabledList)
}

export function togglePageStatus(id: string, disabledList: string[]): string[] {
  const currentDisabled = isPageDisabled(id, disabledList)
  const related = [id, ...(PAGE_ALIASES[id] ?? [])]

  if (currentDisabled) {
    // Reativar: remove o ID e seus aliases da lista de desabilitados
    return disabledList.filter((item) => !related.includes(item))
  } else {
    // Desativar: adiciona à lista de desabilitados
    return Array.from(new Set([...disabledList, id]))
  }
}

// Helpers para compatibilidade com o store e Sidebar legado
export type ModuleKey = string
export type EnabledModules = Record<string, boolean>

export const MODULE_STORAGE_KEY = DISABLED_PAGES_STORAGE_KEY
export const MODULE_DEFINITIONS = ALL_APP_PAGES.map((p) => ({
  key: p.id,
  name: p.label.replace(/^\d\.\s*/, ''),
  description: p.description,
  icon: p.icon
}))

export const DEFAULT_ENABLED_MODULES: EnabledModules = Object.fromEntries(
  ALL_APP_PAGES.map((p) => [p.id, true])
)

export function readEnabledModules(): EnabledModules {
  const disabled = readDisabledPages()
  const result: EnabledModules = {}
  for (const page of ALL_APP_PAGES) {
    result[page.id] = !isPageDisabled(page.id, disabled)
  }
  // Mapeia também aliases clássicos
  result.budget = result.budgets ?? true
  result.creditCards = result.cards ?? true
  result.bills = result.agenda ?? true
  result.goals = result.reserves ?? true
  return result
}

export function countEnabledModules(modules: EnabledModules): number {
  return ALL_APP_PAGES.filter((p) => modules[p.id] !== false).length
}

export function canToggleModule(modules: EnabledModules, key: string): boolean {
  if (modules[key] === false) return true // Pode reativar livremente
  // Se estiver ativo, verifica se resta mais de 1
  return countEnabledModules(modules) > 1
}

export function getFirstEnabledModule(modules: EnabledModules, fallback: string = 'dashboard'): string {
  for (const p of ALL_APP_PAGES) {
    if (modules[p.id] !== false) return p.id
  }
  return fallback
}
