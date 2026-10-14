// ScamWatch India CLI: file reports, confirm them, manage attestors, and read the registry back.
//
//   ARKIV_PRIVATE_KEY=... npx tsx cli/scamwatch.ts <command> [--flags]
//
// Read commands (check, show, verify) need no key.

import type { Hex } from "viem"
import { formatEther, parseEther } from "viem"
import { CATEGORIES, type Category, KINDS, type Kind } from "../src/lib/schema"
import { CURATOR, EXPLORER } from "../src/lib/config"
import {
  attestedReports,
  browseQuery,
  checkTarget,
  confirmationsFor,
  getReport,
  independentConfirmers,
  recentReports,
  trustedAttestors,
} from "../src/lib/registry"
import { normaliseTarget } from "../src/lib/normalise"
import { addAttestor, confirmReport, fileReport, fileReports, renewAttestor } from "../src/lib/writer"
import { accountFor, publicClient, ROLES, type Role, usage, walletFor } from "./wallets"
import { PARTNER_ATTESTOR, SEED, seedReportedAt } from "./seed-data"

const reader = publicClient as any

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("--")) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = "true"
      else {
        out[a.slice(2)] = next
        i++
      }
    }
  }
  return out
}

function need(f: Record<string, string>, name: string): string {
  const v = f[name]
  if (!v) throw new Error(`--${name} is required`)
  return v
}

function role(f: Record<string, string>, fallback: Role): Role {
  const r = (f.as ?? fallback) as Role
  if (!(r in ROLES)) throw new Error(`--as must be one of ${Object.keys(ROLES).join(", ")}`)
  return r
}

async function headBlock() {
  return publicClient.getBlockNumber()
}

function days(blocks: bigint) {
  return (Number(blocks) * 2) / 86400
}

async function cmdWhoami() {
  for (const r of Object.keys(ROLES) as Role[]) {
    const a = accountFor(r).address
    const bal = await publicClient.getBalance({ address: a })
    console.log(`${r.padEnd(11)} ${a}  ${formatEther(bal).padStart(12)} GLM  ${ROLES[r]}`)
  }
}

async function cmdFund(f: Record<string, string>) {
  const amount = parseEther(f.amount ?? "0.01")
  const w = walletFor("curator")
  for (const r of Object.keys(ROLES) as Role[]) {
    if (r === "curator") continue
    const to = accountFor(r).address
    const bal = await publicClient.getBalance({ address: to })
    if (bal >= amount) {
      console.log(`${r} already has ${formatEther(bal)} GLM`)
      continue
    }
    const hash = await w.sendTransaction({ to, value: amount - bal } as any)
    await publicClient.waitForTransactionReceipt({ hash })
    console.log(`funded ${r} ${to} +${formatEther(amount - bal)} GLM  ${EXPLORER}/tx/${hash}`)
  }
}

