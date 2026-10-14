// Every read the app makes against Arkiv. The browser and the CLI both call these, through the same
// SDK and the same public RPC, so what the CLI verifies is what the page shows.

import type { Hex } from "viem"
import { addr, key, str, u64 } from "@arkiv-network/sdk/attr"
import { and, eq, gte, lte, or } from "@arkiv-network/sdk/query"
import type { PublicArkivClient } from "@arkiv-network/sdk"
import { A, APP, type Category, type Kind } from "./schema"
import { domainCandidates } from "./normalise"

// Any client with the Arkiv public actions, over HTTP or WebSocket.
// biome-ignore lint/suspicious/noExplicitAny: transport and chain generics are irrelevant here.
export type Reader = PublicArkivClient<any, any, any, any>

export type Report = {
  key: Hex
  creator: Hex
  owner: Hex
  createdAt: bigint
  expiresAt: bigint
  permissionlessExtension: boolean
  readonly: boolean
  kind: Kind
  target: string
  category: Category
  severity: number
  reportedAt: number
  title: string
  description: string
  evidence: string
  regulatorUrl?: string
  synthetic: boolean
}

export type Confirmation = {
  key: Hex
  creator: Hex
  report: Hex
  confirmedAt: number
  expiresAt: bigint
  note: string
}

export type Attestor = {
  key: Hex
  attestor: Hex
  label: string
  about: string
  expiresAt: bigint
}

type Raw = {
  key: Hex
  creator: Hex
  owner: Hex
  createdAt: bigint
  expiresAt: bigint
  creationFlags: { readonly: boolean; permissionlessExtension: boolean }
  attributes: Record<string, { type: string; value: unknown }>
  toJson(): any
}

function attr<T>(e: Raw, name: string): T {
  return e.attributes?.[name]?.value as T
}

function num(v: unknown): number {
  return typeof v === "bigint" ? Number(v) : Number(v ?? 0)
}

function safeJson(e: Raw): any {
  try {
    return e.toJson()
  } catch {
    return {}
  }
}

export function toReport(e: Raw): Report {
  const p = safeJson(e)
  return {
    key: e.key,
    creator: e.creator,
    owner: e.owner,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    permissionlessExtension: !!e.creationFlags?.permissionlessExtension,
    readonly: !!e.creationFlags?.readonly,
    kind: attr<Kind>(e, A.kind),
    target: attr<string>(e, A.target),
    category: attr<Category>(e, A.category),
    severity: num(attr(e, A.severity)),
    reportedAt: num(attr(e, A.reportedAt)),
    title: String(p.title ?? ""),
    description: String(p.description ?? ""),
    evidence: String(p.evidence ?? ""),
    regulatorUrl: typeof p.regulatorUrl === "string" ? p.regulatorUrl : undefined,
    synthetic: p.synthetic !== false,
  }
}

function toConfirmation(e: Raw): Confirmation {
  const p = safeJson(e)
  return {
    key: e.key,
    creator: e.creator,
    report: String(attr(e, A.report)).toLowerCase() as Hex,
    confirmedAt: num(attr(e, A.confirmedAt)),
    expiresAt: e.expiresAt,
    note: String(p.note ?? ""),
  }
}

function toAttestor(e: Raw): Attestor {
  const p = safeJson(e)
  return {
    key: e.key,
    attestor: String(attr(e, A.attestor)).toLowerCase() as Hex,
    label: String(attr(e, A.label) ?? ""),
    about: String(p.about ?? ""),
    expiresAt: e.expiresAt,
  }
}

const ofType = (t: string) => [eq(A.app, str(APP)), eq(A.type, str(t))]

const FULL = "*" as const

/** Walk every page of a query (cursor pagination, 200 per page, the node maximum). */
async function all<T>(builder: any, map: (e: Raw) => T, max = 1000): Promise<T[]> {
  const out: T[] = []
  let page = await builder.limit(200).fetch()
  for (;;) {
    for (const e of page.entities) out.push(map(e as Raw))
    if (out.length >= max || !page.hasNextPage()) break
    page = await page.next()
  }
  return out
}

/**
 * Query 1: is this link reported? Exact match on target, compound with kind. For a website the
 * host and each parent domain are tried in one OR, so "pay.fake-broker.example" also finds a
 * report filed against "fake-broker.example".
 */
export async function checkTarget(client: Reader, kind: Kind, target: string): Promise<Report[]> {
  const targets = kind === "site" ? domainCandidates(target) : [target]
  const targetPredicate =
    targets.length === 1
      ? eq(A.target, str(targets[0]!))
      : or(...targets.map((t) => eq(A.target, str(t))))
  const q = client
    .select(FULL)
    .where(...ofType("report"), eq(A.kind, str(kind)), targetPredicate)
  return all(q, toReport)
}

export type BrowseFilter = {
  category?: Category
  minSeverity: number
  maxSeverity: number
  sinceUnix?: number
}

/**
 * Query 2: recent reports by category and severity range. Numeric ranges on severity and
 * reportedAt; there is no server-side ordering, so the page is sorted newest first here.
 */
