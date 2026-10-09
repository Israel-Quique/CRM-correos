import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'
import pg from 'pg'

const { Pool } = pg
const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : ''

if (!inputPath) {
  throw new Error('Uso: node scripts/import-ips-packages.mjs <archivo.json|archivo.ndjson>')
}

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env'), quiet: true })
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.')

const getValue = (item, keys) => {
  for (const key of keys) {
    const value = item?.[key]
    if (value != null && String(value).trim()) return value
  }
  return null
}

const getCode = (item) => String(getValue(item, ['codigo_s10', 'codigo', 'package_code', 'mailitm_fid']) ?? '').trim().toUpperCase()
const getEventCode = (event) => Number(getValue(event, ['evento_id', 'codigo_evento', 'event_code', 'event_type_cd']))
const getEventDate = (event) => getValue(event, ['fecha', 'fecha_evento', 'event_date', 'event_gmt_dt', 'created_at'])
const getEventName = (event) => String(getValue(event, ['nombre', 'evento_api', 'evento_original', 'event_name', 'detalle']) ?? '').trim()

const getStage = (eventCode) => {
  if (eventCode === 37) return 'delivered'
  if (eventCode === 76) return 'cancelled'
  if ([32, 36, 39, 73, 74, 75].includes(eventCode)) return 'courier'
  if ([13, 14, 35, 71, 72].includes(eventCode)) return 'regional'
  if ([31, 34, 38].includes(eventCode)) return 'transit'
  return 'received'
}

const rawText = await readFile(inputPath, 'utf8')
const parsed = path.extname(inputPath).toLowerCase() === '.ndjson'
  ? rawText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : JSON.parse(rawText)
const sourceItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : []
const packages = new Map()

for (const item of sourceItems) {
  const code = getCode(item)
  if (!code) continue
  const events = Array.isArray(item?.eventos) ? item.eventos : [item]
  const existing = packages.get(code) ?? { ...item, codigo_s10: code, eventos: [] }
  existing.eventos.push(...events.filter(Boolean))
  packages.set(code, existing)
}

const rows = [...packages.values()].map((item) => {
  const events = [...item.eventos].sort((a, b) => Date.parse(getEventDate(b) ?? '') - Date.parse(getEventDate(a) ?? ''))
  const latestEvent = events[0] ?? {}
  const eventCode = getEventCode(latestEvent)
  const eventName = getEventName(latestEvent)
  const eventDate = getEventDate(latestEvent)
  const payload = { ...item, eventos: events }
  const searchText = JSON.stringify(payload).toLowerCase()
  return {
    package_code: getCode(item),
    stage_key: getStage(eventCode),
    latest_event_code: Number.isFinite(eventCode) ? eventCode : null,
    latest_event_name: eventName,
    latest_event_at: eventDate || null,
    search_text: searchText,
    payload,
  }
})

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
})

try {
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const batch = rows.slice(offset, offset + 1000)
    await pool.query(
      `
        insert into international_tracking_packages (
          package_code, stage_key, latest_event_code, latest_event_name,
          latest_event_at, search_text, payload, imported_at, updated_at
        )
        select
          row.package_code, row.stage_key, row.latest_event_code, row.latest_event_name,
          row.latest_event_at, row.search_text, row.payload, now(), now()
        from jsonb_to_recordset($1::jsonb) as row(
          package_code text,
          stage_key text,
          latest_event_code integer,
          latest_event_name text,
          latest_event_at timestamptz,
          search_text text,
          payload jsonb
        )
        on conflict (package_code) do update set
          stage_key = excluded.stage_key,
          latest_event_code = excluded.latest_event_code,
          latest_event_name = excluded.latest_event_name,
          latest_event_at = excluded.latest_event_at,
          search_text = excluded.search_text,
          payload = excluded.payload,
          imported_at = now(),
          updated_at = now();
      `,
      [JSON.stringify(batch)],
    )
    process.stdout.write(`\rImportados ${Math.min(offset + batch.length, rows.length)} de ${rows.length}`)
  }
  process.stdout.write(`\nImportacion completa: ${rows.length} paquetes.\n`)
} finally {
  await pool.end()
}
