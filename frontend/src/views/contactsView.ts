// @ts-nocheck

export const renderContactsView = (ctx: any) => {
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
    getContactReminderState,
    getContactsPagination,
    getFilteredEmsContacts,
    getEmsColumnContacts,
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
    areAllFilteredContactsSelected,
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
    getSegmentOptions,
    getContactUpdatedTime,
    getPhoneCountryLabel,
    getCountryLabel,
    getCountryIso2,
    getCountryIso2FromLabel,
    getGroupPickerResultsMarkup
  } = ctx
  const filtered = getFilteredContacts()
  const contactsPagination = getContactsPagination()
  const segmentOptions = getSegmentOptions()
  const averageScore =
    filtered.length > 0
      ? Math.round(filtered.reduce((total, contact) => total + contact.score, 0) / filtered.length)
      : 0
  const socialLeads = filtered.filter((contact) => contact.channel !== 'Email').length
  const hotLeads = filtered.filter((contact) => contact.score >= 85).length

  return `
    <section class="section-panel contacts-panel ${state.activeView === 'contactos' ? 'is-visible' : ''}">
      <div class="section-head">
        <div>
          <p class="section-kicker">Contactos</p>
          <h2>Clientes y contactos omnicanal</h2>
        </div>
        <div class="section-actions">
          <select id="segment-filter" aria-label="Filtrar por segmento">
            <option value="Todos" ${state.segmentFilter === 'Todos' ? 'selected' : ''}>Todos los segmentos</option>
            ${segmentOptions
              .map(
                (segment) => `
                  <option value="${escapeHtml(segment)}" ${state.segmentFilter === segment ? 'selected' : ''}>${escapeHtml(segment)}</option>
                `,
              )
              .join('')}
          </select>
          <select id="status-filter" aria-label="Filtrar por estado">
            <option value="Todos" ${state.statusFilter === 'Todos' ? 'selected' : ''}>Todos los estados</option>
            <option value="Nuevo" ${state.statusFilter === 'Nuevo' ? 'selected' : ''}>Nuevo</option>
            <option value="En seguimiento" ${state.statusFilter === 'En seguimiento' ? 'selected' : ''}>En seguimiento</option>
            <option value="Propuesta" ${state.statusFilter === 'Propuesta' ? 'selected' : ''}>Propuesta</option>
            <option value="Activo" ${state.statusFilter === 'Activo' ? 'selected' : ''}>Activo</option>
          </select>
          <button class="primary-btn" id="open-create-contact" type="button">+ Nuevo contacto</button>
        </div>
      </div>

      ${
        state.notice
          ? `<div class="notice-banner">${escapeHtml(state.notice)}</div>`
          : ''
      }

      <div class="summary-grid contacts-summary-grid">
        <article class="summary-card">
          <span>Contactos visibles</span>
          <strong>${filtered.length}</strong>
          <small>Base filtrada para ventas y marketing</small>
        </article>
        <article class="summary-card">
          <span>Score promedio</span>
          <strong>${averageScore}</strong>
          <small>Priorizacion automatica</small>
        </article>
        <article class="summary-card">
          <span>Leads calientes</span>
          <strong>${hotLeads}</strong>
          <small>Score mayor o igual a 85</small>
        </article>
        <article class="summary-card">
          <span>Origen social</span>
          <strong>${socialLeads}</strong>
          <small>WhatsApp, Instagram y Facebook</small>
        </article>
      </div>

      <div class="table-card contacts-table-card">
        <div class="table-toolbar">
          <strong>${filtered.length} registros</strong>
          <span>Seguimiento comercial, documentos y conversaciones del cliente</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    id="select-all-contacts"
                    type="checkbox"
                    ${areAllFilteredContactsSelected() ? 'checked' : ''}
                    aria-label="Seleccionar todos los contactos filtrados"
                  />
                </th>
                <th>Contacto</th>
                <th>Empresa</th>
                <th>Canal</th>
                <th>Segmento</th>
                <th>Owner</th>
                <th>Estado</th>
                <th>Score</th>
                <th>Actualizado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${
                contactsPagination.items.length > 0
                  ? contactsPagination.items
                      .map(
                        (contact) => {
                          const reminderState = getContactReminderState(contact)
                          return `
                          <tr class="contact-table-row">
                            <td data-label="Seleccion">
                              <input
                                class="contact-selector"
                                data-contact-select="${contact.id}"
                                type="checkbox"
                                ${state.selectedContactIds.has(contact.id) ? 'checked' : ''}
                                aria-label="Seleccionar a ${escapeHtml(contact.name)}"
                              />
                            </td>
                            <td data-label="Contacto">
                              <div class="contact-cell">
                                <div class="avatar">${escapeHtml(contact.name.slice(0, 1))}</div>
                                <div class="contact-cell-copy">
                                  <div class="contact-cell-head">
                                    <strong>${escapeHtml(contact.name)}</strong>
                                    <span class="contact-connection-badge ${getContactConnectionClass(contact)}">
                                      <span class="contact-connection-dot" aria-hidden="true"></span>
                                      ${escapeHtml(getContactConnectionLabel(contact))}
                                    </span>
                                    ${
                                      reminderState.active
                                        ? `<span class="contact-reminder-badge">${escapeHtml(reminderState.label)}</span>`
                                        : ''
                                    }
                                  </div>
                                  <span>ID-${String(contact.id).padStart(3, '0')}</span>
                                  <small>${escapeHtml(getContactPreviewLine(contact))}</small>
                                </div>
                              </div>
                            </td>
                            <td data-label="Empresa">${escapeHtml(contact.company)}</td>
                            <td data-label="Canal">${escapeHtml(contact.channel)}</td>
                            <td data-label="Segmento">${escapeHtml(contact.segment)}</td>
                            <td data-label="Owner">${escapeHtml(contact.owner)}</td>
                            <td data-label="Estado"><span class="${getStatusClass(contact.status)}">${escapeHtml(contact.status)}</span></td>
                            <td data-label="Score">${contact.score}</td>
                            <td data-label="Actualizado">${escapeHtml(contact.updatedAt)}</td>
                            <td data-label="Acciones">
                              <div class="table-action-group">
                                <button
                                  class="secondary-btn table-action-btn"
                                  data-edit-contact="${contact.id}"
                                  type="button"
                                  aria-label="Editar a ${escapeHtml(contact.name)}"
                                >
                                  <span>Editar</span>
                                </button>
                                <button
                                  class="secondary-btn table-action-btn table-action-btn-whatsapp"
                                  data-send-whatsapp="${contact.id}"
                                  type="button"
                                  ${getWhatsAppReference(contact) ? '' : 'disabled'}
                                  aria-label="Enviar WhatsApp a ${escapeHtml(contact.name)}"
                                >
                                  <span class="table-action-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none">
                                      <path d="M12 4.2a7.8 7.8 0 0 0-6.75 11.7L4 20l4.27-1.2A7.8 7.8 0 1 0 12 4.2Z" fill="currentColor" opacity=".12"/>
                                      <path d="M12 4.2a7.8 7.8 0 0 0-6.75 11.7L4 20l4.27-1.2A7.8 7.8 0 1 0 12 4.2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                                      <path d="M9.1 8.9c.2-.5.4-.5.6-.5h.5c.1 0 .3 0 .4.3l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.1-.1.3 0 .4.4.8 1.1 1.5 1.9 1.9.1.1.3 0 .4 0l.5-.4c.1-.1.3-.1.5-.1l1.9.8c.3.1.3.2.3.4v.5c0 .2 0 .4-.5.6a4 4 0 0 1-1.8.3c-2 0-5.4-2.9-5.4-5.5 0-.6.1-1.2.4-1.8Z" fill="currentColor"/>
                                    </svg>
                                  </span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        `
                        },
                      )
                      .join('')
                  : `
                    <tr class="table-empty-row">
                      <td colspan="10">
                        <div class="empty-state">No hay contactos para ese filtro.</div>
                      </td>
                    </tr>
                  `
              }
            </tbody>
          </table>
        </div>
        ${
          contactsPagination.totalItems > contactsPagination.pageSize
            ? `
              <div class="international-pagination contacts-pagination">
                <div class="international-pagination-info">
                  <strong>${contactsPagination.currentPage}</strong>
                  <span>de ${contactsPagination.totalPages} páginas</span>
                  <span>Mostrando ${Math.min(
                    contactsPagination.totalItems,
                    contactsPagination.currentPage * contactsPagination.pageSize,
                  )} de ${contactsPagination.totalItems} contactos</span>
                </div>
                <div class="international-pagination-actions">
                  <button
                    class="secondary-btn pagination-btn"
                    type="button"
                    data-contacts-list-page="prev"
                    ${contactsPagination.currentPage <= 1 ? 'disabled' : ''}
                  >
                    Anterior
                  </button>
                  <button
                    class="secondary-btn pagination-btn"
                    type="button"
                    data-contacts-list-page="next"
                    ${contactsPagination.currentPage >= contactsPagination.totalPages ? 'disabled' : ''}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            `
            : ''
        }
      </div>
    </section>
  `
}



