# AGENTS.md — Instrucciones para Codex (CRM Integrador + Chatbot Meta/WhatsApp)

## Contexto del proyecto

CRM web (Node.js + Express 5 + PostgreSQL + React/Vite) con chatbot de WhatsApp mediante Meta Cloud API y respuestas generadas por un LLM local (Ollama).

- Backend de producción: `backend/index.js` (monolito ESM, ~11 600 líneas). Único archivo que arranca.
- `backend/index_refactored.js` y `backend/server/index.js` son borradores de un refactor INCOMPLETO y NO se ejecutan en ningún script.
- FLUJO DEL BOT (no reinventar):
  1. Meta → GET `/webhook` (verificación, `hub.verify_token`) → `backend/index.js:10536`
  2. Meta → POST `/webhook` (eventos) → `backend/index.js:10555` → `persistInboundWhatsAppWebhook` (`backend/index.js:8885`)
  3. Cola auto-respuesta en memoria `enqueueAutoReply` (`backend/index.js:8874`)
  4. Motor de decisión `autoReplyInboundWhatsAppMessage` (`backend/index.js:8468`): filtra, arma contexto (últimos 8 mensajes), enruta intención (heurístico: TRACKING / TARIFAS / GENERAL), responde con plantillas o con Ollama (`callOllamaGenerate` `backend/index.js:8410`).
  5. Envía con `sendWhatsAppCloudMessage` (`backend/index.js:5594`).

## Reglas de trabajo (ahorrar tokens, ser preciso)

- NO leas ni modifiques: `backend/logs/*`, `backend/pgdata`, `node_modules`, `frontend/node_modules`, `backend/dist`, `frontend/dist`, `ollama/models`, `ollama/cache`, `route_extracted.json`, `package-lock.json`.
- NUNCA muestres ni loguees valores de `.env` ni de `integration_settings` (secretos). Solo nombres de variables.
- Antes de hacer cambios grandes en `backend/index.js`, explica el plan en 3 líneas y confírmalo. El monolito funciona en producción: edita quirúrgicamente, sin reformatear bloques ajenos.
- Los prompts del sistema del bot (systemPrompt, routerSystemPrompt, trackingSystemPrompt) viven editables en `integration_settings` clave `crm_pronts_config` y con defaults en `backend/index.js:226-267`. Si cambias defaults, respeta el formato esperado por la UI (`backend/routes/pronts-configRoutes.js`, `frontend/src/views/prontsView.ts`).
- Verificación: `npm --prefix backend run dev` (dev) o `npm run start:server` (servir `frontend/dist`). Health check: `GET /api/health`, `GET /api/ai/health`.

## Verificación y arranque

```bash
npm install
npm --prefix frontend run dev      # UI en http://localhost:5173
npm --prefix backend run dev       # API + webhook en http://localhost:3001
```

Para probar el webhook localmente con un tunnel: `cloudflared tunnel --url http://localhost:3001` (como ya se hace; ver `cloudflared.*.log`).

## Diagnóstico actual (estado conocido)

El proyecto SÍ es un chatbot funcional de Meta/WhatsApp: verifica el webhook, recibe mensajes, persiste contactos/mensajes, genera respuestas automáticas (plantillas + Ollama), envía por Cloud API y responde a consultas de tracking/tarifas. Problemas y deuda técnica pendientes abajo.

## Tareas por prioridad

### P0 — Durabilidad de la auto-respuesta
- La cola de auto-respuesta está EN MEMORIA (`autoReplyQueue` / `enqueueAutoReply` `backend/index.js:8872-8882`): se pierde al reiniciar, sin retries. La tabla DB `whatsapp_auto_reply_queue` ya existe (`backend/db/init.sql:85-105`) pero nadie la usa.
- Acción: conectar `enqueueAutoReply` (y un drenador tipo `drainAutoReplyQueue`) a esa tabla, con estados pending/processing/failed, retry con límite y reinicio seguro. Referencia del intento previo: `backend/index_refactored.js:5531` y `:5581` (no copiar tal cual, adaptar al monolito).

