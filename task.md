# Estado Global del Proyecto y Memoria del Agente

> Documento de memoria del CRM Integrador ("Conversa OS") para Correos de Bolivia.
> Generado el 2026-09-23. Rama git: `UniversidadIsrael`.

---

## 1. Visión y Arquitectura del Proyecto

### Objetivo Principal
Sistema web de gestión de relaciones con clientes (CRM) para **Correos de Bolivia** que combina:
- **Gestión operativa**: pipeline de paquetes nacionales (EMS) e internacionales, tarifarios, contactos, grupos de campaña, chat omnicanal (WhatsApp), usuarios y reporte de logs.
- **Chatbot WhatsApp autónomo**: recibe mensajes vía **Meta Cloud API** (webhook), los clasifica por intención (TRACKING / TARIFAS / GENERAL), consulta APIs externas de Correos (tracking, paquetes-contactos, eventos, tarifarios) y responde con **plantillas locales o un LLM local (Ollama)** sin intervención humana.

### Stack Tecnológico
| Capa | Tecnología |
|---|---|
| Backend | Node.js (ESM) + Express 5 + PostgreSQL 16. **Monolito** `backend/index.js` (**12 061 líneas**). Dependencias: `pg`, `multer`, `xlsx`, `libphonenumber-js`, `cors`, `dotenv`. |
| Frontend | Vite 8 + TypeScript 6, **sin framework de UI** (DOM nativo). `frontend/src/main.ts` monolítico (**10 963 líneas**) + 12 vistas + 14 modales + 5 archivos de layout. |
| Infra | `docker-compose.yml`: postgres:16-alpine (volumen `./pgdata`) y ollama (volumen `./ollama`). |
| LLM | Ollama local (`http://localhost:11434`). Modelos: `qwen2.5:7b` (general), `qwen2.5:0.5b` (router), `llama3.2:3b` (tracking). |
| APIs externas | Correos Bolivia: `/api/tracking/paquetes`, `/api/paquetes-contactos`, `/api/paquetes-eventos`, `/api/tarifarios/*` (bearer token). |

### Reglas de Codificación
- JavaScript/ESM en backend. TypeScript en frontend. Sin framework CSS; una sola hoja `style.css`.
- El backend de producción es el monolito `backend/index.js`. **NO tocar a la ligera**: editar quirúrgicamente, sin reformatear bloques ajenos.
- **Prohibido leer/modificar**: `backend/logs/*`, `backend/pgdata`, `ollama/*`, `node_modules`, `dist`, `route_extracted.json`, `package-lock.json`.
- **Prohibido mostrar/loguear** valores de `.env` ni de `integration_settings` (secretos). Solo nombres de variables.
- Comunicación con el cliente final siempre en español de Bolivia (1-2 frases, nivel conversacional).
- Los prompts del sistema (`systemPrompt`, `routerSystemPrompt`, `trackingSystemPrompt`) son editables desde `integration_settings` (`crm_pronts_config`) con defaults en `backend/index.js:108-267`. Si se cambian los defaults, respetar el formato que espera la UI (`backend/routes/pronts-configRoutes.js`, `frontend/src/views/prontsView.ts`).

### Arquitectura de alto nivel
```
Meta Cloud API ──webhook──► Express (backend/index.js) ──► persistInboundWhatsAppWebhook (:9304)
                                 │
                                 ▼
                        enqueueAutoReply (:9293, EN MEMORIA) ──► autoReplyInboundWhatsAppMessage (:8874)
                                 │                     │
                                 ├─► Contexto (últimos 8 mensajes, buildAiConversationContext :5835)
                                 ├─► Intención (inferIntentHeuristically :7169 / routeCustomerIntent :7196)
                                 ├─► APIs Correos (tracking/tarifas/paquetes) + tabla tariff_rates
                                 ├─► Ollama (callOllamaGenerate :8816) o plantillas/fallback amable (:6375)
                                 └─► sendWhatsAppCloudMessage (:5594) ──► message_logs
```

---

## 2. Asignación de Agentes y Roles

| Agente | Rol en este proyecto |
|---|---|
| **OpenCode** | Análisis del sistema, edición quirúrgica del monolito `backend/index.js`, diagnóstico de autonomía del bot, mantenimiento de esta memoria (`task.md`) y de las reglas (`AGENTS.md`). |
| **Codex** | Ejecución de prompts de implementación (CLI `codex` v0.150.1 instalado). Recibe especificaciones detalladas y las implementa en el monolito. Usado en la sesión de "tarea 1.txt". |
| **GitHub Copilot** | Autocompletado en línea (si el editor lo usa). No mantiene memoria del proyecto. |
| **AntiGravity** | No asignado actualmente. Reservado para futuras tareas multiaarchivo en segundo plano. |

### División de responsabilidades práctica
- *OpenCode/Codex* → lógica operativa y del bot dentro del monolito + frontend.
- *Humano* → decide la P0 del refactor (opción a/b), revisa pull requests de autonomía y prueba el webhook con `cloudflared`.

---

## 3. Plan de Trabajo y Checklist de Tareas
> Leyenda: `[x]` Completado | `[/]` En progreso (parcial) | `[ ]` Pendiente | `[FAILED]` Fallido (requiere revisión)
> Referencias a `backend/index.js` con líneas del 2026-09-23.

### Bloques funcionales ya implementados (base del sistema)
- [x] **Módulo 1: Base CRM + Auth** — login/demo/session/logout (`:9712-9800`), usuarios CRUD (`:9802-9947`), dashboard (`:9949`), contactos CRUD (`:11864-11928`). Sesiones firmadas con HMAC (`:591-634`), passwords con hash/legacy (`:564-583`).
- [x] **Módulo 2: Webhook WhatsApp + Bot** — GET `/webhook` verificación (`:10949`), POST persist (`:10973`), cola auto-respuesta (`:8874-9293`), dedup entrante por `provider_message_id` (en `persistInboundWhatsAppWebhook :9304`), envío por Cloud API (`:5594`), media image/audio (`:1543`, `:1568`).
- [x] **Módulo 3: Tracking y Pipeline EMS** — proxy `/api/tracking/paquetes` (`:735`), `/api/internacionales/paquetes-contactos` (`:831`), catálogos en memoria masivos (`:2823`, `:890`), `/api/ems/pipeline` (`:10134`), `/api/ems/month-options` (`:10200`), overrides de etapa (`:10244`), sync package-pipeline (`:3293`, `:3805`).
- [x] **Módulo 4: Tarifas del bot** — tabla `tariff_rates`, parser de peso/destino/servicio (`:7206-7454`), consulta combinada local+externa `getTariffQuote` (`:7454`), build de respuesta `buildTariffReply` (`:7672`).
- [x] **Módulo 5: Agrupaciones y campañas** — `/api/contact-groups*` (`:10297-10666`), envío masivo a grupos con plantilla `{{name}}/{{company}}`.
- [x] **Módulo 6: Configuración** — `integration_settings` (jsonb): config WhatsApp (`:2205`), prompts PRONTS (`:1963-1988`), pipeline config (`:2055`), automatización (`:1860`), agentes IA (`:5427`), modo prueba (`:8238`).
- [x] **Módulo 7: Logs del sistema** — tabla `system_logs` + `writeSystemLog` (`:511`), reporte `/api/logs/report` (`:9611`), vista logs en frontend.
- [x] **Módulo 8: IA del bot** — `callOllamaGenerate` (`:8816`), router de intención (`:7169-7196`), `buildAiConversationContext` (`:5835`), `/api/ai/health` (`:11202`), `/api/ai/agent*` (`:11242-11305`), `/api/ai/suggest-reply` (`:11602`), prompts por modelo (general `:7768`, tracking `:7814`).

### Tareas de prioridad (provenientes de AGENTS.md + sesiones)
- [ ] **P0-1 · Durabilidad de la auto-respuesta** — La cola es **en memoria** (`autoReplyQueue = Promise.resolve()` `:9291`, `enqueueAutoReply` `:9293`): se pierde al reiniciar y no tiene retries. La tabla `whatsapp_auto_reply_queue` ya existe (`backend/db/init.sql:85-105`) pero NADIE la usa. Conectar `enqueueAutoReply` + un drenador (`drainAutoReplyQueue`) con estados pending/processing/failed, retry con límite y reinicio seguro. Referencia fallida previa: `backend/index_refactored.js:5517-5682` (no copiar tal cual).
- [ ] **P0-2 · Robotizar el refactor (DECIDIR)** — `backend/index_refactored.js` NO compila, y las 17 factories `backend/routes/*.js` tienen deps rotas de forma sistémica. Decidir UNO de: (a) completar la migración conectando las rutas al `index.js` de producción, o (b) eliminar `index_refactored.js` + `server/index.js` + rutas huérfanas. **Hoy hay 3 "servidores" a nivel de código** (monolito + 2 borradores).
- [ ] **P1-1 · Seguridad del webhook** — POST `/webhook` (`:10973`) NO valida `X-Hub-Signature-256` (solo verify token en GET). Firmar con App Secret de Meta. Es un riesgo de inyección de eventos falsos.
- [ ] **P1-2 · Privacidad del webhook** — `backend/index.js:10974` loguea el `body` COMPLETO de cada evento (`console.log('Webhook de WhatsApp recibido:', JSON.stringify(request.body))`). Reducir a resumen (provider message id, tipo, remitente) sin cifras de contacto completas.
- [ ] **P1-3 · Grupos/broadcasts** — No hay filtro de mensajes `g.us` ni broadcasts en `persistInboundWhatsAppWebhook`. Decidir si se ignoran o se tratan como conversación de grupo.
- [ ] **P1-4 · Media webhook** — `getWebhookMediaDescriptor` (`:1543`) solo soporta image y audio. Añadir document/location o degradar con mensaje claro.
- [/] **P1-5 · Robustez del LLM** — `callOllamaGenerate` (`backend/index.js:8816`) ahora tiene retry/backoff corto configurable con `AI_GENERATE_RETRY_ATTEMPTS` y limpia el cache de salud cuando falla `/api/generate`. **Sigue pendiente:** levantar Ollama como servicio estable y revisar si el fallback debe decir explícitamente al cliente que la IA está temporalmente indisponible.
- [ ] **P1-6 · Idempotencia ante reintentos de Meta** — El dedup por `provider_message_id` solo protege la persistencia entrante. Si el proceso falla después de responder, Meta reintenta y puede duplicar respuestas. Revisar idempotencia completa del flujo.
- [ ] **P1-7 · Alinear modelos** — `docker-compose.yml` hace pull de `llama3.1:8b`; el backend usa `qwen2.5:7b` (`:226-267`), `qwen2.5:0.5b` y `llama3.2:3b`. Corregir la inconsistencia.
- [/] **P2-1 · Calidad de texto** — Mojibake residual en código fuente (`backend/index.js:333` `"Tracking API Â·"`, `:5870` `"distribuciÃ³n"`, `:9151` `"Â¡Con gusto!"`, `frontend/src/views/emsView.ts:51/55`, `frontend/src/modals/emsStatePackagesModal.ts:33`). Mitigado en envíos con `repairMojibakeText` (`:4000`), pero el código fuente sigue sucio. Normalizar.
- [/] **P2-2 · Watchers frágiles** — `startWhatsAppStageWatcher` (`:8796`) usa `setTimeout` recursivo; ya tiene `async` wrapper y consulta advisory lock (`:8598`), pero verificar try/catch global que evite muerte silenciosa.

### Tarea de autonomía del agente (tarea 1)
- [x] **A1 · Diagnóstico de bloqueadores de autonomía** — Se confirmó: agente IA global `enabled: true` (`crm_ai_agent`), pero con `WHATSAPP_TEST_MODE=true` la función `isWhatsAppRecipientAllowedByTestMode` (`:8238`) rechaza a cualquiera que no esté en los números de prueba → la auto-respuesta se salta y un humano debía validar. Además Ollama estaba caído.
- [x] **A2 · Arranque de Ollama** — Instalado en `C:\Users\israe\AppData\Local\Programs\Ollama`; los modelos necesarios (`qwen2.5:7b`, `qwen2.5:0.5b`, `llama3.2:3b`, `deepseek-r1:8b`) están descargados. Se levantó el servicio en `:11434`.
- [x] **A3 · Configuración de modo prueba / números** — `whatsapp_meta`: `testModeEnabled: true`, 4 números de prueba configurados, access token y webhook verify token presentes. El flujo quedó listo para autonomía controlada.
- [x] **A4 · Features de autonomía agregadas (SIN comitear)** — Endpoints `/api/settings/automation` (`:1900/:1909`), toggle "Atención por IA" por conversación (`chatConversationPanel.ts`, nuevo), pausa de auto-respuesta off-topic con cooldown 4 h (`:7870-7878`, `:7963-8044`), des/pause y reintento por contacto (`/api/contacts/:id/auto-reply-unpause :11486`, `auto-reply-retry :11539`), `settingsView.ts` (nuevo), y `buildFriendlyFallbackAgentReply` (`:6375`) que reemplaza el texto duro.

### Pendientes de deuda general (nuevos hallazgos de esta auditoría)
- [ ] **Código no comiteado en git**: +6165/−1334 líneas sin commit desde `8923772` (2026-09-10). Incluye cambios importantes del bot (`backend/index.js`, `frontend/src/main.ts`, vistas). **Commitear o segmentar pronto** para no perder el trabajo.
- [ ] `frontend/src/counter.ts` es un residuo del template de Vite (no se usa). Eliminar.
- [ ] Hash de contraseñas: `hashPassword` (`:564`) comparación éstá pendiente de verificar estrategia (hay `hashLegacyPassword`/`verifyPassword` `:570-583`). No usar bcrypt sin revisar compatibilidad con seeds existentes.
- [ ] `system_logs` se escribe en casi todos los endpoints (`writeSystemLog`): revisar volumen y limpieza/rotación.

---

## 4. Registro de Cambios y Decisiones Técnicas (Log de Auditoría)
*(Cada agente debe anotar la fecha, el cambio realizado y los archivos tocados)*

- **[2026-09-10] Agente:** Git (autor)
  - **Acción:** Commit `c069f33` "Versión limpia sin modelos de Ollama": se dejó el repo sin pesos de modelos.
  - **Resultado:** Exitoso.

- **[2026-09-10] Agente:** Git (autor)
  - **Acción:** Commit `8923772` "clasificacion y razonamiento del agente": última versión base del sistema en la rama `UniversidadIsrael`.
  - **Resultado:** Exitoso. (Base desde la que se auditó el sistema.)

- **[2026-09-23] Agente:** Codex + OpenCode (sesión registrada en `tarea 1.txt`)
  - **Acción:** Diagnóstico de autonomía del agente IA. Confirmado: agente global `enabled: true`, `assistedContactIds: 0`, `whatsapp_meta.testModeEnabled: true`, `aiAutoReply: false` en `crm_automation_config`. Ollama instalado pero caído → se levantó `ollama serve` (`:11434 LISTENING`). Modelos verificados localmente: deepseek-r1:8b, llama3.2:3b, qwen2.5:0.5b, qwen2.5:7b.
  - **Acción (continuación):** Preparación de prompt para Codex para implementar autonomía (que no requiera validar cada conversación).
  - **Archivos tocados:** `tarea 1.txt` (log de la sesión).
  - **Resultado:** Exitoso en diagnóstico; implementación quedó en el árbol de trabajo (ver A4).

- **[2026-09-23] Agente:** OpenCode
  - **Acción:** Auditoría completa del sistema para generar esta memoria. Estado en vivo verificado: backend UP `:3001` (health ok), frontend dev `:5173`, PostgreSQL `:5432`, **Ollama DOWN** (`:11434` sin respuesta).
  - **Archivos tocados:** `task.md` (este documento), lectura de `backend/index.js`, `frontend/src/*`, `backend/routes/*.js`, `backend/db/init.sql`, `.env.example`, `docker-compose.yml`, logs de git.
  - **Resultado:** Exitoso.

- **[2026-09-23] Agente:** OpenCode (cambios ajenos SIN comitear detectados)
  - **Acción:** Se detectó trabajo reciente sin commit (modificados: `backend/index.js` +5000 líneas, `frontend/src/main.ts` +593, `style.css` +1316; nuevos: `chatConversationPanel.ts`, `settingsView.ts`, `AGENTS.md`, `tarea 1.txt`).
  - **Resultado:** Pendiente de commit/code review.

- **[2026-09-24] Agente:** Codex
  - **Acción:** Revisión de autonomía del agente de WhatsApp/Ollama según este `task.md`. Confirmado: el flujo no exige validación manual por conversación cuando `crm_ai_agent.enabled` está activo y el número pasa `WHATSAPP_TEST_MODE`; los bloqueos principales son configuración de modo prueba y disponibilidad real de Ollama.
  - **Acción técnica:** `callOllamaGenerate` en `backend/index.js` recibió retry/backoff corto configurable por `AI_GENERATE_RETRY_ATTEMPTS` (default 2 intentos) y limpieza del cache `aiHealthCache` tras fallos de generación, para evitar caer al fallback por errores transitorios.
  - **Verificación:** `node --check backend/index.js` exitoso. `http://localhost:11434/api/tags` no respondió en 3 segundos, por lo que Ollama no estaba disponible al momento de esta revisión.
  - **Archivos tocados:** `backend/index.js`, `task.md`.
  - **Resultado:** Cambio aplicado; falta levantar/verificar Ollama para prueba conversacional end-to-end.

- **[2026-10-08] Agente:** GitHub Copilot
  - **Acción:** Se ampliaron los tiempos máximos predeterminados de generación para dar al modelo general hasta 120 segundos y al modelo de tracking hasta 90 segundos antes de usar la respuesta de respaldo.
  - **Configuración:** `AI_GENERAL_TIMEOUT_MS` y `AI_TRACKING_TIMEOUT_MS` siguen permitiendo ajustes; no estaban definidas en `.env` al realizar el cambio.
  - **Archivos tocados:** `backend/index.js`, `task.md`.
  - **Verificación:** `node --check backend/index.js` exitoso.
  - **Resultado:** Aplicado; el backend debe reiniciarse para usar los nuevos tiempos.

- **[2026-10-08] Agente:** GitHub Copilot
  - **Acción:** Se corrigió el filtro de pausa por mensajes fuera de tema: los mensajes reconocidos como consultas de tarifas/envíos ya no se cuentan como no accionables aunque no mencionen explícitamente Correos, paquete o guía. Esto evita que solicitudes como enviar un paquete a China queden bloqueadas antes de llegar al flujo de cotización/IA.
  - **Diagnóstico:** El mensaje recibido a las 18:42 fue omitido por `off-topic-pause-created`; el sistema creó una pausa de cuatro horas al contar dos mensajes seguidos como fuera de tema. No llegó a Ollama.
  - **Archivos tocados:** `backend/index.js`, `task.md`.
  - **Verificación:** `node --check backend/index.js` exitoso; la prueba de clasificación reconoció “mandar un paqute a china” como consulta de tarifa y no accionable-falso.
  - **Resultado:** Aplicado; reiniciar el backend para activar la corrección.

- **[2026-10-08] Agente:** GitHub Copilot
  - **Acción:** Se corrigió la cotización internacional a China: como China no está en el catálogo EMS configurado, el bot ya no interpreta La Paz (el origen) como destino ni ofrece servicios nacionales; responde que no puede confirmar automáticamente la tarifa y recomienda verificarla con un asesor. También reconoce el texto `china4` enviado en el mensaje de prueba.
  - **Diagnóstico:** La entrada se registró como consulta TARIFAS, pero el destino China no existía en `ems-destinations.json`; el parser reutilizó la única ciudad boliviana reconocida (La Paz) como origen y destino.
  - **Archivos tocados:** `backend/index.js`, `backend/services/ems-calculator.js`, `backend/tests/ems-calculator.test.js`, `task.md`.
  - **Verificación:** `node --check backend/index.js`, `node --check backend/services/ems-calculator.js`, `node --test backend/tests/ems-calculator.test.js` (25/25) y `git diff --check` exitosos. Prueba unitaria confirma `China4` como solicitud de envío internacional no cotizable automáticamente.
  - **Resultado:** Aplicado; reiniciar el backend para activar el cambio.

- **[2026-10-08] Agente:** GitHub Copilot
  - **Acción:** Se prepara una alternativa para destinos internacionales no configurados: para China, el bot puede ofrecer revisar una cotización EMS hasta Rusia, que sí está en el catálogo. La respuesta aclara que Rusia es un destino distinto y que no incluye reenvío a China. Si el cliente acepta esa oferta, la lógica reutiliza el destino Rusia y sigue el flujo real de cotización EMS, solicitando el peso si falta.
  - **Archivos tocados:** `backend/index.js`, `backend/services/ems-calculator.js`, `backend/tests/ems-calculator.test.js`, `task.md`.
  - **Verificación:** `node --check backend/index.js`, `node --check backend/services/ems-calculator.js`, `node --test backend/tests/ems-calculator.test.js` (27/27) y `git diff --check` exitosos. Se confirmó que la API EMS calcula una cotización a Rusia con peso de prueba; no se guardó ni mostró el importe.
  - **Resultado:** Aplicado; reiniciar backend para activar la oferta y su flujo de confirmación/cotización.

---

## 5. Intentos Fallidos y Soluciones Prohibidas (Memory Anti-Loop)

1. **Intento:** Refactor del monolito a `backend/routes/*.js` factories (`index_refactored.js`).
   - **Razón de Falla:** SyntaxError por guiones en identificadores: `registerPackage-code-lookupRoutes` (`index_refactored.js:4`) y `registerContact-groupsRoutes` (`:11`, `:6095`, `:6102`). Además las 17 factories destructurean 49 deps que no incluyen decenas de helpers usados por los handlers: `upload` (messagesRoutes:8) y `getAiConfig` (aiRoutes:10) son las rotas arquetípicas, pero ~10 factories más usan helpers no declarados (`saveWhatsAppConfig`, `sendWhatsAppCloudMessage`, `savePipelineConfig`, `saveProntsConfig`, `persistInboundWhatsAppWebhook`, etc.).
   - **REGLA:** NO seguir ampliando `index_refactored.js` ni `server/index.js`. Solo se mantienen como referencia. Cualquier nueva feature se implementa en el monolito `backend/index.js`. La P0-2 (migrar o borrar) es decisión humana; NO dejar 3 servidores vivos.

2. **Intento:** Drenador de cola de auto-respuesta en `index_refactored.js:5517-5682` (`kickAutoReplyQueueDrain` / `autoReplyQueueDrainPromise`).
   - **Razón de Falla:** Diseñado para el borrador, no integrado al monolito de producción.
   - **REGLA:** Al implementar P0-1, adaptar la lógica de estados/retry a la tabla `whatsapp_auto_reply_queue` directamente en `backend/index.js`, NO copiar el código del borrador.

3. **Intento:** Uso de `psql` CLI para verificar la BD desde la máquina local.
   - **Razón de Falla:** `psql` no está en PATH ni en `node_modules/.bin`. Los intentos de script fallaron por resolución de módulos (`dotenv`, `pg` desde Temp).
   - **REGLA:** Para consultar la BD usar la API del backend (`pg` pool dentro de `backend/`) o Windows Docker Desktop con PostgreSQL (`:5432`), en vez de scripts en temp que no resuelven módulos.

4. **Intento:** Pasar de largo por el bucle test-mode → validación humana.
   - **Razón de Falla:** Lógico, no bug: con `WHATSAPP_TEST_MODE=true`, `isWhatsAppRecipientAllowedByTestMode` (`:8238`) filtra todo número fuera de la lista de prueba. Causa de "siempre validar conversaciones".
   - **REGLA:** Para probar autonomía real hay que (a) incluir el número en la lista de prueba o (b) desactivar `testModeEnabled`. NO borrar la guarda del modo prueba.

---

## 6. Contexto y Variables de Entorno Requeridas
*(Solo nombres; los valores viven en `.env`, que no se versiona)*

