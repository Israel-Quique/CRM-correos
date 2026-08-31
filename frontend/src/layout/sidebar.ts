// @ts-nocheck

export const renderSidebar = (ctx: any) => {
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
  return `
  <aside class="sidebar ${state.isSidebarCollapsed ? 'is-collapsed' : ''}">
    <div class="sidebar-top">
      <div class="brand-row">
        <button
          class="brand-badge brand-toggle"
          id="sidebar-toggle"
          type="button"
          aria-label="${state.isSidebarCollapsed ? 'Desplegar sidebar' : 'Replegar sidebar'}"
          title="${state.isSidebarCollapsed ? 'Desplegar sidebar' : 'Replegar sidebar'}"
        >
          ${getBrandIcon()}
        </button>
        <div class="brand-copy">
          <p>CRM Omnicanal</p>
          <strong>Conversa OS</strong>
        </div>
      </div>
    </div>

    <nav class="sidebar-nav">
      ${menuGroups
        .map((group) => {
          const expanded = state.expandedGroups.has(group.key)
          const containsActive = group.items.some((item) => item.view === state.activeView)
          const flyoutOpen = state.collapsedFlyoutGroup === group.key

          return `
            <section class="menu-group ${expanded ? 'is-open' : ''} ${flyoutOpen ? 'has-flyout' : ''}">
              <button
                class="menu-group-trigger ${containsActive ? 'is-active' : ''}"
                data-group="${group.key}"
                type="button"
                title="${group.label}"
                aria-label="${group.label}"
              >
                <span class="menu-group-icon">${getMenuGroupIcon(group.key)}</span>
                <span class="menu-group-copy">
                  <strong>${group.label}</strong>
                  <small>${group.items.length} modulos</small>
                </span>
                <span class="menu-group-arrow">${expanded ? '-' : '+'}</span>
              </button>

              <div class="menu-items">
                ${group.items
                  .map(
                    (item) => `
                      <button
                        class="menu-item ${item.view === state.activeView ? 'is-current' : ''}"
                        data-view="${item.view}"
                        type="button"
                        title="${item.label}"
                        aria-label="${item.label}"
                      >
                        ${item.label}
                      </button>
                    `,
                  )
                  .join('')}
              </div>

              ${
                state.isSidebarCollapsed
                  ? `
                    <div class="menu-flyout ${flyoutOpen ? 'is-visible' : ''}">
                      <div class="menu-flyout-header">
                        <strong>${group.label}</strong>
                      </div>
                      <div class="menu-flyout-items">
                        ${group.items
                          .map(
                            (item) => `
                              <button
                                class="menu-flyout-item ${item.view === state.activeView ? 'is-current' : ''}"
                                data-view="${item.view}"
                                type="button"
                              >
                                ${item.label}
                              </button>
                            `,
                          )
                          .join('')}
                      </div>
                    </div>
                  `
                  : ''
              }
            </section>
          `
        })
        .join('')}
    </nav>

  </aside>
`

}


