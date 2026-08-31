// @ts-nocheck

export const renderEmsPackageDetailModal = (ctx: any) => {
  const {
    state,
    escapeHtml,
    formatConversationTimestamp,
    getEmsStatusToneClass,
    getEmsStatusLabel,
    findContactByWhatsAppReferenceValue,
  } = ctx

  if (!state.isEmsPackageDetailModalOpen || !state.selectedEmsPackageDetailId) {
    return ''
  }

  const packageCard = ctx
    .getEmsApiStatusPackages()
    .all.find((card: any) => card.id === state.selectedEmsPackageDetailId)

  if (!packageCard) {
    return ''
  }

  const getParticipantInfo = (reference: string) => {
    const contact = findContactByWhatsAppReferenceValue(reference)

    return {
      contact,
      hasWhatsApp: Boolean(contact?.id),
      label: contact?.id ? 'WhatsApp disponible' : 'Solo telefono',
    }
  }

  const senderInfo = getParticipantInfo(packageCard.senderReference)
  const recipientInfo = getParticipantInfo(packageCard.recipientReference)

  const renderReferenceAction = (contact: any, label: string, reference: string) => {
    if (contact?.id) {
      return `
        <button class="primary-btn" data-open-ems-contact-target="${contact.id}" type="button">
          Abrir ${escapeHtml(label)}
        </button>
      `
    }

    return `
      <div class="ems-package-detail-muted">
        <span>${escapeHtml(label)} sin WhatsApp</span>
        <small>${escapeHtml(reference || 'Sin referencia')}</small>
      </div>
    `
  }

  return `
    <div class="modal-backdrop" id="ems-package-detail-modal-backdrop">
      <div class="modal-card modal-card-profile ems-package-detail-modal">
        <div class="modal-header">
          <div>
            <p class="section-kicker">Detalle de paquete EMS</p>
            <h3>${escapeHtml(packageCard.code)}</h3>
            <small class="conversation-subtitle">${escapeHtml(packageCard.summary)}</small>
          </div>
          <button class="modal-close" id="close-ems-package-detail-modal" type="button">Cerrar</button>
        </div>

        <div class="ems-package-detail-hero">
          <div>
            <span class="ems-package-detail-label">Estado</span>
            <strong class="ems-package-detail-status ${getEmsStatusToneClass(packageCard.stage)}">
              ${escapeHtml(getEmsStatusLabel(packageCard.stage))}
            </strong>
          </div>
          <div>
            <span class="ems-package-detail-label">Ultima actualizacion</span>
            <strong>${escapeHtml(formatConversationTimestamp(packageCard.updatedAt))}</strong>
          </div>
          <div>
            <span class="ems-package-detail-label">Destino</span>
            <strong>${escapeHtml(packageCard.destination)}</strong>
          </div>
        </div>

        <div class="ems-package-detail-grid">
          <section class="ems-package-detail-card">
            <div class="ems-package-detail-card-head">
              <span class="ems-package-detail-label">Remitente</span>
              <span class="ems-package-detail-channel-state ${senderInfo.hasWhatsApp ? 'is-whatsapp' : 'is-phone'}">
                ${escapeHtml(senderInfo.label)}
              </span>
            </div>
            <strong>${escapeHtml(packageCard.senderName)}</strong>
            <small>${escapeHtml(packageCard.senderReference)}</small>
            ${renderReferenceAction(senderInfo.contact, 'conversacion del remitente', packageCard.senderReference)}
          </section>
          <section class="ems-package-detail-card">
            <div class="ems-package-detail-card-head">
              <span class="ems-package-detail-label">Destinatario</span>
              <span class="ems-package-detail-channel-state ${recipientInfo.hasWhatsApp ? 'is-whatsapp' : 'is-phone'}">
                ${escapeHtml(recipientInfo.label)}
              </span>
            </div>
            <strong>${escapeHtml(packageCard.recipientName)}</strong>
            <small>${escapeHtml(packageCard.recipientReference)}</small>
            ${renderReferenceAction(recipientInfo.contact, 'conversacion del destinatario', packageCard.recipientReference)}
          </section>
        </div>

        <div class="ems-package-detail-footer">
          <div class="ems-package-detail-note">
            <span>Tipo de origen</span>
            <strong>${escapeHtml(packageCard.sourceKind === 'tracking' ? 'Tracking API' : 'Paquetes de contactos')}</strong>
          </div>
          <div class="ems-package-detail-note">
            <span>Contenido / resumen</span>
            <strong>${escapeHtml(packageCard.summary)}</strong>
          </div>
        </div>
      </div>
    </div>
  `
}
