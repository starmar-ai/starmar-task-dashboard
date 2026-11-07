import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'sm'
}

/** Native <dialog>: focus trap, Escape to close, and inert background come from the browser. */
export function Modal({ title, onClose, children, footer, size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const { t } = useI18n()

  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
    return () => el?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="modal-inner">
        <header className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  )
}

export function ConfirmDialog({
  title,
  tone = 'danger',
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title?: string
  tone?: 'danger' | 'primary'
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const { t } = useI18n()
  return (
    <Modal
      title={title ?? confirmLabel}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className={`btn ${tone === 'primary' ? 'btn-primary' : 'btn-danger'}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  )
}
