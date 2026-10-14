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
    getAutoReplyPausedContacts,
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
    getGroupPickerResultsMarkup,
    getViewHref
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
          CRM
        </button>
        <div class="brand-copy">
          <p>CRM Comercial</p>
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
                <span class="menu-group-arrow">${expanded ? '▲' : '▼'}</span>
              </button>

              <div class="menu-items">
                ${group.items
                  .map(
                    (item) => {
                      const pausedCount = item.view === 'chat' ? getAutoReplyPausedContacts().length : 0
                      return `
                      <a
                        class="menu-item ${item.view === state.activeView ? 'is-current' : ''}"
                        href="${escapeHtml(getViewHref(item.view))}"
                        data-view="${item.view}"
                        title="${item.label}"
                        aria-label="${item.label}"
                      >
                        ${item.label}
                        ${pausedCount > 0 ? `<span class="menu-item-badge">${pausedCount}</span>` : ''}
                      </a>
                    `
                    },
                  )
                  .join('')}
                ${
                  group.key === 'sistema'
                    ? `
                      <button
                        class="menu-item menu-item-action"
                        data-export-tracking-api-excel
                        type="button"
                        title="Extraer tracking Excel"
                        aria-label="Extraer tracking Excel"
                      >
                        Extraer tracking Excel
                      </button>
                    `
                    : ''
                }
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
                            (item) => {
                              const pausedCount = item.view === 'chat' ? getAutoReplyPausedContacts().length : 0
                              return `
                              <a
                                class="menu-flyout-item ${item.view === state.activeView ? 'is-current' : ''}"
                                href="${escapeHtml(getViewHref(item.view))}"
                                data-view="${item.view}"
                              >
                                ${item.label}
                                ${pausedCount > 0 ? `<span class="menu-item-badge">${pausedCount}</span>` : ''}
                              </a>
                            `
                            },
                          )
                          .join('')}
                        ${
                          group.key === 'sistema'
                            ? `
                              <button
                                class="menu-flyout-item menu-item-action"
                                data-export-tracking-api-excel
                                type="button"
                              >
                                Extraer tracking Excel
                              </button>
                            `
                            : ''
                        }
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
    
    <div class="sidebar-postal-watermark" aria-hidden="true">
      <svg viewBox="0 0 200 240" fill="none" stroke="currentColor">
        <!-- Puerta del Sol / Silueta Tiwanaku -->
        <path d="M20 230h160v-10h-25v-80h25v-10h-50v35h-35v-35H20v10h25v80H20v10z" stroke-width="1.2" opacity="0.4"/>
        <rect x="70" y="165" width="60" height="65" stroke-width="1.2" opacity="0.4"/>
        <!-- Sello Matasellos Circular -->
        <circle cx="80" cy="90" r="45" stroke-dasharray="4 3" stroke-width="1.2"/>
        <circle cx="80" cy="90" r="38" stroke-width="0.9"/>
        <path d="M40 90h80M80 50v80" stroke-width="0.7"/>
        <text x="80" y="85" text-anchor="middle" font-size="8" font-family="sans-serif" font-weight="700" fill="currentColor">12 DE</text>
        <text x="80" y="98" text-anchor="middle" font-size="7" font-family="sans-serif" font-weight="700" fill="currentColor">BMITT</text>
        <text x="80" y="115" text-anchor="middle" font-size="9" font-family="sans-serif" font-weight="800" fill="currentColor">BOLIVIA</text>
        <!-- Ondas de Matasellos -->
        <path d="M125 75c15-7 25 7 40 0M125 90c15-7 25 7 40 0M125 105c15-7 25 7 40 0" stroke-width="1.2"/>
      </svg>
    </div>

  </aside>
`

}