### P0 — Robotizar el refactor (decidir)
- `backend/index_refactored.js` NO compila: imports con guiones inválidos en línea 4 (`registerPackage-code-lookupRoutes`) y 11 (`registerContact-groupsRoutes`); también los usos en `:6095` y `:6102`.
- Las factories en `backend/routes/*.js` están rotas: `messagesRoutes.js:8` usa `upload` sin pasarlo en deps; `aiRoutes.js:10` usa `getAiConfig` sin estar en deps.
- Acción: propón y aplica UNO de estos caminos (pregunta antes): (a) completar la migración al refactor conectando las rutas al `index.js` de producción, o (b) eliminar `index_refactored.js` y `server/index.js` + rutas huérfanas para reducir confusión. No dejes tres servidores vivos.

### P1 — Seguridad y privacidad del webhook
- POST `/webhook` (`backend/index.js:10555`): NO valida `X-Hub-Signature-256` (solo el verify token en el GET). Cualquiera que llegue al endpoint puede inyectar eventos falsos. Firmar con el App Secret de Meta.
- `backend/index.js:10555` loguea el body COMPLETO (`console.log('Webhook de WhatsApp recibido:', JSON.stringify(request.body))`) → fuga de datos personales. Reducir a un resumen (provider message id, tipo, remitente), nunca cifras de contacto completas.
- No hay filtro de mensajes de grupos `g.us` ni broadcasts: decidir si se ignoran o se trata como conversación de grupo.
- `getWebhookMediaDescriptor` (`backend/index.js:1543`) solo soporta image y audio. Decidir si añadir document/location o degradar con mensaje claro.

### P1 — Robustez del LLM (Ollama)
- `callOllamaGenerate` (`backend/index.js:8410`) sin retry/backoff; timeouts cortos (general 6000 ms).
- Fallback por IA caída: texto fijo (`buildFallbackAgentReply` `backend/index.js:8795`) que no informa al cliente del problema.
- Modelos inconsistentes: docker-compose hace pull de `llama3.1:8b`; default general del backend `qwen2.5:7b` (`backend/index.js:226-267`). Alinear si es intencional o corregir.
- Acción: retry+backoff en `callOllamaGenerate`, cachear la respuesta de salud para no intentar llamar a Ollama caído, y mensaje de fallback honesto.

### P1 — Doble procesamiento por reintentos de Meta
- `persistInboundWhatsAppWebhook` (`backend/index.js:8885`): el dedupe por `provider_message_id` solo protege el mensaje entrante (`:8959-8971`). Si el proceso falla después de responder, Meta reintenta y podría duplicarse. Revisar idempotencia completa del flujo.

### P2 — Calidad de texto
- Hay mojibake en el código (p.ej. `"estÃ¡"`, `"Â¡Hola!"`) semejante en `backend/index.js` y en los defaults de prompts. Se mitiga en envíos con `repairMojibakeText` (`backend/index.js:8808`), pero conviene normalizar el código fuente.
- Comunicación con el cliente siempre en español de Bolivia (nivel conversacional, 1-2 frases, sin emojis salvo que el contexto lo pida).

### P2 — Watchers frágiles
- `startWhatsAppStageWatcher` (`backend/index.js:8390`) usa setTimeout recursivo sin try/catch externo; si lanza, el watcher muere en silencio. Añadir try/catch + logging de error sin exponer contenido.

## Estilo
- JavaScript/ESM. Sin TypeScript en el backend.
- Sigue las convenciones de `backend/index.js` (helpers `const`, `getX`, `isX`, template literals). No añadas comentarios innecesarios.
- Al terminar una tarea, confirma qué cambió con `file:línea`, cómo se probó y qué comandos correr.