export function browseQuery(client: Reader, f: BrowseFilter) {
  const preds = [
    ...ofType("report"),
    gte(A.severity, u64(f.minSeverity)),
    lte(A.severity, u64(f.maxSeverity)),
  ]
  if (f.category) preds.push(eq(A.category, str(f.category)))
  if (f.sinceUnix) preds.push(gte(A.reportedAt, u64(f.sinceUnix)))
  return client.select(FULL).where(...preds)
}

export type BrowsePage = { reports: Report[]; next?: () => Promise<BrowsePage> }

export async function browse(client: Reader, f: BrowseFilter, pageSize = 25): Promise<BrowsePage> {
  const wrap = (page: any): BrowsePage => ({
    reports: (page.entities as Raw[]).map(toReport).sort((a, b) => b.reportedAt - a.reportedAt),
    next: page.hasNextPage() ? async () => wrap(await page.next()) : undefined,
  })
  return wrap(await browseQuery(client, f).limit(pageSize).fetch())
}

/** All reports, newest first. Used for the feed's first paint. */
export async function recentReports(client: Reader, max = 200): Promise<Report[]> {
  const rows = await all(client.select(FULL).where(...ofType("report")), toReport, max)
  return rows.sort((a, b) => b.reportedAt - a.reportedAt)
}

export async function getReport(client: Reader, entityKey: Hex): Promise<Report | undefined> {
  const page = await client
    .select(FULL)
    .where(eq("$key", key(entityKey)), ...ofType("report"))
    .limit(1)
    .fetch()
  const e = page.entities[0]
  return e ? toReport(e as unknown as Raw) : undefined
}

/** Confirmations that point at one report. */
export async function confirmationsFor(client: Reader, reportKey: Hex): Promise<Confirmation[]> {
  const q = client.select(FULL).where(...ofType("confirmation"), eq(A.report, key(reportKey)))
  return all(q, toConfirmation)
}

/**
 * The trusted attestor set. Trust is rooted in the curator's address: only attestor entities
 * whose $creator is the curator count, whatever anyone else writes with the same attributes.
 * The curator itself is always trusted.
 */
export async function trustedAttestors(client: Reader, curator: Hex): Promise<Map<string, Attestor>> {
  const rows = await all(
    client.select(FULL).where(...ofType("attestor")).createdBy(curator),
    toAttestor,
  )
  const m = new Map<string, Attestor>()
  m.set(curator.toLowerCase(), {
    key: "0x" as Hex,
    attestor: curator.toLowerCase() as Hex,
    label: "ScamWatch curator",
    about: "The registry's root of trust. Its address is fixed in the app's source.",
    expiresAt: 0n,
  })
  for (const r of rows) m.set(r.attestor, r)
  return m
}

/**
 * Query 3: reports confirmed by trusted attestors. createdBy() on each attestor's confirmations,
 * then the reports they point at. Trust comes from $creator, never from a writable field.
 */
export async function attestedReports(
  client: Reader,
  attestors: Iterable<string>,
): Promise<{ report: Report; by: Hex[] }[]> {
  const byReport = new Map<string, Set<Hex>>()
  for (const a of attestors) {
    const confs = await all(
      client.select(FULL).where(...ofType("confirmation")).createdBy(a as Hex),
      toConfirmation,
    )
    for (const c of confs) {
      if (!byReport.has(c.report)) byReport.set(c.report, new Set())
      byReport.get(c.report)!.add(a as Hex)
    }
    // Reports an attestor filed itself also count as attested.
    const own = await all(
      client.select({ key: true }).where(...ofType("report")).createdBy(a as Hex),
      (e) => e.key.toLowerCase(),
    )
    for (const k of own) {
      if (!byReport.has(k)) byReport.set(k, new Set())
      byReport.get(k)!.add(a as Hex)
    }
  }
  const out: { report: Report; by: Hex[] }[] = []
  for (const [k, by] of byReport) {
    const r = await getReport(client, k as Hex)
    if (r) out.push({ report: r, by: [...by] })
  }
  return out.sort((a, b) => b.report.reportedAt - a.report.reportedAt)
}

/** Confirmations for many reports in one OR query, so the feed can show counts per card. */
export async function confirmationsForMany(
  client: Reader,
  reportKeys: Hex[],
): Promise<Map<string, Confirmation[]>> {
  const m = new Map<string, Confirmation[]>()
  for (let i = 0; i < reportKeys.length; i += 20) {
    const chunk = reportKeys.slice(i, i + 20)
    if (chunk.length === 0) continue
    const pred = chunk.length === 1 ? eq(A.report, key(chunk[0]!)) : or(...chunk.map((k) => eq(A.report, key(k))))
    const confs = await all(client.select(FULL).where(...ofType("confirmation"), pred), toConfirmation)
    for (const c of confs) {
      if (!m.has(c.report)) m.set(c.report, [])
      m.get(c.report)!.push(c)
    }
  }
  return m
}

/** Distinct confirming wallets, excluding the reporter confirming their own report. */
export function independentConfirmers(report: Report, confs: Confirmation[]): Hex[] {
  const set = new Set<string>()
  for (const c of confs) {
    if (c.creator.toLowerCase() !== report.creator.toLowerCase()) set.add(c.creator.toLowerCase())
  }
  return [...set] as Hex[]
}

export { addr, and }
