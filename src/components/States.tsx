import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n()
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ?? t('common.loading')}
    </div>
  )
}

export function ErrorState({ message, detail, onRetry }: { message: string; detail?: string; onRetry?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="state state-error" role="alert">
      <p className="state-title">{message}</p>
      {detail && <p className="state-detail">{detail}</p>}
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <p>{children}</p>
      {action}
    </div>
  )
}