async function cmdReport(f: Record<string, string>) {
  const kind = need(f, "kind") as Kind
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(", ")}`)
  const category = need(f, "category") as Category
  if (!CATEGORIES.includes(category)) throw new Error(`--category must be one of ${CATEGORIES.join(", ")}`)
  const r = role(f, "curator")
  const res = await fileReport(walletFor(r), {
    kind,
    target: need(f, "target"),
    category,
    severity: Number(need(f, "severity")),
    payload: {
      title: need(f, "title"),
      description: f.description ?? "",
      evidence: f.evidence ?? "",
      regulatorUrl: f["regulator-url"],
      synthetic: f.real !== "true",
    },
  })
  console.log(`report ${res.entityKey}\n  tx ${EXPLORER}/tx/${res.txHash}\n  entity ${EXPLORER}/entity/${res.entityKey}`)
}

async function cmdConfirm(f: Record<string, string>) {
  const r = role(f, "confirmer1")
  const reportKey = need(f, "report") as Hex
  const res = await confirmReport(walletFor(r), reader, reportKey, f.note ?? "")
  console.log(
    `confirmation ${res.createdEntities[0]} and extension of ${reportKey} in one batch\n  tx ${EXPLORER}/tx/${res.txHash}`,
  )
}

async function cmdAttest(f: Record<string, string>) {
  const who = need(f, "address")
  const address = (who in ROLES ? accountFor(who as Role).address : who) as Hex
  const res = await addAttestor(walletFor("curator"), address, need(f, "label"), f.about ?? "")
  console.log(`attestor ${address} listed as ${res.entityKey}\n  tx ${EXPLORER}/tx/${res.txHash}`)
}

async function cmdRenewAttestor(f: Record<string, string>) {
  const res = await renewAttestor(walletFor("curator"), need(f, "key") as Hex)
  console.log(`renewed ${res.entityKey} to block ${res.expiresAt}  ${EXPLORER}/tx/${res.txHash}`)
}

async function cmdCheck(f: Record<string, string>) {
  const kind = need(f, "kind") as Kind
  const target = normaliseTarget(kind, need(f, "target"))
  const rows = await checkTarget(reader, kind, target)
  console.log(`${kind} ${target}: ${rows.length} report(s)`)
  for (const r of rows) console.log(`  ${r.key} severity ${r.severity} ${r.category} by ${r.creator}`)
}

async function cmdShow(f: Record<string, string>) {
  const k = need(f, "report") as Hex
  const r = await getReport(reader, k)
  if (!r) return console.log("no live report with that key")
  const head = await headBlock()
  const confs = await confirmationsFor(reader, k)
  console.log(JSON.stringify({ ...r, createdAt: String(r.createdAt), expiresAt: String(r.expiresAt) }, null, 2))
  console.log(`expires in ${days(r.expiresAt - head).toFixed(2)} days; ${independentConfirmers(r, confs).length} independent confirmations`)
}

/** Seeds the synthetic dataset. Idempotent per target: skips a target that already has a report. */
async function cmdSeed() {
  const partner = accountFor("partner").address
  const attestors = await trustedAttestors(reader, CURATOR)
  if (!attestors.has(partner.toLowerCase())) {
    const res = await addAttestor(walletFor("curator"), partner, PARTNER_ATTESTOR.label, PARTNER_ATTESTOR.about)
    console.log(`listed partner attestor ${partner}: ${res.entityKey}  tx ${res.txHash}`)
  }

  // Group new reports by reporter so each reporter files its reports in one batch transaction.
  const keyById = new Map<string, Hex>()
  const pending = new Map<Role, typeof SEED>()
  for (const s of SEED) {
    const target = normaliseTarget(s.input.kind, s.input.target)
    const existing = (await checkTarget(reader, s.input.kind, target)).find((r) => r.target === target)
    if (existing) {
      keyById.set(s.id, existing.key)
      continue
    }
    if (!pending.has(s.by)) pending.set(s.by, [])
    pending.get(s.by)!.push(s)
  }
  for (const [by, rows] of pending) {
    const res = await fileReports(
      walletFor(by),
      rows.map((s) => ({ ...s.input, reportedAt: seedReportedAt(s.daysAgo) })),
    )
    rows.forEach((s, i) => keyById.set(s.id, res.createdEntities[i]!))
    console.log(`${by} filed ${rows.length} report(s) in one batch  tx ${res.txHash}`)
  }

  for (const s of SEED) {
    const reportKey = keyById.get(s.id)!
    const confs = await confirmationsFor(reader, reportKey)
    for (const c of s.confirmedBy) {
      const addr = accountFor(c).address.toLowerCase()
      if (confs.some((x) => x.creator.toLowerCase() === addr)) continue
      const res = await confirmReport(walletFor(c), reader, reportKey, `Confirmed by ${c} (synthetic demo).`)
      console.log(`${c} confirmed ${s.id} ${reportKey}  tx ${res.txHash}`)
    }
  }
}

/** Reads everything back through the same SDK and RPC the web app uses, and prints the queries. */
async function cmdVerify() {
  const head = await headBlock()
  const reports = await recentReports(reader, 1000)
  const attestors = await trustedAttestors(reader, CURATOR)
  const attested = await attestedReports(reader, attestors.keys())
  let confTotal = 0
  console.log(`head block ${head}`)
  console.log(`trusted attestors (createdBy ${CURATOR}): ${attestors.size}`)
  for (const a of attestors.values()) console.log(`  ${a.attestor} ${a.label}`)
  console.log(`live reports: ${reports.length}`)
  for (const r of reports) {
    const confs = await confirmationsFor(reader, r.key)
    confTotal += confs.length
    console.log(
      `  ${r.key.slice(0, 10)} ${r.kind.padEnd(16)} ${r.target.padEnd(38)} sev ${r.severity} conf ${independentConfirmers(r, confs).length} expires in ${days(r.expiresAt - head).toFixed(1)}d flags ro=${r.readonly} pe=${r.permissionlessExtension}`,
    )
  }
  console.log(`live confirmations: ${confTotal}`)
  console.log(`reports confirmed or filed by trusted attestors: ${attested.length}`)
  const q = browseQuery(reader, { category: "tips_group", minSeverity: 3, maxSeverity: 5 })
  console.log(`\nexample browse query string:\n  ${q.toString()}`)
  console.log(
    `\nRPC usage for this verify: ${usage.calls} HTTP calls, ${usage.cost} cost units (Arkiv-Cost header); budget left ${usage.remaining ?? "?"} of ${usage.limit ?? "?"}`,
  )
}

const [cmd, ...rest] = process.argv.slice(2)
const f = flags(rest)
const table: Record<string, (f: Record<string, string>) => Promise<unknown>> = {
  whoami: cmdWhoami,
  fund: cmdFund,
  report: cmdReport,
  confirm: cmdConfirm,
  attest: cmdAttest,
  "renew-attestor": cmdRenewAttestor,
  check: cmdCheck,
  show: cmdShow,
  seed: cmdSeed,
  verify: cmdVerify,
}
const run = table[cmd ?? ""]
if (!run) {
  console.log(`commands: ${Object.keys(table).join(", ")}`)
  process.exit(1)
}
run(f).catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
