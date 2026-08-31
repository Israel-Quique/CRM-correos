// @ts-nocheck

export const renderLogsView = (ctx: any) => {
  const {
    state,
    menuGroups,
    escapeHtml,
    getBrandIcon,
    getMenuGroupIcon,
    getRobotIcon,
    formatBoliviaTestPhone,
    getFilteredContacts,
    getContactPreviewLine,
    getContactLastMessagePreview,
    getContactConnectionLabel,
    getContactConnectionClass,
    formatConversationTimestamp,
    getStatusClass,
    getFilteredEmsContacts,
    getEmsStatusContacts,
    getEmsStatusKey,
    getEmsStatusLabel,
    getEmsStatusToneClass,
    getEmsPhaseLabel,
    getEmsPhaseDescription,
    getChatContacts,
    isAutoCreatedChatContact,
    getConversationMessagesChronological,
    renderConversationMessageMedia,
    getConversationMediaUrl,
    getAttachmentKindLabel,
    isAiAssistedConversation,
    getWhatsAppReference,
    hasWhatsAppChannel,
    isContactConnected,
    getTrackingApiPagination,
    renderTrackingApiRows,
    renderTrackingApiPagination,
    getContactPackagesPagination,
    renderContactPackagesRows,
    renderContactPackagesPagination,
    getTrackingPipelineColumns,
    getTrackingPipelineStage,
    renderCountryWithFlag,
    getTrackingOriginPhoneValue,
    getTrackingDestinationPhoneValue,
    getContactPackageRemitenteName,
    getContactPackageDestinatarioName,
    getContactPackageRemitentePhone,
    getContactPackageDestinatarioPhone,
    getProntsColumnConfig,
    getProntsColumnContacts,
    getProntsSelectedContact,
    getProntsTokenChips,
    buildProntsSimulationResponse,
    findPhoneCountry,
    getFlagIconClass,
    defaultWhatsAppCountry,
    contactChannelOptions,
    phoneCountryOptions,
    truncateText,
    getPhoneCountryLabel,
    getCountryLabel,
    getCountryIso2,
    getCountryIso2FromLabel,
    getGroupPickerResultsMarkup
  } = ctx
  const report = state.logsReport
  const totals = report?.totals ?? { total: 0, info: 0, warn: 0, error: 0 }

  return `
    <section class="section-panel logs-panel ${state.activeView === 'logs' ? 'is-visible' : ''}">
      <div class="section-head">
        <div>
          <p class="section-kicker">Sistema</p>
          <h2>Reporte de logs</h2>
          <p class="section-description">Actividad técnica, errores y rendimiento de la plataforma.</p>
        </div>
        <div class="section-actions logs-filters">
          <select id="logs-hours-filter" aria-label="Periodo del reporte">
            ${[1, 24, 72, 168, 720].map((hours) => `<option value="${hours}" ${state.logsHours === hours ? 'selected' : ''}>Ultimas ${hours === 1 ? '1 hora' : `${hours} horas`}</option>`).join('')}
          </select>
          <select id="logs-level-filter" aria-label="Nivel del log">
            <option value="" ${state.logsLevel === '' ? 'selected' : ''}>Todos los niveles</option>
            <option value="info" ${state.logsLevel === 'info' ? 'selected' : ''}>Informacion</option>
            <option value="warn" ${state.logsLevel === 'warn' ? 'selected' : ''}>Advertencias</option>
            <option value="error" ${state.logsLevel === 'error' ? 'selected' : ''}>Errores</option>
          </select>
          <button class="primary-btn" id="refresh-logs-report" type="button">Actualizar reporte</button>
        </div>
      </div>

      ${state.logsState === 'loading' ? '<div class="notice-banner">Cargando actividad del sistema...</div>' : ''}
      ${state.logsError ? `<div class="notice-banner error-state">${escapeHtml(state.logsError)}</div>` : ''}

      <div class="summary-grid logs-summary-grid">
        <article class="summary-card"><span>Total de eventos</span><strong>${totals.total}</strong><small>Ultimas ${report?.period.hours ?? state.logsHours} horas</small></article>
        <article class="summary-card logs-info-card"><span>Informacion</span><strong>${totals.info}</strong><small>Solicitudes exitosas</small></article>
        <article class="summary-card logs-warn-card"><span>Advertencias</span><strong>${totals.warn}</strong><small>Respuestas 4xx</small></article>
        <article class="summary-card logs-error-card"><span>Errores</span><strong>${totals.error}</strong><small>Respuestas 5xx</small></article>
      </div>

      <article class="table-card logs-test-numbers-card">
        <div class="logs-test-numbers-header">
          <div>
            <p class="section-kicker">Acceso controlado</p>
            <strong>Numeros de prueba WhatsApp</strong>
            <span>Administra los numeros autorizados para validar conversaciones sin afectar a clientes reales.</span>
          </div>
          <span class="logs-test-numbers-count">${state.whatsappTestModeNumbers.length} autorizado${state.whatsappTestModeNumbers.length === 1 ? '' : 's'}</span>
        </div>
        <form id="whatsapp-test-numbers-form" class="logs-test-number-form">
          <label class="logs-test-number-field">
            <span>${state.whatsappEditingTestNumber ? 'Editar numero autorizado' : 'Agregar numero autorizado'}</span>
            <div class="logs-test-number-input-wrap">
              <span class="logs-test-number-flag ${getFlagIconClass(state.whatsappTestNumberCountry)}" aria-hidden="true"></span>
              <select id="whatsapp-test-number-country" aria-label="Selecciona el pais del numero">
                ${phoneCountryOptions
                  .map(
                    (country) =>
                      `<option value="${country.iso2}" ${state.whatsappTestNumberCountry === country.iso2 ? 'selected' : ''}>${escapeHtml(getPhoneCountryLabel(country))}</option>`,
                  )
                  .join('')}
              </select>
              <span class="logs-test-number-dial">+${escapeHtml(phoneCountryOptions.find((country) => country.iso2 === state.whatsappTestNumberCountry)?.dialCode ?? defaultWhatsAppCountry.dialCode)}</span>
              <input
                type="text"
                name="testNumber"
                inputmode="tel"
                placeholder="59171234567"
                value="${escapeHtml(state.whatsappTestNumberDraft)}"
              />
            </div>
          </label>
          <div class="logs-test-number-actions">
            <button class="primary-btn" type="submit" ${state.whatsappTestNumbersState === 'submitting' ? 'disabled' : ''}>
              ${state.whatsappEditingTestNumber ? 'Guardar cambio' : 'Agregar numero'}
            </button>
            ${state.whatsappEditingTestNumber ? `<button class="secondary-btn" id="cancel-whatsapp-test-number-edit" type="button">Cancelar</button>` : ''}
          </div>
          ${state.whatsappTestNumbersError ? `<div class="error-state">${escapeHtml(state.whatsappTestNumbersError)}</div>` : ''}
        </form>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Numero</th>
                <th>Rol</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${
                state.whatsappTestModeNumbers.length > 0
                  ? state.whatsappTestModeNumbers
                      .map(
                        (number, index) => `
                          <tr>
                            <td><strong>${escapeHtml(formatBoliviaTestPhone(number))}</strong></td>
                            <td><span class="logs-test-number-role ${index === 0 ? 'is-primary' : ''}">${index === 0 ? 'Principal' : 'Autorizado'}</span></td>
                            <td>
                              <div class="table-action-group">
                                <button class="secondary-btn table-action-btn" data-edit-test-number="${escapeHtml(number)}" type="button">Editar</button>
                                <button class="secondary-btn table-action-btn" data-delete-test-number="${escapeHtml(number)}" type="button" ${state.whatsappTestModeNumbers.length === 1 ? 'disabled' : ''}>Eliminar</button>
                              </div>
                            </td>
                          </tr>
                        `,
                      )
                      .join('')
                  : '<tr><td colspan="3" class="empty-state">Aun no hay numeros de prueba configurados.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </article>

      <div class="logs-report-grid">
        <article class="table-card logs-endpoints-card">
          <div class="table-toolbar"><strong>Actividad por endpoint</strong><span>Rutas con mayor volumen de solicitudes</span></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Ruta</th><th>Eventos</th><th>Promedio</th><th>Errores</th></tr></thead>
              <tbody>
                ${(report?.byEndpoint ?? []).map((item) => `<tr><td><code>${escapeHtml(item.path)}</code></td><td>${item.count}</td><td>${item.average_duration_ms ?? 0} ms</td><td class="${item.errors ? 'logs-cell-error' : ''}">${item.errors}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">No hay actividad para este periodo.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>

        <article class="table-card logs-recent-card">
          <div class="table-toolbar"><strong>Eventos recientes</strong><span>Ultimos registros generados por el sistema</span></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Hora</th><th>Nivel</th><th>Evento</th><th>Resultado</th><th>Duracion</th></tr></thead>
              <tbody>
                ${(report?.recent ?? []).map((item) => `<tr><td>${escapeHtml(formatConversationTimestamp(item.created_at))}</td><td><span class="logs-level-chip ${escapeHtml(item.level)}">${escapeHtml(item.level)}</span></td><td><strong>${escapeHtml(item.event)}</strong><small class="logs-path">${escapeHtml(item.method ?? '')} ${escapeHtml(item.path ?? '')}</small></td><td>${item.status_code ?? '-'}</td><td>${item.duration_ms ?? 0} ms</td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">No hay eventos recientes.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  `
}




