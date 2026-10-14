export const getSafeDeclaredDepartment = (value: unknown) => {
  const department = String(value ?? '').trim()
  if (!department) return ''

  const containsPhoneLabel = /\b(?:tel(?:[ée]fono)?|cel(?:ular)?|m[oó]vil|whatsapp|phone)\b/i.test(department)
  const digitCount = department.replace(/\D/g, '').length
  return containsPhoneLabel || digitCount >= 7 ? '' : department
}

type DeclaredDestination = {
  departamento?: unknown
  ciudad?: unknown
  codigo_postal?: unknown
  pais_codigo?: unknown
  [key: string]: unknown
}

type CdsDeclaration = {
  destino_declarado?: DeclaredDestination | null
  campos?: Record<string, unknown> | null
}

const getCdsField = (fields: Record<string, unknown> | null | undefined, name: string) => {
  const normalizedName = name.toLowerCase()
  const entry = Object.entries(fields ?? {}).find(([key]) => key.trim().toLowerCase() === normalizedName)
  return String(entry?.[1] ?? '').trim()
}

export const getDeclaredDestinationEntries = (
  destinations?: DeclaredDestination[] | null,
  declarations?: CdsDeclaration[] | null,
) => {
  const entries = [
    ...(Array.isArray(destinations) ? destinations : []),
    ...(Array.isArray(declarations) ? declarations.map((declaration) => {
      const fields = declaration.campos
      const destination = declaration.destino_declarado ?? {}
      return {
        departamento: destination.departamento || getCdsField(fields, 'RSta'),
        ciudad: destination.ciudad || getCdsField(fields, 'RCty'),
        codigo_postal: destination.codigo_postal || getCdsField(fields, 'RZip'),
        pais_codigo: destination.pais_codigo || getCdsField(fields, 'RCtr'),
      }
    }) : []),
  ]

  const seen = new Set<string>()
  return entries.filter((entry) => {
    const normalized = {
      departamento: getSafeDeclaredDepartment(entry.departamento),
      ciudad: String(entry.ciudad ?? '').trim(),
      codigo_postal: String(entry.codigo_postal ?? '').trim(),
      pais_codigo: String(entry.pais_codigo ?? '').trim(),
    }
    if (!Object.values(normalized).some(Boolean)) return false

    const key = Object.values(normalized).join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((entry) => ({
    ...entry,
    departamento: getSafeDeclaredDepartment(entry.departamento),
    ciudad: String(entry.ciudad ?? '').trim(),
    codigo_postal: String(entry.codigo_postal ?? '').trim(),
    pais_codigo: String(entry.pais_codigo ?? '').trim(),
  }))
}
