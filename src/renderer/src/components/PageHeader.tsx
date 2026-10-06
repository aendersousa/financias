import type { LucideIcon } from 'lucide-react'

interface PageHeaderProps {
  icon: LucideIcon
  title: string
  subtitle?: string
}

export default function PageHeader({ icon: Icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="page-header mb-6 flex items-center gap-3">
      <div className="page-header-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <Icon size={20} />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
    </div>
  )
}