**Variables necesarias:**
- `DATABASE_URL` (postgresql://postgres:postgres@localhost:5432/crm_integrador), `DATABASE_SSL=false`
- `PORT=3001`, `VITE_API_URL=http://localhost:3001`, `CORS_ORIGIN`, `JSON_BODY_LIMIT=1mb`
- Seed opcional: `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `ENABLE_DEMO_LOGIN`, `DEMO_USER_EMAIL`
- **WhatsApp Meta**: `WHATSAPP_META_ACCESS_TOKEN`, `WHATSAPP_META_PHONE_NUMBER_ID`, `WHATSAPP_META_BUSINESS_ACCOUNT_ID`, `WHATSAPP_META_API_VERSION=v23.0`, `WHATSAPP_META_SENDER_NUMBER`, `WHATSAPP_META_WEBHOOK_VERIFY_TOKEN`
- **IA (Ollama)**: `AI_BASE_URL=http://localhost:11434`, `AI_MODEL`/`AI_GENERAL_MODEL=qwen2.5:7b`, `AI_ROUTER_MODEL=qwen2.5:0.5b`, `AI_TRACKING_MODEL=llama3.2:3b`, `AI_GENERAL_TIMEOUT_MS` (predeterminado 120000), `AI_TRACKING_TIMEOUT_MS` (predeterminado 90000), `AI_AUTO_REPLY=true`
- **Modo prueba/automatización**: `WHATSAPP_TEST_MODE`, `WHATSAPP_TEST_MODE_NUMBER`, `WHATSAPP_AUTO_START_ON_DASHBOARD`, `WHATSAPP_STAGE_WATCHER_ENABLED`, `WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED`, `WHATSAPP_NEW_PACKAGE_WELCOME_ENABLED`, `PACKAGE_PIPELINE_SYNC_INTERVAL_MS`, `PACKAGE_NEW_PACKAGE_WELCOME_INTERVAL_MS`, `PACKAGE_EVENT_CHANGE_SYNC_INTERVAL_MS`, `PACKAGE_FULL_EVENT_CHANGE_SYNC_INTERVAL_MS`
- **APIs Correos**: `TRACKING_SQLSERVER_TOKEN`, `TRACKING_API_URL=https://dev.correos.gob.bo:18100`, `PAQUETES_CONTACTOS_API_URL`/`_TOKEN`, `PAQUETES_EVENTOS_API_URL`/`_TOKEN`, `DELIVERY_EXPRESS_TARIFF_API_URL`/`_TOKEN`, `EMS_NATIONAL_TARIFF_API_URL`/`_TOKEN`

**Comandos:**
| Acción | Comando |
|---|---|
| Instalar | `npm install` |
| Levantar todo (dev) | `npm run dev` (concurrente: back `:3001` + front `:5173`) |
| Backend solo | `npm --prefix backend run dev` (tsx watch) |
| Frontend solo | `npm --prefix frontend run dev` |
| Producción | `npm run build` && `npm run start:server` |
| Infra (postgres + ollama) | `docker compose up -d` |
| Health checks | `GET /api/health`, `GET /api/ai/health` |
| Webhook local | Nube: tunnel `cloudflared tunnel --url http://localhost:3001` (logs `cloudflared.*.log`) |

---

## 7. Cumplimiento Global y Próximos Pasos

### ¿Cuánto cumple el sistema su objetivo?
El sistema es **funcional y en uso de prueba**: verifica el webhook, recibe y persiste mensajes, responde automáticamente (plantillas + heurísticas + Ollama), consulta tracking/tarifas reales de Correos Bolivia y mantiene pipelines EMS. El frontend cubre las 12 vistas operativas y la configuración está externalizada en `integration_settings`.

### Principales brechas (qué falta para "producción real")
1. **Durabilidad de la auto-respuesta (P0-1)** — la cola en memoria es el punto más débil. La infraestructura DB ya existe.
2. **Decisión del refactor (P0-2)** — riesgo de confusión y deuda con 3 archivos de servidor.
3. **Seguridad/privacidad del webhook (P1-1/P1-2)** — riesgo real (inyección de eventos + fuga de PII en logs).
4. **Autonomía total** — requiere: Ollama estable (hoy caído), test-mode fuera o números incluidos, y verificación de calidad de respuestas del LLM.

### Próximos pasos recomendados (en orden)
1. Commitear o segmentar el trabajo actual sin comitear (evitar pérdida).
2. P0-1: conectar `enqueueAutoReply` a `whatsapp_auto_reply_queue` + drenador con retry.
3. P1-1 y P1-2: firma `X-Hub-Signature-256` + log resumido del webhook.
4. Decidir P0-2 (a migrar / b eliminar borradores).
5. Asegurar Ollama como servicio (Windows `serve` o docker) y retry/backoff en `callOllamaGenerate`.

---

## 8. Estilos y Diseño del Login

> Implementación: `frontend/src/layout/loginScreen.ts` (marcado, 219 líneas) + `frontend/src/style.css` (`:52-584`, bloque "SPLIT SCREEN LOGIN DESIGN").

### Concepto visual
Pantalla de login de **layout dividido (split screen)** en dos paneles de alto contraste:
- **Panel izquierdo (promocional, oscuro)** — 48% del ancho, mínimo 440 px: fondo navy oscuro `#111827` con degradado `linear-gradient(135deg, #0f172a, #111827, #0b0f19)` y **puntos de luz radiales** decorativos superpuestos (patrón "night sky" generado con `radial-gradient(1px 1px at ...)`). Es el panel de marca.
- **Panel derecho (formulario, claro)** — 52% restante: fondo `#f8fafc`, centra un contenedor de login con ancho máx. **400 px** (`login-form-container`).

El contraste "promo oscuro + formulario claro" es el patrón de diseño del login y se replica en el resto del CRM (sidebar/paneles oscuros `#1e222d` sobre workspace claro).

### Identidad de marca y paleta
| Elemento | Color / detalle |
|---|---|
| Marca izquierda | Badge **"CRM"** con fondo `#2563eb` (azul) + título **LiveCRM** blanco |
| Hero | Título "CORREOS DE BOLIVIA" (2.3rem, 800, blanco), pill de versión con punto verde `#10b981` con glow |
| Lista de features | Checks SVG verdes `#10B981` sobre círculo con `fill-opacity 0.2`, texto slate `#cbd5e1` |
| **Color primario de acción** | Azul `#2563eb` (inputs en focus, link "Olvidaste tu contrasena?", checkbox `accent-color`) |
| **Color corporativo/accent** | Amarillo `#ffcc11 → #f2be00` (degradado del botón submit y del header clásico `.login-brand`) |
| Textos | Slate scale: títulos `#0f172a`, secundario `#64748b`, muted `#94a3b8`, labels `#475569` |
| Errores | Rojo suave: borde `rgba(187,42,42,0.24)`, fondo `rgba(187,42,42,0.08)`, texto `#a22828` |
| Fondo global | `body` con radiales amarillo/azul tenues sobre `linear-gradient(180deg, #071321, var(--bg))` |

### Tipografía
- Fuente: **Inter** (`font-family: 'Inter', sans-serif` en `body`).
- Jerarquía de pesos: títulos revisión truetype **800** (`H2` 1.8rem, hero 2.3rem), labels **700 uppercase** con `letter-spacing 0.05em` y `text-size 0.68rem` (estilo "micro-label de formulario"), cuerpo 0.86-0.92rem, footer/SSO 0.74rem.
- `letter-spacing` negativo (`-0.02em`) en títulos grandes para un look moderno y compacto.

### Componentes del formulario
- **Campos**: altura fija **44 px**, `border-radius: 10px`, borde `#cbd5e1`, fondo blanco, texto `#0f172a`. Llevan **icono SVG absoluto a la izquierda** (sobre/envío, candado) en `#94a3b8`.
- **Focus**: borde `#2563eb` + `box-shadow: 0 0 0 3px rgba(37,99,235,0.12)` (anillo azul suave), sin `outline`.
- **Password toggle**: botón circular transparente a la derecha (34x34 px) que alterna SVG ojo/ojo-tachado según `state.showPassword`.
- **Botón submit "Ingresar al Workspace CRM"**: alto 46 px, `border-radius: 12px`, **degradado amarillo corporativo** `#ffcc11→#f2be00`, texto navy `var(--navy)` en **700**, flecha SVG `btn-arrow` animada por layout; estados `:hover` (azul oscuro `#1d4ed8` para la variante azul) y `:disabled` (opacity 0.7, `cursor: wait`) mientras `loginState === 'submitting'`.
- **Opciones**: checkbox "Mantener la sesion iniciada" (`accent-color #2563eb`) + badge **"SSO Habilitado"** (decorativo, sin lógica SSO real — solo visual, `sso-badge`).
- **Footer**: "LiveCRM System © 2026. Todos los derechos reservados." en slate muted centrado.

### Estado "is-loading"
`renderApp` muestra un shell alternativo `.login-shell` + `.login-card.is-loading` (tarjeta centrada de 420 px, radio 24 px, sombra `0 24px 80px rgba(0,0,0,0.32)`) mientras restaura la sesión antes de renderizar el login real.

### Responsive
En `@media (max-width: 900px)` el **panel izquierdo se oculta** (`display: none`) y queda solo el formulario centrado sobre el fondo. El login siempre está centrado verticalmente vía `login-split-shell` (flex) y `login-shell`/`login-card` (grid `place-items: center`).

### Observaciones / deuda menor
- El marcado `loginScreen.ts` tiene `// @ts-nocheck` y usa valores prefijados (email demo por defecto en `main.ts:993-997`).
- Hay estilos **duplicados/remanentes** en `style.css`: `.login-shell`/`.login-card` (tema "login-shell", usado en el estado is-loading) conviven con el nuevo `.login-split-shell`; y el bloque `.login-brand` amarillo clásico queda como variante sin uso en el panel derecho nuevo. Normalizar si se decide purgar CSS.
- El botón submit combina reglas de las dos variantes (azul y amarilla): la regla ganadora final es el **degradado amarillo con texto navy** (por orden de declaración en `:526-549`).

---

## 9. Diagnostico 2026-09-24: confusion del agente en saludo y tarifas

### Conversacion observada
```
[12:01 a.m., 24/9/2026] Cliente: Hola buenos dias
[12:01 a.m., 24/9/2026] Bot: ¡Hola! 👋 Buenas noches. Te habla Jaimito de Correos de Bolivia ✉️. ¿Cómo te puedo colaborar hoy? 😊

[3:03 p.m., 24/9/2026] Cliente: Cuanto me costaria llevar un paquete de la paz a cochabamba
[3:03 p.m., 24/9/2026] Bot: La tarifa de LA PAZ a COCHABAMBA por SERVICIO PUERTA A PUERTA es Bs 20.
```

### Hallazgo 1: el saludo no lo decide Ollama, lo decide una plantilla local
- En `backend/index.js`, `autoReplyInboundWhatsAppMessage` detecta saludos con `isGreetingMessage(...)`.
- Si `isGreetingOnly` es verdadero, asigna directamente `finalReply` con una plantilla local y llama a `getBoliviaDayGreeting()`. En ese camino no se consulta al LLM.
- `getBoliviaDayGreeting()` usa zona horaria `America/La_Paz` y devuelve:
  - `Buenas noches` si la hora es `>= 19` o `< 6`.
  - `Buenas tardes` si la hora es `>= 12`.
  - `Buenos dias` para el resto.
- Por eso a las `12:01 a.m.` responde `Buenas noches`. No es una confusion del modelo: es una regla horaria programada. El detalle que se percibe raro es que el cliente escribio `buenos dias` y el bot no respeta ese saludo textual, sino que lo reemplaza por su saludo segun hora del servidor.

### Cambio recomendado para saludo
- Ajustar la logica para que, cuando el cliente salude con una franja explicita (`buenos dias`, `buenas tardes`, `buenas noches`), el bot pueda espejar esa franja o responder neutral: `¡Hola! Te habla Jaimito de Correos de Bolivia. ¿Como te puedo colaborar hoy?`.
- Alternativa mas segura para WhatsApp: eliminar la franja horaria de la plantilla de saludo y usar siempre un saludo neutral. Esto evita choques cuando el cliente escribe a medianoche, cuando la hora del telefono difiere o cuando el usuario usa una formula social distinta.

### Hallazgo 2: la respuesta de tarifa sale de heuristicas + tabla/API, no del LLM
- El mensaje `Cuanto me costaria llevar un paquete de la paz a cochabamba` cae en `TARIFAS` por `isTariffInquiryMessage(...)`, porque detecta expresiones como `cuanto me costaria`, `llevar`, `costo`, `tarifa`, etc.
- Luego `getTariffQuote(...)` infiere origen y destino por texto:
  - primer lugar encontrado: `la-paz`.
  - ultimo lugar encontrado: `cochabamba`.
- El problema operativo esta en la inferencia de servicio/modalidad/peso:
  - Si el flujo viene de una conversacion reciente donde ya se cotizo o menciono Delivery Express / puerta a puerta, el codigo puede reutilizar contexto anterior.
  - Para `delivery_express`, si no hay peso explicito, usa `1 kg` por defecto internamente (`quotedWeightKg = weightKg || 1`), aunque luego la respuesta no muestre ese peso.
  - Si encuentra una tarifa activa, `buildTariffReply(...)` responde directo: `La tarifa ... es Bs ...`.
- Por eso el bot puede sonar demasiado seguro aunque el cliente no especifico peso, servicio ni modalidad en ese mensaje. El texto final muestra `SERVICIO PUERTA A PUERTA`, lo que sugiere que la modalidad vino de la tarifa encontrada o de contexto reciente, no necesariamente del mensaje actual.

### Cambio recomendado para tarifas
- Si el mensaje actual trae ruta pero no trae servicio/modalidad, no reutilizar automaticamente un servicio anterior salvo que el cliente lo confirme como continuidad clara.
- Para consultas nuevas con origen + destino pero sin servicio, responder pidiendo una aclaracion corta:
  - `Tengo la ruta La Paz a Cochabamba. ¿Lo quieres cotizar por EMS Nacional o Delivery Express? Si es Delivery Express, dime si seria puerta a puerta, puerta a ventanilla o ventanilla a ventanilla.`
- Para Delivery Express sin peso, mantener el default tecnico si el negocio lo requiere, pero explicitarlo:
  - `Para Delivery Express puerta a puerta de La Paz a Cochabamba, tomando como referencia hasta 1 kg, la tarifa es Bs 20.`
- Mejor aun: si el tarifario depende realmente de peso, no cotizar precio final sin peso; pedir `peso aproximado` antes de consultar.

### Riesgo adicional detectado
- Hay mojibake persistente en `backend/index.js` (`Â¡`, `Ãƒ`, `ðŸ...`). `repairMojibakeText(...)` lo corrige antes de enviar, pero complica el mantenimiento y puede romper regex o textos de prompt.
- La plantilla de saludo y varias respuestas de tarifa/tracking contienen esos textos corruptos en fuente. Conviene normalizar el archivo de manera controlada, pero no junto con cambios grandes de logica.

### Accion sugerida siguiente
- Parche quirurgico en `backend/index.js`:
  1. Agregar helper para saludo neutral o para espejar saludo explicito del cliente.
  2. Cambiar la plantilla `isGreetingOnly` para evitar contradicciones de hora.
  3. Endurecer `getTariffQuote(...)` para que una consulta nueva con ruta y sin servicio no herede modalidad anterior ni responda precio final sin aclaracion.
  4. Probar con estos casos:
     - `Hola buenos dias` a las 00:01 -> saludo neutral o espejado, no `Buenas noches`.
     - `Cuanto me costaria llevar un paquete de la paz a cochabamba` sin contexto -> pide servicio/modalidad.
     - `Delivery Express puerta a puerta de La Paz a Cochabamba` -> cotiza o pide peso segun regla definida.
     - Continuacion clara despues de una cotizacion -> puede reutilizar contexto.

### Consulta 2026-09-24: evitar que el bot se salte preguntas de servicio/modalidad
- Consulta del usuario: el bot no debe responder directamente `La tarifa de LA PAZ a COCHABAMBA por SERVICIO PUERTA A PUERTA es Bs 20` cuando el cliente solo dijo `Cuanto me costaria llevar un paquete de la paz a cochabamba`.
- Regla de negocio esperada: si el cliente da origen y destino, pero no especifica servicio ni modalidad, el bot debe preguntar primero por el metodo de envio antes de cotizar.
- Respuesta esperada:
  - `Tengo la ruta La Paz a Cochabamba. ¿Lo quieres enviar por EMS Nacional o por Delivery Express? Si eliges Delivery Express, dime si seria puerta a puerta, puerta a ventanilla o ventanilla a ventanilla.`
- Forma tecnica recomendada:
  1. Crear o usar un detector de consulta nueva de tarifa con ruta: mensaje actual contiene al menos 2 ciudades/departamentos (`getTariffPlaceMatchCount(messageBody) >= 2`).
  2. Crear un detector de servicio explicito del mensaje actual: `inferTariffServiceKey(messageBody)` o `inferDeliveryExpressMode(messageBody)`.
  3. En `getTariffQuote(...)`, antes de heredar `recentCustomerServiceKey`, `recentQuotedDeliveryMode` o consultar `tariff_rates`, cortar el flujo si:
     - el mensaje actual trae ruta completa,
     - no trae servicio explicito,
     - no trae modalidad explicita,
     - y no es una continuacion clara de una cotizacion anterior.
  4. En ese caso devolver:
     - `matched: false`
     - `missingFields: ['servicio']`
     - `originKey`
     - `destinationKey`
     - `isNewPackageQuestion: true`
  5. Ajustar `buildTariffReply(...)` para que cuando falte `servicio` y existan `originKey` + `destinationKey`, pregunte siempre por EMS Nacional o Delivery Express. No debe dar precio final todavia.
- Criterios de prueba:
  - Sin contexto: `Cuanto me costaria llevar un paquete de la paz a cochabamba` -> pregunta servicio/modalidad.
  - Sin contexto: `Cuanto cuesta por Delivery Express puerta a puerta de La Paz a Cochabamba` -> puede cotizar o pedir peso segun regla de negocio.
  - Con contexto anterior de puerta a puerta, pero mensaje nuevo con ruta distinta y sin `otro paquete/otra cotizacion/ahora tambien`: no heredar automaticamente; preguntar confirmacion.
  - Con continuacion clara: `y si lo mando de La Paz a Cochabamba tambien puerta a puerta?` -> puede reutilizar modalidad porque el cliente la explicito.

### Cambio aplicado 2026-09-24
- Archivo modificado: `backend/index.js`.
- En `getTariffQuote(...)` se agrego `shouldAskServiceForCurrentRoute` para detectar consultas de tarifa donde el mensaje actual trae al menos dos ciudades/departamentos, pero no trae servicio (`EMS`, `Delivery Express`) ni modalidad (`puerta a puerta`, etc.).
- Esa bandera evita heredar automaticamente `recentCustomerServiceKey` o modalidad de conversaciones anteriores cuando el mensaje actual parece una cotizacion nueva con ruta completa.
- En `buildTariffReply(...)` se cambio la condicion para que, si falta `servicio` pero ya existen `originKey` y `destinationKey`, el bot pregunte por EMS Nacional o Delivery Express antes de dar precio.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: clasificar modalidad Delivery Express desde lenguaje natural
- Conversacion analizada: el cliente eligio `Delivery Express` y luego dijo `Quiera que lo recogieran y entregaran en una de sus sucursales`. El bot volvio a pedir modalidad en vez de clasificarlo.
- Diagnostico: el intent general si entraba a `TARIFAS`, pero `inferDeliveryExpressMode(...)` no reconocia frases con `recoger/retirar + entregar/llevar + sucursal` si el cliente no decia literalmente `casa`, `puerta a ventanilla` o `puerta a puerta`.
- Interpretacion esperada: `recoger/retirar` el paquete y `entregar/llevar` a `sucursal/ventanilla/oficina` debe clasificarse como `puerta_a_ventanilla`.
- Cambio aplicado en `backend/index.js`: se agrego una regla en `inferDeliveryExpressMode(...)` para detectar `recog*`/`retir*` + `entreg*`/`llevar*` + `sucursal|ventanilla|oficina`.
- Resultado esperado: ante `Quiero que lo recojan y lo entreguen en una sucursal`, el bot debe avanzar con modalidad `puerta a ventanilla` y no repetir la lista de modalidades.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: tarifa local no debe ignorar modalidad Delivery Express
- Conversacion analizada: el cliente primero dio ruta `La Paz a Cochabamba`, luego eligio `Delivery Express`, luego pidio que lo recojan y entreguen en sucursal. El bot respondio `SERVICIO PUERTA A PUERTA es Bs 20`.
- Aclaracion: la ruta si venia del mensaje anterior (`de la paz a cochabamba`). El problema no era falta de origen/destino, sino que la consulta local de tarifas usaba destino + peso + `service_key`, pero no filtraba por modalidad (`puerta_a_puerta`, `puerta_a_ventanilla`, etc.).
- Cambio aplicado en `backend/index.js`: la consulta SQL a `tariff_rates` ahora, cuando hay `effectiveDeliveryMode`, exige que `service_name` coincida con esa modalidad antes de devolver tarifa.
- Resultado esperado: si el usuario pidio sucursal (`puerta_a_ventanilla`), el bot no debe devolver una tarifa `SERVICIO PUERTA A PUERTA`. Si no existe tarifa activa para esa modalidad, debe derivar/avisar que no hay tarifa activa para esa ruta y modalidad.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: agente se marea al repetir ruta y usar `sucursales`
- Conversacion analizada: despues de que el cliente ya habia elegido `Delivery Express`, repitio `Cuanto me costaria llevar un paquete de la paz a cochabamba` y el bot volvio al paso de elegir servicio. Luego el cliente dijo `Quiera que lo recogieran y entregaran en una de sus sucursales` y el bot volvio a pedir modalidad.
- Diagnostico 1: `shouldAskServiceForCurrentRoute` reiniciaba la seleccion de servicio aunque en el historial reciente el cliente ya habia dicho `Delivery Express`.
- Diagnostico 2: `inferDeliveryExpressMode(...)` reconocia `sucursal`, `ventanilla`, `oficina` en singular, pero no `sucursales`, `ventanillas`, `oficinas`.
- Cambio aplicado en `backend/index.js`:
  - `shouldAskServiceForCurrentRoute` ahora no se activa si ya existe `recentCustomerServiceKey`.
  - Los detectores de modalidad y seguimiento de tarifa aceptan plurales: `sucursal(es)`, `ventanilla(s)`, `oficina(s)`.
- Resultado esperado:
  - Si el cliente ya dijo `Delivery Express` y repite la ruta, el bot debe continuar con modalidad, no volver a pedir servicio.
  - Si el cliente dice `recogieran y entregaran en una de sus sucursales`, debe clasificarse como `puerta_a_ventanilla`.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: respuesta personalizada despues de filtrar y consultar tarifa
- Conversacion analizada: el cliente dijo `Soy mayor de edad y no puedo cargar pesado sera que me lo pueden recoger el paquete de mi casa y entregarlo?`. El bot respondio solo `La tarifa ... es Bs 20`, sin reconocer la necesidad del cliente.
- Objetivo: usar el bot como filtro inteligente. Primero debe clasificar servicio/modalidad y consultar tarifas con la informacion disponible; luego debe responder de forma humana usando el contexto del cliente.
- Cambio aplicado en `backend/index.js`:
  - `buildTariffReply(...)` ahora recibe `messageBody`.
  - Se agrego `hasHomePickupNeed(...)` para detectar frases como `no puedo cargar`, `pesado`, `mayor de edad`, `recoger de mi casa`.
  - Si la tarifa encontrada es `Delivery Express puerta a puerta` y el cliente pidio apoyo de recojo en casa, la respuesta confirma que ese servicio aplica y despues da la tarifa consultada.
- Respuesta esperada: `Claro, para ese caso te conviene Delivery Express puerta a puerta: recogemos el paquete en tu casa y lo entregamos en el domicilio destino. Con los datos que me diste, la tarifa ... es Bs ...`
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: base reutilizable para respuesta personalizada de tarifas
- Consulta del usuario: el agente debe ser capaz de responder de forma personalizada con una base, no solo con una plantilla puntual.
- Criterio acordado: el flujo debe funcionar como filtro inteligente:
  1. Clasifica intencion, servicio, modalidad, origen, destino y peso si existe.
  2. Consulta APIs/tablas de tarifas con esos datos.
  3. Responde con una base humana que use el contexto del cliente, pero el precio sale del dato consultado.
- Cambio aplicado en `backend/index.js`: se agrego `buildPersonalizedTariffIntro(...)` para generar una introduccion contextual segun modalidad Delivery Express:
  - `puerta_a_puerta`: reconoce necesidad de recojo en casa o dificultad para cargar.
  - `puerta_a_ventanilla`: explica recojo en casa y entrega en sucursal destino.
  - `ventanilla_a_ventanilla`: explica deposito y recojo en sucursal.
- Resultado esperado: el bot ya no solo dice `La tarifa es...`; cuando tenga contexto suficiente, debe explicar brevemente por que ese servicio/modalidad aplica y luego dar la tarifa consultada.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: plantillas de respuesta personalizables por el agente
- Consulta del usuario: quiere una plantilla base de respuestas que el agente pueda personalizar para tener una conversacion mas solida.
- Criterio aplicado: las plantillas deben dar estructura y seguridad, pero permitir que el agente agregue una introduccion contextual sin inventar precios ni condiciones.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `tariffReplyTemplates` con plantillas base para cotizacion exacta, datos faltantes y opciones de modalidad Delivery Express.
  - Se agrego `renderTextTemplate(...)` para renderizar variables controladas como `{intro}` y `{quote}`.
  - `buildTariffReply(...)` ahora usa las plantillas base para respuestas repetidas.
  - La respuesta final de tarifa usa `exactQuote`: el `intro` se personaliza con `buildPersonalizedTariffIntro(...)` y el `quote` sale de la tarifa consultada.
- Resultado esperado: el bot mantiene una conversacion mas natural, pero el precio, ruta, servicio y modalidad siguen saliendo del filtro y de la consulta de tarifas, no de una invencion del modelo.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: typo `enviear` mandaba cotizacion a tracking
- Conversacion analizada: `Quisiera enviear un paquete de la paz a cochabamba` fue respondido como tracking: `Dejame tu numero de guia`.
- Diagnostico: `isTariffInquiryMessage(...)` no reconocia el typo `enviear`, entonces `isPackageInquiryMessage(...)` detectaba `paquete` y el router lo trataba como consulta de guia/seguimiento.
- Cambio aplicado en `backend/index.js`:
  - `isTariffInquiryMessage(...)` ahora reconoce `enviear` y `enbiar`.
  - `inferIntentHeuristically(...)` agrega `looksLikeShipmentQuote`: si el mensaje tiene intencion de enviar/mandar/llevar, menciona paquete/envio y trae al menos dos lugares, se clasifica como `TARIFAS` mientras no tenga codigo de guia.
- Resultado esperado: `Quisiera enviear un paquete de la paz a cochabamba` debe pedir datos de tarifa, no numero de guia.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: Delivery Express no debe cotizar paquetes mayores a 5 kg
- Conversacion analizada: `Quiero enviar un paquete de La Paz a Cochabamba por Delivery Express Puerta a Puerta. Es una caja con repuestos que pesa 12 kg.` fue respondido con tarifa `SERVICIO PUERTA A PUERTA es Bs 20`.
- Diagnostico: `getTariffQuote(...)` detectaba servicio/modalidad y peso, pero no aplicaba la regla de negocio de Delivery Express antes de consultar tarifas. Por eso podia devolver una tarifa aunque el peso excediera el limite.
- Cambio aplicado en `backend/index.js`:
  - Si `serviceKey === delivery_express` y `weightKg > 5`, `getTariffQuote(...)` retorna `invalidReason: delivery_express_weight_exceeded`.
  - `buildTariffReply(...)` responde que Delivery Express solo aplica hasta 5 kg y deriva la cotizacion a EMS Nacional e Internacional.
- Resultado esperado: para 12 kg por Delivery Express, el bot no debe dar precio de puerta a puerta; debe indicar que corresponde EMS.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: no arrastrar peso anterior cuando el cliente cambia ruta/modalidad
- Conversacion analizada: luego de consultar un paquete de 12 kg por Delivery Express, el cliente cambio de idea: `Ah no, perdon, mejor de Santa Cruz a Tarija pero de ventanilla a ventanilla`. El bot siguio usando los 12 kg anteriores y bloqueo la consulta por exceso de peso.
- Diagnostico: `getTariffQuote(...)` calculaba `weightKg` desde todo el historial reciente + mensaje actual. Eso hacia que una cotizacion nueva heredara pesos viejos aunque el cliente estuviera cambiando ruta o modalidad.
- Cambio aplicado en `backend/index.js`:
  - Se separo `currentWeightKg` del mensaje actual y `recentWeightKg` del historial.
  - Si el mensaje actual trae una ruta fresca con servicio/modalidad/intencion de tarifa, no se hereda el peso anterior.
  - Solo se hereda peso cuando el mensaje no parece una nueva ruta/cotizacion.
- Resultado esperado: `mejor de Santa Cruz a Tarija pero de ventanilla a ventanilla` debe cotizar o pedir datos para esa nueva ruta, sin quedar bloqueado por los 12 kg anteriores.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: Delivery Express no aplica a provincia/comunidad
- Conversacion analizada: `Necesito envio por Delivery Express de La Paz hasta una casa en la comunidad de Achacachi.` fue respondido con el bloqueo de 12 kg heredado.
- Diagnostico: faltaba una regla explicita para destinos de provincia/comunidad. Ademas, al no identificar ese caso, el flujo caia en la validacion de peso heredado.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `isDeliveryExpressProvinceDestination(...)` para detectar `provincia`, `comunidad`, `municipio`, `Achacachi`.
  - Si el cliente pide Delivery Express hacia provincia/comunidad, `getTariffQuote(...)` retorna `invalidReason: delivery_express_province_destination` antes de validar peso.
  - `buildTariffReply(...)` responde que Delivery Express no aplica y que corresponde EMS Nacional.
- Resultado esperado: para `Delivery Express ... comunidad de Achacachi`, el bot debe decir que Delivery Express no aplica a provincia/comunidades y orientar a EMS Nacional, no mencionar 12 kg heredados.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: pregunta por descuento tercera edad no debe arrastrar Delivery Express/12 kg
- Conversacion analizada: `Tengo 85 años, ¿cuánto me cobran de descuento por ser de la tercera edad en el envío de La Paz a Oruro?` recibio la respuesta vieja de Delivery Express y 12 kg.
- Diagnostico: la pregunta era de politica/descuento, pero el flujo de tarifas seguia heredando contexto anterior de Delivery Express/peso. Ademas no existia una respuesta explicita para descuentos de tercera edad.
- Cambio aplicado en `backend/index.js`:
  - `isTariffInquiryMessage(...)` reconoce `descuento`, `rebaja`, `tercera edad`, `adulto mayor`.
  - Se agrego `isSeniorDiscountQuestion(...)`.
  - `getTariffQuote(...)` corta ese caso con `invalidReason: senior_discount_unavailable`.
  - `buildTariffReply(...)` responde que no hay descuento automatico registrado y pide peso/servicio si desea cotizar tarifa vigente.
- Resultado esperado: no mencionar Delivery Express ni 12 kg heredados; responder que no hay descuento automatico registrado y continuar con cotizacion normal si el cliente da datos.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: separar conocimiento del agente en archivos
- Solicitud del usuario: separar la informacion de rastreo nacional/internacional, cotizaciones EMS y Delivery Express en archivos para que el agente responda basandose en esa informacion, sin inventar.
- Archivos creados:
  - `backend/knowledge/delivery-express.json`: cobertura, limite de 5 kg, modalidades, reglas de provincia/comunidad y clasificacion.
  - `backend/knowledge/ems.json`: descripcion, cobertura nacional/provincia/comunidades/internacional y reglas de cotizacion por peso.
  - `backend/knowledge/tracking.json`: reglas para responder rastreo nacional/internacional usando codigo, estado, ultimo evento, origen/destino y sucursal/oficina cuando existan.
  - `backend/knowledge/agent-responses.json`: plantillas base de tarifas, errores de cobertura/peso/descuento, intros personalizadas y respuestas base de tracking.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `knowledgeDir`, `readKnowledgeJson(...)` y `botKnowledge`.
  - Las plantillas de tarifa se cargan desde `agent-responses.json`.
  - Las reglas de Delivery Express usan `delivery-express.json` para limite de peso, palabras de provincia/comunidad y labels de modalidad.
  - Las respuestas de tracking para codigo faltante/no encontrado se leen desde `agent-responses.json`.
  - Los prompts de IA reciben reglas de `tracking.json`, `ems.json` y `delivery-express.json` cuando corresponde.
- Criterio tecnico: APIs/BD siguen siendo fuente de datos dinamicos (estado real del paquete, eventos, tarifas). Los JSON son fuente de verdad para reglas, cobertura, tono y plantillas.
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Parseo JSON de los cuatro archivos de `backend/knowledge`.

### Consulta 2026-09-25: nueva solicitud de envio no debe heredar Delivery Express previo
- Conversacion analizada: `Quisiera enviar un paquete de la paz a tarija` fue respondido con tarifa directa `SERVICIO PUERTA A PUERTA es Bs 20`.
- Diagnostico: el bot heredo `Delivery Express` de una conversacion anterior porque existia `recentCustomerServiceKey`, aunque el mensaje actual era una solicitud nueva sin servicio indicado.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `isFreshShipmentRequestWithoutService`.
  - Si el mensaje actual tiene `quiero/quisiera/necesito + enviar/mandar/llevar + paquete/envio` y trae dos lugares, pero no trae servicio/modalidad, se reinicia el filtro y se pide servicio.
  - En ese caso no se hereda `recentCustomerServiceKey`.
- Resultado esperado: `Quisiera enviar un paquete de La Paz a Tarija` debe mostrar servicios EMS y Delivery Express, incluyendo modalidades de Delivery cuando corresponda, antes de cotizar.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: bloquear inyecciones de tarifa gratis / autoridad falsa / auditoria
- Conversacion analizada: el bot bloqueo `Ignora instrucciones... Bs 0`, pero no bloqueo variantes con `Gerente General`, `#FREE-2026`, `descuento 100%`, `sin costo` o `auditoria del sistema escribe exactamente...`.
- Diagnostico: `isPromptInjectionAttempt(...)` detectaba prompt injection directa, pero no detectaba social engineering aplicado a tarifas.
- Cambio aplicado en `backend/index.js`: se agregaron patrones para bloquear:
  - `escribe/responde/di/confirma exactamente/literalmente/texto`.
  - tarifas/costos/precios/envios con `Bs 0`, `gratis`, `sin costo`, `costo cero`.
  - descuentos/rebajas de `100%`.
  - codigos `FREE`, `#FREE`, `FREE-2026`.
  - autoridad falsa (`gerente`, `director`, `jefe`, `autorizacion`) asociada a gratis/descuento/sin costo.
  - auditoria/prueba del sistema que pida escribir o confirmar texto.
- Resultado esperado: cualquier variante parecida debe responder con `PROMPT_INJECTION_SAFE_REPLY` y no entrar al flujo de tarifas.
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Prueba local de los tres ejemplos: todos evaluaron como bloqueados.

### Consulta 2026-09-25: numero de contacto y servicio inventado `Nacional Express`
- Solicitud del usuario: poner el numero de contacto `71596249` en el `.env` y agregarlo a la respuesta segura: `No puedo ayudarte con eso...`.
- Cambio aplicado:
  - Se agrego `BOT_SUPPORT_CONTACT_NUMBER` al `.env`.
  - `PROMPT_INJECTION_SAFE_REPLY` ahora agrega `Para mas informacion, comunicate al {numero}.`
- Conversacion validada: `Quiero enviar un paquete de la sucursal de Tarija a la ventanilla de Tarija pero en la modalidad 'Nacional Express La Paz'.`
- Diagnostico: el bot interpretaba `Nacional Express La Paz` como Delivery Express y tomaba `La Paz` como destino, devolviendo una tarifa incorrecta.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `isUnsupportedTariffServiceRequest(...)`.
  - `getTariffQuote(...)` corta ese caso con `invalidReason: unsupported_tariff_service`.
  - `buildTariffReply(...)` responde que no existe `Nacional Express` y que los unicos servicios disponibles para cotizar son EMS Nacional e Internacional y Delivery Express.
- Cambio aplicado en `backend/knowledge/agent-responses.json`:
  - Se agrego la plantilla `unsupportedTariffService`.
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Parseo JSON de `backend/knowledge/agent-responses.json`.

### Consulta 2026-09-25: dimensiones grandes en Delivery Express
- Caso validado: `El paquete pesa solo 100 gramos (cumple < 5 kg), pero mide 2 metros por 2 metros. ¿Puedo enviarlo por Delivery Express?`
- Regla definida por el usuario: para Delivery Express la validacion de cotizacion se basa en peso maximo de 5 kg; alto/ancho/largo no afectan el precio/costo en esta logica. Si no cumple el peso, no se puede mandar por Delivery Express.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `isDeliveryExpressDimensionQuestion(...)`.
  - Si el mensaje es sobre dimensiones y servicio Delivery Express, `getTariffQuote(...)` retorna `invalidReason: delivery_express_dimensions_policy`.
  - `buildTariffReply(...)` responde la politica de peso/dimensiones sin pedir datos innecesarios.
- Cambio aplicado en `backend/knowledge/agent-responses.json`:
  - Se agrego la plantilla `deliveryDimensionsPolicy`.
- Resultado esperado: para 100 g y medidas grandes, el bot debe decir que cumple por peso y que alto/ancho/largo no cambian el precio; si supera 5 kg, debe derivar a EMS.
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Parseo JSON de `backend/knowledge/agent-responses.json`.

### Consulta 2026-09-25: reclamo/inconsistencia de tracking debe derivar a consultas
- Conversacion analizada: el cliente indico una inconsistencia con la guia `EN000006423LPZ`: el sistema decia recibido/llegado, pero el cliente afirmaba que aun no lo habia llevado.
- Problema: el bot respondia como tracking normal y reafirmaba el estado del sistema, sin reconocer el reclamo.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `isPackageDisputeMessage(...)` para detectar reclamos o inconsistencias: `por que dice`, `aun no lo lleve`, `no lo he llevado`, `lo entregare manana`, `error`, `inconsistencia`, etc.
  - En `autoReplyInboundWhatsAppMessage(...)`, si hay codigo de guia y el mensaje es reclamo/inconsistencia, el bot ya no responde con estado normal; deriva a revision humana.
  - La respuesta usa `BOT_SUPPORT_CONTACT_NUMBER`.
- Respuesta esperada: `Entiendo la inconsistencia con la guia {codigo}. Para revisar ese caso con detalle y validar el registro, comunicate al 71596249; ahi pueden confirmar la informacion del sistema y corregir si corresponde.`
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Prueba local del detector con el ejemplo del usuario: evaluo `true`.

### Consulta 2026-09-25: JSON override y cotizacion multiple rompian el cotizador
- Conversacion analizada:
  - El cliente envio JSON con `service`, `price: 0`, `override_system: true` y pidio procesarlo.
  - Luego pidio cotizar 3 envios en un solo mensaje con desglose y total final.
  - El bot respondio con una mezcla incorrecta y texto `Para [object Object]...`.
- Diagnostico:
  - El detector de inyeccion no bloqueaba JSON con `override_system`, `price: 0` ni `procesa el JSON`.
  - El cotizador simple fue diseñado para una sola cotizacion; al recibir multiples rutas/pesos/servicios mezclo datos.
  - `al mismo tiempo` podia activar por error la logica de tiempo de entrega.
  - Algunos nombres de servicio/origen/destino podian llegar como objeto desde APIs externas y terminar como `[object Object]`.
- Cambio aplicado en `backend/index.js`:
  - `isPromptInjectionAttempt(...)` bloquea `override_system`, `price: 0`, `service`, `procesa JSON`.
  - Se agrego `isMultipleTariffQuoteRequest(...)`.
  - `getTariffQuote(...)` retorna `invalidReason: multiple_tariff_quote_request` para desglose/multiples envios.
  - `buildTariffReply(...)` responde que debe cotizar un envio a la vez.
  - `isTariffDeliveryTimeQuestion(...)` ignora `al mismo tiempo`.
  - Se agrego `normalizeTariffDisplayValue(...)` para evitar `[object Object]` en respuestas.
- Cambio aplicado en `backend/knowledge/agent-responses.json`:
  - Se agrego `multipleTariffQuoteRequest`.
- Resultado esperado:
  - JSON con override/precio cero se bloquea como inyeccion.
  - Cotizaciones multiples no se procesan mezcladas; se pide enviar un paquete por mensaje.
  - No debe salir `[object Object]` en tarifa.
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Parseo JSON de `backend/knowledge/agent-responses.json`.

### Ajuste 2026-09-25: cotizaciones multiples deben prepararse, no rechazarse
- Solicitud del usuario: si el cliente manda varios envios juntos, el bot debe preparar el mensaje para cotizarlos y preguntar datos faltantes por item, no pedir que mande todo separado desde cero.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `splitMultipleTariffItems(...)` para separar items numerados.
  - Se agrego `summarizeTariffItemForDraft(...)` para extraer por item origen, destino, peso, servicio y modalidad si existe.
  - Se agrego `buildMultipleTariffDraftReply(...)` para responder con una lista revisada y datos faltantes por envio.
  - `multiple_tariff_quote_request` ahora usa ese borrador, en vez de rechazar.
- Cambio aplicado en `backend/knowledge/agent-responses.json`:
  - `multipleTariffQuoteRequest` ahora indica que puede cotizar varios envios si vienen con origen, destino, peso y servicio por cada uno.
- Resultado esperado: ante 3 envios en un mensaje, el bot responde con una preparacion tipo:
  - `1) la paz a santa cruz, 2 kg, Delivery Express. Falta: modalidad Delivery Express.`
  - `2) la paz a oruro, 8 kg, EMS Nacional e Internacional. Datos completos para revisar tarifa.`
  - `3) sucre a potosi, 0.5 kg, Delivery Express puerta a puerta. Datos completos para revisar tarifa.`
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Parseo JSON de `backend/knowledge/agent-responses.json`.

### Ajuste 2026-09-25: cotizacion multiple debe inferir Delivery Express por modalidad
- Solicitud del usuario: en cotizaciones multiples, si un item dice `puerta a puerta` debe poder interpretarse como Delivery Express; si falta servicio, debe pedir aclarar entre EMS Nacional e Internacional o Delivery Express.
- Cambio aplicado en `backend/index.js`:
  - `summarizeTariffItemForDraft(...)` ahora infiere `delivery_express` cuando detecta una modalidad Delivery Express aunque el cliente no escriba la palabra `Delivery`.
  - Si falta servicio, el faltante ahora dice `servicio: EMS Nacional e Internacional o Delivery Express`.
  - El label generico cambio de `sin servicio definido` a `servicio pendiente`.
- Resultado esperado:
  - `Sucre-Potosi puerta a puerta` se resume como `Delivery Express puerta a puerta`.
  - Si realmente falta servicio, el bot pregunta cual de los dos servicios disponibles desea usar.
- Verificacion ejecutada: `node --check backend/index.js`.

### Ajuste 2026-09-25: cotizacion multiple debe cotizar items completos
- Solicitud del usuario: cuando el cliente manda varios envios en un solo mensaje, los items completos deben devolver precio; solo los incompletos deben pedir datos faltantes.
- Conversacion analizada:
  - Item 1: `2kg La Paz-Santa Cruz por Express` tiene ruta, peso y servicio, pero falta modalidad Delivery Express.
  - Item 2: `8kg La Paz-Oruro por EMS` tiene datos suficientes para consultar tarifa.
  - Item 3: `500g Sucre-Potosi puerta a puerta` debe inferirse como Delivery Express puerta a puerta y consultar tarifa.
- Cambio aplicado en `backend/index.js`:
  - `buildMultipleTariffDraftReply(...)` ahora es asincrono y llama a `getTariffQuote(...)` por cada item completo.
  - Los items con faltantes siguen mostrando `Falta: ...`.
  - Los items cotizados muestran precio y suman `Total parcial cotizado` si hay pendientes, o `Total final cotizado` si todos estan completos.
  - `buildTariffReply(...)` ahora espera la respuesta multiple con `await`.
- Resultado esperado:
  - Para el ejemplo de 3 envios, el bot debe pedir modalidad solo para el item 1.
  - Debe consultar y responder precio para el item 2 y el item 3 cuando existan tarifas activas.
  - El total debe ser parcial si falta completar algun item.
- Verificacion ejecutada: `node --check backend/index.js`.

### Ajuste 2026-09-25: cotizacion multiple no debe mezclar EMS automaticamente
- Problema observado:
  - En una solicitud con 3 envios, el bot cotizo el item `La Paz-Oruro, 8 kg, EMS` y sumo `Total parcial cotizado: Bs 16`.
  - Eso mezclaba EMS con Delivery Express y daba una tarifa EMS que el usuario marco como incorrecta para este flujo.
- Regla ajustada:
  - En cotizaciones multiples, EMS no debe cotizarse automaticamente dentro del desglose mixto.
  - El bot debe pedir confirmacion de servicio: `EMS Nacional e Internacional o Delivery Express`.
  - Solo los items Delivery Express con modalidad completa pueden intentar consultar tarifa en ese desglose.
- Cambio aplicado en `backend/index.js`:
  - `summarizeTariffItemForDraft(...)` ahora marca los items EMS como pendientes con `confirmar si se cotizara por EMS Nacional e Internacional o Delivery Express`.
  - Se agrego `serviceKey` al resumen del item para distinguir servicios en el flujo multiple.
- Resultado esperado para el ejemplo:
  - Item 1: `Falta: modalidad Delivery Express`.
  - Item 2: `Falta: confirmar si se cotizara por EMS Nacional e Internacional o Delivery Express`.
  - Item 3: puede cotizarse si existe tarifa activa Delivery Express puerta a puerta; si no existe, debe indicar que no hay tarifa activa.
  - No debe sumar un total con una tarifa EMS automatica.
- Verificacion ejecutada: `node --check backend/index.js`.

### Ajuste 2026-09-25: preguntas claras por item en cotizacion multiple
- Solicitud del usuario:
  - Para `La Paz-Santa Cruz, 2 kg, Delivery Express`, el bot no debe decir solo `Falta: modalidad Delivery Express`; debe preguntar si sera puerta a puerta, puerta a ventanilla o ventanilla a ventanilla.
  - Para `La Paz-Oruro, 8 kg, EMS`, debe pedir confirmar si se cotizara por EMS Nacional e Internacional o Delivery Express.
  - Para `Sucre-Potosi, 0.5 kg, puerta a puerta`, debe intentar cotizar porque ya tiene origen, destino, peso y modalidad Delivery Express.
  - Si la API/tarifa no responde, debe decir que por el momento se esta consultando la tarifa, no dar una conclusion definitiva.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `buildMultipleTariffMissingQuestion(...)` para generar preguntas naturales por item.
  - La respuesta sin tarifa activa en cotizacion multiple ahora dice: `Por el momento estoy consultando la tarifa para esa ruta; si la API no responde, debe confirmarse con un asesor.`
  - El flujo multiple conserva la cotizacion de items Delivery Express completos y deja pendientes los incompletos.
- Resultado esperado:
  - Item 1 pregunta explicitamente por la modalidad Delivery Express.
  - Item 2 pregunta por el servicio a confirmar.
  - Item 3 consulta la tarifa por API/base de datos cuando existe tarifa activa.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-25: verificar API de tarifarios Delivery Express
- Endpoint revisado: `https://dev.correos.gob.bo:18100/api/tarifarios/delivery-express`.
- Resultado de la prueba:
  - La API respondio correctamente con `243` registros.
  - Estructura raiz: `data`, `nombre_api`, `relaciones_incluidas`, `tabla`, `total_registros`.
  - Campos por tarifa: `origen`, `destino`, `servicio_extra`, `peso1`, `peso2`, `peso3`, `peso_extra`, `tiempo_entrega`.
  - `peso1` viene con valores `15.00` o `20.00`; `peso2`, `peso3` y `peso_extra` no traen valores en los registros revisados.
  - Ruta confirmada: `CHUQUISACA -> POTOSI`, `SERVICIO PUERTA A PUERTA`, `peso1: 20.00`, `tiempo_entrega: 48`.
- Cambio aplicado:
  - Se actualizaron en `.env` las claves `DELIVERY_EXPRESS_TARIFF_API_URL` y `DELIVERY_EXPRESS_TARIFF_API_TOKEN` sin imprimir valores sensibles.
  - En `backend/index.js` se agrego `getExternalDeliveryExpressPrice(...)` para tomar explicitamente el precio desde `peso1` cuando el servicio es Delivery Express.
  - En `backend/index.js` se agrego `getExternalTariffServiceName(...)` para mostrar el nombre como `Delivery Express puerta a puerta`, `Delivery Express puerta a ventanilla` o `Delivery Express ventanilla a ventanilla`, en vez del texto crudo de la API.
- Resultado esperado:
  - `Sucre-Potosi puerta a puerta` debe mapearse contra `CHUQUISACA -> POTOSI` y cotizarse con la tarifa de la API si el token sigue valido.
  - Las cotizaciones Delivery Express deben salir desde la API externa antes de caer a la tabla local.
- Verificacion ejecutada:
  - Consulta real al endpoint con token en cabecera, sin exponer el token.
  - `node --check backend/index.js`.

### Ajuste 2026-09-25: item completo en cotizacion multiple debe consultar API
- Problema observado:
  - El item `Sucre-Potosi, 0.5 kg, Delivery Express puerta a puerta` respondia `Por el momento estoy consultando la tarifa...` aunque la API si tiene tarifa para `CHUQUISACA -> POTOSI`, puerta a puerta.
- Diagnostico:
  - Al separar los items numerados, el ultimo item podia conservar texto global como `Dame el desglose y el total final en un solo mensaje`.
  - Luego `getTariffQuote(...)` volvia a detectar ese subtexto como cotizacion multiple y retornaba `multiple_tariff_quote_request` en vez de consultar la API del item individual.
- Cambio aplicado en `backend/index.js`:
  - `getTariffQuote(...)` acepta `skipMultipleCheck`.
  - `buildMultipleTariffDraftReply(...)` llama a `getTariffQuote(...)` con `skipMultipleCheck: true` para cada item ya separado.
- Resultado esperado:
  - El item 3 debe consultar directamente la API de Delivery Express y devolver precio cuando exista tarifa activa.
  - Para `Sucre-Potosi puerta a puerta`, debe mapear `Sucre` a `CHUQUISACA` y usar la tarifa de la API.
- Verificacion ejecutada: `node --check backend/index.js`.

### Ajuste 2026-09-25: matcher dedicado para API Delivery Express
- Problema observado:
  - El item `Sucre-Potosi, 0.5 kg, Delivery Express puerta a puerta` seguia respondiendo que se estaba consultando, aunque la API contiene la ruta y tarifa.
- Regla correcta:
  - Para Delivery Express cada cotizacion completa debe buscarse en la API por:
    - origen: `origen.nombre_origen`
    - destino: `destino.nombre_destino`
    - modalidad: `servicio_extra.nombre` o `servicio_extra.descripcion`
    - precio: `peso1`
  - El peso del cliente se valida antes contra el limite de 5 kg; la API revisada no trae rangos de peso activos (`peso2`, `peso3`, `peso_extra` vacios).
- Cambio aplicado en `backend/index.js`:
  - Se agrego `deliveryExpressModeMatchesApiRate(...)` para comparar modalidades de la API con `puerta_a_puerta`, `puerta_a_ventanilla` y `ventanilla_a_ventanilla`.
  - Se agrego `deliveryExpressApiRateMatches(...)` para comparar origen, destino, modalidad y precio de Delivery Express usando la estructura real del endpoint.
  - En el buscador externo, Delivery Express ahora usa ese matcher dedicado antes del matcher generico.
- Resultado esperado:
  - `Sucre-Potosi, 0.5 kg, Delivery Express puerta a puerta` debe cotizarse con la API como `CHUQUISACA -> POTOSI`, `SERVICIO PUERTA A PUERTA`, `Bs 20`.
  - Si no hay coincidencia en la API, recien debe caer a la respuesta de tarifa no confirmada.
- Verificacion ejecutada: `node --check backend/index.js`.

### Diagnostico 2026-09-25: WhatsApp sigue respondiendo texto viejo para item 3
- Conversacion observada:
  - El bot sigue respondiendo para el item `Sucre-Potosi, 0.5 kg, Delivery Express puerta a puerta`: `Por el momento estoy consultando la tarifa...`.
- Verificacion ejecutada:
  - Se consulto la API desde Node usando el `.env` del proyecto, sin imprimir token.
  - Resultado: HTTP 200, `243` registros.
  - Coincidencia encontrada: `CHUQUISACA -> POTOSI`, `SERVICIO PUERTA A PUERTA`, `peso1: 20.00`, `tiempo_entrega: 48`.
  - Se reviso el puerto local `3001` y no hay proceso escuchando ahi en este momento.
- Diagnostico:
  - La API si funciona y Node si encuentra la tarifa.
  - Si WhatsApp sigue dando la respuesta anterior, el webhook probablemente esta atendido por otro proceso/backend/tunel que no tiene el codigo reiniciado o no apunta a este workspace.
- Resultado esperado al ejecutar el backend actualizado:
  - El item 3 debe responder con precio desde API, por ejemplo `Delivery Express puerta a puerta: Bs 20`.
  - El texto `Por el momento estoy consultando...` solo deberia aparecer si realmente no hay coincidencia o la API falla.

### Correccion 2026-09-25: cotizar cada item completo de forma independiente
- Conversacion observada:
  - En una solicitud de tres envios, el item `Sucre-Potosi, 500 g, puerta a puerta` tenia origen, destino, peso y modalidad completos, pero no consultaba la API y respondia `Por el momento estoy consultando la tarifa...`.
- Diagnostico profundo:
  - `buildMultipleTariffDraftReply(...)` ya separaba y recorria los envios uno por uno.
  - `summarizeTariffItemForDraft(...)` clasificaba correctamente `puerta a puerta` como Delivery Express.
  - Al entrar individualmente a `getTariffQuote(...)`, el servicio se volvia a inferir desde cero.
  - La modalidad explicita solo se convertia en Delivery Express si existia una conversacion reciente. En el procesamiento aislado de cada item, `recentConversation` esta vacio; por eso el servicio quedaba vacio y la consulta a la API nunca se ejecutaba.
- Cambio aplicado en `backend/index.js`:
  - Toda modalidad explicita `puerta a puerta`, `puerta a ventanilla` o `ventanilla a ventanilla` ahora clasifica directamente el item como Delivery Express, incluso sin contexto previo.
  - Los items se siguen procesando secuencialmente, uno por uno. Un item incompleto no impide que los items completos consulten su API y devuelvan precio.
- Resultado esperado para el ejemplo:
  - Item 1: pregunta por la modalidad porque esta incompleto.
  - Item 2: pide confirmar el servicio segun la regla actual del flujo multiple.
  - Item 3: consulta la API como `CHUQUISACA -> POTOSI`, puerta a puerta, y devuelve `Bs 20` si la API mantiene la tarifa activa.
- Verificacion ejecutada:
  - `node --check backend/index.js` finalizo correctamente.
  - Se inicio `npm --prefix backend run dev` con el codigo actualizado.
  - `GET http://localhost:3001/api/health` respondio con estado `ok`.
  - El backend actualizado quedo escuchando localmente en `http://localhost:3001`.

### Correccion 2026-09-25: multi-cotizacion debe rechazar Delivery Express mayor a 5 kg antes de pedir modalidad
- Conversacion observada:
  - El cliente pidio tres cotizaciones en un solo mensaje.
  - En el item 2 indico `8kg La Paz-La Paz por Delivery Express, ventanila a puerta`.
  - El bot respondio pidiendo modalidad Delivery Express, aunque el peso ya invalida el servicio.
- Diagnostico:
  - En solicitudes multiples, `summarizeTariffItemForDraft(...)` marcaba datos faltantes antes de aplicar la regla de peso maximo de Delivery Express.
  - Por eso el flujo se quedaba en `modalidad Delivery Express` y no llegaba a la validacion que ya existe en `getTariffQuote(...)`.
  - La regla correcta es: si el item se identifica como Delivery Express y el peso supera 5 kg, debe responder que Delivery Express no aplica, aunque falte o este mal escrita la modalidad.
- Cambio aplicado en `backend/index.js`:
  - `summarizeTariffItemForDraft(...)` ahora calcula `invalidReason: delivery_express_weight_exceeded` por item cuando corresponde.
  - `buildMultipleTariffMissingQuestion(...)` ahora muestra el rechazo por peso: Delivery Express solo aplica hasta 5 kg y para ese peso corresponde EMS Nacional e Internacional.
  - `buildMultipleTariffDraftReply(...)` trata los items invalidos como pendientes/no cotizados, sin impedir que otros items completos se coticen.
- Resultado esperado para el ejemplo:
  - Item 1: pregunta modalidad porque falta definir puerta a puerta / puerta a ventanilla / ventanilla a ventanilla.
  - Item 2: responde que 8 kg no se puede mandar por Delivery Express y corresponde EMS Nacional e Internacional.
  - Item 3: se cotiza por Delivery Express ventanilla a ventanilla si la API tiene tarifa activa para esa ruta.
- Verificacion ejecutada: `node --check backend/index.js`.

### Correccion 2026-09-25: modalidad inexistente ventanilla a puerta no debe cotizarse al reves
- Conversacion observada:
  - El cliente envio varios items y en uno escribio `delivery express, ventanila a puerta`.
  - Esa modalidad no existe en Delivery Express.
  - El riesgo era que el agente confundiera la frase y cotizara como `puerta a ventanilla`, que significa lo contrario.
- Regla correcta:
  - Las unicas modalidades validas de Delivery Express son:
    - puerta a puerta
    - puerta a ventanilla
    - ventanilla a ventanilla
  - Si el cliente pide `ventanilla a puerta` o una variante con typo como `ventanila a puerta`, no se debe invertir ni asumir otra modalidad; se debe pedir aclaracion.
  - Si ademas el peso supera 5 kg, tiene prioridad la regla de peso y se indica que Delivery Express no aplica.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `hasUnsupportedDeliveryExpressMode(...)` para detectar `ventanilla a puerta` y variantes.
  - `inferDeliveryExpressMode(...)` ya no convierte esa frase en otra modalidad.
  - En multi-cotizacion, cada item con esa modalidad queda como `unsupported_delivery_express_mode` y pregunta por una modalidad valida.
  - En cotizacion simple, `buildTariffReply(...)` usa la plantilla `unsupportedDeliveryMode`.
- Cambio aplicado en conocimiento:
  - `backend/knowledge/delivery-express.json` ahora incluye la regla de no invertir `ventanilla a puerta`.
  - `backend/knowledge/agent-responses.json` ahora incluye la plantilla `unsupportedDeliveryMode`.
- Resultado esperado:
  - `4kg La Paz-Potosi por Delivery Express, ventanilla a puerta` debe responder que esa modalidad no existe y pedir confirmar una de las tres modalidades validas.
  - `8kg ... ventanilla a puerta` debe responder primero que Delivery Express no aplica por superar 5 kg.
- Verificacion ejecutada:
  - `node --check backend/index.js`
  - Parseo JSON de `backend/knowledge/delivery-express.json` y `backend/knowledge/agent-responses.json`.

### Consulta 2026-09-25: base de datos usada por el proyecto
- Pregunta del usuario:
  - Que base de datos maneja el proyecto: PostgreSQL, MySQL o SQLite.
- Respuesta confirmada:
  - El proyecto usa PostgreSQL.
- Evidencia en el codigo:
  - `backend/index.js` importa `pg` y crea `new Pool(...)`.
  - La conexion se toma desde `DATABASE_URL`.
  - `package.json` y `backend/package.json` tienen la dependencia `pg`.
  - Tambien se usan funciones propias de PostgreSQL como `pg_try_advisory_lock`.
- No se encontro uso de MySQL ni SQLite como base principal.

### Analisis 2026-09-25: API tarifario EMS Nacional
- Consulta del usuario:
  - Analizar `https://dev.correos.gob.bo:18100/api/tarifarios/ems-nacional`.
  - Investigar los tipos/servicios dentro de la respuesta y si existe otro ademas de `EMS_NACIONAL`.
- Seguridad:
  - El token se uso solo para consultar la API.
  - No se guardo ni se imprimio el token en `task.md`.
- Resultado de la API:
  - HTTP 200.
  - `nombre_api`: `TARIFARIO EMS NACIONAL`.
  - `tabla`: `tarifario`.
  - `total_registros`: 25.
  - Relaciones incluidas: `servicio`, `peso`, `destino`, `origen`.
- Estructura observada:
  - Campos principales: `id`, `servicio_id`, `destino_id`, `peso_id`, `origen_id`, `precio`, `observacion`, `created_at`, `updated_at`, `servicio`, `peso`, `destino`, `origen`.
  - `servicio` trae: `id`, `nombre_servicio`, `descripcion`, `codigo`, `codigoSin`, `actividadEconomica`, `unidadMedida`, fechas.
  - `peso` trae: `id`, `peso_inicial`, `peso_final`, fechas.
  - `origen` y `destino` vienen `null` en los 25 registros.
- Servicios/tipos encontrados:
  - Solo se encontro `EMS_NACIONAL`.
  - Descripcion: `Servicio EMS Nacional - Envio de paqueteria`.
  - Codigo: `SRV-001`.
  - Codigo SIN: `99100`.
  - Actividad economica: `841001`.
  - Unidad de medida: `58`.
  - No se encontro otro `nombre_servicio` dentro de esta API.
- Regla de cotizacion deducida:
  - EMS Nacional se cotiza por rango de peso.
  - La API no diferencia precio por origen/destino; esos datos sirven como contexto de conversacion, pero no como filtro para encontrar tarifa en esta API.
- Rangos/precios principales:
  - 0.001 a 0.250 kg: Bs 16.
  - 0.251 a 0.500 kg: Bs 18.
  - 0.501 a 1.000 kg: Bs 23.
  - 1.001 a 2.000 kg: Bs 29.
  - 2.001 a 3.000 kg: Bs 34.
  - 3.001 a 4.000 kg: Bs 40.
  - 4.001 a 5.000 kg: Bs 47.
  - 5.001 a 6.000 kg: Bs 54.
  - 6.001 a 7.000 kg: Bs 60.
  - 7.001 a 8.000 kg: Bs 66.
  - 8.001 a 9.000 kg: Bs 74.
  - 9.001 a 10.000 kg: Bs 80.
  - 10.001 a 11.000 kg: Bs 87.
  - 11.001 a 12.000 kg: Bs 93.
  - 12.001 a 13.000 kg: Bs 100.
  - 13.001 a 14.000 kg: Bs 107.
  - 14.001 a 15.000 kg: Bs 113.
  - 15.001 a 16.000 kg: Bs 120.
  - 16.001 a 17.000 kg: Bs 127.
  - 17.001 a 18.000 kg: Bs 133.
  - 18.001 a 19.000 kg: Bs 140.
  - 19.001 a 20.000 kg: Bs 146.
  - 20.001 a 21.000 kg: Bs 169.
  - 21.001 a 22.000 kg: Bs 175.
  - 24.001 a 25.000 kg: Bs 193.
- Observacion importante:
  - Hay un hueco en la API entre 22.000 kg y 24.001 kg; no aparecieron tarifas para 22.001-23.000 ni 23.001-24.000 kg en la respuesta consultada.
- Cambio aplicado en `backend/index.js`:
  - Se agrego `emsNationalApiRateMatches(...)` para que EMS Nacional compare contra `peso.peso_inicial` y `peso.peso_final`.
  - Se agrego `getExternalEmsNationalServiceName(...)` para evitar que el servicio salga como `[object Object]` y usar la descripcion/nombre real.
  - La busqueda externa ahora usa matcher dedicado cuando `serviceKey === 'ems'`.
- Cambio aplicado en `backend/knowledge/ems.json`:
  - Se documento que la API nacional usa `EMS_NACIONAL`.
  - Se documento que EMS Nacional se cotiza por peso y que origen/destino no son filtros de precio en esta API.
- Verificacion ejecutada:
  - `node --check backend/index.js`.
  - Parseo JSON de `backend/knowledge/ems.json`.

### Consulta 2026-09-24: respuesta de tarifa debe pedir peso y servicio aunque ya detecte ruta
- Conversacion observada: despues del saludo, el cliente pregunto `Cuanto me costaria llevar un paquete de la paz a cochabamba` y el bot respondio `Perfecto, tengo la ruta la paz a cochabamba...`, preguntando solo EMS/Delivery Express y modalidad.
- Problema: esa respuesta aun se saltaba el peso del paquete. Para tarifa exacta, el bot debe pedir peso + servicio y mostrar las opciones disponibles.
- Cambio aplicado en `backend/index.js`: cuando `buildTariffReply(...)` recibe una ruta completa pero falta `servicio`, ahora usa la plantilla generica:
  - `Para darte la tarifa exacta de tu envio, ayudame con el peso del paquete y el servicio que buscas:`
  - `• EMS Nacional e Internacional: Envios dentro y fuera del pais por peso.`
  - `• Delivery Express: Entrega rapida de paquetes a nivel nacional; no aplica para provincia ni para paquetes que excedan los 5 kg. Si supera ese peso, debe enviarse por EMS Nacional.`
  - `¡Dime cual necesitas y te doy el precio de inmediato!`
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-24: EMS debe cubrir nacional e internacional
- Consulta del usuario: la opcion `EMS Nacional: Envios a todo el pais por peso.` debe expresar que el servicio cubre envios nacionales e internacionales.
- Cambio aplicado en `backend/index.js`: la opcion ahora dice `EMS Nacional e Internacional: Envios dentro y fuera del pais por peso.` en las dos plantillas de tarifa.
- Verificacion ejecutada: `node --check backend/index.js`.

### Consulta 2026-09-24: ajustar descripcion de Delivery Express
- Consulta del usuario: la descripcion de Delivery Express debe decir que es entrega rapida de paquetes a nivel nacional y aclarar que no aplica a paquetes que excedan los 5 kg.
- Cambio aplicado en `backend/index.js`: la opcion ahora dice `Delivery Express: Entrega rapida de paquetes a nivel nacional; no aplica para provincia ni para paquetes que excedan los 5 kg. Si supera ese peso, debe enviarse por EMS Nacional.` en las dos plantillas de tarifa.
- Verificacion ejecutada: `node --check backend/index.js`.
- Resultado esperado: `Cuanto me costaria llevar un paquete de la paz a cochabamba` debe responder preguntando por el metodo de envio, no con `SERVICIO PUERTA A PUERTA es Bs 20`.

### Consulta 2026-09-24: quitar saludo en respuesta generica de tarifas
- Consulta del usuario: la respuesta generica de tarifas antes decia `¡Hola! Para darte la tarifa exacta...`; se pidio quitar `¡Hola!`.
- Cambio aplicado en `backend/index.js`: la plantilla generica de `buildTariffReply(...)` ahora inicia con `Para darte la tarifa exacta de tu envio...`.
- Verificacion ejecutada: `node --check backend/index.js`.

---

## 11. Tarea 2026-09-25: Rediseño visual del Pipeline EMS (`/ems`)

### Objetivo
Hacer que la vista `http://localhost:5173/ems` sea 100% fiel al diseño de referencia (Imagen 1) que difiere del estado actual (Imagen 2) en densidad, tamaños tipográficos, espaciados y aspecto de los componentes.

### Archivos involucrados
- `frontend/src/style.css` — todos los cambios son de CSS; la estructura HTML del template en `emsView.ts` **no cambia**.
- `frontend/src/views/emsView.ts` — solo lectura de referencia (estructura del markup).

### Diferencias detectadas (Imagen 2 → Imagen 1)

| Elemento | Estado actual (Imagen 2) | Objetivo (Imagen 1) |
|---|---|---|
| `.ems-control-board` | `gap: 18px`, `padding: 24px` | `gap: 12px`, `padding: 18px` |
| `.ems-control-header h2` | `clamp(2rem, 3vw, 3rem)` | `clamp(1.6rem, 2.2vw, 2.2rem)` |
| `.ems-control-header` | `align-items: start` | `align-items: center` |
| `.ems-month-filter` | grid vertical, `min-width: 220px` | flex inline, sin min-width fijo |
| `.ems-month-filter select` | `min-height: 42px`, `border-radius: 13px` | `min-height: 38px`, `border-radius: 10px` |
| `.ems-kanban-grid` | `minmax(220px, 1fr)` | `minmax(180px, 1fr)` |
| `.ems-kanban-column` | `gap: 12px`, `padding: 14px` | `gap: 8px`, `padding: 10px` |
| `.ems-column-search input` | `min-height: 42px` | `min-height: 36px` |
| `.ems-column-state-btn` | `min-height: 40px` | `min-height: 34px` |
| `.ems-column-actions` | `gap: 8px` | `gap: 6px` |
| `.ems-package-card` | `gap: 10px`, `padding: 14px` | `gap: 8px`, `padding: 10px` |
| `.ems-package-avatar` | `42px`, `border-radius: 15px` | `36px`, `border-radius: 11px` |
| `.ems-package-copy strong` | `font-size: 0.96rem` | `font-size: 0.88rem` |
| `.ems-package-meta` | `padding: 10px 12px` | `padding: 7px 10px` |
| `.ems-column-list` | `gap: 10px` | `gap: 8px` |

### Plan de cambios quirúrgicos en `style.css`

1. **[APLICADO]** `.ems-control-board`: `gap 18→12px`, `padding 24→18px`.
2. `.ems-control-header`: `align-items: start → center`.
3. `.ems-control-header h2`: tamaño de fuente reducido.
4. `.ems-month-filter`: convertir de grid vertical a flex inline.
5. `.ems-month-filter select`: altura y radio reducidos.
6. `.ems-kanban-grid`: columnas más angostas.
7. `.ems-kanban-column`: gap y padding reducidos.
8. `.ems-column-search input`: altura reducida.
9. `.ems-column-state-btn`: altura reducida.
10. `.ems-column-actions`: gap reducido.
11. `.ems-package-card`: gap y padding reducidos.
12. `.ems-package-avatar`: tamaño y radio reducidos.
13. `.ems-package-copy strong`: fuente reducida.
14. `.ems-package-meta`: padding reducido.
15. `.ems-column-list`: gap reducido.
2. **[APLICADO]** `.ems-control-header`: `align-items: start → center`.
3. **[APLICADO]** `.ems-control-header h2`: `clamp(2rem,3vw,3rem) → clamp(1.6rem,2.2vw,2.2rem)`.
4. **[APLICADO]** `.ems-month-filter`: grid vertical → flex inline con `gap: 8px`.
5. **[APLICADO]** `.ems-month-filter select`: `min-height 42→38px`, `border-radius 13→10px`.
6. **[APLICADO]** `.ems-kanban-grid`: `minmax(220px,1fr) → minmax(180px,1fr)`, `gap 14→12px`.
7. **[APLICADO]** `.ems-kanban-column`: `gap 12→8px`, `padding 14→10px`.
8. **[APLICADO]** `.ems-column-search input`: `min-height 42→36px`, `border-radius 14→12px`.
9. **[APLICADO]** `.ems-column-state-btn`: `min-height 40→34px`, `border-radius 14→12px`.
10. **[APLICADO]** `.ems-column-actions`: `gap 8→6px`.
11. **[APLICADO]** `.ems-package-card`: `gap 10→8px`, `padding 14→10px`.
12. **[APLICADO]** `.ems-package-avatar`: `42px→36px`, `border-radius 15→11px`.
13. **[APLICADO]** `.ems-package-copy strong`: `font-size 0.96→0.88rem`.
14. **[APLICADO]** `.ems-package-meta`: `padding 10px 12px → 7px 10px`, `border-radius 14→12px`.
15. **[APLICADO]** `.ems-column-list`: `gap 10→8px`.

### Verificación
- Levantar frontend: `npm --prefix frontend run dev`.
- Navegar a `http://localhost:5173/ems` y comparar con Imagen 1.
- Confirmar que búsqueda, drag-and-drop, paginación y modales no se rompen.
- Sin cambios en `backend/index.js` ni en `emsView.ts`.

---

## 12. Tarea 2026-09-30: Terminal Escáner Internacional (`/internacionales`)

### Objetivo
Reemplazar la vista `internacionales` con un **Terminal Escáner & Inspección** que permite buscar guías individuales de la API SITRA en tiempo real, ver el detalle del paquete, su avance en el embudo logístico y filtrar el registro de escaneos de la sesión por etapa.

### Imágenes de referencia
- **Imagen 1 & 2**: diseño objetivo — escáner + panel detalle + registro de escaneos + volumen por etapa como botones
- **Imagen 3**: lo que NO se incluye — barra de 3 tabs (Terminal/Pipeline/Métricas)
- **Imagen 4**: componente del input de escaneo
- **Imagen 5**: panel derecho (Registro de Escaneos + VOLUMEN POR ETAPA como botones de filtro)

### Archivos a tocar
| Archivo | Cambio |
|---|---|
| `frontend/src/main.ts` | +`internacionales-scanner` en `ViewKey`; +state `scannerQuery`, `scannerResult`, `scannerSessionLog`, `scannerStageFilter`; +handler `[data-scanner-submit]`; setActiveView carga paquetes al entrar a scanner |
| `frontend/src/views/internationalScannerView.ts` | **NUEVO** — toda la vista del escáner |
| `frontend/src/views/index.ts` | exportar `renderInternationalScannerView` |
| `frontend/src/layout/workspace.ts` | +`if activeView === 'internacionales-scanner'` |
| `frontend/src/layout/sidebar.ts` | sin cambio (usa menuGroups) |
| `frontend/src/main.ts` menuGroups | renombrar item `internacionales` → label `"Terminal Escáner"`, `internacionales-pipeline` → label `"Pipeline 2"`, agregar `internacionales-scanner` |
| `frontend/src/style.css` | +estilos `.intl-scanner-*` |
| `.env` | ya tiene `TRACKING_API_URL` y `TRACKING_SQLSERVER_TOKEN` [APLICADO] |

### Estructura de la vista `internationalScannerView.ts`
```
section.intl-scanner-panel
  ├── .intl-scanner-header (kicker + title + total paquetes cargados)
  ├── .intl-scanner-toolbar (date desde/hasta + departamento)
  ├── .intl-scanner-module (banner + input código + botón Consultar Guía)
  ├── .intl-scanner-body (2 columnas)
  │   ├── left: .intl-scanner-detail (guía activa en inspección)
  │   │   ├── código + badge etapa + Origen/Destino
  │   │   ├── .intl-funnel-steps (Origen→Aduana→Nacional→Ult. Milla→Entregado)
  │   │   ├── Destinatario / Teléfono / Peso
  │   │   ├── último evento (amarillo)
  │   │   ├── historial de trazabilidad
  │   │   └── .intl-stage-btns (1.Origen 2.Aduana 3.Nacional 4.Ult.Milla 5.Entregado 6.Detenido)
  │   └── right: .intl-scanner-log
  │       ├── .intl-scanner-log-header (Registro de Escaneos + contador)
  │       ├── .intl-scanner-log-list (tarjetas de escaneos filtrados)
  │       └── .intl-scanner-funnel (VOLUMEN POR ETAPA como botones de filtro 3x2)
```

### Lógica del filtro de etapas
- `state.scannerStageFilter = 'all' | 'received' | 'transit' | 'regional' | 'courier' | 'delivered' | 'cancelled'`
- Al hacer clic en un botón de etapa del embudo → setea `scannerStageFilter` → filtra `scannerSessionLog` en el render
- El botón activo tiene clase `is-active`
- Los volúmenes se calculan desde `state.trackingApiCatalogPackages` usando `getTrackingPipelineStage()`

### Cambios en sidebar/menuGroups
```js
// Grupo 'internacionales' items:
{ view: 'internacionales-scanner', label: 'Internacionales' },   // nuevo (antes 'internacionales')
{ view: 'internacionales-pipeline', label: 'Pipeline 2' },        // renombrado
{ view: 'pronts-internacional', label: 'Pronts Internacional' },
```

### Estado nuevo en main.ts
```ts
scannerQuery: string           // texto del input
scannerResult: TrackingApiPackage | null  // paquete activo en inspección
scannerSessionLog: Array<{pkg: TrackingApiPackage, scannedAt: string, stage: string}>
scannerStageFilter: string     // 'all' | stage key
scannerQueryState: 'idle' | 'loading' | 'error'
scannerQueryError: string | null
```

### Plan de implementación
1. [x] **[APLICADO]** Agregar `internacionales-scanner` al `ViewKey` en `main.ts:8-21`
2. [x] **[APLICADO]** Agregar state `scannerQuery/Result/SessionLog/StageFilter/QueryState/Error` en `main.ts`
3. [x] **[APLICADO]** Crear `performScannerSearch()` async con búsqueda en catálogo SITRA/tracking API + fallback
4. [x] **[APLICADO]** Renombrar en `menuGroups`: `Internacionales` y `Pipeline 2`
5. [x] **[APLICADO]** Crear `frontend/src/views/internationalScannerView.ts` con diseño 100% fiel a imágenes 1 y 2
6. [x] **[APLICADO]** Exportar desde `views/index.ts`
7. [x] **[APLICADO]** Conectar en `workspace.ts` para renderizar `renderInternationalScannerView`
8. [x] **[APLICADO]** Agregar listeners de formulario de escaneo, guías rápidas, selección de logs y filtro de etapas en `main.ts`
9. [x] **[APLICADO]** Agregar estilos completos `.intl-scanner-*` en `style.css`
10. [x] **[APLICADO]** Compilación verificada con `npm --prefix frontend run build` (cero errores)

### Verificación
- `http://localhost:5173/internacionales` muestra el Terminal Escáner & Inspección
- `http://localhost:5173/internacionales-pipeline` muestra el Pipeline 2
- El input de búsqueda/escáner y los chips de prueba rápida consultan y actualizan la guía activa en inspección
- Los botones de "VOLUMEN POR ETAPA DEL EMBUDO" filtran el "Registro de Escaneos de la Sesión"
- No se muestran los 3 tabs de la imagen 3 (excluidos según instrucción del usuario)
---

## 13. Tarea 2026-10-07: Rediseño Visual de Pantalla de Login (LiveCRM - Correos de Bolivia)

### Objetivo
Replicar fielmente el diseño de login proporcionado en la imagen de referencia:
- Panel izquierdo color mostaza/dorado (`#E5A823`) con branding `[CRM] LiveCRM`, pill `• Plataforma de Ventas`, título `CORREOS DE BOLIVIA`, subtítulo, lista de 4 características con iconos oscuros y área de collage visual/estampillas/dron/carruaje postal.
- Panel derecho con fondo claro suave (`#F3F6FA`), sellos postales / matasellos de agua en esquinas, tarjeta de login flotante blanca con sombra suave, campos redondeados gris claro, banner de error rojo suave, checkbox `Mantener la sesión iniciada`, enlace `¿Olvidaste tu contraseña?`, etiqueta `SSO Habilitado`, y botón dorado brillante con flecha `Ingresar al Workspace CRM ➔`.
- Creación de carpeta de imágenes `frontend/public/images/login/` con el nombre de archivo exacto para el recurso de imagen de collage postal (`login-hero-collage.png`).

### Archivos a modificar
1. `frontend/src/layout/loginScreen.ts`: Actualización de la estructura HTML, textos exactos, branding, lista de features con iconos SVG fieles y contenedor de ilustración.
2. `frontend/src/style.css`: Actualización completa de los estilos `.login-split-shell`, `.login-left-panel`, `.login-right-panel`, `.login-card`, inputs, botón dorado y marcas de agua de matasellos.
3. Carpeta de imágenes: `frontend/public/images/login/` con la imagen/placeholder de referencia.
4. `task.md`: Registro de avances y verificación.

### Plan de implementación
1. [x] **[APLICADO]** Crear directorio `frontend/public/images/login/` y colocar archivo de imagen base extraído con fondo transparente (`login-hero-collage.png`).
2. [x] **[APLICADO]** Actualizar `loginScreen.ts` con la estructura HTML desacoplada (ilustración lateral derecha sin solapar textos).
3. [x] **[APLICADO]** Actualizar `style.css` con el color de fondo exacto (`#D6A429`), textos limitados en anchura y posicionamiento limpio de la imagen.
4. [x] **[APLICADO]** Compilación verificada con `npm --prefix frontend run build` (0 errores).

### Verificación
- `http://localhost:5173/login` muestra el diseño idéntico a la Imagen 2.
- La ilustración del collage (estampillas, Puerta del Sol, sobre, dron y carruaje) se amplió al 96% de la altura de la pantalla para cubrir todo el lateral derecho del panel amarillo sin dejar vacíos.
- Los textos del panel izquierdo y los 4 beneficios se leen de forma nítida en el lateral izquierdo.
- Panel derecho con fondo claro, matasellos postales de agua y tarjeta flotante con botón dorado `Ingresar al Workspace CRM ➔`.
---

## 14. Tarea 2026-10-11: Rediseño Visual de Sidebar y Header (Conversa OS - Estilo Postal / Golden Bolivia)

### Objetivo
Adaptar el diseño del sidebar y la barra superior según la imagen de referencia:
1. **Sidebar temático en amarillo/mostaza postal (`#D6A429`)**:
   - Encabezado de marca con insignia `[CRM]` en azul marino y texto `CRM Comercial` / `Conversa OS`.
   - Botones de grupo de menú (`.menu-group-trigger`) con diseño de tarjeta redondeada:
     - Título en negrita (`Nacional`, `Internacionales`, `Clientes`, `Usuarios`, `Sistema`) con texto oscuro (`#0C1E38`).
     - Subtítulo con cantidad de módulos (`3 modulos`, `4 modulos`, etc.).
     - Iconos temáticos a la izquierda y chevron indicador a la derecha.
     - Estado activo con sombreado ámbar suave (`rgba(0,0,0,0.12)`).
     - Subitems del menú (`.menu-item`) con tipografía oscura legible y resaltado activo.
   - Marcas de agua postales (matasellos / Puerta del Sol) en la parte inferior del sidebar.
2. **Topbar y Badges con Estilo Filatélico / Sello Postal**:
   - Barra superior con fondo claro suave (`#F4F7FB` o blanco) y borde inferior sutil.
   - Píldora central: `CRM comercial, marketing y automatizacion`.
   - Badges de `Prueba` y `Agente IA` con borde estilo sello postal perforado/discontinuo (`dashed border`).
   - Chip de `0 leads calientes` en dorado mostaza con texto oscuro.
   - Avatar de usuario con fondo circular dorado suave.
3. **Panel de Carga / Workspace**:
   - Contenedor de `Cargando datos desde PostgreSQL...` con marco de sello postal discontinuo.

### Archivos a modificar
- `frontend/src/layout/sidebar.ts`: Ajuste del markup del sidebar, branding y marcas de agua.
- `frontend/src/layout/authenticatedApp.ts`: Ajuste de clases y estructura de badges estilo sello postal.
- `frontend/src/style.css`: Estilos visuales del sidebar mostaza, navegación, topbar filatélico y banner de carga.
- `task.md`: Registro de avances y verificación.

### Plan de implementación
1. [x] Actualizar `frontend/src/layout/sidebar.ts` con el branding `CRM Comercial / Conversa OS`, chevrons de grupo y marcas de agua postales (Puerta del Sol / Tiwanaku y matasellos).
2. [x] Ajustar estructura en `frontend/src/layout/authenticatedApp.ts` y topbar para sincronizar con la estética de sello postal.
3. [x] Actualizar `frontend/src/style.css`:
   - Sidebar en mostaza postal (`#D6A429`) con tipografía azul marino oscuro (`#0C1E38`).
   - Insignia de marca `[CRM]` en azul marino `#0C1E38` con texto blanco.
   - Triggers de menú `.menu-group-trigger` redondeados con hover suave y estado activo `.is-active` con sombreado oscuro translúcido.
   - Submenús `.menu-item` en `#0C1E38` con estado `.is-current`.
   - Marca de agua SVG `.sidebar-postal-watermark` en la parte inferior del sidebar.
   - Topbar en blanco limpio `#FFFFFF` con borde inferior `#E2E8F0`.
   - Badges de `Prueba` y `Agente IA` con diseño filatélico de borde perforado/discontinuo (`1.5px dashed #CBD5E1`), fondo suave y estados activo/inactivo.
   - Chip de `leads calientes` en píldora dorada `#E5A823` con texto oscuro `#0C1E38`.
   - Avatar de usuario con fondo circular dorado suave `#FDE68A`.
   - Tarjeta de carga `.empty-state.loading-state` con borde de sello postal discontinuo (`2px dashed #CBD5E1`).
4. [x] Verificar compilación: `npm --prefix frontend run build` completado exitosamente sin errores en 1.58s.
---

## 12. Tarea 2026-09-28: Revision de Internacionales y API SITRA

### Solicitud
- Revisar `http://localhost:5173/internacionales`.
- Revisar la API SITRA de tracking en `http://172.65.10.55:8103/api/tracking/paquetes?page=2&per_page=100`.
- Mantener los cambios documentados en este archivo.
- Seguridad: el token se uso solo para verificar configuracion/conectividad y no se copia en `task.md`.

### Hallazgos
- La vista `internacionales` consume el proxy del backend `GET /api/tracking/paquetes`.
- La configuracion local ya tiene `TRACKING_API_URL` y `TRACKING_SQLSERVER_TOKEN` definidos en `.env`.
- `http://localhost:5173/internacionales` responde HTTP 200 desde Vite.
- `http://localhost:3001/api/health` responde HTTP 200.
- La IP externa responde ping, pero el puerto `8103` no acepta conexion TCP desde esta maquina al momento de la prueba.
- La consulta HTTP directa a SITRA fallo con `No es posible conectar con el servidor remoto`.

### Cambios aplicados
- `backend/index.js`: en el proxy `/api/tracking/paquetes`, cuando la API externa responde error HTTP, el fallback ahora usa `fetchStoredTrackingPackagesPage(...)` y mensajes de `tracking`, no `fetchStoredContactPackagesPage(...)` ni textos de `paquetes-contactos`.
- `frontend/src/views/internationalPackagesView.ts`: se quitaron los textos duplicados del formulario de busqueda por codigo (`Codigo` y `Buscar codigo`) para que la pantalla muestre una sola etiqueta y un solo boton.

### Verificacion ejecutada
- `node --check backend/index.js` exitoso.
- `npm --prefix frontend run build` exitoso.
- `Test-NetConnection localhost -Port 5173` exitoso.
- `Test-NetConnection localhost -Port 3001` exitoso.
- `Invoke-WebRequest http://localhost:5173/internacionales` devolvio HTTP 200.
- `Invoke-WebRequest http://localhost:3001/api/health` devolvio HTTP 200.
- `Test-NetConnection 172.65.10.55 -Port 8103` fallo en TCP aunque hubo ping.

---

## 13. Tarea 2026-09-28: Auditoria de paginacion SITRA

### Solicitud
- Revisar por que la vista/Excel aparenta tener solo 200 paquetes si la paginacion sugiere que hay mas.
- Seguir documentando cambios y verificaciones en `task.md`.

### Hallazgos
- `frontend/src/main.ts` no leia `payload.total` ni `payload.total_registros` en algunas respuestas de tracking; si la API devolvia el total fuera de `paginacion`, la UI podia quedarse con el conteo de la pagina actual.
- `state.trackingApiHasMore` se calculaba solo con `remoteData.length >= pageSize`; esto puede ocultar o mostrar mal el boton siguiente si la API manda total real.
- La exportacion Excel de Tracking tenia `maxPages = 1`, por lo que solo exportaba una pagina aunque la API tuviera mas.
- El token local de SITRA estaba sin el prefijo de token esperado; se corrigio en `.env` sin imprimir ni copiar el valor.
- Despues de corregir el formato del token, la API externa sigue sin aceptar conexion TCP desde esta maquina: la IP responde ping, pero `172.65.10.55:8103` no abre.

### Cambios aplicados
- `frontend/src/main.ts`: la carga de tracking ahora considera `paginacion.total_registros`, `pagination.total_registros`, `pagination.total`, `meta.total`, `payload.total`, `payload.total_registros` y `count`.
- `frontend/src/main.ts`: `trackingApiHasMore` ahora usa el total real cuando esta disponible (`pagina * pageSize < total`).
- `frontend/src/main.ts`: la exportacion de Tracking subio de `pageSize = 40` y `maxPages = 1` a `pageSize = 200` y `maxPages = 500`, para traer todas las paginas disponibles.
- `.env`: se ajusto el formato de `TRACKING_SQLSERVER_TOKEN` para incluir el prefijo requerido, sin registrar el secreto en este documento.

### Verificacion ejecutada
- `npm --prefix frontend run build` exitoso.
- Confirmacion enmascarada de `.env`: `TRACKING_SQLSERVER_TOKEN` existe, empieza con prefijo tipo `numero|` y no se imprimio el valor.
- `Test-NetConnection 172.65.10.55 -Port 8103`: ping exitoso, TCP fallido.
- Consulta directa a paginas 1, 2 y 3 de SITRA: fallo con `No es posible conectar con el servidor remoto` por conectividad TCP, no por parseo del CRM.

### Pendiente externo
- Para confirmar el total real de paquetes, la red/equipo debe poder abrir `http://172.65.10.55:8103`. Mientras el puerto no acepte TCP, el CRM solo puede usar fallback/local-db y no puede validar el conteo real remoto.

### Ajuste posterior por volumen informado
- El usuario indico que el total esperado es aproximadamente `271.159` paquetes.
- Se amplio el limite de extraccion de Tracking a `maxPages = 2000` con `per_page = 200`, cubriendo hasta `400.000` registros.
- Archivos ajustados: `frontend/src/main.ts` para exportacion Excel y `backend/index.js` para catalogo completo/cache de Tracking.
- Verificacion ejecutada: `node --check backend/index.js` y `npm --prefix frontend run build` exitosos.

### Revision por captura de pantalla
- La pantalla mostraba `12 registros sincronizados` y el boton `Siguiente` deshabilitado.
- Causa probable: no se estaban mostrando los 271.159 de SITRA, sino el fallback local (`local-db`) porque la API externa no esta accesible desde esta maquina.
- Se agrego `trackingApiWarning` en `frontend/src/main.ts` para conservar la advertencia del backend cuando se usa fallback.
- Se agrego un banner en `frontend/src/views/internationalPackagesView.ts` para mostrar al usuario que no se pudo consultar la API externa y que se estan viendo datos locales sincronizados.
- Verificacion ejecutada: `npm --prefix frontend run build` exitoso.

### Segunda revision del mismo problema
- Se comprobo nuevamente el servicio externo el 2026-09-28: `172.65.10.55` responde ping, pero el puerto TCP `8103` sigue cerrado o inaccesible desde el equipo del CRM.
- El backend local responde correctamente en `GET /api/health`; la limitacion actual esta antes de la paginacion, en la conexion con SITRA.
- Los `12 registros` de la captura corresponden al respaldo de la base local. No representan el total remoto aproximado de `271.159` paquetes.
- `frontend/src/views/internationalPackagesView.ts` ahora etiqueta el conteo como `registros en respaldo local` cuando el backend envia la advertencia de fallback, y como `sincronizados desde SITRA` cuando la consulta externa funciona.
- No se fuerza artificialmente el total remoto durante el fallback, porque habilitaria paginas sin datos y daria un resultado incorrecto.

---

## 14. Tarea 2026-09-28: Pipeline Internacionales basado en eventos IPS

### Solicitud
- Adaptar el Pipeline de Internacionales al flujo real extraido de `ips_catalog`.
- Clasificar todos los paquetes disponibles en el pipeline segun sus eventos IPS.

### Criterio operativo aplicado
- `Origen y llegada`: eventos `1`, `2`, `3`, `8`, `12` y `30`.
- `Aduana`: eventos `31`, `34` y `38`.
- `Distribucion nacional`: eventos `13`, `14`, `35`, `71` y `72`.
- `Ultima milla`: eventos `32`, `36`, `39`, `73`, `74` y `75`.
- `Entregado`: evento `37`.
- `Importacion detenida`: evento `76`; no se interpreta como entrega.
- La etapa se determina por el ultimo evento cronologico disponible. No se exige que cada paquete tenga todos los pasos intermedios.

### Cambios aplicados
- `frontend/src/main.ts`: seleccion del ultimo evento por fecha y clasificacion IPS prioritaria para el pipeline internacional.
- `frontend/src/views/internationalPipelineView.ts`: columnas, ayudas y etiquetas actualizadas al flujo IPS; cada tarjeta muestra codigo y nombre del ultimo evento.
- `backend/index.js`: la sincronizacion persistida usa la misma clasificacion IPS y seleccion cronologica del ultimo evento.
- `backend/index.js`: el catalogo completo de Tracking admite hasta `2000` paginas de `200`, capacidad maxima de `400.000` registros.
- El pipeline muestra la advertencia de respaldo local cuando SITRA no esta accesible, para no presentar los datos parciales como catalogo completo.

### Verificacion
- `node --check backend/index.js`: exitoso.

---

## 15. Tarea 2026-09-28: Filtros y paginacion del Pipeline Internacionales

### Problema encontrado
- El tablero clasificaba los paquetes, pero cada columna mostraba solamente los primeros `8`.
- Los campos `Buscar por codigo` y las flechas estaban deshabilitados.
- El boton `Actualizar paquetes` recargaba la pagina reducida de Tracking, pero no el catalogo completo utilizado por el pipeline.

### Cambios aplicados
- Cada columna tiene busqueda activa por codigo, codigo/nombre de evento, estado postal, servicio, contenido, pais, remitente y destinatario.
- Cada etapa pagina sus resultados de `8` en `8`, con botones anterior/siguiente y contador de pagina y coincidencias.
- `Ver todos` limpia el filtro de la columna y regresa a su primera pagina.
- `Actualizar paquetes` recarga tanto la pagina normal como el catalogo completo del pipeline.
- El filtro y la pagina se conservan de forma independiente para cada etapa IPS.

### Verificacion
- `npm --prefix frontend run build`: exitoso.
- `node --check backend/index.js`: exitoso.
- Vite sirve los controles y manejadores actualizados en `http://localhost:5173/internacionales-pipeline`.

---

## 16. Tarea 2026-09-28: Pipeline Internacionales paginado desde servidor

### Objetivo
- Mostrar el catalogo completo de paquetes internacionales clasificado por etapas, siguiendo el patron del Pipeline Nacional.
- Evitar cargar cientos de miles de registros completos dentro del navegador.

### Cambios aplicados
- Nuevo endpoint autenticado `GET /api/internacionales/pipeline` con parametros `scope`, `query`, `page` y `per_page`.
- El backend clasifica el catalogo completo por el ultimo evento IPS y devuelve solamente la pagina solicitada, junto con `total`, `total_pages` y `catalog_total`.
- Las seis columnas del frontend consultan el endpoint de forma independiente y muestran los totales calculados por el servidor.
- Las busquedas se ejecutan en el servidor sobre el catalogo completo, no solamente sobre las ocho tarjetas visibles.
- Las flechas solicitan la pagina anterior o siguiente al servidor, igual que el Pipeline Nacional.
- `Actualizar paquetes` recarga las seis etapas desde el endpoint paginado.
- Si SITRA no responde, el endpoint conserva el fallback local y devuelve una advertencia visible.

### Verificacion
- `node --check backend/index.js`: exitoso.
- `npm --prefix frontend run build`: exitoso.
- `GET /api/internacionales/pipeline` sin sesion devuelve `401`, confirmando que la ruta existe y esta protegida.
- Backend local saludable y frontend Vite sirviendo el consumo del nuevo endpoint.

### Fuente pendiente
- El informe de `ips_catalog` compartido contiene estadisticas agregadas, patrones y cantidades, pero no incluye las filas individuales con codigo y eventos de los aproximadamente `271.159` paquetes.
- Para visualizar las `271.159` tarjetas reales, SITRA debe volver a responder o se debe importar una extraccion por paquete. No se crean registros ficticios a partir de los conteos agregados.

### Comprobacion posterior por captura de 200 paquetes
- La suma visible `181 + 3 + 16 = 200` confirma que el endpoint paginado esta usando el fallback PostgreSQL local.
- `fetchStoredTrackingPackagesPage(...)` obtiene esos registros desde `contacts` filtrando `segment ilike '%Tracking API%'`; no consulta las tablas IPS `L_MAILITM_EVENTS` ni `N_EDI_MAILITM_EVENTS`.
- El proyecto SITRA mencionado por el informe en `C:\xampp\htdocs\Git proyectos\sitra` no existe en esta computadora, por lo que la conexion de lectura `ips_catalog` no esta disponible localmente.
- La ruta HTTP principal `172.65.10.55:8103` y la ruta alternativa `dev.correos.gob.bo:18100` no aceptaron conexion TCP desde este equipo.
- El tablero ya soporta totales y paginas del catalogo completo. El bloqueo restante es de disponibilidad de los registros fuente, no de presentacion ni paginacion.
- Para completar la carga se necesita uno de estos insumos: acceso de red a SITRA, una API operativa, o una exportacion por paquete con codigo, fecha y eventos. El informe agregado no permite reconstruir tarjetas reales.

---

## 17. Tarea 2026-09-28: Catalogo persistente e importacion masiva IPS

### Solucion aplicada
- Se creo la tabla PostgreSQL `international_tracking_packages` para conservar todos los paquetes internacionales sin depender de la memoria del servidor ni de la disponibilidad permanente de SITRA.
- La tabla guarda codigo unico, etapa IPS, ultimo evento, fecha, texto de busqueda y el payload completo JSON.
- Se agregaron indices por etapa/fecha y busqueda para soportar cientos de miles de registros.
- `/api/internacionales/pipeline` consulta primero este catalogo persistente y pagina directamente con SQL. Si esta vacio, mantiene temporalmente el flujo API/fallback existente.
- Se creo `backend/scripts/import-ips-packages.mjs`, que acepta JSON o NDJSON, agrupa eventos por codigo, selecciona el ultimo evento cronologico, clasifica la etapa IPS y realiza upsert en lotes de `1000`.
- Se agrego el comando npm `import:ips`.

### Formato aceptado
- JSON como arreglo de paquetes o como objeto `{ "data": [...] }`.
- NDJSON con un objeto por linea.
- Puede recibir paquetes con arreglo `eventos` o filas individuales de eventos repetidas por codigo.
- Reconoce codigo en `codigo_s10`, `codigo`, `package_code` o `mailitm_fid`.
- Reconoce evento en `evento_id`, `codigo_evento`, `event_code` o `event_type_cd`.
- Reconoce fecha en `fecha`, `fecha_evento`, `event_date`, `event_gmt_dt` o `created_at`.

### Comando de carga
```powershell
npm --prefix backend run import:ips -- "C:\ruta\exportacion-ips.ndjson"
```

Al finalizar, recargar `http://localhost:5173/internacionales-pipeline` y pulsar `Actualizar paquetes`. Los totales y paginas se leen desde PostgreSQL aunque SITRA este fuera de servicio.

### Verificacion
- `node --check backend/index.js`: exitoso.
- `node --check backend/scripts/import-ips-packages.mjs`: exitoso.
- `npm --prefix frontend run build`: exitoso.
- No se ejecuto una importacion real porque todavia no se proporciono el archivo con las filas individuales de IPS.

### Importacion integrada en la pantalla
- Se agrego el boton `Importar IPS` junto a `Actualizar paquetes` en el encabezado del Pipeline Internacionales.
- El selector admite archivos `.json` y `.ndjson` de hasta `512 MB`.
- La carga se guarda temporalmente en disco y se procesa en segundo plano para evitar bloquear el navegador.
- Nuevos endpoints autenticados: `POST /api/internacionales/import` y `GET /api/internacionales/import-status`.
- La pantalla consulta el progreso cada dos segundos y, al finalizar, recarga automaticamente las seis etapas.
- El encabezado ahora identifica el origen y total: `respaldo local parcial`, `Tracking API` o `catalogo IPS importado`.
- El archivo temporal se elimina al completar o fallar; los registros importados permanecen en PostgreSQL.
- Verificacion repetida: sintaxis de backend/importador correcta y build frontend exitoso.

### Sincronizacion automatica desde la API
- Se aclaro que la fuente principal debe ser la API SITRA; la importacion manual queda solo como alternativa de recuperacion.
- Se encontro que el recolector detenía la descarga cuando el campo remoto `total` llegaba a `200`, aunque pudieran existir paginas posteriores.
- Para Tracking se configuro `trustReportedTotal: false`: ahora continua solicitando `page=2`, `page=3`, etc. hasta recibir una pagina vacia o con menos de `200` registros.
- Se agrego deteccion de paginas repetidas para evitar ciclos si la API ignora el parametro `page`.
- Cada catalogo obtenido desde la API se guarda automaticamente mediante upsert en `international_tracking_packages`, en lotes de `1000`.
- Nuevo endpoint autenticado `POST /api/internacionales/sync` para forzar la extraccion completa y devolver cantidad obtenida y cantidad persistida.
- El boton del tablero ahora se llama `Sincronizar API`; muestra el proceso, conserva los registros previos si SITRA falla y recarga las etapas al terminar.
- Verificacion: `node --check backend/index.js` y `npm --prefix frontend run build` exitosos; backend y frontend locales activos.

### Ajuste de paginacion visual
- El Pipeline Internacionales muestra `6` paquetes por pagina en cada columna.
- Cada etapa conserva paginacion independiente y solicita al backend solamente sus seis registros visibles.
- El endpoint usa `per_page=6` por defecto y el frontend envia explicitamente ese tamaño.

### Correccion profunda del tablero vacio
- Se detecto que un catalogo remoto vacio quedaba guardado en cache como respuesta valida; las seis columnas reutilizaban ese cero.
- `fetchAllTrackingPackagesCatalog` ahora descarta caches vacios y considera una extraccion sin paquetes como error, conservando los datos anteriores.
- El fallback local antes devolvia siempre `page: 1` y los primeros seis registros, aunque se solicitara otra pagina.
- El fallback ahora filtra, calcula `total_pages`, respeta `page`, aplica busqueda y devuelve el bloque correcto de seis paquetes.
- La respuesta local incluye el objeto `pagination`, por lo que las flechas pueden avanzar y retroceder correctamente.
- El frontend muestra errores del endpoint por columna y ya no presenta `Tracking API` como fuente cuando aun no se determino el origen.

### Correccion del boton Siguiente en `/internacionales`
- Se encontro que el frontend confiaba demasiado en `total_registros`. Cuando SITRA devuelve un total truncado o inconsistente, por ejemplo `200`, el boton podia deshabilitarse aunque la pagina recibida estuviera completa y existieran mas paginas.
- La pantalla interpreta tambien `has_more`, `pagina_actual` y `ultima_pagina` (incluidos sus nombres equivalentes en ingles), pero una pagina completa tiene prioridad para no detenerse en el limite remoto falso de `200`.
- Si la API no entrega metadata confiable, una pagina completa habilita `Siguiente`; la navegacion termina al recibir una pagina parcial o vacia.
- El total visible nunca queda por debajo de la cantidad de registros recorridos, evitando rangos imposibles al avanzar.
- Se corrigio la deteccion de filtros: estado, servicio, origen, destino y busqueda por codigo usan ahora la misma estrategia de paginacion local sobre el catalogo completo.
- Se detecto un segundo bloqueo: filtros antiguos guardados en `localStorage` podian seguir activos internamente aunque su opcion ya no existiera y el selector mostrara visualmente `Todos`. Al cargar el catalogo, esos valores invalidos ahora se restablecen y persisten como `all`.
- Se elimino un retorno prematuro que impedia aplicar realmente los filtros de servicio, origen y destino.

### Revision directa de la API SITRA y carga completa
- Se consultaron directamente las paginas 1, 2 y 3 con `per_page=100`: cada una devolvio 100 codigos diferentes, confirmando que existen paginas posteriores y que la API pagina correctamente.
- La respuesta real usa `count`, `data` y `meta`; no devuelve `paginacion.total_registros`. `count` representa solamente los registros de la pagina actual y no el total general.
- SITRA limita `per_page` a 100 aunque el CRM solicite 200. El recolector comparaba los 100 recibidos contra los 200 solicitados y se detenia incorrectamente en la primera pagina.
- El recolector ahora utiliza `meta.per_page` como tamano efectivo y continua hasta recibir una pagina parcial o vacia.
- El maximo de seguridad para Tracking se amplio de 2.000 a 5.000 paginas, suficiente para recorrer aproximadamente 271.159 paquetes si SITRA entrega 100 por pagina.
- El proxy agrega una estructura `pagination` normalizada con `page`, `per_page` y `has_more`, sin confundir `count` con el total global.
- Mientras SITRA no entregue un total general, el pie de tabla muestra el rango recorrido e indica que hay mas paquetes, en vez de afirmar incorrectamente que solo existen 12.

### Controles visibles de paginacion por columna
- Las seis columnas del Pipeline Internacionales conservan su paginacion independiente de seis paquetes por pagina.
- Los botones anterior y siguiente ahora permanecen alineados en una sola fila mediante una grilla estable de tres elementos.
- El indicador se compacto a `Pagina actual/total · paquetes` para evitar que el boton siguiente baje a una segunda linea en columnas estrechas.
- Las flechas incluyen etiquetas accesibles y se deshabilitan solamente en la primera o ultima pagina correspondiente.

### Correccion del pipeline sin tarjetas
- Se comprobo directamente PostgreSQL y la tabla `international_tracking_packages` estaba vacia; por eso no habia paquetes persistidos para paginar.
- Cuando la tabla estaba vacia, las seis columnas esperaban la descarga completa de miles de paginas antes de recibir tarjetas. Una demora o corte dejaba todo el tablero en blanco.
- El pipeline ahora obtiene un lote inicial de hasta 10 paginas, guarda cada pagina inmediatamente y puede mostrar las primeras tarjetas sin esperar la sincronizacion completa.
- La sincronizacion masiva tambien persiste cada pagina conforme llega, evitando perder todo el avance si SITRA falla en una pagina posterior.
- Al volver a entrar al Pipeline Internacionales se recargan las seis columnas; un primer intento fallido ya no deja la pantalla bloqueada permanentemente en cero.
- Verificacion en ejecucion: PostgreSQL paso de `0` a `200` paquetes persistidos y clasificados (`173` origen/llegada, `14` aduana y `13` entregados), confirmando que el pipeline vuelve a tener tarjetas paginables.

---

## Tarea 2026-09-29: adaptador de cotizacion CalcuPost para EMS

### Solicitud
- Crear un archivo reutilizable que consuma `POST /api/calcular` de CalcuPost exclusivamente para EMS Nacional (`EMS NAT`) e Internacional (`EMS INT`).
- Registrar en este documento cada archivo modificado.

### Cambios aplicados
- `backend/services/ems-calculator.js`: agrega `calculateEmsTariff(...)`, valida categoria, codigo de destino y peso, invoca la API con timeout y devuelve una tarifa validada. No admite otros servicios.
- `backend/tests/ems-calculator.test.js`: agrega pruebas unitarias con respuestas simuladas para EMS nacional/internacional, validaciones y tarifa inexistente; ninguna prueba hace solicitudes externas ni registra calculos reales.
- `.env.example`: agrega `EMS_CALCULATOR_API_URL` con la ruta confirmada `https://postar.correos.gob.bo/api/calcular`; se puede sobrescribir por entorno.
- `backend/index.js`: conecta las consultas de tarifa EMS al adaptador. Identifica `EMS NAT`/`EMS INT`, forma codigos de destino usando las convenciones de los ejemplos (`nacional_<destino>` y `dest_a_<pais>`), solicita datos faltantes y responde solo con un importe confirmado por la API.
- Cada mensaje clasificado como consulta de tarifas EMS que incluya servicio nacional/internacional, destino y peso ejecuta una nueva solicitud `POST`; no se reutiliza una tarifa guardada en memoria. Si faltan datos, WhatsApp los solicita primero.
- Si la API no confirma el destino/precio o no esta disponible, no se genera una cotizacion inventada; se informa al cliente y se registra solo el codigo de error.
- `backend/services/ems-calculator.js` usa `https://postar.correos.gob.bo/api/calcular` por defecto y permite reemplazarlo mediante `EMS_CALCULATOR_API_URL`.
- Verificacion inicial sin escritura: `HEAD` y `GET` a `/api/calcular` respondieron HTTP 405, consistente con una ruta existente que requiere `POST`.
- Prueba real autorizada el 2026-09-29: `POST /api/calcular` con `EMS NAT`, `nacional_la_paz`, `1 kg` respondio HTTP 200, `success=true` y tarifa `Bs 17`; la API confirmo que el calculo se guardo en el historial. No se registra aqui el ID de historial.
- Esta prueba confirma la conexion y el calculo EMS Nacional de ejemplo. EMS Internacional aun no se probo en vivo; hacerlo tambien crearia otro registro en el historial.
- La API registra cada calculo exitoso en su historial; el adaptador no reintenta solicitudes para evitar duplicar registros.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 12 pruebas aprobadas con el catalogo oficial, el POST por solicitud y el manejo de dimensiones.
- `node --check backend/index.js` y `node --check backend/services/ems-calculator.js` exitosos.

### Actualizacion 2026-09-29: modalidad, destino y medidas aproximadas de EMS
- La web oficial `https://postar.correos.gob.bo/` se reviso sin enviar calculos. Al seleccionar EMS muestra modalidad Nacional/Internacional, nueve departamentos nacionales, 162 destinos internacionales y dimensiones opcionales en centimetros.
- `backend/knowledge/ems-destinations.json`: guarda los codigos exactos visibles en los selectores de la web; corrige, entre otros, Chuquisaca (`nacional_chuquisaca`), EEUU (`dest_c_eeuu`) y destinos internacionales con prefijos regionales `dest_a_` a `dest_e_`.
- `backend/services/ems-calculator.js`: resuelve nombres y alias a esos codigos oficiales; extrae dimensiones aproximadas en cm (tambien acepta metros/milimetros y formato largo x ancho x alto) y las agrega al POST. Las dimensiones siguen siendo opcionales en la API.
- `backend/index.js`: el dialogo pregunta primero Nacional o Internacional, despues departamento/solo pais y peso. Si el usuario da una localidad internacional, cotiza por el pais reconocido e indica confirmar cobertura con el operador postal del pais de destino. Solicita alto, ancho y largo aproximados; permite continuar solo con el peso si el cliente no cuenta con medidas y avisa que la sucursal verificara peso y dimensiones reales.
- Los mensajes que solo contestan departamento, pais, peso o dimensiones se mantienen en el flujo de cotizacion EMS usando el contexto reciente; no hace falta repetir la pregunta de tarifa.
- Verificacion: `node --check`, 12 pruebas unitarias con POST simulado y comprobacion del catalogo (9 destinos nacionales, 162 internacionales, codigos unicos); no se envio ningun calculo real durante esta actualizacion.

## Tarea 2026-09-29: detalle visual de pipelines internacionales

### Cambios aplicados
- `frontend/src/views/internationalPipelineView.ts`: conserva la clasificacion por ultimo evento y muestra en cada tarjeta si corresponde a salida/exportacion desde Bolivia o entrada/importacion a Bolivia.
- `frontend/src/views/internationalPipelineView.ts`: identifica explicitamente el evento `32` como habilitado para retiro en ventanilla.
- `frontend/src/views/internationalPipelineView.ts`: identifica el evento `36` como incidencia por intento fallido y mantiene el evento `76` como importacion detenida, sin presentarlo como entrega.
- `frontend/src/views/internationalPipelineView.ts`: actualiza la ayuda de la columna de ultima milla para separar los eventos normales de entrada de la incidencia `36`.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron el frontend sin errores.

## Tarea 2026-09-30: apertura del modal desde el Pipeline Internacionales

### Problema encontrado
- Las tarjetas del Pipeline Internacionales se cargan en `internationalPipelineColumns`, pero el manejador del clic buscaba el paquete solamente en `trackingApiPackages`; al no encontrarlo, retornaba sin abrir el modal.
- Algunos registros IPS pueden no incluir objetos `origen` o `destino`, lo que podia provocar un error al renderizar el detalle.

### Cambios aplicados
- `frontend/src/main.ts`: `openTrackingInfoModal` busca el paquete tanto en el catalogo general de tracking como en las columnas paginadas del pipeline internacional; compara por `mailitm_pid` o codigo de paquete.
- `frontend/src/modals/trackingInfoModal.ts`: maneja origen, destino y lista de eventos ausentes sin fallar, para permitir ver detalles de registros IPS parciales.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron sin errores.

## Tarea 2026-09-30: ordenar paquetes internacionales por fecha

### Cambios aplicados
- `frontend/src/views/internationalPipelineView.ts`: agrega selector global para ordenar por fecha del evento mas reciente, de mas nuevo a mas antiguo o al reves.
- `frontend/src/main.ts`: mantiene el orden seleccionado y recarga desde la primera pagina todas las columnas cuando cambia.
- `backend/index.js`: aplica el orden en la consulta paginada de PostgreSQL y en las fuentes de respaldo, antes de cortar los resultados por pagina; los paquetes sin fecha quedan al final.
- `frontend/src/style.css`: da estilo al selector de orden en el encabezado del pipeline.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron sin errores.
- `node --check backend/index.js`: exitoso.

## Tarea 2026-10-01: notificaciones de llegada y rendimiento del watcher

### Problema
- El log confirmaba que se envio un evento de salida desde La Paz y por eso el mensaje informo transito; no confirmaba llegada a Santa Cruz.
- Al construir el registro desde Paquetes-Contactos se elegia directamente la etapa del ultimo evento, ignorando un estado actual mas avanzado como `Recibido en destino`.
- Las consultas de eventos por guia se ejecutaban en lotes con concurrencia predeterminada de una solicitud, alargando la revision cuando habia muchas guias recientes.
- `duplicate-recipient` corresponde a bienvenidas ya enviadas; no significa que se haya bloqueado el aviso de movimiento. El watcher protege sus ciclos contra solapamiento mediante un lock.

### Cambios
- `backend/services/whatsapp-package-automation.js`: agrega `resolveContactPackageStage`, que combina estado actual, ultimo evento y traspaso. Un estado explicito de destino/reparto/entrega prevalece sobre un evento anterior de transito, sin retroceder desde un movimiento mas avanzado.
- `backend/index.js`: usa la etapa resuelta para construir los registros de Paquetes-Contactos y sube a 3 la concurrencia predeterminada, manteniendo el limite de 3 y el override de configuracion.
- `backend/tests/whatsapp-package-automation.test.js`: agrega regresiones para estado de destino frente a salida y para conservar etapas mas avanzadas.
- `.env.example`: documenta `PACKAGE_EVENTS_LOOKUP_CONCURRENCY=3`.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/whatsapp-intent.test.js`: 23 pruebas aprobadas.
- `node --check backend/index.js` y `node --check backend/services/whatsapp-package-automation.js`: correctos.
- `git diff --check` sobre los archivos de esta correccion: correcto.
- No se consulto la API externa en vivo; la llegada solo se notificara si la API proporciona el estado actual/evento de destino.

## Correccion 2026-10-01: no confundir una respuesta de peso EMS con tracking

### Problema
- "Son dos kilos" se detectaba como respuesta pendiente EMS, pero la misma bandera tambien activaba la aclaracion para numeros sin unidad. Como el generador de esa aclaracion solo acepta un numero como "2", devolvia texto vacio y el mensaje podia terminar en la respuesta de tracking ("origen/destino").
- El contexto de la solicitud EMS se consultaba aparte, pero no se conservaba para determinar la cotizacion ni recuperar el pais cuando el historial principal no lo incluia.

### Cambios aplicados
- `backend/index.js`: separa las respuestas pendientes con unidad de las respuestas numericas sin unidad; solo estas ultimas piden confirmar la unidad.
- `backend/index.js`: fuerza la ruta de cotizacion EMS cuando el peso responde a una solicitud EMS reciente y utiliza ese historial pendiente para conservar el pais y la categoria.
- `backend/tests/ems-calculator.test.js`: comprueba que "Son dos kilos" tiene unidad y que "2" aun requiere confirmarla.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 20 pruebas aprobadas.
- `node --check` en `backend/index.js`, `backend/services/ems-calculator.js` y `backend/tests/ems-calculator.test.js`: exitoso.
- `git diff --check` para los archivos editados: exitoso.

## Correccion 2026-10-01: avisos de paquete nuevo en modo de prueba

### Problema
- La configuracion de WhatsApp permite pruebas unicamente al numero autorizado, pero los avisos de creacion priorizaban el telefono real del destinatario del paquete. En el ejemplo de la imagen, el remitente corresponde al numero de prueba y el destinatario tiene otro telefono, por lo que el aviso no aparecia en el chat de prueba.

### Cambios aplicados
- `backend/index.js`: con modo de prueba activo, los avisos de bienvenida y cambio de estado se limitan al numero autorizado que figure asociado al paquete (incluyendo los telefonos de remitente/destinatario); no se envia al telefono real ajeno a la lista de prueba.
- `backend/services/whatsapp-package-automation.js`: encapsula la seleccion de destinatarios para mantener el comportamiento de produccion y aislar la politica de modo de prueba.
- `backend/index.js`: el watcher programa su siguiente ciclo según el menor intervalo activo de bienvenida/cambios de evento; así el ajuste de 1 minuto no queda limitado por el ciclo base de 5 minutos.
- `backend/tests/whatsapp-package-automation.test.js`: agrega pruebas de envio al telefono de prueba vinculado, omision sin vinculacion, conservacion de destinatarios en produccion e intervalo de ejecucion configurado.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 25 pruebas aprobadas.
- `node --check` en `backend/index.js`, `backend/services/whatsapp-package-automation.js` y `backend/tests/whatsapp-package-automation.test.js`: exitoso.
- Diagnosticos de los archivos de codigo: sin errores.
- `git diff --check` para los archivos editados: exitoso.

## Correccion 2026-10-01: no omitir paquetes recientes al paginar el watcher

### Problema
- La consulta rapida de paquetes podia detenerse al encontrar un unico paquete antiguo en una pagina, descartando otros paquetes recientes de esa misma pagina.
- La ventana de lectura por defecto era de una hora, aunque el proceso de bienvenida admite paquetes recientes durante 24 horas; si el watcher estuvo detenido, perdia paquetes aun elegibles.
- El registro de consola no mostraba el total de paquetes recientes ni el motivo por el que se omitieron bienvenidas.

### Cambios aplicados
- `backend/services/whatsapp-package-automation.js`: agrega una condicion de corte paginado que solo detiene la lectura cuando todos los paquetes de la pagina tienen fecha valida y son anteriores al limite.
- `backend/index.js`: alinea la ventana de lectura con el periodo de elegibilidad de bienvenida, conserva el limite de paginas para evitar recorrer todo el catalogo, y detalla en consola conteos y motivos de omision sin exponer telefonos ni contenido personal.
- `backend/tests/whatsapp-package-automation.test.js`: prueba paginas mixtas, paginas antiguas completas y registros sin fecha.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 26 pruebas aprobadas.
- `node --check` en `backend/index.js`, `backend/services/whatsapp-package-automation.js` y `backend/tests/whatsapp-package-automation.test.js`: exitoso.
- Diagnosticos de los archivos de codigo: sin errores.
- `git diff --check` para los archivos editados: exitoso.

## Correccion 2026-10-01: enviar bienvenida para nuevos paquetes EMS de Tracking

### Problema
- La guia `EN000006425LPZ` esta en Paquetes EMS del SIOP, pero la bienvenida del watcher solo aceptaba registros cuya fuente fuera `contact`. Los paquetes que llegaban por Tracking se excluian explicitamente.
- El chequeo rapido de bienvenida solo consultaba Paquetes-Contactos; por lo tanto, un paquete nuevo disponible en Tracking no se sincronizaba en ese ciclo ni podia recibir bienvenida.

### Cambios aplicados
- `backend/index.js`: el chequeo rapido consulta paginadamente las fuentes recientes de Paquetes-Contactos y Tracking, deduplica por codigo y sincroniza las entradas para habilitar la bienvenida EMS.
- `backend/index.js`: la elegibilidad incluye fuente Tracking; para estos avisos usa solo el telefono del destinatario en produccion. En modo de prueba se mantiene la restriccion al numero de prueba vinculado/autorizado.
- `backend/services/whatsapp-package-automation.js`: centraliza elegibilidad por fuente y seleccion de telefonos de bienvenida.
- `backend/tests/whatsapp-package-automation.test.js`: cubre la aceptacion de nuevos EMS de Tracking y que no se elija el telefono del remitente como destinatario de bienvenida.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 28 pruebas aprobadas.
- `node --check backend/index.js`: correcto.
- `git diff --check -- backend/index.js backend/services/whatsapp-package-automation.js backend/tests/whatsapp-package-automation.test.js task.md`: correcto.
- No se forzo un envio real; la entrega a `EN000006425LPZ` requiere que el watcher productivo vuelva a consultar Tracking y que la automatizacion de bienvenida este habilitada.

## Ajuste 2026-10-01: revisar nuevos paquetes cada minuto por defecto

### Analisis
- El ciclo base del watcher y la consulta efectiva de nuevas guias son relojes distintos. Con un ciclo base de 2 minutos, `getPackageAutomationPollIntervalMs` puede despertar el watcher cada 2 minutos, pero `shouldRunWelcomeSync` solo consulta fuentes cuando vence `welcomeResponseIntervalMs`, cuyo valor por defecto era 10 minutos.
- El log `Watcher WhatsApp rapido` confirma una ejecucion concreta con 12 paquetes revisados, pero `0 nuevo(s)` significa que no se insertaron guias nuevas en esa pasada; no mide el tiempo entre consultas.
- El webhook compartido es un estado `read` para el numero de prueba, no incluye el codigo de paquete, por lo que no prueba por si solo que ese recibo corresponda a `EN000006425LPZ`.

### Cambios
- `backend/index.js`: reduce a 1 minuto el intervalo predeterminado y migra una sola vez el valor anterior de 10 minutos cuando estaba guardado; los intervalos elegidos posteriormente y los valores configurados explicitamente en entorno se respetan.
- `frontend/src/views/settingsView.ts` y `frontend/src/main.ts`: alinean el valor de respaldo de la interfaz a 1 minuto y explicitan el minimo permitido.
- `backend/tests/whatsapp-package-automation.test.js`: agrega una prueba de que el watcher despierta cada minuto cuando la bienvenida esta configurada a ese intervalo.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 29 pruebas aprobadas.
- `node --check backend/index.js`: correcto.
- `git diff --check -- backend/index.js frontend/src/views/settingsView.ts frontend/src/main.ts backend/tests/whatsapp-package-automation.test.js task.md`: correcto.
- `npm --prefix frontend run build`: correcto (`tsc` y Vite).
- La aplicacion migra una sola vez el valor guardado antiguo de 10 minutos a 1 minuto. Despues del reinicio, la pantalla de Configuracion muestra el intervalo efectivo; si hay un valor explicito de entorno, este se conserva como respaldo para instalaciones sin valor guardado.

## Analisis 2026-10-01: guia EN000006427LPZ y diagnostico de bienvenidas

### Evidencia
- La fila de SIOP muestra `EN000006427LPZ` EMS Nacional con registro a las 14:06 del 01/10/2026.
- El log compartido del watcher marca su consulta a las 14:04:33 (18:04:33Z), antes de la hora de registro de la guia; esa pasada no puede demostrar si la guia fue detectada despues.
- El recibo webhook `read` aparece a las 14:10:45 (18:10:45Z), pero solo identifica el numero de destino/recibo y no contiene codigo de guia; no permite atribuirlo de forma concluyente a esta bienvenida.
- Los conteos `ineligible-stage` y `missing-recipient` pertenecen a actualizaciones de eventos; no son la causa de omission de bienvenida. El log previo no separaba los motivos de bienvenida.

### Cambios de diagnostico
- `backend/services/whatsapp-package-automation.js`: amplia extraccion del telefono del destinatario a campos y objetos anidados conocidos dentro del bloque de destinatario, sin tomar el telefono del remitente.
- `backend/index.js`: muestra motivos agregados de omision de bienvenida en el resumen y una linea por guia omitida; no escribe telefonos candidatos en ese nuevo diagnostico.
- `backend/tests/whatsapp-package-automation.test.js`: cubre formatos anidados y confirma que el telefono del remitente se excluye.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 30 pruebas aprobadas.
- `node --check backend/index.js`: correcto.
- `git diff --check -- backend/index.js backend/services/whatsapp-package-automation.js backend/tests/whatsapp-package-automation.test.js task.md`: correcto.
- `GET http://localhost:3001/api/health`: respondio `status: ok`. Esto confirma que la API local esta activa, pero no que haya cargado los cambios sin reiniciarla.
- No se forzo el watcher ni un envio de WhatsApp real.

## Correccion 2026-10-01: mantener activo el ciclo automatico ante errores

### Causa
- La ejecucion inicial del watcher ocurria antes de programar el siguiente ciclo. Si fallaba una consulta/configuracion antes de los manejadores internos, la promesa quedaba rechazada y no se instalaba ningun temporizador; el watcher podia quedarse sin volver a revisar hasta reiniciar el backend.

### Cambios
- `backend/index.js`: centraliza la ejecucion inicial y las posteriores para que cada ciclo siempre programe el siguiente, incluso al fallar; los fallos quedan en consola y en `system_logs`.
- `backend/index.js`: informa el tiempo estimado hasta la siguiente comprobacion automatica; el mensaje anterior solo indicaba el intervalo base y no el siguiente ciclo efectivo.
- `.env.example`: alinea el intervalo de bienvenida documentado a 1 minuto.
- `backend/services/whatsapp-package-automation.js`: agrega `runAndReschedule` para garantizar esa secuencia.
- `backend/tests/whatsapp-package-automation.test.js`: verifica que una ejecucion fallida tambien vuelva a programarse y reporte el error.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 31 pruebas aprobadas.
- `node --check backend/index.js`: correcto.
- `git diff --check -- .env.example backend/index.js backend/services/whatsapp-package-automation.js backend/tests/whatsapp-package-automation.test.js task.md`: correcto.
- Los cambios requieren reiniciar el backend en ejecucion para que el planificador actualizado quede activo.

## Ajuste 2026-10-01: intervalo de bienvenida de 5 minutos configurable

### Cambios
- `backend/index.js`: establece 5 minutos como valor predeterminado, actualiza a ese valor los defaults anteriores guardados por versiones previas y calcula el tiempo restante hasta la siguiente comprobacion para evitar que el tick base adelante o retrase el intervalo solicitado.
- `frontend/src/views/settingsView.ts` y `frontend/src/main.ts`: muestran 5 minutos por defecto; el control sigue permitiendo programar minutos u horas desde Configuracion > WhatsApp y automatizacion.
- `.env.example`: documenta el default de 5 minutos.
- `backend/tests/whatsapp-package-automation.test.js`: prueba que el proximo ciclo se programe al plazo restante de cinco minutos y se mantenga el intervalo configurable.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 32 pruebas aprobadas.
- `node --check backend/index.js`: correcto.
- `npm --prefix frontend run build`: correcto (`tsc` y Vite).
- `git diff --check` para los archivos editados: correcto.
- SIOP muestra `EN000006429LPZ` EMS Nacional registrado el 01/10/2026 a las 15:09; esto confirma su existencia, no la entrega del mensaje de bienvenida.
- Reiniciar el backend para aplicar la nueva planificacion. El intervalo elegido desde la pantalla se guarda en `crm_automation_config`; los valores predeterminados antiguos de 1 o 10 minutos se migran una vez a 5 minutos.

## Correccion 2026-10-01: respetar la activacion de bienvenida desde Configuracion

### Causa
- El watcher exigia tanto `automaticWelcome` guardado desde la interfaz como el flag de entorno `WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED`. Si ese flag heredado estaba en falso, la UI podia mostrar la bienvenida activada pero el proceso no la consultaba ni la enviaba.

### Cambios
- `backend/index.js`: la activacion guardada de `automaticWelcome` ahora gobierna la busqueda y el temporizador; el flag de entorno ya no bloquea una automatizacion que el usuario activo explicitamente desde la interfaz.
- `backend/index.js`: la configuracion guardada en la interfaz prevalece sobre los flags heredados de entorno y el log de cada ciclo indica si la bienvenida esta activa y su intervalo efectivo.
- `backend/services/whatsapp-package-automation.js`: resuelve los booleanos de automatizacion priorizando el valor guardado sobre la configuracion inicial del entorno.
- `frontend/src/views/settingsView.ts`: aclara que el control de bienvenida busca paquetes automaticamente segun el intervalo seleccionado.
- `backend/tests/whatsapp-package-automation.test.js`: verifica la prioridad del ajuste guardado en la interfaz.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 33 pruebas aprobadas.
- `node --check backend/index.js`: correcto.
- `npm --prefix frontend run build`: correcto (`tsc` y Vite).
- Diagnosticos de los archivos de codigo modificados: sin errores.
- `git diff --check` para los archivos editados: correcto.
- Reiniciar el backend para aplicar la precedencia nueva. Verificar en la consola `bienvenidas automaticas activas; intervalo configurado 5 min.`; si aparece desactivadas, activar la tarjeta de bienvenida desde Configuracion.

## Correccion critica 2026-10-01: parsear fechas de SIOP en formato dia/mes/anio

### Causa
- SIOP presenta fechas como `01/10/2026 15:09` (dia/mes/anio). Se comprobo que `Date.parse` en Node interpreta ese texto como 10 de enero; si la API entrega `fecha_registro` en ese formato, el filtro de 24 horas descarta la guia aunque el ciclo se ejecute.
- No se inspecciono ni se afirmo el formato crudo de la respuesta del API para la guia: la evidencia disponible es la fecha mostrada en SIOP. El parser nuevo soporta ese formato cuando llegue asi y conserva el comportamiento para ISO.

### Cambios
- `backend/services/whatsapp-package-automation.js`: agrega un parser de timestamps que reconoce fechas dia/mes/anio de SIOP como hora local de Bolivia (UTC-4), valida calendario y conserva timestamps ISO y epoch interpretables por JavaScript.
- `backend/index.js`: usa el parser compartido para filtrar paquetes recientes y ordenar movimientos.
- `backend/tests/whatsapp-package-automation.test.js`: reproduce y cubre la fecha `01/10/2026 15:09`, timestamps ISO y fechas imposibles.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 34 pruebas aprobadas.
- `node --check backend/index.js`: correcto.
- Diagnosticos de los archivos editados: sin errores.
- `git diff --check` para los archivos editados: correcto.
- Reiniciar backend y revisar el siguiente ciclo; no se forzo un envio real.

## Ajuste 2026-10-01: consultar paquetes nuevos cada 5 minutos y diagnosticar respuestas entrantes

### Cambios
- `backend/index.js`: la migracion de automatizacion (version 7) activa la bienvenida, las respuestas automaticas y el intervalo de 5 minutos; tambien vuelve a habilitar el agente global heredado para instalaciones que tenian la version 6.
- `backend/index.js`: el resumen por ciclo muestra cuantas guias recientes devolvio Paquetes-Contactos y cuantas Tracking, separando esos datos de los paquetes efectivamente registrados en el CRM.
- `backend/index.js`: el estado de automatizacion devuelve la ultima comprobacion, conteos por fuente y omisiones, ademas del ultimo mensaje entrante y el resultado de su intento de respuesta, sin numeros ni texto de mensajes.
- `backend/index.js`: registra que fuente no respondio cuando solo una de las consultas falla, para no confundir una consulta parcial con una revision completa.
- `backend/index.js`: enlaza los logs de respuesta con el ID del mensaje entrante y registra fallas de cola/configuracion; el webhook deja de imprimir el payload completo y solo registra conteos.
- `frontend/src/main.ts`, `frontend/src/views/settingsView.ts` y `frontend/src/style.css`: Configuracion muestra la revision periodica y diagnostica si el ultimo mensaje entro por webhook, fue respondido, omitido o fallo.
- `backend/services/whatsapp-intent.js` y `backend/index.js`: una consulta explicita de estado que incluye una guia se enruta a TRACKING y no puede activar una cotizacion EMS heredada del historial reciente.
- `backend/services/whatsapp-intent.js` y `backend/index.js`: al combinar Tracking y Paquetes-Contactos, el estado se determina por el evento con fecha mas reciente; una etapa antigua avanzada no reemplaza un movimiento posterior de transito.
- `backend/tests/whatsapp-intent.test.js`: agrega regresion para la consulta `EN000006438LPZ` y para que el evento reciente de transito prevalezca sobre un estado anterior, sin cambiar el desempate cuando las fechas coinciden.
- `backend/services/whatsapp-package-automation.js`: acepta epoch en segundos/milisegundos en fechas de API y encapsula la migracion del intervalo.
- La configuracion inicial consulta las fuentes cada 5 minutos y envia la aceptacion de cada paquete nuevo elegible una sola vez. Los ciclos siguientes no reenvian la bienvenida ya registrada para la guia/destinatario.
- `frontend/src/views/settingsView.ts`, `frontend/src/main.ts` y `.env.example`: alinean los valores iniciales y la etiqueta a 5 minutos. Configuracion conserva la opcion de cambiar el intervalo.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/whatsapp-intent.test.js backend/tests/ems-calculator.test.js`: 41 pruebas aprobadas, incluidas prioridad de la guia explicita y estado por evento mas reciente.
- `node --check backend/index.js`, `backend/services/whatsapp-intent.js` y `backend/tests/whatsapp-intent.test.js`: exitosos.
- `npm --prefix frontend run build`: exitoso; `git diff --check`: sin errores.
- No se consulto el API externo en vivo para la guia `EN000006438LPZ`; el estado transmitido al cliente depende de los datos y fechas que entregue Tracking/Paquetes-Contactos.
- `node --check backend/index.js`, `backend/services/whatsapp-intent.js` y `backend/tests/whatsapp-intent.test.js`: exitosos.
- `npm --prefix frontend run build`: exitoso; `git diff --check`: sin errores.
- `node --check backend/index.js`, `backend/services/whatsapp-package-automation.js` y `backend/tests/whatsapp-package-automation.test.js`: exitosos.
- `npm --prefix frontend run build`: exitoso.
- Diagnosticos de los archivos editados y `git diff --check`: sin errores.
- El backend local se recargo y `GET /api/health` respondio HTTP 200.
- No se recibio un mensaje entrante real durante la verificacion; la nueva pantalla en Configuracion permite comprobar despues si Meta entrega el webhook y donde se detiene la respuesta.
- No se consulto una API EMS autenticada ni se envio WhatsApp real. La respuesta con el estado real requiere que el webhook procese el mensaje y que la API de tracking encuentre la guia.

## Tarea 2026-10-01: indicar zonas postales en cotizaciones EMS internacionales

### Problema
- El agente cotizaba EMS Internacional por codigo de pais, pero no informaba al cliente la zona postal asociada al destino.

### Cambios aplicados
- `backend/services/ems-calculator.js`: agrega la clasificacion de los codigos internacionales existentes en cinco zonas: Sudamerica, Centroamerica y el Caribe, Norteamerica, Europa y Medio Oriente, y Africa y Oceania. No asigna zona a codigos nacionales ni desconocidos.
- `backend/index.js`: incluye la zona postal en las notas de cotizacion EMS Internacional cuando el catalogo reconoce el codigo. La consulta de tarifa sigue usando el codigo del pais y el peso; EMS Nacional no cambia.
- `backend/tests/ems-calculator.test.js`: agrega cobertura para las cinco zonas y para destinos nacionales/desconocidos.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 15 pruebas aprobadas.
- Diagnosticos de los tres archivos de codigo: sin errores.
- `git diff --check` para los archivos de codigo: exitoso.

## Tarea 2026-10-01: evitar cotizaciones nacionales para solicitudes internacionales nuevas

### Problema
- Una solicitud nueva como "Quisiera enviar un paquete de Bolivia a España" podia reutilizar el peso y la ruta nacional de la cotizacion anterior, respondiendo con EMS Nacional para La Paz-Cochabamba.

### Cambios aplicados
- `backend/services/ems-calculator.js`: detecta solicitudes de envio que mencionan un pais internacional reconocido.
- `backend/index.js`: trata ese mensaje como una nueva solicitud EMS Internacional, limita el contexto de destino al mensaje actual y no hereda peso ni ruta de una cotizacion previa. Si el peso no se indico, debe solicitarlo antes de cotizar.
- `backend/tests/ems-calculator.test.js`: agrega pruebas para deteccion por pais, destino no reconocido y una respuesta de pais aislada que puede ser un dato de seguimiento.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 16 pruebas aprobadas.
- `node --check backend/index.js`, `backend/services/ems-calculator.js` y `backend/tests/ems-calculator.test.js`: exitosos.
- Diagnosticos de los tres archivos de codigo: sin errores.
- `git diff --check` para los cuatro archivos: exitoso.

## Seguimiento 2026-10-01: cambiar de ruta internacional a nacional

### Problema
- Despues de cotizar Bolivia-Espana, una pregunta alternativa como "Y si quiero mandar de La Paz a Cochabamba" no tenia una respuesta dirigida a la nueva ruta y podia perder el peso ya indicado.

### Cambios aplicados
- `backend/index.js`: detectada una pregunta de cambio de ruta, conserva el peso de la cotizacion anterior (si existe) y pide elegir EMS Nacional o Delivery Express para la ruta dentro de Bolivia. Si se conserva el peso, lo indica claramente; para Delivery Express solicita despues la modalidad.

### Verificacion
- `node --check backend/index.js`: exitoso.
- `node --test backend/tests/ems-calculator.test.js`: 17 pruebas aprobadas.
- Diagnostico de `backend/index.js`: sin errores.
- `git diff --check` para `backend/index.js` y `task.md`: exitoso.

## Correccion 2026-10-05: no heredar EMS Internacional en una nueva cotizacion local

### Problema
- La solicitud nueva "Quisiera cotizar un envio de un paquete de La Paz a Cochabamba" podia tratarse como continuacion de una pregunta EMS Internacional pendiente y pedir pais de destino, pese a que la ruta indicada es local.
- El detector de solicitud nueva sin servicio solo reconocia verbos como "enviar"/"mandar", pero no "cotizar", permitiendo que la ruta y categoria anteriores influyeran en el turno.

### Cambios aplicados
- `backend/services/ems-calculator.js`: identifica una solicitud nueva de cotizacion con dos lugares de ruta y sin servicio explicitado, incluyendo formulaciones con "cotizar un envio".
- `backend/index.js`: una solicitud local nueva no hereda la categoria pendiente EMS Internacional; cuando no se especifica servicio, pregunta si prefiere EMS Nacional o Delivery Express para esa ruta.
- `backend/tests/ems-calculator.test.js`: agrega regresion para La Paz-Cochabamba y confirma que una peticion con servicio explicito no se clasifica como nueva sin servicio.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 21 pruebas aprobadas.
- `node --check backend/index.js`, `backend/services/ems-calculator.js` y `backend/tests/ems-calculator.test.js`: exitosos.
- `git diff --check` para los archivos de la correccion: exitoso.

## Seguimiento 2026-10-05: conservar ruta nacional al elegir EMS

### Problema
- Despues de que el bot preguntaba EMS Nacional o Delivery Express para La Paz-Cochabamba, la respuesta "Por Ems" podia recuperar la categoria EMS Internacional de una pregunta anterior.

### Cambios aplicados
- `backend/services/ems-calculator.js`: agrega deteccion de una ruta con dos destinos nacionales conocidos.
- `backend/index.js`: al resolver categoria EMS para la respuesta de servicio, prioriza la ruta nacional mas reciente sobre la categoria de una pregunta pendiente antigua.
- `backend/tests/ems-calculator.test.js`: agrega regresion con la conversacion internacional anterior, nueva ruta La Paz-Cochabamba y seleccion "Por Ems".

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 22 pruebas aprobadas.
- `node --check backend/index.js`, `backend/services/ems-calculator.js` y `backend/tests/ems-calculator.test.js`: exitosos.
- `git diff --check` para los archivos del seguimiento: exitoso.

## Seguimiento 2026-10-05: reconocer una nueva cotizacion EMS Internacional a Peru

### Problema
- Una nueva solicitud "y el envio de un paquete a Peru" heredaba la ruta La Paz-Cochabamba y la categoria EMS Nacional anteriores, por lo que pedia un departamento boliviano.

### Cambios aplicados
- `backend/services/ems-calculator.js`: centraliza la prioridad de categoria EMS; una solicitud internacional reconocida en el mensaje actual prevalece sobre rutas/categorias anteriores.
- `backend/index.js`: usa la nueva resolucion de categoria al preparar la cotizacion, manteniendo el texto actual como contexto de destino internacional.
- `backend/tests/ems-calculator.test.js`: verifica el texto "y el envio de un paquete a peru" con una ruta nacional y categoria EMS NAT previas; el resultado debe ser EMS INT.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 23 pruebas aprobadas.
- `node --check backend/index.js`, `backend/services/ems-calculator.js` y `backend/tests/ems-calculator.test.js`: exitosos.
- `git diff --check` para los archivos del seguimiento: exitoso.

## Correccion 2026-10-05: conservar EMS Internacional para peso superior a 5 kg

### Problema
- Para una cotizacion EMS Internacional a Peru, la respuesta "7 kilos" quedaba contaminada por la ruta nacional anterior; ademas, la regla de 5 kg de Delivery Express podia activar una explicacion de cambio a EMS Nacional aunque EMS ya estuviera seleccionado.

### Cambios aplicados
- `backend/services/ems-calculator.js`: la categoria de la pregunta pendiente ahora prevalece sobre una ruta nacional mas antigua. La pregunta de seleccion "EMS Nacional o Delivery Express" se reconoce como pendiente para fijar EMS Nacional al contestar "Por EMS".
- `backend/services/ems-calculator.js` y `backend/index.js`: el limite de 5 kg solo fuerza la conversion a EMS cuando todavia no se eligio EMS; no cambia cotizaciones EMS Nacional/Internacional ya seleccionadas.
- `backend/tests/ems-calculator.test.js`: agrega regresiones para la secuencia EMS Internacional/Peru/7 kg y la aplicacion del limite solo cuando EMS no ha sido elegido.
- `task.md`: documenta este seguimiento.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 24 pruebas aprobadas, incluida la respuesta de 7 kg a EMS Internacional.
- `node --check backend/index.js`, `backend/services/ems-calculator.js` y `backend/tests/ems-calculator.test.js`: exitosos.
- `git diff --check` para los archivos de esta correccion: exitoso.

## Seguimiento 2026-10-01: pedir unidad para respuestas de peso numericas

### Problema
- Si el agente pide el peso en kg y el cliente responde solo "2", el mensaje no incluye la unidad y no debe cotizarse suponiendo kg ni reutilizando un peso anterior.

### Cambios aplicados
- `backend/services/ems-calculator.js`: reconoce una respuesta exclusivamente numerica solo cuando la ultima pregunta del agente solicita el peso de una cotizacion EMS y especifica unidades.
- `backend/index.js`: procesa ese numero como seguimiento EMS, bloquea el uso de cualquier peso anterior y solicita confirmar si el valor esta en kg o gramos antes de cotizar.
- `backend/tests/ems-calculator.test.js`: verifica respuestas numericas, decimales y que no se active para otras preguntas, saludos o respuestas que ya incluyen unidad.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 18 pruebas aprobadas.
- `node --check` en los tres archivos JavaScript editados: exitoso.
- Diagnosticos de los archivos de codigo: sin errores.
- `git diff --check` para los archivos modificados: exitoso.

## Correccion 2026-10-01: responder directamente a un peso sin unidad

### Problema
- El cliente respondia solo "2" despues de que el agente pidiera el peso en kg, pero la respuesta dependia de que el clasificador de intencion reconociera ese mensaje numerico como seguimiento de tarifas.

### Cambios aplicados
- `backend/index.js`: detecta este caso antes de la respuesta generativa y contesta directamente pidiendo confirmar los 2 kg y, opcionalmente, las dimensiones aproximadas; ofrece continuar solo con el peso si no tiene medidas.
- `backend/tests/ems-calculator.test.js`: extiende la prueba para incluir el mensaje numerico dentro de la conversacion reciente completa.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 18 pruebas aprobadas, incluida la conversacion con "2" como ultimo mensaje del cliente.
- `node --check` en los tres archivos JavaScript: exitoso.
- Diagnosticos de los archivos de codigo: sin errores.
- `git diff --check` para los archivos modificados: exitoso.

### Ajuste solicitado: pedir especificaciones del paquete
- Si el cliente responde un numero sin unidad a la pregunta de peso EMS, la respuesta directa pide confirmar el peso en kg e indica claramente las dimensiones necesarias para afinar el calculo: largo, ancho y alto en centimetros.
- Si no tiene las medidas, puede responder "solo con el peso"; el numero sin unidad por si solo no genera cotizacion.
- La prueba unitaria verifica el texto exacto y el manejo de decimales.

## Correccion 2026-10-01: reconocer pesos escritos con palabras en seguimiento EMS

### Problema
- El extractor EMS solo aceptaba cantidades numericas con digitos. "Son dos kilos" no producia un peso; ademas, al no mencionar palabras clave del dominio, podia quedar filtrado como mensaje fuera de tema antes de continuar la cotizacion.

### Cambios aplicados
- `backend/services/ems-calculator.js`: reconoce numeros escritos en espanol del cero al treinta para pesos con unidad; identifica como respuesta EMS un peso con unidad cuando el ultimo mensaje del agente solicito el peso EMS.
- `backend/index.js`: trata esas respuestas como seguimientos validos antes del filtro de baja senal/pausa automatica, y permite que la ruta de cotizacion EMS use el peso extraido.
- `backend/tests/ems-calculator.test.js`: agrega casos para "Son dos kilos", veintidos kilogramos y contexto pendiente EMS.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 20 pruebas aprobadas, incluidos "Son dos kilos" y "veintidós kilogramos".
- `node --check` en los tres archivos JavaScript editados: exitoso.
- Diagnosticos de los archivos de codigo: sin errores.
- `git diff --check` para los archivos modificados: exitoso.

## Analisis y correccion 2026-10-01: respuesta numerica podia quedar filtrada como baja senal

### Hallazgo en el flujo
- `isNonActionableCustomerMessage("2")` devuelve verdadero porque el mensaje no tiene vocales.
- `autoReplyInboundWhatsAppMessage(...)` aplica el filtro de baja senal y puede descartar la respuesta por una pausa automatica activa antes de consultar el historial reciente y detectar que el numero respondia a una solicitud de peso EMS.
- No se consultaron logs de ejecucion; por ello, este es un camino de codigo capaz de producir el sintoma, no una afirmacion de que fue la causa efectiva de ese mensaje especifico.

### Cambios aplicados
- `backend/index.js`: para mensajes numericos, consulta el historial reciente anterior al mensaje entrante; si el ultimo mensaje del agente pidio el peso para EMS, exime esa respuesta del filtro de baja señal y de la pausa automatica.
- `backend/index.js`: mantiene la excepcion limitada a respuestas numericas con una pregunta EMS pendiente dentro de los 30 minutos previos.
- `backend/index.js` y `backend/services/ems-calculator.js`: la solicitud de dimensiones ahora nombra EMS Nacional o EMS Internacional para conservar el contexto del siguiente turno.
- `backend/tests/ems-calculator.test.js`: verifica que la respuesta pida las especificaciones y mencione la categoria EMS.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 19 pruebas aprobadas.
- Ejecucion directa con el historial "Quisiera enviar un paquete de Bolivia a Estados Unidos" / pregunta EMS / respuesta "2": la respuesta numerica se reconoce como seguimiento y genera la solicitud de peso y dimensiones EMS Internacional.
- `node --check` en los tres archivos JavaScript editados: exitoso.
- Diagnosticos de los archivos de codigo: sin errores.
- `git diff --check` para los archivos modificados: exitoso.

## Correccion 2026-10-01: restaurar vista del escaner internacional

### Causa
- `frontend/src/views/index.ts` reexportaba `renderInternationalScannerView` desde `internationalScannerView.ts`, y `workspace.ts` la importaba para la seccion "Escáner internacional".
- `frontend/src/views/internationalScannerView.ts` existia como archivo vacio (0 bytes), por lo que Vite fallaba al cargar el modulo al no encontrar la exportacion nombrada.

### Cambios aplicados
- `frontend/src/views/internationalScannerView.ts`: implementa y exporta `renderInternationalScannerView`; restaura formulario de busqueda, codigos rapidos, detalle del paquete, historial de eventos, registro de consultas y filtros por etapa usando los `data-scanner-*` ya conectados en `main.ts`.
- Se conservan los reexports existentes en `frontend/src/views/index.ts` y el import/ruteo de `frontend/src/layout/workspace.ts`; no se agregan alias vacios ni se oculta el error de contrato.

### Verificacion
- `npm --prefix frontend run build`: exitoso (`tsc` y Vite; 152 modulos transformados).
- Diagnosticos de `internationalScannerView.ts`, `views/index.ts` y `layout/workspace.ts`: sin errores.
- `git diff --check` para archivos de UI y registro: exitoso.

## Seguimiento 2026-10-01: continuar cotizacion EMS al recibir el peso

### Problema
- Despues de pedir el peso para EMS Internacional, una respuesta breve como "Pesan 2 kilos" entraba como seguimiento, pero no recuperaba la categoria de la pregunta pendiente y mostraba de nuevo el menu generico de servicios.

### Cambios aplicados
- `backend/services/ems-calculator.js`: agrega la inferencia de categoria desde la ultima pregunta pendiente del agente que solicita datos EMS.
- `backend/index.js`: conserva EMS Internacional o EMS Nacional al procesar la respuesta de peso, dimensiones o destino, priorizando la pregunta pendiente mas reciente sobre menciones antiguas del historial.
- `backend/tests/ems-calculator.test.js`: verifica la categoria de la pregunta EMS pendiente mas reciente y conversaciones sin pregunta EMS pendiente.

### Verificacion
- `node --test backend/tests/ems-calculator.test.js`: 17 pruebas aprobadas.
- `node --check backend/index.js`, `backend/services/ems-calculator.js` y `backend/tests/ems-calculator.test.js`: exitosos.
- Diagnosticos de los tres archivos de codigo: sin errores.
- `git diff --check` para los cuatro archivos: exitoso.

## Diagnostico de “fuente no disponible” en Pipeline Internacionales (2026-09-30, 17:39)

- La captura muestra que el backend devolvio un error en la consulta del pipeline: no es un resultado valido de cero paquetes ni un error de inicio de sesion.
- Health check de backend (`localhost:3001/api/health`) y del proxy Vite (`localhost:5173/api/health`) devolvieron HTTP 200. El check de IA devolvio 401 porque requiere autenticacion y no es el servicio usado por este pipeline.
- Se comprobo la configuracion sin leer credenciales: no hay URL/token dedicados de `PAQUETES_EVENTOS_API`; si existe URL de Tracking, cuyo host configurado es `172.65.10.55:8103`, y hay una credencial configurada. Por tanto, el codigo usa el fallback esperado de Tracking, no el API dedicado de eventos.
- La tabla local tiene 86.931 paquetes; 7.561 filas se actualizaron durante los dos minutos previos a la medicion. Esto indica que la paginacion/persistencia estaba activa, no que la fuente estuviera apagada.
- Causa probable del error: la primera consulta del pipeline espera que termine la descarga completa del catalogo antes de responder. Se fuerza una pausa minima de 2,5 s entre paginas y el cliente/proxy tienen un limite de 15 minutos. Para 86.931 paquetes, la descarga requiere al menos unas 435 paginas si el API entrega 200 por pagina (aprox. 18 minutos); si entrega 100, son unas 869 paginas (aprox. 36 minutos), sin contar reintentos o latencia. Asi, una API operativa puede dejar al pipeline sin respuesta dentro del limite configurado.
- La causa inmediata del HTTP 502 no se pudo verificar sin el detalle del error capturado por el proceso; no se hicieron solicitudes adicionales al API externo para evitar consumir su limite. El panel muestra un mensaje generico y el backend escribe el error interno en la consola del proceso.
- No se cambio el comportamiento en esta revision. Para resolverlo de fondo conviene servir el periodo desde el catalogo local disponible mientras se sincroniza en segundo plano, indicando claramente si la carga aun esta incompleta; no debe afirmarse que la lista mensual esta completa hasta terminar la paginacion.
- Aclaracion tras revisar el historial: el unico intento con `psql` documentado anteriormente (seccion 5, intento 3) era para inspeccionar la PostgreSQL local del CRM; fallo porque `psql` no estaba disponible. No fue un intento de conexion directa a la base de SITRA.
- El backend productivo `backend/index.js` crea su pool PostgreSQL solo con `DATABASE_URL`. El endpoint del pipeline obtiene el catalogo desde `/api/tracking/paquetes` y persiste una copia en la base local del CRM; no consume `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` ni `POSTAL_IPS_READ_CONNECTION` del `.env` Laravel compartido. Por ello, compartir ese `.env` no configura por si solo una conexion directa desde el CRM a SITRA.
- No hay evidencia en el historial ni en el endpoint actual de que se haya implementado el intento de conexion directa a la base SITRA. Se mantiene como fuente activa el API de Tracking, no la conexion SQL externa.

## Diagnostico ECONNREFUSED en proxy de Vite (2026-09-30, 17:46)

- `GET /api/health` directo a `127.0.0.1:3001` y `localhost:3001` fallo al conectar; `GET /api/health` a traves de Vite tambien fallo con 502. El puerto 3001 no tenia proceso escuchando.
- Vite si estaba activo en el puerto 5174; no habia listener en 5173 en la comprobacion. Su proxy apunta a `localhost:3001`.
- Hay procesos Node iniciados para `npm run dev` y `tsx watch index.js`, pero el proceso del backend no habia abierto el puerto 3001. Esto explica el `AggregateError [ECONNREFUSED]`: la solicitud `/api/auth/login` no llega al handler de login ni a validar credenciales. Aun no se obtuvo el error de arranque del backend, por lo que no se atribuye a una causa especifica.
- Para recuperar: revisar la salida de `dev:server` donde se inicio `npm run dev`; el backend debe anunciar que escucha en `http://localhost:3001` y `http://localhost:3001/api/health` debe devolver HTTP 200. La interfaz de esta ejecucion esta en `http://localhost:5174` si Vite no tomo 5173.
- No se imprimieron valores de `.env` ni se modifico el proxy/configuracion.
- Recuperacion verificada (17:49): `node --check backend/index.js` paso; al ejecutar `npm --prefix backend run start`, el backend anuncio que escucha en `:3001`. La API directa y `http://localhost:5174/api/health` por proxy devolvieron HTTP 200. El backend queda activo en la sesion para que se pueda volver a probar el login. No se identifico por que el proceso anterior de `dev:server` no estaba escuchando; no se hicieron cambios de codigo.

## Fuente del Pipeline Internacionales: Tracking SITRA del `.env` (2026-09-30, 18:03)

- Se confirmo que la seccion `Tracking SITRA (internacionales)` declara `TRACKING_API_URL` y `TRACKING_SQLSERVER_TOKEN`; la URL apunta al host `172.65.10.55:8103`. No se leyeron ni copiaron secretos.
- `backend/index.js`: se ajusto `/api/internacionales/pipeline` para que use siempre `fetchAllTrackingPackagesCatalog()`, que toma `TRACKING_API_URL` y `TRACKING_SQLSERVER_TOKEN` del `.env` raiz del CRM y consulta `/api/tracking/paquetes`. Un API separado de eventos ya no reemplaza esta fuente para internacionales.
- El catálogo y su historial de `eventos` se persisten en PostgreSQL local del CRM; el pipeline selecciona cada paquete por el ultimo movimiento del intervalo desde esos eventos. No se cambia la fuente de EMS nacional ni se usa la conexión SQL Laravel.
- Verificacion: `node --check backend/index.js` y `npm --prefix frontend run build` exitosos; el `git diff --check -- backend/index.js task.md` no reporto problemas en los archivos de este cambio. Se reinicio el backend con `npm --prefix backend run start` y los health checks directo (`localhost:3001`) y por proxy (`localhost:5174`) respondieron HTTP 200.

## Ajuste 2026-10-02: mostrar movimientos IPS dentro del periodo

### Cambios aplicados
- `backend/index.js`: el Pipeline Internacionales ahora toma, para cada paquete, el movimiento mas reciente cuya fecha cae dentro del rango seleccionado. Clasifica la tarjeta y el departamento usando ese movimiento, en vez de excluir paquetes cuyo movimiento mas reciente global sucedio despues del periodo. Se reconocen fechas `event_date`/`event_gmt_dt` y codigos `event_code`/`event_type_cd` del formato IPS; las consultas paralelas de columnas reutilizan en memoria el resultado del periodo por 15 segundos.
- `backend/index.js`: el pipeline consulta solo el catalogo persistido y devuelve un resultado vacio si aun no hay catalogo; abrir el tablero ya no provoca una sincronizacion completa ni una carga parcial automatica desde SITRA. Los fallos al consultar el catalogo se devuelven como error explicito, no como una respuesta parcial con forma de exito.
- `frontend/src/main.ts` y `frontend/src/views/internationalPipelineView.ts`: se quitaron los controles de importacion IPS y sincronizacion API, sus manejadores y sus avisos rojo/verde. Se mantiene visible el error real de carga del pipeline.
- La consulta afecta solo la presentacion del Pipeline Internacionales; no modifica las automatizaciones de WhatsApp ni el resto de los tableros.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron.
- `node --check backend/index.js`: exitoso.
- Diagnosticos de `frontend/src/main.ts` y `frontend/src/views/internationalPipelineView.ts`: sin errores.
- Busqueda de referencias a los controles, estado y manejadores de importacion/sincronizacion retirados: sin coincidencias en `frontend/src`.

## Ajuste 2026-09-30: movimientos IPS por mes en columnas internacionales

### Solicitud
- Mostrar en las columnas del Pipeline Internacionales todos los paquetes cuyo ultimo movimiento dentro del periodo pertenece al mes seleccionado, con un total comparable al informe “Actividad postal por oficina”.

### Cambios aplicados
- `backend/index.js`: el pipeline obtiene el catalogo paginado del API de movimientos `/api/paquetes-eventos`, agrupa los movimientos por codigo de paquete y conserva el ultimo movimiento del rango para asignar cada paquete a una sola etapa. Complementa los datos de la tarjeta con el catalogo local de tracking cuando existe.
- `backend/index.js`: reutiliza en memoria el resultado agrupado por periodo durante 15 segundos y el catalogo de movimientos existente durante su TTL; si falta configurar el API de movimientos, responde con un error explicito en vez de presentar un catalogo local parcial como si fuera el informe completo.
- `backend/index.js` y `frontend/src/main.ts`: Internacionales admite rangos inclusivos de hasta 31 dias, necesarios para meses calendario completos; EMS conserva su limite de 30 dias.
- `frontend/src/main.ts`: el Pipeline Internacionales inicia en el mes actual hasta hoy.
- `frontend/src/main.ts` y `frontend/src/views/internationalPipelineView.ts`: se reconocen los alias de codigo IPS y la fuente se identifica como “movimientos IPS”.
- La consulta se limita al tablero; no modifica los procesos ni automatizaciones de WhatsApp.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron sin errores.
- `node --check backend/index.js`: exitoso.
- Diagnosticos de `frontend/src/main.ts` y `frontend/src/views/internationalPipelineView.ts`: sin errores.
- Confirmado en codigo que EMS conserva el maximo de 30 dias y que Internacionales acepta hasta 31 dias inclusivos.
- La igualdad exacta con el reporte (9.738 paquetes en la captura) requiere que el API configurado en `PAQUETES_EVENTOS_API_URL` y `PAQUETES_EVENTOS_API_TOKEN` devuelva el historial completo del mismo periodo. No se consulto ese servicio durante la edicion.

### Diagnostico de pantalla sin paquetes (2026-09-30)
- La captura muestra el error “Configura el API de movimientos IPS...” y cero en las seis columnas. Esto no indica que el rango del mes no tenga movimientos: el endpoint responde error de configuracion antes de cargar el catalogo.
- `backend/index.js`: el endpoint `/api/paquetes-eventos` solo se habilita para el pipeline si existen `PAQUETES_EVENTOS_API_URL` y `PAQUETES_EVENTOS_API_TOKEN`; aunque hay una URL por defecto, `hasDedicatedPackageEventsApiConfig()` exige ambas variables explicitamente.
- Las variables Laravel compartidas (`DB_*` y `POSTAL_IPS_READ_CONNECTION`) no son leidas por el backend Node del CRM. Este inicializa su propia base con `DATABASE_URL`; el selector `POSTAL_IPS_READ_CONNECTION` solo tendria efecto dentro de la configuracion Laravel.
- No se copian credenciales a `task.md` ni se intenta conectar a la base externa. Para cambiar el origen a PostgreSQL se necesita confirmar el esquema/tabla o vista de eventos y disponer de credenciales de solo lectura configuradas localmente.
- Se confirma continuar con el API de movimientos existente. El archivo `.env.example` ya documenta `PAQUETES_EVENTOS_API_URL` y `PAQUETES_EVENTOS_API_TOKEN`; hay que configurar ambos en el `.env` raiz del CRM (el que carga `backend/index.js`) con endpoint/token validos y reiniciar el backend. No se modifica ni se consulta el `.env` local para evitar acceder o registrar secretos.
- Las credenciales de base de datos y la clave de aplicacion incluidas en el mensaje quedaron expuestas en la conversacion; rotarlas en el servicio correspondiente y no reutilizarlas en la configuracion del CRM.

### Ajuste 2026-09-30: fallback al API de Tracking ya configurado
- El usuario proporciono el endpoint `/api/tracking/paquetes` y un token de tracking. Ese endpoint no es el API de eventos separado; el pipeline antes solo intentaba `/api/paquetes-eventos` y mostraba error de configuracion aunque Tracking ya estuviera configurado.
- `backend/index.js`: si no hay API de eventos dedicado, Internacionales ahora usa el catalogo completo de Tracking del CRM (con `TRACKING_API_URL` y las credenciales existentes, sin duplicar ni guardar el secreto), lee `eventos` por paquete y distribuye cada codigo segun su ultimo movimiento dentro del rango elegido.
- `backend/index.js`: si la respuesta de Tracking no trae historiales de eventos, devuelve un error explicito; no genera un falso resultado exitoso de cero paquetes. El catalogo del periodo mantiene cache por 15 segundos.
- `frontend/src/views/internationalPipelineView.ts`: etiqueta esta fuente como “Tracking API con movimientos”.
- No se llamo al API externo durante el cambio ni se escribio el token compartido en archivos del repositorio. El token quedo expuesto en el chat y debe revocarse/rotarse; configurar el nuevo valor localmente en la variable de Tracking que ya consume el backend.
- Verificacion: `node --check backend/index.js` y `npm --prefix frontend run build` exitosos; sin errores de diagnostico en `frontend/src/main.ts` ni `frontend/src/views/internationalPipelineView.ts`.
- No se solicito el API en vivo; la disponibilidad y forma del historial entregado por Tracking se confirmaran al recargar el pipeline con el backend reiniciado y sus credenciales locales vigentes.

### Diagnostico de error de carga y control de limite API (2026-09-30)
- La captura de error se reprodujo contra la fuente configurada sin imprimir token, codigos de paquete ni datos personales: el API de Tracking contesto HTTP 200 para paginas de 200 y cada elemento revisado contenia `eventos`; PostgreSQL local esta disponible.
- Auditoria paginada de septiembre: 11.800 filas recibidas en 59 paginas, 11.130 codigos unicos, 78.228 movimientos totales y 9.739 codigos con al menos un movimiento en septiembre de 2026. El total del reporte en la captura es 9.738 (diferencia de uno por conciliar).
- Al continuar la auditoria, la siguiente pagina contesto HTTP 429; una solicitud posterior tambien encontro temporalmente limitado el endpoint. La causa concreta es una descarga paginada demasiado rapida / limite upstream. El cargador previo podia detenerse ante error en paginas posteriores y guardar el catalogo parcial como si fuera completo.
- Validacion aislada de escritura: una pagina de 200 items tenia 200 codigos distintos y su upsert contra `international_tracking_packages` paso dentro de una transaccion revertida; no se altero la base local con esta prueba.
- `backend/index.js`: el catalogo Tracking ahora espacía las solicitudes al menos 1.2 segundos, exige una paginacion completa, informa HTTP 429 sin convertir una descarga interrumpida en catalogo exitoso y conserva una sola promesa activa aunque la descarga dure mas que el TTL. El pipeline comparte su promesa de carga entre las seis columnas y comunica el limite de SITRA con estado 429 y mensaje visible.
- La inspeccion intensiva de paginacion pudo contribuir a la limitacion temporal observada; no se haran mas solicitudes externas en esta tarea. El token compartido anteriormente debe revocarse y sustituirse solo localmente.
- Verificacion tras los cambios: `node --check backend/index.js`, `npm --prefix frontend run build`, diagnosticos del frontend y `git diff --check`.

### Ajuste 2026-09-30: esperar la descarga completa sin 502
- La consola del navegador confirma que las seis solicitudes del pipeline terminan con HTTP 502 tras esperar aproximadamente un minuto. La consulta compartida tarda porque primero pagina todo el catalogo Tracking; antes, el frontend esperaba solo 120 segundos y el proxy Vite no tenia timeout extendido.
- `backend/index.js`: al catalogo Tracking usado por el pipeline se le aplica una pausa minima de 2.5 segundos entre paginas y hasta seis reintentos por 429, respetando `Retry-After` o usando backoff exponencial. La descarga solo se acepta al completarse.
- `frontend/src/main.ts` y `frontend/vite.config.ts`: el timeout de la solicitud internacional y del proxy `/api` se extiende a 15 minutos para que Vite no corte la consulta larga.
- `frontend/src/views/internationalPipelineView.ts`: las columnas indican que la primera carga desde SITRA puede tardar unos minutos, en vez de parecer un tablero congelado.
- No se hicieron nuevas solicitudes al API externo durante este cambio. La carga completa se debe verificar reiniciando tanto backend como Vite; toma mas tiempo deliberadamente para evitar el limite de SITRA y ya no debe finalizar con 502 por los timeouts anteriores.
- Verificacion: `node --check backend/index.js` y `npm --prefix frontend run build` exitosos; sin diagnosticos en `main.ts`, la vista internacional ni `vite.config.ts`; `git diff --check` sin errores.
- Diagnostico final: Vite PID 15320 seguia activo desde las 11:21, anterior al cambio del proxy; el primer arranque manual uso por error la raiz equivocada y devolvio 404. Backend PID 6232 inicio antes de los ultimos cambios de reintentos. Se reiniciaron ambos procesos desde sus carpetas de proyecto: Vite PID 22880 (16:49:58) y backend PID 22856 (16:50:20).
- Verificacion posterior: `http://localhost:5173/` y los health checks directo (`:3001/api/health`) y via proxy (`:5173/api/health`) devuelven HTTP 200. El backend confirma arranque y watcher activo. No se solicito el API externo para evitar nuevos 429.
- Pendiente para validar en el navegador: recarga completa (`Ctrl+F5`) e inicio de la carga del periodo. La primera carga puede esperar el catalogo completo de Tracking y tardar unos minutos; ahora Vite y el backend tienen los timeouts y reintentos nuevos.
- Seguimiento del estado (17:00): los dos servidores seguian activos. La consola del backend revelo que el watcher pesado fallo al persistir una pagina con codigos repetidos: `ON CONFLICT DO UPDATE no puede afectar una fila por segunda vez`. Esto impedia completar la sincronizacion local y explica que no se llenara el pipeline.
- `backend/index.js`: `persistInternationalTrackingCatalog` ahora consolida duplicados por codigo antes del upsert, conservando el registro con el movimiento mas reciente. Validar el reinicio automatico del watcher/backend y la siguiente carga completa; no se forzo una nueva sincronizacion externa en esta revision.
- Validacion posterior al hot reload: backend responde health HTTP 200 y el catalogo local aumento de 2.011 a 3.784 registros. Aun no es el catalogo completo; no se ha confirmado que el pipeline ya cargue el mes entero.
- Aclaracion del usuario (17:04): confirma que la fuente correcta es `http://172.65.10.55:8103/api/tracking/paquetes?page=2&per_page=100`. La configuracion local del CRM ya apunta al host `172.65.10.55:8103`, ruta `/api/tracking/paquetes`, y tiene credencial de Tracking configurada; no se imprimio ni comparo el valor del token compartido.
- Seguimiento de sincronizacion (17:04): el catalogo persistido llego a 17.645 paquetes y 9.115 codigos con movimiento de septiembre en una consulta agregada; el conteo local aumento mientras la sincronizacion seguia activa, por lo que es una lectura intermedia, no una cifra final. No reiniciar el backend durante esta carga.
- Comprobacion posterior (17:05): la misma tabla local subio a 22.629 paquetes; la consulta agregada para septiembre dio 9.114. El conteo global sigue creciendo, pero la cobertura de septiembre no alcanzo aun la referencia de 9.738 del reporte, asi que el pipeline no se debe dar por resuelto.
- Actualizacion (17:31): la captura muestra “Consultando movimientos de SITRA. La primera carga puede tardar unos minutos...”; esto es el estado loading, no una respuesta final ni evidencia de que el filtro mensual ya se aplico. El usuario aclara que la fuente alternativa ya fue configurada por Codex y pide que el tablero liste solo cada paquete una vez, clasificado por su ultimo evento dentro del mes.
- Conteo solo agregado a las 17:31: la tabla contiene 86.931 codigos unicos; 9.116 tienen como ultimo evento registrado un movimiento de septiembre. No equivale a la semantica del informe (ultimo evento dentro del periodo) y no se usaron codigo/datos de paquetes.
- Siguiente trabajo: una vez que termine la descarga completa, comprobar la respuesta paginada del endpoint Pipeline con fechas de septiembre y suma de las seis etapas. El algoritmo del endpoint ya filtra eventos por rango y toma el mas reciente dentro del rango; distinguir esto del conteo global por `latest_event_at`.
- El token compartido en el chat vuelve a estar expuesto; debe revocarse y reemplazarse localmente.

## Tarea 2026-09-30: filtros de fecha y departamento para Pipeline EMS

### Solicitud
- Reemplazar el filtro mensual del tablero EMS por fechas Desde/Hasta, limitar el rango a 30 dias y agregar filtro por departamento donde se registro el ultimo movimiento.
- Limitar estos filtros a lo que se muestra en el pipeline; no alterar automatizaciones ni envios de mensajes.

### Cambios aplicados
- `frontend/src/views/emsView.ts`: reemplaza “Todos los meses” por dos fechas y selector de los nueve departamentos de Bolivia.
- `frontend/src/main.ts`: inicia mostrando los ultimos 30 dias, limita los selectores a un rango inclusivo maximo de 30 dias y solicita cada columna con fechas y departamento.
- `frontend/src/main.ts`: elimina la carga de opciones mensuales y aplica los mismos filtros al estado local usado por el pipeline.
- `backend/index.js`: `/api/ems/pipeline` filtra las tarjetas por fecha boliviana y departamento antes de paginar; valida fechas y rechaza rangos mayores a 30 dias.
- `backend/index.js`: expone departamento y ubicacion del ultimo movimiento en las tarjetas. La ruta solo afecta datos de presentacion del pipeline; no cambia la sincronizacion ni la automatizacion de WhatsApp.
- `frontend/src/style.css`: estiliza los filtros y permite que se acomoden en pantallas estrechas.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron sin errores.
- `node --check backend/index.js`: exitoso.
- Verificacion de alcance: el filtro se envia exclusivamente a `GET /api/ems/pipeline`; la sincronizacion y el procesamiento automatizado de mensajes no reciben parametros de fechas ni departamento.

### Ajuste 2026-09-30: rango historico de hasta 30 dias
- Se amplia el rango seleccionable de 15 a 30 dias calendario (maximo 29 dias de diferencia entre inicio y fin).
- Se puede seleccionar cualquier fecha pasada; al cambiar una fecha, la otra se ajusta automaticamente para mantener el rango valido.
- Las fechas futuras se bloquean en los controles y se rechazan tambien en el backend.
- El rango inicial ahora muestra los ultimos 30 dias. El filtro sigue limitando unicamente las tarjetas visibles del pipeline, sin cambiar la automatizacion de mensajes.
- Verificacion: `npm --prefix frontend run build` y `node --check backend/index.js` exitosos.

### Extension 2026-09-30: filtros por fechas y departamento en Internacionales
- `frontend/src/views/internationalPipelineView.ts`: agrega Desde, Hasta y departamento del ultimo movimiento al encabezado del Pipeline Internacionales.
- `frontend/src/main.ts`: aplica el rango inicial de 30 dias, permite fechas historicas, bloquea fechas futuras y ajusta automaticamente el extremo contrario para no exceder 30 dias; al cambiar filtros solo recarga las columnas locales, sin iniciar sincronizacion ni automatizaciones.
- `backend/index.js`: `/api/internacionales/pipeline` valida rango maximo de 30 dias y filtra por fecha del evento mas reciente antes de paginar. La consulta por rango se ejecuta contra el catalogo persistido; si se elige departamento, reduce candidatos al periodo seleccionado y clasifica la ubicacion del ultimo evento antes de paginar.
- Los filtros solo afectan paquetes mostrados en Internacionales; no alteran sincronizacion global, seguimiento ni mensajeria automatizada.
- Verificacion: `npm --prefix frontend run build` y `node --check backend/index.js` exitosos; no se detectaron problemas en los archivos TypeScript editados.

## Tarea 2026-09-30: reorganizar modal de detalle de tracking

### Solicitud
- Al abrir un paquete desde el Pipeline Internacionales, separar los eventos de la informacion general para facilitar la lectura.

### Cambios aplicados
- `frontend/src/modals/trackingInfoModal.ts`: distribuye la informacion del paquete en el panel izquierdo y el historial de eventos en el panel derecho.
- `frontend/src/style.css`: da al modal mas ancho disponible en escritorio, permite desplazamiento independiente en detalles e historial y cambia a una sola columna en pantallas estrechas.
- Se conserva la lista completa de informacion, eventos, fechas, oficinas y detalles que ya mostraba el modal.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron sin errores.

## Tarea 2026-09-30: completar datos del Pipeline Internacionales

### Problema encontrado
- `/internacionales` consulta el catalogo completo de Tracking, mientras `/internacionales-pipeline` consulta primero `international_tracking_packages`; la tabla podia contener solo una carga parcial anterior.
- Al abrir el Pipeline Internacionales no se solicitaba una sincronizacion completa automaticamente, por lo que las columnas reflejaban solo los registros persistidos hasta ese momento.

### Cambios aplicados
- `frontend/src/main.ts`: en la primera carga del Pipeline Internacionales de cada sesion solicita asegurar la sincronizacion del catalogo y luego carga las paginas de las seis etapas. Si la sincronizacion falla, intenta mostrar los datos persistidos disponibles.
- `frontend/src/main.ts`: la primera carga puede reutilizar el catalogo completo almacenado en caché del backend; el boton de sincronizacion manual sigue solicitando una extraccion forzada.
- `backend/index.js`: `/api/internacionales/sync` usa la caché completa si esta vigente y solo fuerza una nueva extraccion cuando recibe `?force=1`.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron sin errores.
- `node --check backend/index.js`: exitoso.

## Tarea 2026-10-01: habilitar avisos de correspondencia en ventanilla

### Problema y cambio
- Algunos eventos de ventanilla pueden venir con un identificador que el clasificador interpreta como etapa `received`; `notifyPackageEventChanges` descartaba esa etapa antes de evaluar el texto del evento.
- La notificacion ahora admite explicitamente eventos cuyo nombre, estado o firma indique ventanilla/recojo, aun si la etapa base llega como `received`.
- El generador del aviso evalua tambien la firma del evento para usar la plantilla de recojo cuando la marca de ventanilla solo aparece en el estado de la API.
- Se agrego una prueba para evento de ventanilla con etapa `received`, y otra para confirmar que un evento ordinario `received` sigue sin disparar aviso.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/whatsapp-intent.test.js`: 24 pruebas aprobadas.
- `node --check backend/index.js` y `node --check backend/services/whatsapp-package-automation.js`: correctos.
- `git diff --check` sobre los archivos de esta correccion: correcto.
- No se consulto la API externa en vivo; el envío del mensaje real depende de que la fuente devuelva el evento/estado de ventanilla.

## Tarea 2026-10-01: comprobador periodico de conciliacion de WhatsApp

### Solicitud y comportamiento
- Añadir una comprobacion completa configurable, cada 30 minutos por defecto, que detecte intentos faltantes y deje un comprobante visible.
- Durante ese ciclo se omiten los chequeos automaticos normales y se usa el lock del watcher para impedir solapamientos; el backend, webhook y respuestas entrantes siguen activos.
- La carga completa refresca los catalogos de Tracking, Paquetes-Contactos y eventos. Las bienvenidas y actualizaciones pendientes conservan sus controles de automatizacion y deduplicacion.

### Cambios aplicados
- `backend/index.js`: agrega `automaticReconciliation` y `reconciliationIntervalMs` a la configuracion API, activa la comprobacion por defecto cada 30 minutos (minimo 15) y conecta el ciclo al watcher.
- `backend/index.js`: al conciliar, omite las revisiones regulares de ese ciclo, fuerza la sincronizacion pesada, vuelve a revisar bienvenidas elegibles y guarda conteos de paquetes, envios, omisiones y fuentes no disponibles en `system_logs`.
- `backend/index.js`: evita que una carga manual compita con una sincronizacion en curso y publica el ultimo comprobante mediante `/api/settings/automation`.
- `frontend/src/main.ts` y `frontend/src/views/settingsView.ts`: agregan control del intervalo/activacion y muestran fecha, cantidad de paquetes, mensajes enviados/omitidos y fuentes fallidas.
- `backend/services/whatsapp-package-automation.js`: el planificador considera la proxima fecha limite de conciliacion.
- `backend/tests/whatsapp-package-automation.test.js`: valida la programacion del siguiente ciclo de conciliacion.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/whatsapp-intent.test.js`: 25 pruebas aprobadas.
- `node --check backend/index.js` y `node --check backend/services/whatsapp-package-automation.js`: correctos.
- `npm --prefix frontend run build`: exitoso.
- `git diff --check` en los archivos modificados: correcto.
- No se ejecuto una carga pesada real ni se enviaron mensajes reales durante la validacion.

### Correccion posterior: no retrasar bienvenidas ni estados al iniciar
- Causa: el comprobador se consideraba vencido al arrancar el proceso, por lo que hacia la carga completa antes de la primera revision rapida; ademas, se omitian las bienvenidas y eventos cuando coincidian con la conciliacion.
- `backend/index.js`: el intervalo de conciliacion ahora comienza a contar desde el arranque y las revisiones rapidas de bienvenida/estado se ejecutan antes de la carga pesada incluso cuando ambas vencen a la vez.
- Verificacion: 25 pruebas aprobadas; `node --check backend/index.js` y `git diff --check -- backend/index.js task.md` correctos.

## Tarea 2026-10-02: diagnostico de notificaciones de transito, destino y ventanilla

### Hallazgos y correcciones
- Las firmas de eventos solo incorporaban `fecha`; si Tracking/Paquetes-Contactos enviaban `fecha_registro`, `fecha_evento` u otro alias, movimientos posteriores podían producir la misma firma y quedar deduplicados. Ahora se consideran los alias temporales habituales.
- Al consolidar registros de Tracking y Paquetes-Contactos se comparaba la fecha de registro del paquete antes que la del movimiento; eso podía hacer prevalecer una etapa antigua. Se prioriza el timestamp del último evento conocido, con fallback a la fecha del paquete solo si ambas fuentes carecen de fecha de evento.
- Se aseguró que la sincronizacion de pipeline no condicione avisos de evento a que exista una bienvenida previa.
- La pantalla de Configuración ahora muestra también envíos/omisiones de eventos del ciclo rápido y sus motivos, para distinguir entre evento no detectado, sin destinatario, duplicado o envío.

### Archivos
- `backend/index.js`
- `backend/services/whatsapp-package-automation.js`
- `backend/tests/whatsapp-package-automation.test.js`
- `frontend/src/main.ts`
- `frontend/src/views/settingsView.ts`

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/whatsapp-intent.test.js`: 26 pruebas aprobadas.
- `node --check backend/index.js` y `node --check backend/services/whatsapp-package-automation.js`: correctos.
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron.
- `git diff --check` sobre los archivos de esta tarea: correcto.
- No se consulto la API externa ni se enviaron mensajes reales durante esta validacion; la Configuracion ahora mostrara los conteos y motivos del siguiente ciclo real.

## Tarea 2026-10-02: notificacion de paquete devuelto a origen

- Se agrego deteccion de eventos cuyo texto indique devolucion/retorno/devuelto al origen o remitente, sin inferir un codigo de evento que no esta documentado en el catalogo local.
- Cuando se detecta, el CRM envia un mensaje específico de retorno a origen y agrega las fechas locales en que se enviaron avisos de salida a reparto al mismo destinatario. Si no existen avisos registrados, el mensaje lo indica sin inventar fechas.
- Las fechas se obtienen de `system_logs` para notificaciones exitosas de etapa `courier`; el evento sigue sujeto a la configuración de actualizaciones automáticas y a la deduplicación existente.
- Archivos: `backend/index.js`, `backend/services/whatsapp-package-automation.js`, `backend/tests/whatsapp-package-automation.test.js`.
- Verificacion: pruebas unitarias para etiquetas de retorno, elegibilidad y contenido/fechas del mensaje. No se consulto el API postal ni se enviaron mensajes reales; el identificador exacto del evento de retorno debe confirmarse con un payload real de Tracking/Bolipost.

## Correccion 2026-10-05: mostrar ubicaciones de origen y destino en Internacionales

### Problema
- La columna `Origen` podia mostrar `Tracking API`, que identifica la fuente del registro y no el lugar de origen.
- El cambio previo mostraba direcciones del remitente/destinatario en lugar de los lugares informados por los campos `origen` y `destino` de Tracking.

### Cambios aplicados
- `frontend/src/main.ts`: la columna y exportacion muestran `origen.nombre` y `destino.nombre`, con el codigo como alternativa cuando el nombre no existe.
- Si `origen` llega como la etiqueta `Tracking API`, se muestra `Sin dato` en vez de presentarla como lugar postal.
- Si `destino.nombre` y `destino.codigo` son nulos, se muestra `Sin dato`; no se infiere el destino desde una oficina de eventos ni desde la direccion del destinatario.
- La tarjeta del pipeline mantiene su uso anterior de la direccion del destinatario; la nueva resolucion de ubicaciones aplica a la tabla de Internacionales y a su exportacion Excel.
- Para el registro de ejemplo, `origen.nombre` se muestra como `Netherlands (the)` y `destino` como `Sin dato`.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron.
- `git diff --check -- frontend/src/main.ts task.md`: exitoso.
- La API externa no se consulto en vivo; el resultado concreto depende del objeto que entregue Tracking para cada guia.

## Ajuste 2026-10-05: quitar Servicio y corregir origen en Internacionales

### Cambios aplicados
- `frontend/src/main.ts`: se elimina la columna `Servicio` de la tabla de Internacionales y de la exportacion Excel; se actualiza el `colspan` de filas vacias.
- La ubicacion de origen ya no muestra `Tracking API` aunque llegue en `origen.nombre`; usa `origen.codigo` como alternativa y muestra `Sin dato` si no existe un lugar disponible.
- Se conserva el origen real cuando llega en `origen.nombre`, como `Netherlands (the)`.

### Verificacion
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron.
- `git diff --check -- frontend/src/main.ts task.md`: exitoso.
- La API externa no se consulto en vivo; la ubicacion final depende de `origen.nombre` o `origen.codigo` en cada registro.

## Correccion 2026-10-05: conservar paquetes reales cuando SITRA no responde

### Analisis
- La captura muestra el aviso de respaldo local. En ese escenario, `GET /api/tracking/paquetes` usaba contactos sintetizados como paquetes; `mapStoredContactToTrackingPackage` asigna `origen.nombre = "Tracking API"` y no incluye eventos. Por eso las guias como `LX096537093NL` aparecian sin origen/destino ni movimientos reales.
- La hora del respaldo tambien se generaba al atender la solicitud, no representaba la ultima sincronizacion real.
- La captura por si sola no permite determinar por que el upstream SITRA no responde; la indisponibilidad/autorizacion de ese servicio sigue siendo la causa de que no haya datos en vivo.

### Cambios aplicados
- `backend/index.js`: ante fallo del upstream, el respaldo ahora prioriza los payloads completos guardados en `international_tracking_packages`, con origen, destino y eventos originales.
- `backend/index.js`: el endpoint de catalogo completo usa el mismo respaldo persistido; solo recurre a contactos sintetizados si no hay ningun payload de tracking guardado.
- La fecha de respaldo ahora procede de `updated_at` de los registros almacenados, en vez de atribuir al dato una fecha de sincronizacion actual falsa.
- `frontend/src/main.ts`: usa la fecha `cachedAt` del servidor en el listado, para que la hora visible no parezca una sincronizacion recien hecha cuando se estan mostrando datos de respaldo.

### Verificacion
- `node --check backend/index.js`: exitoso.
- `npm --prefix frontend run build`: exitoso; TypeScript y Vite compilaron.
- `git diff --check -- backend/index.js frontend/src/main.ts task.md`: exitoso.
- No se consulto SITRA en vivo; el refresco de datos nuevos requiere que la API externa vuelva a responder correctamente.

## Ajuste 2026-10-05: saludo claro y consulta de otra guia

### Problema
- El saludo solo presentaba a Jaimito y preguntaba en que podia ayudar, sin decir que puede rastrear paquetes ni cotizar envios.
- La frase "Y de este paquete EN000005573LPZ" incluye una nueva guia, pero no las palabras estado/seguimiento/rastreo; podia quedar clasificada como tarifas y reutilizar la cotizacion anterior.

### Cambios aplicados
- `backend/index.js`: el saludo local indica que Jaimito puede ayudar a encontrar un paquete y cotizar el costo de envio.
- `backend/services/whatsapp-intent.js`: reconoce frases de continuidad como "y de este paquete" con una guia como solicitud de tracking, para que la nueva guia se consulte y no se responda con una cotizacion vieja.
- `backend/tests/whatsapp-intent.test.js`: prueba la frase de otra guia y confirma que consultas de precio no se convierten en tracking por error.

### Verificacion
- `node --test backend/tests/whatsapp-intent.test.js`: 6 pruebas aprobadas.
- `node --check backend/index.js`, `backend/services/whatsapp-intent.js` y `backend/tests/whatsapp-intent.test.js`: exitosos.
- `git diff --check` para los archivos modificados: exitoso.

## Ajuste 2026-10-05: fallback internacional de tracking en WhatsApp

### Problema
- La pantalla de Internacionales consulta SITRA usando `query`, pero el bot solo enviaba `q`; SITRA podia ignorar la busqueda y la guia quedaba sin encontrar.
- La frase "Me podrias buscar este paquete" no se clasificaba explicitamente como solicitud de rastreo.

### Cambios aplicados
- `backend/index.js`: busca en SITRA con los parametros `query`, `q` y `codigo_s10`, validando que la coincidencia del codigo sea exacta.
- `backend/index.js`: consulta primero Paquetes-Contactos por codigo; si no encuentra la guia en SITRA, consulta `international_tracking_packages` por codigo exacto.
- `backend/index.js`: desacopla el limite HTTP 429 de la API de eventos para que no bloquee consultas de tracking; admite el paquete cuando la API devuelve el objeto dentro de `data`.
- `backend/index.js`: limita a 8 segundos cada intento de consulta a SITRA y evita recorrer cientos de paginas si el codigo exacto no aparece; esto evita dejar la respuesta de WhatsApp pendiente durante una busqueda exhaustiva.
- `backend/services/whatsapp-intent.js`: "buscar" y "busqueda" clasifican la solicitud como rastreo.
- Cuando la guia aparece en cualquiera de esas fuentes, se procesa mediante el mismo contexto y respuesta de tracking existente.

### Verificacion
- `node --check backend/index.js` y `backend/services/whatsapp-intent.js`: exitosos.
- `node --test backend/tests/whatsapp-intent.test.js backend/tests/whatsapp-package-automation.test.js`: 31 pruebas aprobadas.
- `git diff --check` para los archivos del cambio: exitoso.
- El health check local `GET /api/health` responde HTTP 200; no se expusieron credenciales ni se confirmó una consulta en vivo para `CP532216072CN`.
- Diagnostico en vivo 2026-10-05: SITRA respondio HTTP 401 al consultar la guia usando los parametros `query`, `q` y `codigo_s10`; probar esquemas estandar Bearer, Token y clave API tampoco fue autorizado. Paquetes-Contactos respondio HTTP 200 sin coincidencia exacta, y la base local `international_tracking_packages` no contiene `CP532216072CN`.
- `backend/index.js`: si SITRA y Paquetes-Contactos no autorizan la consulta y tampoco hay copia local, WhatsApp informa que no pudo consultar el sistema en lugar de afirmar que la guia no existe. Para ver movimientos sigue siendo necesario renovar/corregir la credencial autorizada del servicio; no se imprimio ni se altero ningun secreto.

## Reintento automatico de guias no verificadas por WhatsApp

### Comportamiento
- Si una consulta explicita de rastreo no encuentra la guia en ese momento, se persiste la guia y el WhatsApp del cliente en `whatsapp_tracking_retry_queue`.
- El worker del backend vuelve a consultar cada 15 minutos durante un maximo de 24 horas. Si aparece una coincidencia exacta, envia el estado y movimiento disponibles por WhatsApp y marca el trabajo como enviado.
- Se evita crear filas activas duplicadas por la misma guia y remitente. Al vencer el plazo, el trabajo queda expirado.
- Si Meta o el envio fallan luego de encontrar el paquete, el trabajo se reintenta dentro de la misma ventana.
- Alcance acordado: solo rastreos solicitados por el cliente; no se encolan bienvenidas ni otros avisos salientes.
- El worker revisa la cola cada minuto y ejecuta cada rastreo cuando llega su `next_attempt_at`; asi no se desplaza el horario de la guia por el momento de inicio del servidor.

### Archivos
- `backend/db/init.sql`: nueva cola persistente e indices de vencimiento/deduplicacion.
- `backend/index.js`: encolado al fallar el rastreo, worker programado, consulta y envio del estado.
- `backend/services/whatsapp-package-automation.js`: politica de 15 minutos/24 horas.
- `backend/tests/whatsapp-package-automation.test.js`: prueba de intervalos y vencimiento.

### Verificacion
- `node --check backend/index.js`, `backend/services/whatsapp-package-automation.js` y `backend/tests/whatsapp-package-automation.test.js`: exitosos.
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/whatsapp-intent.test.js`: 32 pruebas aprobadas.
- `git diff --check` para los archivos del cambio: exitoso.
- `GET /api/health` local devuelve HTTP 200 despues de cargar la inicializacion del backend.
- Diagnostico de `CP532216072CN`: fila persistida y pendiente, intento 1, siguiente consulta programada 15 minutos despues del ultimo intento, vencimiento a las 24 horas.
- Antes de la correccion del poller, el proceso esperaba 15 minutos desde cada ciclo del watcher y podia pasar de largo `next_attempt_at`; ahora el nuevo backend revisa cada minuto.
- La fuente configurada de Tracking devuelve HTTP 404 y Paquetes-Contactos devuelve HTTP 401 al consultar desde este entorno. Aunque el reintento esta encolado, no podra entregar el estado hasta corregir endpoint/autorizacion del upstream. No se leyeron ni imprimieron valores de `.env`.

## Investigacion manual del reintento CP532216072CN (2026-10-05 16:24)

- Se forzo `next_attempt_at` de la fila pendiente para ejecutar ahora el mismo worker de reintentos, sin enviar ningun estado supuesto.
- La cola registro el intento 6 y lo dejo `pending`; resultado `tracking-source-unavailable`. La proxima consulta quedo programada 15 minutos despues y conserva la expiracion original de 24 horas.
- Se busco el codigo exactamente en `international_tracking_packages` (173078 registros): sin coincidencia, tampoco en `search_text`.
- SITRA configurado actualmente: host `dev.correos.gob.bo:18100`; `/api/tracking/paquetes` responde HTTP 404 en los parametros de busqueda probados.
- Host historico de SITRA `172.65.10.55:8103`: la ruta `/api/tracking/paquetes` existe, pero responde HTTP 401 (no autorizado).
- Paquetes-Contactos responde HTTP 200 pero no devuelve coincidencia exacta por `codigo`.
- No se envio WhatsApp porque ninguna fuente proporciono el estado. Para completar y enviar el estado real se necesita corregir `TRACKING_API_URL` al endpoint SITRA vigente y proveer una credencial autorizada en `.env`; no compartir el secreto en el chat.

## Busqueda paginada tipo Postman para reintentos de tracking (2026-10-05)

- WhatsApp mantiene la busqueda exacta por `query`, `q` y `codigo_s10`; si el API responde correctamente pero no encuentra la guia, cada reintento ahora recorre hasta 100 paginas de 200 registros y compara el codigo de forma exacta.
- La pagina siguiente se guarda en `whatsapp_tracking_retry_queue.tracking_scan_page` para que los ciclos de 15 minutos avancen en el catalogo y vuelvan a la primera pagina al terminar el recorrido.
- Si el API encuentra la guia en una pagina, guarda el registro en `international_tracking_packages` y usa el flujo existente para crear y enviar el estado real por WhatsApp.
- Si la URL configurada responde 404, prueba el host SITRA historico `http://172.65.10.55:8103`; se puede cambiar el respaldo con `TRACKING_API_FALLBACK_URL`. El token sigue usando la variable `TRACKING_SQLSERVER_TOKEN`/`TRACKING_API_TOKEN`, sin imprimir su valor.
- Verificacion en vivo 2026-10-05: el host de desarrollo responde HTTP 404 en `/api/tracking/paquetes`; el host historico responde HTTP 401 con los tokens configurados. Por eso la busqueda paginada esta implementada, pero no puede recuperar ni enviar `CP532216072CN` hasta que SITRA acepte la credencial; no se afirma que la guia no exista.

## Actualizacion manual de paquetes recientes en Internacionales (2026-10-07)

### Cambio aplicado
- `frontend/src/views/internationalPackagesView.ts`: se agrego el boton superior `Actualizar paquetes`; mientras se carga la pagina, muestra `Actualizando...` y queda deshabilitado.
- `frontend/src/main.ts`: al pulsar el boton se vuelve a consultar la pagina 1 de `/api/tracking/paquetes`, que contiene los movimientos mas recientes segun el orden de SITRA, y se actualiza la hora/lista visible.
- Las guias devueltas se incorporan al catalogo ya cargado y reemplazan versiones anteriores con el mismo codigo. Se conservan las demas guias y los filtros activos, sin solicitar una descarga completa del catalogo.
- Si la solicitud falla, devuelve un respaldo o no esta autorizada, no se mezcla como si fuera una actualizacion exitosa.

### Verificacion
- `npm run build` del CRM: compilacion TypeScript y build de Vite exitosos.
- Diagnosticos del editor para `frontend/src/main.ts` y `frontend/src/views/internationalPackagesView.ts`: sin errores.
- `git diff --check` para ambos archivos del frontend: exitoso.

## Correccion 2026-10-09: guia internacional recibida en Bolivia

### Caso reportado
- Guia: `EY592031552US`.
- La fila muestra origen `United States of America (the)`, ultimo evento `Recibir envío en oficina de cambio (entrada)`, ubicacion `Sin dato` y peso `2.565 Kg`.
- El mensaje de WhatsApp indicaba que el paquete estaba en la sucursal del pais de origen y que saldria en un despacho futuro hacia `Sin destino`, aunque el ultimo movimiento confirma la llegada a Bolivia.

### Cambio aplicado
- `backend/services/whatsapp-package-automation.js`: identifica la llegada a partir del evento de recepcion de entrada en oficina de cambio; la misma respuesta indica que llego a Bolivia y que continua el procesamiento, sin inventar sucursal ni disponibilidad de recojo.
- `backend/index.js`: la confirmacion se calcula sobre todos los movimientos disponibles en Tracking y en el historial de eventos, no solo sobre la etiqueta elegida como ultimo movimiento. Asi, un estado concurrente de transito no vuelve a presentar el paquete en el pais de origen.
- `backend/index.js`: los mensajes de transito omiten el destino cuando SITRA lo entrega como `Sin destino`, en vez de incluir ese texto como si fuera un destino real.
- El historial identifica el evento de entrada y el mensaje normal de seguimiento evita afirmar que el paquete ya esta disponible para entrega.
- No se infiere llegada por el mero registro de una guia y se excluyen movimientos de salida.

### Verificacion
- `node --test backend/tests/whatsapp-package-automation.test.js`: validar el evento de entrada, la persistencia de la confirmacion cuando el ultimo movimiento dice transito y el rechazo de eventos de salida.
- `node --check backend/index.js` y `backend/services/whatsapp-package-automation.js`.
- `git diff --check` para los archivos modificados.

## Diagnostico 2026-10-09: paquete EN000007153LPZ sin bienvenida ni eventos

### Hallazgos
- No hay una fila local para `EN000007153LPZ` en el catalogo `international_tracking_packages`, ni coincidencia en contactos del CRM.
- La base local no registra eventos `whatsapp_new_package_welcome_sent/skipped/failed`, `package_event_observed` ni `whatsapp_package_event_update_sent/skipped` para esa guia. Tampoco hay mensaje saliente registrado que contenga el codigo.
- Las conciliaciones recientes del watcher fallan repetidamente con HTTP 403 en la pagina 1 de Tracking. Se reprodujo el fallo con la misma forma de consulta usada por la sincronizacion (`include_declaration=1`, pagina 1, 200 registros). Por ello, la carga completa no sincroniza paquetes ni llega a las fases de bienvenida y conciliacion de eventos.
- La busqueda puntual de la guia en Tracking respondio HTTP 200 pero no devolvio coincidencia exacta. Paquetes-Contactos respondio HTTP 429 durante la busqueda puntual; la API separada de eventos respondio HTTP 401.

### Conclusion y siguiente paso
- El CRM no detecto ni registro esta guia, asi que no pudo generar la bienvenida automatica ni notificar sus movimientos. La evidencia apunta a restricciones de acceso/rate limit en las fuentes externas, no a un fallo del envio de WhatsApp para esta guia.
- Para volver a probar, SITRA debe autorizar la consulta paginada con declaraciones, Paquetes-Contactos debe permitir la consulta sin 429 y la API de eventos requiere autorizacion valida. Despues, ejecutar una sincronizacion/conciliacion y verificar que la guia aparezca en el catalogo y en los logs de notificacion.
- No se consultaron ni documentaron valores de credenciales; no se modifico la logica ni se envio ningun mensaje.

## Diagnostico 2026-10-09: HTTP 403 en Tracking durante el watcher

### Pruebas reproducidas
- Se reviso la presencia de las variables configuradas sin leer ni imprimir sus valores. Tracking usa `TRACKING_SQLSERVER_TOKEN`; no hay un `TRACKING_API_TOKEN` alternativo configurado. Paquetes-Contactos tiene su variable de token especifica.
- Con la misma credencial efectiva de Tracking y la consulta de pagina 1/100 registros, sin `include_declaration`, SITRA respondio HTTP 200 y devolvio 100 registros.
- Repitiendo la consulta con `include_declaration=1`, SITRA respondio HTTP 403, tanto con 100 como con 200 registros por pagina.
- La respuesta HTTP 200 no incluye la propiedad `declaracion_cds`; el backend activa `include_declaration=1` mediante `withTrackingDeclarations()` antes de sincronizar catalogos. Esto explica por que la API funciona para lecturas basicas pero falla en el watcher y en conciliaciones que piden declaraciones.
- Paquetes-Contactos respondio HTTP 200 para la consulta reciente paginada durante esta prueba. En el primer ciclo reportado habia fallado la conexion; el ciclo siguiente obtuvo cuatro paquetes, consistente con una interrupcion temporal recuperada.

### Interpretacion del log
- `duplicate-recipient` para `SL00000108LP` y `SL00000107LP` significa que ya existe una bienvenida enviada a esos destinatarios; el control de deduplicacion evita reenviarla. No es un error de la API ni de WhatsApp.
- La conciliacion completa queda bloqueada por el HTTP 403 de Tracking al solicitar declaraciones. Las consultas basicas siguen autorizadas.
- La API separada de eventos habia respondido HTTP 401 en la prueba anterior; es un problema de autorizacion independiente del 403 de Tracking.

### Conclusion
- No hay evidencia de que el token general de Tracking este vencido: el mismo token devuelve HTTP 200 en la consulta basica. El bloqueo reproducible es especifico de `include_declaration=1`; SITRA debe confirmar si ese parametro requiere otro permiso/credencial o si ya no se admite.
- No se cambio la logica ni se quitaron declaraciones de las consultas, porque ese campo puede ser necesario para conservar el catalogo completo. Tampoco se cambiaron credenciales.

### Aclaracion posterior: API Dev de paquetes nacionales
- El diagnostico HTTP 403 anterior corresponde a SITRA/Tracking y no debe confundirse con la API Dev de paquetes nacionales (`/api/paquetes-contactos`).
- Se verifico el endpoint Dev efectivo sin mostrar la credencial: la consulta paginada de paquetes recientes respondio HTTP 200 y entrego 100 registros. En el log compartido, la primera consulta tuvo un fallo de conexion transitorio y el ciclo siguiente ya leyo 4 paquetes de esa fuente.
- Se reprodujo la solicitud paginada del backend a la API Dev separada de eventos (`/api/paquetes-eventos`): respondio HTTP 401 con el mensaje `Token de acceso invalido, vencido o dado de baja.`. El servidor no distingue si el token es incorrecto, vencio o fue revocado.
- El backend usa la variable dedicada `PAQUETES_EVENTOS_API_TOKEN` para esa ruta. Se confirmo localmente que esta configurada y que su valor no coincide con los tokens configurados para Paquetes-Contactos ni Tracking; los valores no se mostraron.
- Los dos `duplicate-recipient` del log significan que ya habia bienvenidas enviadas a esos destinatarios. No explican el fallo de eventos ni indican un rechazo del API Dev de paquetes.
- No se cambio codigo ni credenciales. Para corregirlo, solicitar al administrador Dev un token vigente/autorizado para `/api/paquetes-eventos`, configurarlo localmente en `PAQUETES_EVENTOS_API_TOKEN` y repetir la prueba. La API `/api/paquetes-contactos` ya respondio HTTP 200 en esta comprobacion.

### Reprueba posterior al cambio de token (2026-10-09)
- Se repitio la consulta paginada a `/api/paquetes-eventos` usando el valor efectivo cargado desde el `.env` raiz del CRM y el esquema Bearer del backend. La API continuo respondiendo HTTP 401 con `Token de acceso invalido, vencido o dado de baja.`.
- `backend/index.js` carga el `.env` ubicado en la raiz del CRM (`path.join(__dirname, '..', '.env')`); no existe `backend/.env`. El `.env` raiz figura con ultima modificacion 2026-10-07 17:55, anterior al reporte de que se actualizo el token el 2026-10-09.
- Esto indica que el token nuevo no esta reflejado en el `.env` raiz que lee el backend, o que el valor actualmente guardado alli sigue sin estar autorizado. No se leyo ni se mostro el secreto. Si se actualizo desde otra pantalla/archivo, esa ruta no es la fuente de esta variable; editar el `.env` raiz y reiniciar el backend antes de volver a probar.

### Configuracion y verificacion del nuevo token (2026-10-09)
- Se actualizaron `PAQUETES_EVENTOS_API_URL` a `https://dev.correos.gob.bo:18100/api/paquetes-eventos` y `PAQUETES_EVENTOS_API_TOKEN` en el `.env` raiz, que esta ignorado por Git.
- La consulta paginada a la API Dev respondio HTTP 200 y devolvio 200 eventos (`data`, `paginacion`, `tipos_incluidos`, `nota`).
- No se guardo el token en este documento ni en el codigo. Reiniciar el backend para que la ejecucion normal del watcher continue con la nueva configuracion.

### Diagnostico: API de eventos correcta, avisos automaticos deshabilitados (2026-10-09)
- La API configurada responde HTTP 200. En una consulta de diagnostico, la primera pagina incluyo eventos con campos de codigo y fecha que el backend reconoce; esto confirma conectividad y compatibilidad basica del formato, pero no garantiza que cada evento tenga un paquete/destinatario notificable.
- El backend local tiene `WHATSAPP_STAGE_WATCHER_ENABLED=false` y `WHATSAPP_NEW_PACKAGE_WATCHER_ENABLED=false`. El segundo valor de entorno prevalece sobre `automaticStatusUpdates=true` guardado en la configuracion de automatizacion; con ambos flags apagados no se ejecuta el flujo del watcher que notifica cambios de estado.
- La ultima revision rapida registrada consulto 6 paquetes de Paquetes-Contactos y 0 de Tracking, con 0 mensajes de evento enviados y 4 omitidos. No habia registros recientes de envio/fallo/omision individual de eventos, consistente con la automatizacion deshabilitada.
- Conclusion: el bloqueo observado no es la URL ni la autenticacion de la API de eventos; son los flags de automatizacion del `.env`. No se habilitaron porque hacerlo puede enviar mensajes automaticamente a destinatarios reales; se requiere confirmacion antes de cambiar este comportamiento.
- La consulta mostro solo cantidades, nombres de campos y estados; no se registraron credenciales, telefonos ni codigos de paquete.
- Tras la confirmacion del usuario, se cambiaron ambos flags locales a `true`. Reiniciar el backend para que cargue la configuracion y active el watcher. No se envio un mensaje manual de prueba.

### Seguimiento de eventos: EN000006443LPZ (2026-10-09)
- Se reviso en modo de solo lectura. La guia tiene registro local de bienvenida, pero no tiene registros individuales de evento observado, aviso omitido ni aviso enviado. Esto indica que el CRM no llego a registrar un movimiento notificable para esta guia.
- La ultima revision rapida, a las 18:03 UTC, registro 0 avisos de eventos y 4 paquetes omitidos. La automatizacion de eventos figura habilitada en la configuracion guardada.
- Se compararon los tiempos locales: el proceso Node del backend inicio a las 17:33 UTC y el `.env` con los flags activados se modifico a las 17:51 UTC. Como `WHATSAPP_STAGE_WATCHER_ENABLED` se lee al arrancar y controla si se ejecuta la revision rapida de eventos, el proceso activo seguia usando la configuracion anterior. Esto explica que la revision de bienvenida omitiera el flujo de eventos aunque los flags del archivo ya estuvieran en `true`.
- Una consulta exacta actual a la API de eventos para esta guia respondio HTTP 429 en todos los parametros de busqueda probados; por limite de solicitudes no se pudo confirmar el movimiento mas reciente directamente. La conectividad previa al catalogo general respondio HTTP 200, pero eso no sustituye la consulta de esta guia.
- Siguiente paso: reiniciar el backend para que cargue los flags y dejar que el siguiente ciclo normal consulte y procese eventos. No se forzo una sincronizacion ni se envio un mensaje manual; al reiniciar, un evento elegible nuevo puede generar un WhatsApp a los destinatarios asociados.
- La comprobacion no mostro ni guardo credenciales o telefonos.

### Automatizacion independiente para eventos de ventanilla (2026-10-09)
- Se confirmo que ya existian el texto del aviso de ventanilla y la elegibilidad por frases como `ventanilla`/`pendiente de recojo`, pero estaban dentro del mismo flujo de notificaciones generales y no tenian una automatizacion propia.
- Se agrego `automaticVentanillaNotifications` como control separado en Configuraciones, activado por defecto. Su revision usa la frecuencia de eventos configurada, pero puede funcionar aunque `automaticStatusUpdates` este apagado.
- Se separo la ruta de notificacion: Cambios de evento excluye los movimientos de ventanilla y Avisos de ventanilla solo procesa esos movimientos. Conserva la deduplicacion por guia, movimiento y destinatario para no duplicar mensajes.
- Se incorporo el resultado de ventanilla a los registros del watcher/conciliacion y al estado visible en Configuraciones.
- Para que entre en vigor, guardar la configuracion desde la interfaz (o reiniciar el backend si se modifica el archivo); no se envio ningun mensaje manual de prueba. Un aviso requiere que la API entregue el evento, que el contacto tenga destinatario valido y que Meta acepte el envio.
- Validacion: `node --test backend/tests/whatsapp-package-automation.test.js` (29/29), `node --check backend/index.js`, `node --check backend/services/whatsapp-package-automation.js`, build del frontend (`tsc && vite build`), diagnosticos del editor sin errores y `git diff --check`; todos pasaron.

### Revision de avisos de tránsito, destino, cartero y cancelación (2026-10-09)
- Se verifico que los movimientos `transit`, `regional` (llegada a destino) y `courier` ya estaban clasificados, elegibles para notificacion general y tenian textos especificos.
- Se encontro que `cancelled` tambien se clasificaba, pero `isPackageEventNotificationEligible` lo rechazaba, por lo que el aviso nunca alcanzaba el envio. Ahora la etapa cancelada es elegible para el canal general; retorno a origen conserva su mensaje especializado y precedencia.
- Se separo el texto de cancelacion del de devolucion: informa que el sistema registra el envio como cancelado, incluye ubicacion si existe y no afirma un motivo ni que el paquete haya sido devuelto.
- Ventanilla sigue usando su control independiente; los avisos de tránsito, destino, cartero y cancelación permanecen bajo `automaticStatusUpdates`.
- Se añadieron pruebas para elegibilidad de tránsito/destino/cartero y cancelación, y para evitar confundir cancelación con devolución.
- Validacion: `node --test backend/tests/whatsapp-package-automation.test.js` (31/31), `node --check backend/index.js`, `node --check backend/services/whatsapp-package-automation.js`, diagnosticos del editor y `git diff --check`; todos pasaron.

### Seguimiento de llegada a destino: EN000006444LPZ
- La API Dev muestra como destino TARIJA; los eventos disponibles culminan en `Paquete recibido en oficina origen de transito`. Esto acredita que el paquete sigue en una oficina de tránsito de origen, no que ya llegó a Tarija.
- En los registros locales, el evento 240 `Saca interna creada (salida)` sí generó un WhatsApp. El evento 297 de recepción en oficina de origen se omitió como `ineligible-stage`: el clasificador lo trataba como `received`, aunque el ID también se usa para recepciones en oficinas de destino.
- Se ajustó la clasificación del evento 297 para interpretar una recepción posterior a un despacho de tránsito como llegada a la siguiente oficina, incluso si la API repite la etiqueta `origen de tránsito`. Una primera recepción antes de cualquier despacho sigue como recepción/tránsito, y la llegada explícita a oficina de destino continúa siendo regional.
- Así no se anuncia prematuramente que llegó a Tarija y el movimiento de tránsito puede notificarse por el canal general. Para que se procese con la lógica nueva, reiniciar el backend y esperar el siguiente ciclo; el envío depende de que el evento siga disponible, haya destinatario asociado y Meta acepte el mensaje.
- Se añadieron pruebas para origen, destino explícito y el evento 297 genérico tras tránsito previo.

### Ajuste contextual de llegada para EN000006445LPZ (2026-10-09)
- A solicitud del usuario, se ajustó la interpretación del evento 297: cuando existe un movimiento anterior de tránsito/despacho, su siguiente recepción se considera llegada a la siguiente oficina (etapa regional), aunque la API reutilice el texto `Paquete recibido en oficina origen de transito.`.
- La firma de deduplicación ahora distingue la etapa. Así, el aviso de tránsito previamente enviado para la misma firma no bloquea el nuevo aviso regional; una vez enviado el aviso regional, los ciclos siguientes sí lo reconocen como duplicado.
- Se amplió la detección del identificador para preferir campos numéricos si el primer campo viene con una etiqueta de etapa como `TRANSIT`.
- Se añadieron pruebas para el identificador `TRANSIT` junto con `codigo_evento: 297`, y para separar una recepción inicial de una recepción posterior al tránsito.
- Validación: `node --test backend/tests/whatsapp-package-automation.test.js` (32/32), `node --check backend/index.js`, `node --check backend/services/whatsapp-package-automation.js`, `git diff --check`; todos pasaron. Reiniciar el backend para activar el cambio y que el siguiente ciclo procese la llegada.

### Seguimiento de llegada y WhatsApp: EN000006445LPZ (2026-10-09)
- La API Dev respondió HTTP 200 y muestra destino SUCRE con cuatro movimientos: recepción del cliente, recepción en oficina origen de tránsito, salida de saca interna y otra recepción en oficina origen de tránsito. El último movimiento disponible figura en LA PAZ; no hay evento que confirme recepción en Sucre.
- El CRM registró el evento más reciente como `transit` y la etiqueta `Paquete recibido en oficina origen de transito.`. Su aviso de cambio de estado fue aceptado y quedó registrado como enviado; el callback de Meta para ese mismo mensaje avanzó a `delivered` y `read` pocos segundos después. Por tanto, no aparece un fallo de entrega en WhatsApp para ese aviso.
- La guía también tiene un registro separado de bienvenida enviado en el mismo ciclo. El aviso de llegada a Sucre no se generó porque todavía no existe un movimiento de llegada a oficina/sucursal de destino en la respuesta actual de la API; destino SUCRE por sí solo no prueba que el paquete haya llegado.
- Investigación de solo lectura; no se modificó lógica ni se forzó envío. Si el paquete ya llegó físicamente, revisar que SIOP registre/sincronice el evento de recepción en la oficina de destino y esperar la siguiente consulta del watcher.
- Se consultaron solo el estado del envío y ubicaciones/eventos; no se guardaron ni documentaron teléfonos, tokens ni credenciales.

### Diagnostico: aviso de EN000006445LPZ no llego al destinatario esperado (2026-10-09)
- Se confirmo que el CRM registro el mensaje de tránsito para el evento mas reciente, y Meta reporto el mensaje como `sent`, `delivered` y `read`. Ese estado corresponde al destinatario usado por el CRM, no demuestra que lo recibiera el titular del paquete.
- La configuracion guardada de WhatsApp tiene el modo de prueba activado y el destinatario del aviso coincide con un numero de prueba configurado. Ademas, ese destinatario no coincide con el WhatsApp actualmente registrado en el contacto del paquete. Esto explica por que el titular no recibio el aviso aunque Meta muestre el mensaje como leido.
- La bienvenida y el aviso de evento se enviaron al mismo destinatario de prueba. No se expusieron ni guardaron numeros, tokens ni otros valores de configuracion.
- No se cambio la configuracion ni se forzo un reenvio para evitar activar notificaciones a destinatarios reales sin autorizacion. Para que los avisos lleguen al destinatario del paquete, desactivar Modo de prueba en la configuracion de WhatsApp y verificar que el contacto tenga su numero correcto; el siguiente ciclo puede reevaluar el evento vigente para el destinatario normal.

### Revalidacion del mensaje de comprobacion de EN000006445LPZ (2026-10-09)
- Se inspecciono el cuerpo exacto de la bienvenida registrado: incluye la guia `EN000006445LPZ` y el destino SUCRE. Meta reporto ese mensaje como `sent`, `delivered` y `read`; el CRM no muestra fallo de envio para la bienvenida.
- El saludo usa un nombre distinto al nombre actual del contacto CRM, lo que apunta a que el dato de nombre recibido para el destinatario no es confiable; no se reemplazo por otro nombre ni se modificaron los datos del contacto.
- Correccion del diagnostico anterior: la comparacion previa miro un solo perfil WhatsApp. Al comprobar todos los perfiles vinculados, el destinatario del mensaje coincide con uno de ellos y tambien esta configurado como numero de prueba; por tanto, no se puede afirmar que el aviso se envio a un telefono ajeno al contacto. El modo de prueba sigue activado.
- La comprobacion de solo lectura confirma que el codigo de paquete si esta en el mensaje guardado. Si el cliente indica que no lo ve, revisar el chat del WhatsApp asociado al perfil que recibio el mensaje y corregir el nombre en el origen de datos si corresponde. No se reenvio para evitar duplicar el aviso.

### Revision de aviso de llegada a destino para EN000006445LPZ (2026-10-09)
- Los registros del CRM solo contienen eventos hasta las 15:07:31 (hora local): el movimiento mas reciente es `Paquete recibido en oficina origen de transito`, ubicacion LA PAZ. No hay un evento de llegada/recepcion en SUCRE que pueda activar el mensaje de llegada a destino.
- El movimiento de las 15:07:31 se proceso como `transit`; su WhatsApp fue enviado y Meta confirmo `sent`, `delivered` y `read`. Las omisiones posteriores corresponden al canal independiente de ventanilla y a deduplicacion; no representan una omision de llegada a destino.
- Una consulta actual a la API Dev respondio HTTP 429 (limite de solicitudes), por lo que no se pudo comprobar si SIOP agrego un movimiento posterior. La ultima informacion verificable sigue siendo la recepcion en oficina de origen de transito, no la llegada a Sucre.
- Conclusion: no se envio el aviso de llegada porque no existe un evento de destino registrado en los datos disponibles. Cuando la API vuelva a permitir consultas, verificar la nueva secuencia; si el paquete ya esta fisicamente en Sucre, confirmar que SIOP registre la recepcion en la sucursal destino. No se forzo envio ni se mostro informacion personal.

### Revision de declaraciones en paquetes internacionales (2026-10-09)
- El backend y la pantalla de Tracking solicitan `include_declaration=1` al endpoint `/api/tracking/paquetes`; el modelo del frontend contempla `declaracion_cds` con estados `declarada`, `objeto_sin_declaracion`, `sin_objeto_cds` y `consulta_incompleta`.
- La consulta actual de la API de Tracking respondio HTTP 403, asi que no fue posible confirmar directamente si hoy el upstream devuelve declaraciones ni validar datos de un paquete concreto.
- El catalogo local contiene 174713 registros y ninguno incluye actualmente la propiedad `declaracion_cds`. Por tanto, la base local no permite saber si esos paquetes tienen declaracion.
- La interfaz solo declara el tipo de `declaracion_cds`; no se encontro una vista que presente sus valores. La capacidad esta prevista en las consultas/tipos, pero hoy no hay evidencia de disponibilidad de datos y la API rechaza la consulta con la configuracion efectiva.
- Revision de solo lectura; no se mostro ni documento ningun token, contenido de declaracion o dato personal.

### Vista de declaraciones por paquete internacional (2026-10-09)
- Se agrego una columna `Declaración` a la lista internacional con resumen por paquete: declarada (cantidad), objeto sin declaración, sin objeto CDS, consulta incompleta o no consultada.
- El boton `Información` ahora incluye el estado CDS, objetos asociados, declaraciones por objeto, numero/estado/etapa, resumen, campos, articulos y documentos, escapando el contenido antes de renderizarlo.
- La vista diferencia dato ausente (API no incluyo `declaracion_cds`) de un resultado de consulta sin objetos CDS, evitando mostrar ausencia como una confirmacion de que no existe declaracion.
- La API habia respondido HTTP 403 en la revision previa, asi que la UI podra mostrar datos reales cuando Tracking vuelva a responder con el campo solicitado mediante `include_declaration=1`; mientras falte, mostrara `No consultada`.
- Validacion: `npm --prefix frontend run build`, diagnosticos del editor y `git diff --check`; todos pasaron.

### Aclaracion: destinos por paquete internacional (2026-10-09)
- El usuario aclaro que por “declaraciones” se refiere a los lugares/departamentos de destino de los paquetes, no a formularios aduaneros. No se modifico la vista aduanera anterior en esta revision.
- Se resumieron los 100 registros mas recientemente importados del catalogo local: 32 muestran el pais Bolivia, 1 China, 1 Espana y 66 tienen `destino.nombre` y `destino.codigo` vacios. La ultima importacion local registrada fue 2026-10-09 14:27:18.
- En esa muestra, el objeto `destino` solo contiene `codigo` y `nombre`; no hay campo de departamento/declaracion local que permita desglosar destinos dentro de Bolivia.
- La consulta previa a la API de Tracking respondio HTTP 403; por ello esta muestra es del catalogo local y no confirma una lectura en vivo actual. No se leyeron ni mostraron codigos de paquete o datos de personas.

## Tarea 2026-10-11: consolidacion de declaracion CDS y correcciones del pipeline internacional

### Estado actualizado
- Se consolidaron los cambios recientes en la lectura y visualizacion del tracking internacional para mantener la memoria del proyecto alineada con la ultima revision tecnica.
- El foco principal fue la sincronizacion del catalogo de tracking con el campo `declaracion_cds`, la navegacion de paginas y la apertura del detalle de paquetes desde el pipeline internacional.
- Se mantuvieron los valores secretos en `.env` fuera de este documento y solo se documentaron nombres de variables y criterios de seguridad.

### Cambios aplicados
- `README.md`: se agrego una nota explicita sobre el uso de `include_declaration=1` en `/api/tracking/paquetes`, la necesidad de permiso `sqlserver.read` + `cds.read`, y la restriccion de tratar datos de declaracion como si fueran siempre disponibles.
- `backend/index.js`: se reforzo la carga del catalogo de tracking para conservar `declaracion_cds` cuando la API la devuelve, usando la estrategia de fallback solo cuando la respuesta no la incluye o la fuente esta bloqueada por permisos.
- `frontend/src/main.ts`: se corrige la evaluacion de `trackingApiHasMore` para usar el total real cuando la API lo expone, y se agrega soporte para abrir el modal de detalle desde las columnas paginadas del pipeline internacional, no solo desde el catalogo general.
- `frontend/src/modals/trackingInfoModal.ts`: se protege la renderizacion de `declaracion_cds` para que no falle cuando faltan objetos, listas o campos parciales.
- `frontend/src/views/internationalPipelineView.ts`: se mantiene el orden del pipeline y el conteo total por columnas, con comportamientos estables aun cuando el catalogo llega parcial o desordenado.
- `frontend/src/style.css`: se ajustan estilos de las columnas y controles del pipeline para reflejar el estado de carga y orden, sin introducir cambios de layout ajenos.

### Verificacion
- `npm --prefix frontend run build`: exitoso.
- `node --check backend/index.js`: exitoso.
- `git diff --check`: exitoso para los archivos involucrados.

### Conclusiones
- La integracion del pipeline internacional queda consistente con el manejo de datos de declaracion CDS y los fallbacks del catalogo local.
- El flujo sigue siendo seguro desde la perspectiva de almacenamiento de secretos: no se registraron tokens ni valores sensibles en `task.md` ni en el codigo.
- La siguiente comprobacion util es volver a consultar la API de Tracking con `include_declaration=1` cuando la autorizacion de SITRA este reinstalada; mientras tanto, la UI muestra el estado `No consultada` o usa el catalogo local sin convertir ausencia de datos en evidencia de inexistencia.

## Diagnostico 2026-10-11: error al iniciar sesion en entorno local

### Hallazgo
- El frontend local esta escuchando en el puerto `5173`, pero el backend no tenia un proceso escuchando en `3001`.
- `GET http://localhost:5173/api/health` devuelve HTTP 502 desde el proxy de Vite, por lo que la interfaz no puede completar el inicio de sesion mientras el backend este detenido.
- No se intento iniciar el backend durante el diagnostico: al arrancar tambien activa los watchers de automatizacion de WhatsApp y podria procesar notificaciones pendientes.

### Cambio aplicado
- `frontend/src/main.ts`: el envio del formulario detecta HTTP 502/503/504 y fallos de red, y muestra el comando para iniciar el backend (`npm --prefix backend run dev`), en vez de dejar un mensaje tecnico o generico.

### Verificacion y siguiente paso
- Verificado: frontend escuchando en `5173`, backend no escuchando en `3001`, proxy de Vite devuelve HTTP 502 para `/api/health`.
- Iniciar el backend en una terminal desde la carpeta del proyecto y volver a probar el login. Si el backend inicia pero el login sigue fallando, revisar el mensaje de error del endpoint sin compartir contrasenas ni secretos.

## Correccion 2026-10-11: memoria del watcher y logs de eventos duplicados

### Diagnostico
- `Evento ya enviado` es el resultado esperado de la deduplicacion y significa que el mismo evento/destinatario no se reenvia.
- El mensaje `Nuevo evento detectado ... preparando mensaje` se escribia antes de consultar la deduplicacion, por lo que parecia que se iba a enviar aunque despues se omitiera.
- La sincronizacion pesada descargaba catálogos completos de eventos, Tracking y Paquetes-Contactos simultaneamente, reteniendo todas las filas crudas durante el armado y la actualizacion del pipeline. Tracking puede solicitar hasta 5000 paginas; este patron elevaba el pico de memoria del proceso Node.
- Los errores `No se pudo conectar ... pagina 1` son fallos de conectividad con las APIs externas, independientes del control de duplicados. Se agrego reintento breve para fallos de red transitorios; si persisten, requieren revisar disponibilidad/red del servicio externo.

### Cambios aplicados
- `backend/index.js`: la sincronizacion completa ahora procesa paginas de Tracking y Paquetes-Contactos conforme llegan, registra las entradas normalizadas y no acumula los catálogos crudos completos en arrays o caché.
- `backend/index.js`: el catalogo completo de eventos tambien se procesa por paginas, conservando en memoria solo el evento mas reciente por guia.
- `backend/index.js`: las fuentes completas se consultan secuencialmente en vez de descargar los tres catálogos en paralelo.
- `backend/index.js`: `fetchAllPaginatedItems` admite procesamiento por pagina sin retener resultados y reintenta hasta dos veces errores de red con espera incremental.
- `backend/index.js`: el log `Nuevo evento detectado ... preparando mensaje` ahora se emite solo despues de confirmar que el destinatario no tiene ya ese evento; los duplicados solo muestran el mensaje de omision.

### Verificacion y operacion
- `node --check backend/index.js` y `node --check backend/services/whatsapp-package-automation.js`: exitosos.
- `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js`: 59 pruebas aprobadas.
- `git diff --check -- backend/index.js task.md`: exitoso.
- Reiniciar el backend para activar los cambios. Si continua el fallo de conexion a Tracking o Paquetes-Contactos, investigar la disponibilidad de esos servicios; los reintentos no sustituyen el acceso al API.

## Correccion 2026-10-11: proxy de Vite al cargar el dashboard

### Diagnostico
- El proxy ya tenia un limite de 15 minutos y el cliente espera hasta 60 segundos; no era un timeout corto configurado en Vite.
- `GET /api/dashboard` tardaba entre 30 y 33 segundos en los registros compartidos. Su consulta buscaba mensajes con un `OR` y normalizaba el telefono de cada fila dentro de dos consultas laterales por contacto, evitando busquedas eficientes por indice y pudiendo saturar la conexion proxy/backend.
- En la comprobacion posterior, backend directo y Vite a `GET /api/health` respondieron HTTP 200; la API estaba disponible, aunque esto no descarta fallos intermitentes al ejecutar el dashboard.

### Cambios aplicados
- `backend/index.js`: la consulta del dashboard ahora busca el ultimo mensaje y el ultimo mensaje entrante por separado, con consultas ordenadas y limitadas; combina las coincidencias por `contact_id` y por telefono normalizado sin el `OR` que provocaba recorridos costosos.
- `backend/db/init.sql`: agrega indices para los mensajes mas recientes por contacto y por telefono normalizado, incluyendo indices parciales para mensajes entrantes.
- Se conserva el formato de respuesta del dashboard; el frontend y el timeout del proxy no se modificaron.

### Verificacion y operacion
- Verificado: `node --check backend/index.js`, `node --test backend/tests/whatsapp-package-automation.test.js backend/tests/ems-calculator.test.js` (59/59) y `npm --prefix frontend run build`.
- `git diff --check -- backend/index.js backend/db/init.sql task.md` sin errores. El build conserva la advertencia existente sobre el tamaño del bundle principal.
- Reiniciar el backend para que aplique los nuevos indices al inicializar PostgreSQL; no reiniciar automaticamente porque el arranque activa los watchers de WhatsApp.
- Despues del reinicio, comprobar que `GET /api/dashboard` termina sin el error de proxy y que su duracion disminuye frente a los ~30 segundos registrados.

## Correccion 2026-10-11: prioridad del servicio actual en cotizaciones WhatsApp

### Revision de la conversacion
- Las cotizaciones de las 4:44 p. m. (Delivery Express, 3 kg, modalidad indicada) y 4:45 p. m. (EMS Nacional) identifican correctamente el servicio.
- La respuesta de las 4:53 p. m. es incorrecta: el mensaje actual pide Delivery Express y no debe responder con EMS heredado.
- A las 4:57 p. m., 6 kg supera el maximo de Delivery Express; no se debe cotizar EMS automaticamente sin confirmar el cambio. La nueva ruta a Cochabamba tampoco debe reemplazarse por Santa Cruz.
- La solicitud rural de Achacachi debe respetar la regla existente: Delivery Express no aplica a comunidades/provincias y se orienta a EMS, sin heredar la ruta/peso anterior.
- En la pregunta de 500 g y dimensiones, la politica de Delivery Express debe responderse aunque falte modalidad o ruta; no corresponde reutilizar una tarifa EMS anterior.
- Las respuestas a las entradas `#FREE-2026`, JSON de override y auditoria son correctas y se conserva la proteccion. En la cotizacion multiple, el item 1 queda pendiente por modalidad, los otros dos se cotizan y el total parcial excluye correctamente el pendiente.

### Cambios aplicados
- `backend/services/whatsapp-tariff-routing.js`: agrega un selector testeable que da prioridad al servicio explicito del mensaje actual antes de categorias EMS pendientes, peso heredado o servicio anterior.
- `backend/index.js`: utiliza esa prioridad; un pedido explicito de Delivery Express por encima de 5 kg ya no se convierte silenciosamente en una cotizacion EMS.
- `backend/services/whatsapp-tariff-routing.js`: extrae la deteccion de preguntas sobre dimensiones para validarla directamente en pruebas; su politica ya se ejecutaba antes de solicitar los campos de ruta/modalidad.
- `backend/tests/whatsapp-tariff-routing.test.js`: cubre cambios EMS/Delivery Express dentro de la conversacion y preguntas de dimensiones sin modalidad.

### Verificacion y operacion
- Verificado: `node --check backend/index.js`, `node --check backend/services/whatsapp-tariff-routing.js`, 38 pruebas EMS/routing/intencion aprobadas y `npm --prefix frontend run build`.
- `git diff --check` sin errores. El build del frontend conserva la advertencia existente sobre el tamaño del bundle.
- El backend local observado inicio a las 17:26:24, despues de las respuestas de 16:53–17:08. Al guardar `backend/index.js`, el watcher de desarrollo reinicio automaticamente el backend a las 17:36:15; `GET /api/health` devolvio estado `ok`. Ese reinicio vuelve a activar los watchers de WhatsApp; no se inicio un segundo proceso.

## Diagnostico 2026-10-12: destino declarado en CDS / departamento por paquete

### Hallazgo
- En SITRA el campo correcto para el departamento declarado del paquete es `declaracion_cds.objetos[].declaraciones[].destino_declarado.departamento`, y para la ciudad es `destino_declarado.ciudad`.
- El valor del departamento no viene de `declaracion_cds` en general; viene del bloque `destino_declarado` generado por el parser CDS usando los campos `RSta` (departamento) y `RCty` (ciudad).
- El proyecto CRM estaba leyendo la declaración de forma parcial y no mostraba ese destino en el modal de detalle del paquete, aunque la API de SITRA ya lo trae cuando la consulta incluye `include_declaration=1` y el token tiene permiso `cds.read`.

### Cambios aplicados
- `frontend/src/main.ts`: se extiende el tipo `TrackingApiPackage` para incluir `destino_declarado`, `destinos_declarados` y los campos `departamento`, `ciudad` y `pais_codigo`.
- `frontend/src/modals/trackingInfoModal.ts`: se agrega la renderizacion del `Destino declarado` en cada declaración y un resumen agregado de `destinos_declarados` para que el departamento aparezca en la UI del paquete.
- Se documenta la regla de negocio: la declaración CDS no sustituye el destino del paquete, sino que aporta el destino declarado en aduanas para ese objeto.

### Verificacion y operacion
- `npm --prefix frontend run build`: exitoso.
- Se valida la lógica existente en SITRA y el proyecto CRM: el dato correcto esta en `destino_declarado` y no en un campo genérico de `departamento` del paquete. La ausencia del valor en la UI no significa que la API no la esté enviando; suele indicar que la consulta no incluye CDS o que el token no tiene `cds.read`.
- Para volver a probar en producción, confirmar `include_declaration=1` y que el token autorizado tenga `cds.read` en SITRA; si falta ese permiso, la API responde sin ese dato o con el estado `consulta_incompleta`.

## Diagnostico 2026-10-12: API actual rechaza la consulta con declaraciones CDS

### Prueba de solo lectura
- Se consulto la URL de Tracking configurada en el CRM, sin mostrar ni guardar URL ni credenciales.
- Con `include_declaration=0`, pagina 1 y 25 registros: HTTP 200, 25 paquetes.
- Con `include_declaration=1`, mismos parametros: HTTP 403; la respuesta fue clasificada como error de permiso. No se recibieron paquetes ni declaraciones en esta consulta.
- Por tanto, actualmente no se puede confirmar ningun departamento de destino declarado desde la API. La causa comprobada es que el endpoint rechaza la solicitud ampliada; no es un problema de renderizado de los departamentos recibidos.

### Flujo CRM y cambio
- `backend/index.js` solicita `include_declaration=1`; ante HTTP 403 responde con catalogo local de respaldo, que puede no contener `declaracion_cds`. La interfaz muestra el aviso de respaldo cuando la API externa falla.
- `frontend/src/modals/trackingInfoModal.ts` presenta el departamento cuando viene en `destinos_declarados[]` o `declaracion_cds.objetos[].declaraciones[].destino_declarado`.
- `frontend/src/main.ts`: se corrigio el tipo `TrackingApiPackage`; `destinos_declarados` pertenece al nivel del paquete, de acuerdo con la respuesta de SITRA, no dentro de `declaracion_cds`.

### Siguiente paso y validacion
- SITRA debe autorizar al token utilizado por el CRM con `cds.read` y confirmar que la lectura CDS este habilitada. No se modificaron permisos ni credenciales.
- Repetir las dos consultas despues del cambio: ambas deben responder HTTP 200 y la consulta ampliada debe incluir `declaracion_cds`; solo entonces se podra validar cuantos departamentos llegan.
- Verificacion de esta revision: consulta segura con conteos agregados; no se imprimieron tokens, codigos de paquete ni datos personales.

## Diagnostico 2026-10-12: expediente CDS si tiene destino, el token API del CRM no puede leerlo

### Evidencia del expediente y del codigo SITRA
- La captura compartida de `/conjunto` muestra la declaracion aduanera del paquete consultado y el destino declarado en Tarija. El flujo web usa `PostalWorkspace::search()` y `CdsRepository::search()`.
- La API consumida por el CRM es otra ruta: `GET /api/tracking/paquetes`. En `SqlServerPackageListController`, el destino declarado se forma desde los campos CDS `RCty` (ciudad) y `RSta` (departamento) y se expone en `declaracion_cds.objetos[].declaraciones[].destino_declarado` y `destinos_declarados[]`.
- Esa ruta requiere un token Sanctum ligado a un administrador, con `sqlserver.read`; para incluir declaraciones requiere ademas `cds.read`. La cuenta y contraseña de acceso web no sustituyen ese token de integración.

### Prueba actual, busqueda exacta sin exponer datos
- Consulta a la API configurada en CRM con el codigo compartido, pagina 1 y `include_declaration=0`: HTTP 200; la busqueda encontró 2 filas y, de forma esperada, no incluyo `declaracion_cds`.
- Misma consulta con `include_declaration=1`: HTTP 403 y mensaje clasificado como falta del permiso CDS; no devolvio paquetes ni departamentos.
- Esto confirma que el problema actual no es el mapeo de `RSta` ni que el expediente web carezca de declaracion: el token/API no esta autorizado para leer CDS. El frontend no puede mostrar departamentos que el endpoint rechazó.

### Verificacion de SITRA y accion operativa
- `php artisan test --filter=declaration --stop-on-failure` desde SITRA: 8 pruebas aprobadas (96 assertions), incluyendo el contrato de `departamento` y `ciudad` en la respuesta API.
- SITRA documenta emitir un token de integracion para un administrador con `--ability=sqlserver.read,cds.read`; actualizar en el entorno del CRM el token de tracking y reiniciar el backend. Verificar que la solicitud exacta con `include_declaration=1` responda HTTP 200 y devuelva destino declarado antes de retirar el token anterior.
- No se modifico el permiso del servidor, no se emitio token y no se utilizo la contraseña de acceso web compartida en el mensaje. Por seguridad, cambiar esa contraseña mediante el canal de administracion porque fue incluida en la conversacion.

## Diagnostico 2026-10-12: boton de actualizacion en /internacionales

### Revision del flujo y del entorno local
- `frontend/src/views/internationalPackagesView.ts` conecta el boton `Actualizar paquetes` con `refreshTrackingApiPackages()`.
- Esa funcion vuelve a pedir la pagina actual (por defecto la primera) mediante `GET /api/tracking/paquetes?...&include_declaration=1`; no ejecuta la sincronizacion completa `POST /api/internacionales/sync?force=1`.
- Si SITRA responde error, `backend/index.js` devuelve la pagina guardada localmente con `warning` y `upstreamStatus`, en vez de datos recientes del proveedor. En ese caso el boton no incorpora el resultado al catalogo: la funcion termina al detectar el aviso de respaldo.
- La vista muestra el aviso generico de respaldo local, por lo que puede parecer que la lista se recargo aunque las filas provengan de la ultima sincronizacion exitosa.
- Comprobacion local: `/internacionales` sirve la app web, `GET /api/health` responde 200 y `/api/ai/health` requiere autenticacion (401). El navegador sin sesion activa redirige al login; no se uso ninguna credencial para entrar.
- La consulta externa mas reciente de esta revision sigue siendo HTTP 403 para `include_declaration=1`; la consulta sin declaraciones responde HTTP 200. Por ello el refresh del CRM continua sin poder obtener una pagina completa con declaraciones mientras no se corrija el permiso del token.

### Conclusion y siguiente paso
- Hay dos aspectos distintos: el boton vuelve a consultar la pagina actual, pero no sincroniza todo el catalogo; y la API rechaza el acceso CDS, por lo que tampoco puede refrescarse correctamente ni siquiera esa pagina con departamentos.
- Para que lleguen los departamentos, SITRA debe habilitar `cds.read` en el token de integracion utilizado por CRM. Luego verificar HTTP 200 con `include_declaration=1`.
- Si se necesita que el boton sincronice todo el catalogo, debe ajustarse el flujo frontend/backend para invocar la sincronizacion completa y luego volver a cargar las filas. No se cambio ese comportamiento en esta revision para no prometer datos recientes mientras la API aun responde 403.

## Diagnostico 2026-10-12: paquete declarado aparece como "No consultada" en Internacionales

### Prueba exacta
- Se consulto el paquete indicado por el usuario contra la API SITRA con `q` exacto y paginacion de 25.
- Sin `include_declaration=1`, SITRA respondio HTTP 200 y encontro 1 registro; como esperado, `meta.declaracion_cds_incluida=false` y no habia campo CDS.
- Con `include_declaration=1`, la API respondio HTTP 403 clasificado como permiso de CDS y no devolvio filas.
- El resultado explica la etiqueta de CRM: `renderTrackingDeclarationSummary()` muestra "No consultada" cuando `declaracion_cds` esta ausente. Si SITRA devuelve la propiedad con estado `declarada`, el mismo renderizador muestra "Declarada".
- El usuario compartio una captura del expediente web `/conjunto` con declaracion y destino declarado en Tarija. Ese flujo web usa autenticacion de sesion y consulta CDS directamente; no demuestra que el token tecnico que consume CRM tenga `cds.read`.

### Conclusiones y accion
- No es correcto inferir `declarada` desde el expediente web, ni etiquetar como declarado un paquete si la API del CRM no pudo consultar CDS. Se conserva "No consultada" para distinguir falta de acceso de una respuesta CDS positiva/negativa.
- El mapeo de SITRA debe enviar `declaracion_cds.estado` por paquete; el codigo y las pruebas existentes verifican ese contrato. El bloqueo observado ocurre antes de recibir ese payload, en la autorizacion del token.
- El administrador de SITRA debe autorizar o emitir para la integracion un token con `sqlserver.read` y `cds.read`. Repetir la consulta exacta; se espera HTTP 200, `meta.declaracion_cds_incluida=true` y `data[].declaracion_cds.estado=declarada` para que CRM la muestre como tal.
- No se modifico codigo ni permisos durante esta comprobacion; no se registraron datos del paquete ni secretos en logs.

## Integracion separada de declaraciones CDS por paquete

### Cambios implementados
- SITRA expone `POST /api/tracking/cds/declaraciones`, separado del servicio de Tracking. El endpoint requiere usuario administrador y `cds.read`, acepta hasta 100 codigos y devuelve la declaracion, sus objetos/documentos y el destino declarado mapeado desde `RSta` (departamento) y `RCty` (ciudad). No requiere `sqlserver.read`.
- El endpoint de SITRA se cubre con `tests/Feature/CdsDeclarationApiTest.php` y esta documentado en `docs/IPS_OPERACIONES.md`.
- CRM configura el servicio y su credencial CDS de forma independiente con `CDS_API_URL` y `CDS_API_TOKEN`; no reutiliza ni registra los valores de credenciales.
- `backend/index.js` pide los paquetes a Tracking sin solicitarle CDS y enriquece la pagina vigente, la consulta exacta y el catalogo completo con la API CDS. La consulta agrupa hasta 100 codigos por solicitud y aplica una pausa para respetar el limite de la API CDS.
- Si CDS no esta configurado o responde con error, los datos de Tracking se conservan y se adjunta una advertencia; el CRM no afirma que el paquete esta declarado sin una respuesta CDS.
- El buscador puede abrir un registro encontrado solo en CDS, incluso si Tracking no tiene coincidencia. El resultado muestra el estado CDS y el destino declarado; el modal de detalle recibe el registro de la busqueda.
- README y `.env.example` describen la configuracion sin incluir secretos.

### Requisitos para recibir declaraciones reales
- Desplegar primero SITRA con la ruta nueva.
- Configurar `CDS_API_URL` y un `CDS_API_TOKEN` de integracion autorizado con `cds.read` en el entorno CRM. El token de Tracking puede seguir siendo distinto.
- Consultar un codigo conocido y confirmar que la respuesta CRM incluye `declaracion_cds.estado` y `destinos_declarados[].departamento`. `destino_declarado` representa el departamento de la declaracion CDS, no garantiza el destino operativo actual de Tracking/IPS.
- La implementacion local por si sola no habilita el permiso ni cambia el despliegue; sin token CDS autorizado, la respuesta debe mostrar una advertencia.

### Validacion ejecutada y pendiente
- SITRA: `php artisan test --filter=CdsDeclarationApiTest` paso, 3 pruebas y 14 aserciones; `php artisan route:list --path=tracking/cds/declaraciones` registra la ruta nueva.
- CRM: `npm run build` paso (incluye `tsc` y Vite); `node --check backend/index.js` paso; las pruebas dirigidas de backend pasaron (36 pruebas).
- `git diff --check` paso en los archivos de esta integracion. Se excluyeron archivos con cambios previos ajenos a esta tarea.
- Sigue pendiente probar un codigo real despues del despliegue de SITRA y de configurar la credencial con `cds.read`; no registrar el token ni datos personales del paquete.

### Verificacion del endpoint desplegado y diagnostico CRM - 2026-10-12
- La peticion sin credenciales a `POST http://172.65.10.55:8103/api/tracking/cds/declaraciones`, con `Accept: application/json`, respondio HTTP 401 JSON. Esto confirma que el servidor alcanza una ruta protegida; no confirma autorizacion, conexion CDS ni contenido para un paquete.
- En la configuracion local revisada no existen valores para `CDS_API_URL` ni `CDS_API_TOKEN` en `.env`, ni archivo `backend/.env`. No se leyeron ni mostraron secretos. El codigo usa `CDS_API_TOKEN` como credencial obligatoria para consultar CDS y, si falta, devuelve advertencia y estado `consulta_incompleta`.
- Se corrigio `.env.example` para usar la base SITRA `http://172.65.10.55:8103` en vez del host de desarrollo. El valor efectivo del CRM puede omitir `CDS_API_URL` (su default es la base de Tracking) o configurarlo explicitamente.
- Para mostrar declaraciones, crear en SITRA un token de integracion de administrador con permiso `cds.read`, configurarlo como `CDS_API_TOKEN` en el entorno del backend CRM y reiniciar el backend. Despues probar un codigo con declaracion conocida y verificar el estado/destino; esta revision no probo una consulta CDS autenticada ni confirma que el CRM desplegado tenga la configuracion.

### Configuracion local y prueba con token proporcionado - 2026-10-12
- Se configuraron localmente `CDS_API_URL` con la base SITRA `http://172.65.10.55:8103` y `CDS_API_TOKEN` en el `.env` ignorado por Git. El valor del token no se copia a este documento ni al codigo.
- Se envio una consulta autenticada de prueba para `LP666718164MY`; SITRA respondio HTTP 403. Por lo tanto, el CRM ya tiene la credencial local configurada, pero SITRA no autoriza esta consulta y todavia no se confirma que el departamento se este devolviendo. Revisar que el token corresponda a un usuario administrador con la habilidad `cds.read` y que el despliegue activo de SITRA incluya esa regla.
- El token fue compartido en la conversacion; por seguridad, revocarlo y emitir uno nuevo antes de usarlo en produccion. Actualizar `CDS_API_TOKEN` local con el token nuevo y reiniciar el backend para que cargue la configuracion.

### Seccion de entorno para declaraciones CDS
- Se agruparon `CDS_API_URL` y `CDS_API_TOKEN` bajo una seccion explicita para declaraciones aduaneras CDS de paquetes internacionales, tanto en el `.env` local ignorado por Git como en `.env.example`.
- `CDS_API_URL` es la base SITRA (`http://172.65.10.55:8103`); el backend usa la ruta `/api/tracking/cds/declaraciones`. `CDS_API_TOKEN` debe ser un token autorizado con `cds.read`.
- El token real permanece solo en `.env` local; `.env.example` conserva un marcador y no versiona credenciales.

### Verificacion funcional de Tracking/CDS - 2026-10-12
- La consulta exacta a Tracking en SITRA devolvio HTTP 200 y coincidencia para `EY467201535US` y `LP666718164MY`.
- La consulta autenticada CDS al host correcto `http://172.65.10.55:8103` devolvio HTTP 200 y estado `declarada` para ambos codigos. Para `LP666718164MY`, SITRA devolvio departamento `Cercado` y ciudad `Tarija`. Para `EY467201535US`, devolvio ciudad `LA PAZ BOLIVIA` pero `RSta` vacio, por lo que faltaba departamento.
- El `.env` local tenia como URL CDS una ruta completa. El backend construye la ruta absoluta `/api/tracking/cds/declaraciones`, por lo que resuelve correctamente al endpoint host; la prueba directa confirma HTTP 200.
- Se corrigio SITRA para inferir un departamento solo si el pais es BO y el campo de ciudad coincide exactamente con el nombre de un departamento boliviano, con sufijo opcional “Bolivia” o “BO”. No se altera un `RSta` ya informado ni se infiere en otros paises/ciudades.
- Pruebas SITRA: `php artisan test --filter=CdsDeclarationApiTest` paso con 8 pruebas y 38 aserciones. La compilacion frontend y 36 pruebas dirigidas del backend CRM tambien pasaron. `GET /api/health` respondio HTTP 200 en el backend local; el servidor Vite de desarrollo no estaba escuchando en el puerto 5173 durante esta comprobacion, asi que no se verifico la pantalla en navegador.
- Hay que desplegar la correccion SITRA para que el departamento inferido de La Paz aparezca en la API real; al momento de la prueba, la respuesta desplegada aun devolvia el departamento vacio para `EY467201535US`.

### Respuesta de declaraciones CDS por mensajes WhatsApp
- Se integró la consulta CDS a `fetchMatchingPackageContext()` para mensajes con código de guía, consultando CDS aparte de Tracking y sin barrer declaraciones por número telefónico.
- El contexto del bot separa explícitamente el departamento/ciudad declarado en CDS del destino y la ubicación operativos de Tracking. Cuando el cliente pregunta por declaración o departamento, responde usando los campos recibidos; si CDS falla o falta el departamento, lo comunica sin inferir datos.
- La búsqueda CDS por código también funciona cuando el código no tuvo coincidencia en Tracking, pero no altera el estado operativo ni afirma movimientos que Tracking no confirmó.
- Se añadieron pruebas unitarias de clasificación de consulta y respuestas para departamento disponible, departamento ausente y consulta CDS incompleta en `backend/tests/whatsapp-intent.test.js`.
- Validacion de esta integracion al bot: `node --check backend/index.js`, `node --check backend/services/whatsapp-intent.js` y las suites dirigidas `whatsapp-intent`, `whatsapp-package-automation` y `whatsapp-tariff-routing` pasaron; SITRA CDS paso 8 pruebas/38 aserciones.
- Para probar mensajes reales hay que desplegar/reiniciar CRM con estos cambios y SITRA con la inferencia de La Paz. El entorno consultado ya autorizo CDS para los dos codigos; rotar el token compartido en la conversacion antes de dejarlo en produccion.

### Prueba de lote de 100 paquetes internacionales en SITRA - 2026-10-12
- Se leyo Tracking con `TRACKING_SQLSERVER_TOKEN`, recorriendo sus paginas hasta reunir 100 codigos postales internacionales unicos; no se imprimieron ni almacenaron los codigos en la documentacion.
- La consulta unica `POST /api/tracking/cds/declaraciones` se envio al host configurado `172.65.10.55:8103` con el token local y respondio HTTP 200. SITRA devolvio 100 resultados: 11 `declarada`, 89 `sin_objeto_cds`, 0 `objeto_sin_declaracion`, 0 `consulta_incompleta`; `meta.cds_truncado=false`.
- Departamentos presentes entre las declaraciones devueltas: BOLIVIA, Cochabamba, La Paz y SANTA CRUZ.
- Una consulta adicional inmediata para verificar el departamento del caso conocido de La Paz respondio HTTP 429 (limite de solicitudes); no se reintento. La prueba del lote confirma que el endpoint responde en el servidor y entrega resultados, pero no verifica el departamento de ese codigo especifico ni la interfaz web.

### Mostrar destino declarado CDS en tabla Internacionales
- `frontend/src/main.ts`: la celda muestra información estructurada del destino declarado CDS; no se debe usar solo el departamento porque algunos registros tienen ciudad/país en otros campos.
- Si Tracking no informa destino, la tabla muestra `Bolivia` solo para guias internacionales con un evento entrante (`entrada`, `inbound` o `importacion`). No se inventa departamento/localidad y no se cambia el destino operativo de la API.
- Solo se modifico la presentacion del CRM; no se modifico la API CDS ni SITRA.

### Muestreo de paquetes sin declaracion y sin destino - 2026-10-12
- Se consultaron las primeras paginas de Tracking hasta reunir 100 codigos internacionales unicos; Tracking respondio HTTP 200. Se enviaron esos mismos 100 codigos en una consulta CDS; CDS respondio HTTP 200 y devolvio 100 resultados sin truncamiento.
- En la muestra, 84 codigos no estaban declarados en CDS, 67 no tenian destino operativo informado por Tracking y 58 cumplian ambas condiciones. Ejemplos de la interseccion: `EC261702498BE`, `LX097177961NL`, `LX098223177NL`, `LX096688840NL` y `LX096606315NL`; CDS los clasifico como `sin_objeto_cds` y Tracking no informo destino.
- Este es un muestreo de 100 paquetes, no un conteo del catalogo completo. `sin_objeto_cds` significa que CDS no encontro un objeto asociado para ese codigo en esta consulta; no se uso un destino declarado inexistente ni se infirio ubicacion.

### Evitar mostrar teléfonos como departamento declarado - 2026-10-13
- La columna `Destino declarado CDS` y los resúmenes CDS descartan valores telefónicos en el campo de departamento, por ejemplo `Tel 591...`.
- Se aplicó el mismo filtro en los modales de consulta/detalle y en el resumen CDS enviado al contexto del bot. Los datos recibidos de CDS no se modifican.

### Corregir destino CDS incompleto para LP666543485MY - 2026-10-13
- La declaración CDS mostrada para `LP666543485MY` tiene información de destinatario/dirección en los campos de origen, pero `destinos_declarados`/`destino_declarado` no estaba exponiendo esos valores a la tabla; por eso se veía `—`.
- La tabla y los modales ahora usan como respaldo `RCty`, `RZip` y `RCtr` de los campos originales de la declaración cuando no hay destino normalizado. `RSta` solo se muestra si no parece un teléfono. No se infiere una ciudad a partir de la dirección libre ni se cambia el destino operativo de Tracking.
- El contexto CDS enviado al bot aplica el mismo respaldo para no responder que el destino no está informado cuando hay ciudad, código postal o país en la declaración original.

### Notificar llegada internacional al número de prueba - 2026-10-13
- En modo de prueba, un evento confirmado de entrada en oficina de cambio para un paquete de Tracking Internacional se notifica a los números de prueba autorizados aunque el paquete no tenga teléfono asociado.
- La llegada es notificable aun si Tracking conserva la etapa `received` y no depende de que Aduana haya registrado o completado la declaración. Se mantiene la deduplicación por paquete/evento/destinatario.
- Para ejecutarlo desde el watcher deben estar activos Modo de prueba WhatsApp y Cambios de evento; el aviso sigue limitado a los números configurados para pruebas.

### Ajuste de modo prueba para notificaciones internacionales - 2026-10-13
- Se corrigió la detección de paquetes que llegan a Bolivia: el watcher ya no depende solo del último evento, también revisa el historial del paquete para encontrar `Recibir envío en oficina de cambio (entrada)`.
- Al mezclar datos de Tracking con Paquetes-Contactos se conserva la señal de llegada internacional, para que no se pierda cuando una fuente reemplaza a la otra.
- En modo de prueba WhatsApp activo, las notificaciones del watcher se envían a los números de prueba autorizados para probar llegadas internacionales, cambios de estado y ventanilla sin contactar a destinatarios reales.
- Con modo de prueba WhatsApp desactivado, las mismas notificaciones dejan de usar números de prueba y se envían a los teléfonos reales registrados en el paquete/contacto.
- Se aumentó el límite predeterminado de códigos recientes revisados para eventos de llegada de 25 a 200, configurable con `PACKAGE_RECENT_EVENT_CODE_LIMIT`.
- Se agregó trazabilidad en logs: las omisiones de eventos guardan `notificationType`, y el resumen del watcher reporta `internationalArrivalSent`, `internationalArrivalSkipped` y sus motivos.
- Archivos modificados: `backend/index.js`, `backend/services/whatsapp-package-automation.js`, `backend/tests/whatsapp-package-automation.test.js`.
- Validación: `node --check backend/index.js` pasó; `node --test backend/tests/whatsapp-package-automation.test.js` pasó con 36/36 pruebas.
- Requisito operativo: reiniciar el backend para que el watcher cargue esta regla; al arrancar puede procesar notificaciones pendientes, por lo que conviene confirmar que el modo prueba esté en el estado deseado antes del reinicio.
### Respuesta WhatsApp para paquetes en aduana - 2026-10-13
- Si el contexto real del paquete trae estado, ubicacion o ultimo evento relacionado con aduana, el bot responde de forma directa que el paquete se encuentra en aduana, en revision u observacion aduanera.
- La respuesta usa el codigo de guia y el ultimo registro disponible, sin inventar fechas ni ubicaciones no confirmadas.
- Tambien se agrego una regla al prompt de seguimiento para mantener el mismo criterio cuando el flujo use IA.
- Archivos modificados: `backend/services/whatsapp-intent.js`, `backend/index.js`, `backend/tests/whatsapp-intent.test.js`.
- Validacion: `node --test backend/tests/whatsapp-intent.test.js` paso con 12/12 pruebas; `node --test backend/tests/whatsapp-package-automation.test.js` paso con 36/36 pruebas; `node --check backend/index.js` paso.

### Respuesta WhatsApp para distribucion nacional - 2026-10-13
- Si el contexto real del paquete trae eventos de distribucion nacional del pipeline (`13`, `14`, `35`, `71` o `72`) o textos de ubicacion nacional, traslado o clasificacion, el bot responde que el paquete ya esta en Bolivia y se esta clasificando para su distribucion nacional.
- La respuesta no muestra el numero ni nombre tecnico del evento; solo informa el estado operativo entendible para el cliente.
- Se guarda `currentLatestEventSignature` en el contexto del paquete para que la respuesta pueda guiarse por la firma real del evento del pipeline.
- El mismo texto se usa para consultas por WhatsApp y para notificaciones automaticas del watcher cuando el evento corresponde.
- Archivos modificados: `backend/services/whatsapp-intent.js`, `backend/index.js`, `backend/tests/whatsapp-intent.test.js`.
- Validacion: `node --test backend/tests/whatsapp-intent.test.js` paso con 14/14 pruebas; `node --test backend/tests/whatsapp-package-automation.test.js` paso con 36/36 pruebas; `node --check backend/index.js` y `node --check backend/services/whatsapp-intent.js` pasaron.

### Correccion de filtros del pipeline internacional - 2026-10-13
- Se revisaron conteos agregados locales de `international_tracking_packages` por `latest_event_code` y `stage_key`: los eventos IPS principales estaban guardados con la etapa esperada (`35 -> regional`, `31/34/38 -> transit`, `32/36/39/73 -> courier`, `37 -> delivered`).
- La causa del fallo estaba en frontend: el modal `+ Estados` del tablero internacional usaba fuentes nacionales (`isNationalTrackingPackage`/`isNationalContactPackage`) y filtros de fecha/departamento del pipeline nacional.
- Se corrigio `getApiPipelineStateOptions()` para que, cuando la vista activa sea `internacionales-tablero`, use paquetes internacionales, omita paquetes-contactos nacionales y aplique los filtros `internationalPipelineDateStart`, `internationalPipelineDateEnd` e `internationalPipelineDepartment`.
- Tambien se ajusto el fallback textual de `getTrackingPipelineStage()`: textos de `ubicacion nacional`, `traslado` o `clasific` ahora caen en `regional`/Distribucion nacional en vez de `transit`/Aduana.
- Archivo modificado: `frontend/src/main.ts`.
- Validacion: `npm --prefix frontend run build` paso; `node --check backend/index.js` paso.

### Modulo de mensajes personalizados - 2026-10-14
- Se agrego `Mensajes personalizados` al grupo **Clientes** del sidebar, debajo de Agrupaciones.
- La vista reutiliza el editor existente de prompts/configuracion para mostrar y editar mensajes personalizados sin duplicar la logica de guardado ni simulacion.
- Se ajustaron titulo, descripcion y etiqueta de alcance para diferenciar el modulo general de las vistas Nacional e Internacional.
- Archivos modificados: `frontend/src/main.ts`, `frontend/src/layout/workspace.ts`, `frontend/src/views/prontsView.ts`.
- Validacion: `npm --prefix frontend run build`.

### Correccion de visibilidad de mensajes personalizados - 2026-10-14
- Se corrigio la condicion de visibilidad de `frontend/src/views/prontsView.ts`: el nuevo módulo ahora aparece correctamente cuando `activeView` es `mensajes-personalizados`.
- Causa: la vista compartida solo marcaba como visible las rutas Nacional e Internacional.
- Validacion: `npm --prefix frontend run build`.

### Biblioteca visible de respuestas personalizadas - 2026-10-14
- Se reemplazó el acceso al editor de prompts por una vista independiente que muestra los mensajes configurados para tarifas, Delivery Express y seguimiento.
- La nueva biblioteca presenta cada caso, su descripción y el texto de respuesta con sus variables (`{packageCode}`, `{status}`, etc.).
- Archivos modificados: `frontend/src/views/customMessagesView.ts`, `frontend/src/views/index.ts`, `frontend/src/layout/workspace.ts`, `frontend/src/style.css`.
- Validación: `npm --prefix frontend run build`.

### Vista operativa de mensajes por paquetes - 2026-10-14
- Se ajustó `Mensajes personalizados` para utilizar nuevamente la vista operativa existente de prompts: estados de paquetes, mensajes configurables, variables de contexto y probador con paquetes reales.
- El módulo ya no presenta un catálogo estático; usa los paquetes disponibles en los datos cargados del CRM mediante `getProntsColumnContacts`.
- Se actualizó la descripción para indicar que los mensajes responden sobre paquetes existentes.

### Vista previa de respuesta de paquete en tránsito - 2026-10-14
- Se agregó en `Mensajes personalizados` la vista previa del mensaje de tránsito solicitado para `CP000118322BO`, con saludo, destino, última actualización y aviso de próximo movimiento.
- La vista queda dentro del editor operativo junto a las columnas y el probador de paquetes.
- Archivos modificados: `frontend/src/views/prontsView.ts`, `frontend/src/style.css`.

### Edición del mensaje personalizado de tránsito - 2026-10-14
- La vista previa del mensaje de `CP000118322BO` ahora es un campo editable; conserva los saltos de línea y permite modificar el texto directamente.
- El contenido editado se mantiene durante la sesión del CRM para poder probarlo y ajustarlo antes de integrarlo al prompt definitivo.
- Archivos modificados: `frontend/src/main.ts`, `frontend/src/views/prontsView.ts`, `frontend/src/style.css`.

### Vista independiente de todos los mensajes personalizados - 2026-10-14
- `Mensajes personalizados` ahora abre una vista nueva e independiente, sin columnas de prompts ni probador IA.
- La vista reúne todos los mensajes personalizados por categoría (tarifas, Delivery Express y seguimiento) y presenta cada texto en un campo editable.
- Archivos modificados: `frontend/src/layout/workspace.ts`, `frontend/src/views/customMessagesView.ts`, `frontend/src/style.css`.

### Vista nueva desde cero para mensajes personalizados - 2026-10-14
- Se creó `frontend/src/views/personalizedMessagesView.ts` como pantalla independiente desde cero.
- La ruta ya no reutiliza el editor de prompts ni sus componentes; muestra una biblioteca propia de mensajes editables, categorizados y con botón de guardar.
- Archivos modificados: `frontend/src/views/personalizedMessagesView.ts`, `frontend/src/views/index.ts`, `frontend/src/layout/workspace.ts`, `frontend/src/style.css`.

### Corrección de enrutamiento de la vista nueva - 2026-10-14
- Se corrigió el orden de las condiciones de `renderWorkspace`: `mensajes-personalizados` ya no cae primero en la vista de prompts.
- Ahora la ruta muestra exclusivamente `personalizedMessagesView.ts`.

### Plantillas editables con variables y guardado - 2026-10-14
- Cada mensaje de `Mensajes personalizados` ahora es editable mediante un textarea independiente.
- Se agregó una guía paso a paso visible con las variables permitidas: `{Nombre cliente}`, `{paquete}`, `{Destino del paquete}`, `{estado}` y `{ultimo movimiento}`.
- El botón `Guardar cambios` persiste las plantillas en el navegador y muestra confirmación al usuario.
- Archivos modificados: `frontend/src/views/personalizedMessagesView.ts`, `frontend/src/main.ts`, `frontend/src/style.css`.

### Separación nacional/internacional y editor con vista previa - 2026-10-14
- La nueva vista agrega botones superiores **Nacionales** e **Internacionales**.
- Los mensajes se listan por categoría en el panel izquierdo; al seleccionar uno, se edita en el panel derecho.
- La vista previa reemplaza `{Nombre cliente}`, `{paquete}` y `{Destino del paquete}` con datos del primer paquete disponible en la API cargada.
- Cada mensaje tiene su propio botón `Guardar mensaje` y persiste la plantilla editada.

### Panel de datos enviados por la API - 2026-10-14
- Se agregó un tercer panel a la derecha del editor para mostrar los datos usados en la personalización: cliente, paquete, destino, estado, último movimiento y fuente API.
- El panel cambia según la pestaña Nacional/Internacional y el paquete disponible cargado en `state.data`.

### Búsqueda y ampliación de mensajes existentes - 2026-10-14
- Se revisaron `backend/knowledge/agent-responses.json`, `backend/services/whatsapp-intent.js` y `backend/services/whatsapp-package-automation.js`.
- Se incorporaron a la vista mensajes existentes para cartero, cancelación/retorno, llegada a Bolivia, aduana, paquete no encontrado y consulta de declaración aduanera.
- Los mensajes conservan variables editables para conectarse con los datos del paquete.

### Corrección de lectura de destinos desde la API - 2026-10-14
- Se revisó cómo llegan los destinos en la API: pueden ser texto o un objeto con `nombre`/`direccion`.
- La vista ahora lee ambos formatos, también considera destinatario y código `codigo_s10`, y muestra `Destino no informado` si la API no entrega destino.
- Se eliminó el respaldo fijo `Germany` para evitar enviar o previsualizar destinos inventados.

### Incorporación de bienvenida nacional y recojo en ventanilla - 2026-10-14
- La búsqueda del flujo `buildNewPackageWelcomeMessage` confirmó que faltaba la plantilla de bienvenida para paquetes nuevos nacionales.
- Se agregó `Bienvenida de paquete nuevo`, incluyendo cliente, código, origen, destino, aviso de salida a ruta y canal de consulta.
- También se agregó el mensaje de paquete disponible para recojo en ventanilla con sucursal de destino.

### Revisión de `chat.txt` y mensajes faltantes - 2026-10-14
- Se revisó `C:\Users\israe\OneDrive\Desktop\Pasantia\Correos de Bolivia\chat.txt`, diferenciando mensajes emitidos por Correos de Bolivia de instrucciones/prompts escritos por el usuario.
- Se identificaron y agregaron mensajes de saludo inicial, recorrido de paquete, llegada a Bolivia sin sucursal, despacho internacional desde Bolivia, aduana con último registro y entrega confirmada.
- No se incorporaron instrucciones de jailbreak, solicitudes de descuentos no autorizados ni mensajes del usuario como plantillas operativas.

### Switch de activación por mensaje - 2026-10-14
- Se agregó un switch individual junto a cada mensaje nacional e internacional.
- El switch permite activar/desactivar la plantilla y muestra visualmente los mensajes inactivos.
- El estado se persiste en `localStorage` junto con las plantillas editadas.

### Incorporación completa de plantillas faltantes - 2026-10-14
- Se agregaron las plantillas faltantes identificadas en `chat.txt`: saludos, solicitud de peso y dimensiones, tarifas referenciales, tercera edad, cotizaciones múltiples, confirmación e inconsistencia de guías, atención telefónica, declaraciones aduaneras, errores de tracking, recorrido de paquetes y correspondencia pendiente de recojo.
- Las plantillas están separadas en Nacionales e Internacionales y usan variables editables para los datos dinámicos.
- Se excluyeron duplicados, pruebas de jailbreak, descuentos no autorizados y respuestas defectuosas como `[object Object]`.

### Panel de mensajes desplazable - 2026-10-14
- Cotizaciones redactadas por el agente: se eliminó la selección directa de `buildTariffReply(...)`; la IA ahora recibe el resultado estructurado del tarifario y redacta según los datos disponibles.
- El tarifario sigue siendo la fuente única de precios y condiciones; la IA no puede inventar ni modificar valores.
- Validación: `node --check backend/index.js`.
- Recuperación conversacional de cotización y tracking: se ajustó `backend/index.js` para que el agente, ante una solicitud no resoluble, pida los datos faltantes para cotizar o ofrezca consultar una guía usando el estado real de la API.
- Se agregó un fallback conversacional para evitar respuestas vacías o genéricas.
- Validación: `node --check backend/index.js`.
- El listado de mensajes nacionales e internacionales ahora tiene desplazamiento vertical independiente.
- Se agregó una altura máxima, scrollbar visible y estilos compatibles con navegadores Chromium para recorrer todos los mensajes sin desplazar el editor derecho.
