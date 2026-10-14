// @ts-nocheck

import {
  renderChatView,
  renderCustomMessagesView,
  renderPersonalizedMessagesView,
  renderContactsView,
  renderEmsView,
  renderGroupsView,
  renderInternationalContactPackagesView,
  renderInternationalPackagesView,
  renderInternationalPipelineView,
  renderInternationalScannerView,
  renderLogsView,
  renderProntsView,
  renderUsersView,
  renderSettingsView,
} from '../views'
export const renderWorkspace = (ctx: any) => {
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
  if (state.loading && !state.data) {
    return `
      <main class="workspace">
        <section class="section-panel is-visible">
          <div class="empty-state loading-state">Cargando datos desde PostgreSQL...</div>
        </section>
      </main>
    `
  }

  if (state.error && !state.data) {
    return `
      <main class="workspace">
        <section class="section-panel is-visible">
          <div class="empty-state error-state">
            <p>${escapeHtml(state.error)}</p>
            <button class="primary-btn" id="retry-load" type="button">Reintentar</button>
          </div>
        </section>
      </main>
    `
  }

  const renderActiveView = () => {
    if (state.activeView === 'pronts-nacional' || state.activeView === 'pronts-internacional') return renderProntsView(ctx)
    if (state.activeView === 'ems') return renderEmsView(ctx)
    if (state.activeView === 'internacionales') return renderInternationalPackagesView(ctx)
    if (state.activeView === 'internacionales-pipeline') return renderInternationalScannerView(ctx)
    if (state.activeView === 'internacionales-paquetes') return renderInternationalContactPackagesView(ctx)
    if (state.activeView === 'internacionales-tablero') return renderInternationalPipelineView(ctx)
    if (state.activeView === 'chat') return renderChatView(ctx)
    if (state.activeView === 'mensajes-personalizados') return renderPersonalizedMessagesView(ctx)
    if (state.activeView === 'contactos') return renderContactsView(ctx)
    if (state.activeView === 'agrupaciones') return renderGroupsView(ctx)
    if (state.activeView === 'usuarios') return renderUsersView(ctx)
    if (state.activeView === 'logs') return renderLogsView(ctx)
    if (state.activeView === 'configuraciones') return renderSettingsView(ctx)

    return '<section class="section-panel is-visible"></section>'
  }

  return `
    <main class="workspace">
      ${renderActiveView()}
    </main>
  `
}

