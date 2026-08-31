// @ts-nocheck

export const renderUsersView = (ctx: any) => {
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
  const users = state.users

  return `
    <section class="section-panel ${state.activeView === 'usuarios' ? 'is-visible' : ''}">
      <div class="section-head">
        <div>
          <p class="section-kicker">Usuarios</p>
          <h2>Personas con acceso al sistema</h2>
        </div>
        <div class="section-actions">
          <button class="primary-btn" id="open-user-create-modal" type="button">+ Nuevo usuario</button>
        </div>
      </div>

      ${
        state.usersError
          ? `<div class="notice-banner notice-banner-error">${escapeHtml(state.usersError)}</div>`
          : ''
      }

      <div class="summary-grid">
        <article class="summary-card">
          <span>Usuarios registrados</span>
          <strong>${users.length}</strong>
        </article>
        <article class="summary-card">
          <span>Ultima sincronizacion</span>
          <strong>${state.usersSyncedAt ? formatConversationTimestamp(state.usersSyncedAt) : 'Sin datos'}</strong>
        </article>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <strong>Accesos al sistema</strong>
          <span>Estos registros son usuarios internos con credenciales de acceso, no datos de la API.</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Creado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${
                state.usersState === 'loading'
                  ? `
                    <tr>
                      <td colspan="5">
                        <div class="empty-inline">Cargando usuarios...</div>
                      </td>
                    </tr>
                  `
                  : users.length > 0
                    ? users
                        .map(
                          (user) => `
                            <tr>
                              <td data-label="Nombre">
                                <strong>${escapeHtml(user.fullName)}</strong>
                              </td>
                              <td data-label="Correo">${escapeHtml(user.email)}</td>
                              <td data-label="Rol">
                                <span class="status-pill">${escapeHtml(user.role)}</span>
                              </td>
                              <td data-label="Creado">${escapeHtml(formatConversationTimestamp(user.createdAt))}</td>
                              <td data-label="Acciones">
                                <div class="group-card-actions">
                                  <button class="secondary-btn" data-edit-user="${user.id}" type="button">Editar</button>
                                  <button class="danger-btn" data-delete-user="${user.id}" type="button">Eliminar</button>
                                </div>
                              </td>
                            </tr>
                          `,
                        )
                        .join('')
                    : `
                      <tr>
                        <td colspan="5">
                          <div class="empty-inline">Aun no hay usuarios cargados.</div>
                        </td>
                      </tr>
                    `
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `
}



