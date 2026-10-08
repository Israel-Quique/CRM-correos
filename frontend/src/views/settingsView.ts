// @ts-nocheck

export const renderSettingsView = (ctx: any) => {
  const { state, escapeHtml } = ctx
  const config = state.automationConfig ?? {
    automaticWelcome: false,
    automaticStatusUpdates: false,
    automaticReconciliation: true,
    aiAutoReply: true,
    welcomeResponseIntervalMs: 5 * 60 * 1000,
    eventChangeResponseIntervalMs: 15 * 60 * 1000,
    reconciliationIntervalMs: 30 * 60 * 1000,
  }
  const isSaving = state.automationConfigState === 'saving'
  const getIntervalParts = (milliseconds: number) => {
    const safeMilliseconds = Number.isFinite(Number(milliseconds)) ? Math.max(Number(milliseconds), 60 * 1000) : 60 * 1000
    if (safeMilliseconds % (60 * 60 * 1000) === 0) {
      return { value: safeMilliseconds / (60 * 60 * 1000), unit: 'hours' }
    }

    return { value: Math.max(1, Math.round(safeMilliseconds / (60 * 1000))), unit: 'minutes' }
  }
  const welcomeInterval = getIntervalParts(config.welcomeResponseIntervalMs)
  const eventInterval = getIntervalParts(config.eventChangeResponseIntervalMs)
  const reconciliationInterval = getIntervalParts(config.reconciliationIntervalMs)
  const watcherStatus = state.automationWatcherStatus
  const watcherCheckedAt = watcherStatus?.checkedAt && Number.isFinite(Date.parse(watcherStatus.checkedAt))
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(watcherStatus.checkedAt))
    : ''
  const watcherSources = watcherStatus?.packageCountsBySource ?? {}
  const watcherSourceFailures = Array.isArray(watcherStatus?.packageSourceFailures)
    ? watcherStatus.packageSourceFailures
    : []
  const watcherSkippedReasons = [
    ...Object.entries(watcherStatus?.welcomeSkippedByReason ?? {}),
    ...Object.entries(watcherStatus?.eventSkippedByReason ?? {}),
  ]
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ')
  const watcherSummary = !watcherStatus
    ? 'Aún no hay una revisión automática registrada.'
    : watcherStatus.status === 'failed'
      ? 'La última revisión falló. Revisa el registro del backend para conocer la causa.'
      : watcherSourceFailures.length > 0
        ? `No se pudo consultar: ${watcherSourceFailures.join(', ')}.`
        : `Fuentes consultadas: Paquetes-Contactos ${watcherSources.contact ?? 0}, Tracking ${watcherSources.tracking ?? 0}.`
  const reconciliationStatus = state.automationReconciliationStatus
  const reconciliationCheckedAt =
    reconciliationStatus?.checkedAt && Number.isFinite(Date.parse(reconciliationStatus.checkedAt))
      ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(reconciliationStatus.checkedAt))
      : ''
  const reconciliationSourceFailures = Array.isArray(reconciliationStatus?.sourceFailures)
    ? reconciliationStatus.sourceFailures
    : []
  const reconciliationNotificationFailures = Array.isArray(reconciliationStatus?.notificationFailures)
    ? reconciliationStatus.notificationFailures
    : []
  const reconciliationSkippedReasons = [
    ...Object.entries(reconciliationStatus?.welcomeSkippedByReason ?? {}),
    ...Object.entries(reconciliationStatus?.eventSkippedByReason ?? {}),
  ]
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ')
  const reconciliationSummary = !reconciliationStatus
    ? 'Aún no hay una comprobación completa registrada.'
    : reconciliationStatus.status === 'failed'
      ? 'La carga completa o conciliación falló; se volverá a intentar en el próximo ciclo.'
      : reconciliationStatus.status === 'running'
        ? 'Carga pesada y conciliación en curso; el webhook y las respuestas siguen activos.'
      : reconciliationStatus.status === 'partial'
        ? `Revisión parcial${reconciliationSourceFailures.length > 0 ? `; fuente(s) no disponibles: ${reconciliationSourceFailures.join(', ')}` : ''}${reconciliationNotificationFailures.length > 0 ? `; fallos: ${reconciliationNotificationFailures.join(', ')}` : ''}.`
        : 'Carga completa y conciliación terminadas.'
  const inboundReplyStatus = state.latestInboundReplyStatus
  const inboundReceivedAt = inboundReplyStatus?.receivedAt && Number.isFinite(Date.parse(inboundReplyStatus.receivedAt))
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(inboundReplyStatus.receivedAt))
    : ''
  const inboundAttemptedAt = inboundReplyStatus?.attemptedAt && Number.isFinite(Date.parse(inboundReplyStatus.attemptedAt))
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(inboundReplyStatus.attemptedAt))
    : ''
  const inboundReplySummary = !inboundReplyStatus?.receivedAt
    ? 'Aún no se registra ningún mensaje entrante por el webhook.'
    : !inboundReplyStatus.event
      ? 'El último mensaje entró al CRM, pero no registra intento de respuesta.'
      : inboundReplyStatus.event === 'whatsapp_auto_reply_sent'
        ? 'Respuesta aceptada por Meta.'
        : inboundReplyStatus.event === 'whatsapp_auto_reply_started'
          ? 'Respuesta en proceso.'
          : inboundReplyStatus.event === 'whatsapp_auto_reply_skipped'
            ? `Respuesta omitida${inboundReplyStatus.reason ? `: ${inboundReplyStatus.reason}` : ''}.`
            : 'Falló la respuesta automática; revisa el registro del backend.'
  const renderStatus = (label: string, active: boolean, detail: string, action: string, disabled = false) => `
    <div class="settings-status-row">
      <span>
        <strong>${label}</strong>
        <small>${detail}</small>
      </span>
      <span class="settings-status-end">
        <b class="settings-status-badge ${active ? 'is-active' : 'is-inactive'}">${active ? 'Activo' : 'No activado'}</b>
        <button class="secondary-btn settings-status-action" type="button" data-settings-action="${action}" ${disabled ? 'disabled' : ''}>
          ${active ? 'Desactivar' : 'Activar'}
        </button>
      </span>
    </div>
  `

  const renderIntervalControl = (key: string, label: string, description: string, interval: { value: number; unit: string }, minimumMinutes = 1) => `
    <label class="settings-interval-row" aria-label="${escapeHtml(label)}">
      <span>
        <strong>${label}</strong>
        <small>${description}</small>
      </span>
      <span class="settings-interval-inputs">
        <input
          type="number"
          min="${minimumMinutes}"
          step="1"
          value="${escapeHtml(String(interval.value))}"
          data-automation-interval-value="${key}"
          ${isSaving ? 'disabled' : ''}
        />
        <select data-automation-interval-unit="${key}" ${isSaving ? 'disabled' : ''}>
          <option value="minutes" ${interval.unit === 'minutes' ? 'selected' : ''}>Minutos</option>
          <option value="hours" ${interval.unit === 'hours' ? 'selected' : ''}>Horas</option>
        </select>
      </span>
    </label>
  `

  const renderAutomationCard = ({
    key,
    label,
    description,
    badge,
    interval,
  }: {
    key: string
    label: string
    description: string
    badge: string
    interval?: string
  }) => `
    <article class="settings-automation-card ${config[key] ? 'is-enabled' : ''}">
      <div class="settings-automation-main">
        <span class="settings-automation-icon">${badge}</span>
        <div>
          <strong>${label}</strong>
          <small>${description}</small>
        </div>
      </div>
      <label class="settings-switch" aria-label="${escapeHtml(label)}">
        <input type="checkbox" data-automation-setting="${key}" ${config[key] ? 'checked' : ''} ${isSaving ? 'disabled' : ''} />
        <span></span>
      </label>
      ${
        interval
          ? `<div class="settings-automation-interval">${interval}</div>`
          : ''
      }
    </article>
  `

  return `
    <section class="section-panel is-visible settings-panel">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Sistema</p>
          <h1>Configuraciones</h1>
          <p class="section-subtitle">Controla los mensajes automáticos y las respuestas del agente.</p>
        </div>
      </div>
      ${state.automationConfigError ? `<div class="form-error">${escapeHtml(state.automationConfigError)}</div>` : ''}
      ${state.automationConfigNotice ? `<div class="form-notice">${escapeHtml(state.automationConfigNotice)}</div>` : ''}
      ${isSaving ? '<div class="settings-saving" role="status"><span class="settings-spinner" aria-hidden="true"></span>Guardando configuraciones, espera un momento...</div>' : ''}
      <div class="settings-card">
        <h3>Estado actual</h3>
        <p class="settings-help">Aquí puedes ver y controlar los modos que también aparecen en la barra superior.</p>
        <div class="settings-status-list">
          ${renderStatus('Modo de prueba WhatsApp', state.whatsappTestModeEnabled, `Solo permite pruebas al ${state.whatsappTestModeNumber || 'numero configurado'}.`, 'toggle-test-mode', state.whatsappTestModeState === 'submitting')}
          ${renderStatus('Agente IA', state.globalAiAgentEnabled, 'Responde automáticamente a todas las conversaciones.', 'toggle-ai-agent')}
        </div>
      </div>
      <div class="settings-card">
        <h3>WhatsApp y automatización</h3>
        <p class="settings-help">Configura aquí los tiempos que pediste: bienvenida rápida y revisión completa de eventos.</p>
        <div class="settings-automation-grid">
          ${renderAutomationCard({
            key: 'automaticWelcome',
            label: 'Bienvenida de paquetes nuevos',
            description: 'Busca paquetes nuevos automáticamente según el intervalo y envía la bienvenida al destinatario.',
            badge: '⚡',
            interval: renderIntervalControl('welcomeResponseIntervalMs', 'Tiempo de respuesta', 'Frecuencia para consultar la API y buscar paquetes nuevos; predeterminado cada 5 minutos.', welcomeInterval),
          })}
          ${renderAutomationCard({
            key: 'automaticStatusUpdates',
            label: 'Cambios de evento',
            description: 'Ejecuta el escaneo completo para cambios como tránsito, destino, cartero o entregado.',
            badge: '🔁',
            interval: renderIntervalControl('eventChangeResponseIntervalMs', 'Tiempo de revisión', 'Puede tardar más porque compara eventos.', eventInterval),
          })}
          ${renderAutomationCard({
            key: 'automaticReconciliation',
            label: 'Comprobador de envíos y estados',
            description: 'Hace una carga pesada, pausa revisiones automáticas simultáneas y concilia notificaciones pendientes. No detiene el webhook ni las respuestas entrantes.',
            badge: '✓',
            interval: renderIntervalControl('reconciliationIntervalMs', 'Frecuencia de comprobación', 'Predeterminado cada 30 minutos; mínimo 15 minutos.', reconciliationInterval, 15),
          })}
          ${renderAutomationCard({
            key: 'aiAutoReply',
            label: 'Respuestas del agente Jaimito',
            description: 'Responde automáticamente cuando el cliente escribe por WhatsApp.',
            badge: '🤖',
          })}
        </div>
        <div class="automation-watcher-status" aria-live="polite">
          <div>
            <strong>Comprobante de conciliación</strong>
            <small>${reconciliationCheckedAt ? `${escapeHtml(reconciliationCheckedAt)} · ` : ''}${escapeHtml(reconciliationSummary)}</small>
            ${
              reconciliationStatus && reconciliationStatus.status !== 'running'
                ? `<small>Paquetes cargados: ${reconciliationStatus.totalPackages}; mensajes enviados: ${reconciliationStatus.sentTotal} (bienvenidas ${reconciliationStatus.welcomeSent}, eventos ${reconciliationStatus.eventSent}); omitidos: ${reconciliationStatus.welcomeSkipped + reconciliationStatus.eventSkipped}${reconciliationSkippedReasons ? ` · Motivos: ${escapeHtml(reconciliationSkippedReasons)}` : ''}${reconciliationStatus.welcomeReason || reconciliationStatus.eventReason ? ` · Estado: ${escapeHtml([reconciliationStatus.welcomeReason, reconciliationStatus.eventReason].filter(Boolean).join('; '))}` : ''}.</small>`
                : ''
            }
          </div>
          <button class="secondary-btn" type="button" data-refresh-automation-status>Actualizar estado</button>
        </div>
        <div class="automation-watcher-status" aria-live="polite">
          <div>
            <strong>Última revisión automática</strong>
            <small>${watcherCheckedAt ? ` ${escapeHtml(watcherCheckedAt)} · ` : ''}${escapeHtml(watcherSummary)}</small>
            ${
              watcherStatus
                ? `<small>Paquetes revisados: ${watcherStatus.totalPackages}; bienvenidas: ${watcherStatus.welcomeSent} enviadas/${watcherStatus.welcomeSkipped} omitidas; eventos: ${watcherStatus.eventSent} enviados/${watcherStatus.eventSkipped} omitidos${watcherSkippedReasons ? ` · Motivos: ${escapeHtml(watcherSkippedReasons)}` : ''}${watcherStatus.eventReason ? ` · Estado: ${escapeHtml(watcherStatus.eventReason)}` : ''}.</small>`
                : ''
            }
          </div>
          <button class="secondary-btn" type="button" data-refresh-automation-status>Actualizar estado</button>
        </div>
        <div class="automation-watcher-status" aria-live="polite">
          <div>
            <strong>Último mensaje entrante</strong>
            <small>${inboundReceivedAt ? `${escapeHtml(inboundReceivedAt)} · ` : ''}${escapeHtml(inboundReplySummary)}</small>
            ${inboundAttemptedAt ? `<small>Intento de respuesta: ${escapeHtml(inboundAttemptedAt)}.</small>` : ''}
          </div>
        </div>
        <div class="settings-actions">
          <button class="primary-btn" type="button" data-save-automation-settings ${isSaving ? 'disabled' : ''}>
            ${isSaving ? '<span class="settings-spinner settings-spinner-dark" aria-hidden="true"></span>Guardando...' : 'Guardar configuraciones'}
          </button>
        </div>
      </div>
    </section>
  `
}
