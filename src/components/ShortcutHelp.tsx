import { Fragment } from 'react'
import { useI18n, type TFn } from '../lib/i18n'
import { GO_KEYS } from '../lib/shortcuts'
import { Modal } from './Modal'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function Keys({ combo, t }: { combo: string[][]; t: TFn }) {
  // combo: alternatives, each a sequence of keys
  return (
    <span className="kbd-combo">
      {combo.map((seq, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="kbd-sep">{t('keys.or')}</span>}
          {seq.map((k, j) => (
            <Fragment key={j}>
              {j > 0 && <span className="kbd-sep">{t('keys.then')}</span>}
              <kbd>{k}</kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  )
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const general: { label: string; combo: string[][] }[] = [
    { label: t('keys.search'), combo: [['/'], [isMac ? '⌘ K' : 'Ctrl K']] },
    { label: t('keys.newTask'), combo: [['N']] },
    { label: t('keys.theme'), combo: [['T']] },
    { label: t('keys.help'), combo: [['?']] },
    { label: t('keys.close'), combo: [['Esc']] },
  ]
  return (
    <Modal title={t('keys.title')} onClose={onClose}>
      <p className="muted small">{t('keys.hint')}</p>
      <div className="keys-grid">
        <section aria-labelledby="keys-general">
          <h3 id="keys-general">{t('keys.general')}</h3>
          <dl className="keys-list">
            {general.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  <Keys combo={row.combo} t={t} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="keys-go">
          <h3 id="keys-go">{t('keys.goTo')}</h3>
          <p className="muted small">{t('keys.goHint')}</p>
          <dl className="keys-list">
            {GO_KEYS.map((g) => (
              <div key={g.key}>
                <dt>{t(g.nav as Parameters<TFn>[0])}</dt>
                <dd>
                  <Keys combo={[['G', g.key.toUpperCase()]]} t={t} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Modal>
  )
}
