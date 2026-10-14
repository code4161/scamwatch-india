// ScamWatch India web app. Static files only: every read goes from this page straight to the
// Arkiv Tiramisu RPC through the official SDK. There is no ScamWatch server.

import "./style.css"
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { custom, type Hex, http, webSocket } from "viem"
import { key, str } from "@arkiv-network/sdk/attr"
import { eq, or } from "@arkiv-network/sdk/query"
import { CURATOR, EXPLORER, RPC_HTTP, RPC_WS } from "../lib/config"
import {
  type Attestor,
  attestedReports,
  browse,
  type BrowsePage,
  browseQuery,
  checkTarget,
  type Confirmation,
  confirmationsFor,
  confirmationsForMany,
  getReport,
  independentConfirmers,
  type Reader,
  type Report,
  recentReports,
  toReport,
  trustedAttestors,
} from "../lib/registry"
import { domainCandidates, guessKind, normaliseTarget, RejectedTarget } from "../lib/normalise"
import {
  CATEGORIES,
  CATEGORY_LABEL,
  type Category,
  KIND_LABEL,
  KINDS,
  type Kind,
  LIFETIME_DAYS,
  SEVERITY_LABEL,
} from "../lib/schema"
import { confirmReport } from "../lib/writer"

// ---------- clients ----------

// The per-minute request limit resets within a minute, so one short wait is worth it; the hourly
// cost budget can be most of an hour away, so that 429 is shown to the reader instead.
async function politeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status !== 429) return res
  const wait = Number(res.headers.get("Retry-After") ?? 0)
  if (wait > 0 && wait <= 65) {
    setNet(`Waiting ${wait} s for the public RPC's per-minute limit…`, false)
    await new Promise((r) => setTimeout(r, wait * 1000))
    return fetch(input, init)
  }
  return res
}

// retryCount 0: on a 429 viem would otherwise sleep for the whole Retry-After (often most of an
// hour) before failing, and the page would look frozen. The response headers carry the budget.
const budget = { remaining: undefined as number | undefined, limit: undefined as number | undefined, resetSec: 0 }
const reader = createPublicClient({
  chain: tiramisu,
  transport: http(RPC_HTTP, {
    retryCount: 0,
    fetchFn: politeFetch,
    onFetchResponse(res) {
      const m = /limit=(\d+),\s*remaining=(\d+),\s*reset=(\d+)/.exec(res.headers.get("RateLimit") ?? "")
      if (m) {
        budget.limit = Number(m[1])
        budget.remaining = Number(m[2])
        budget.resetSec = Number(m[3])
        showBudget()
      }
    },
  }),
}) as unknown as Reader

function showBudget() {
  const el = document.getElementById("budget")
  if (el && budget.limit !== undefined) {
    el.textContent = ` · public RPC allowance for your connection: ${budget.remaining} of ${budget.limit} left in this window (RateLimit header)`
  }
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/429|ANON_COST_LIMITED|Too Many Requests/i.test(msg)) {
    const mins = Math.ceil((budget.resetSec || 3600) / 60)
    return `Arkiv's public RPC has used up the free query budget for your connection. It resets in about ${mins} minutes. The data is still on chain; anyone with their own budget or an Arkiv access key can read it.`
  }
  return msg
}
// watchEntityEvents opens a real subscription only over a WebSocket transport, and only without
// fromBlock. Over HTTP it would silently poll.
const live = createPublicClient({ chain: tiramisu, transport: webSocket(RPC_WS) }) as unknown as Reader

// ---------- state ----------

let head = 0n
let attestors = new Map<string, Attestor>()
const confCache = new Map<string, Confirmation[]>()
let feed: Report[] = []
const liveLog: string[] = []

const app = document.getElementById("app")!
const net = document.getElementById("net")!

// ---------- helpers ----------

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`

function remaining(expiresAt: bigint): string {
  if (head === 0n) return "…"
  const secs = Number(expiresAt - head) * 2
  if (secs <= 0) return "expired"
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

function ago(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} days ago`
}

const isTrusted = (a: string) => attestors.has(a.toLowerCase())

function trustOf(r: Report, confs: Confirmation[]) {
  const by = new Set<string>()
  if (isTrusted(r.creator)) by.add(r.creator.toLowerCase())
  for (const c of confs) if (isTrusted(c.creator)) by.add(c.creator.toLowerCase())
  return [...by]
}

function addrLink(a: string) {
  const t = attestors.get(a.toLowerCase())
  return `<a class="mono" href="${EXPLORER}/address/${esc(a)}" target="_blank" rel="noopener">${esc(short(a))}</a>${
    t ? ` <span class="badge trusted" title="${esc(t.about)}">${esc(t.label)}</span>` : ""
  }`
}

function sevPill(n: number) {
  return `<span class="sev sev${n}" title="${esc(SEVERITY_LABEL[n] ?? "")}">Severity ${n}</span>`
}

function card(r: Report): string {
  const confs = confCache.get(r.key.toLowerCase()) ?? []
  const n = independentConfirmers(r, confs).length
  const trust = trustOf(r, confs)
  return `<a class="card" href="#/r/${esc(r.key)}" data-key="${esc(r.key.toLowerCase())}">
    <div class="row1">
      <span class="kind">${esc(KIND_LABEL[r.kind] ?? r.kind)}</span>
      ${sevPill(r.severity)}
      ${trust.length ? `<span class="badge trusted">Attested</span>` : `<span class="badge">Community report</span>`}
    </div>
    <div class="target mono">${esc(r.target)}</div>
    <div class="title">${esc(r.title)}</div>
    <div class="meta">
      <span>${esc(CATEGORY_LABEL[r.category] ?? r.category)}</span>
      <span>${n} confirmation${n === 1 ? "" : "s"}</span>
      <span>filed ${esc(ago(r.reportedAt))}</span>
      <span class="exp" data-exp="${r.expiresAt}">expires in ${remaining(r.expiresAt)}</span>
    </div>
  </a>`
}

async function loadConfs(reports: Report[]) {
  const missing = reports.map((r) => r.key).filter((k) => !confCache.has(k.toLowerCase()))
  if (missing.length === 0) return
  const m = await confirmationsForMany(reader, missing)
  for (const k of missing) confCache.set(k.toLowerCase(), m.get(k.toLowerCase()) ?? [])
}

function tickExpiries() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-exp]")) {
    el.textContent = `${el.dataset.prefix ?? "expires in "}${remaining(BigInt(el.dataset.exp!))}`
  }
}

function setNet(text: string, ok = true) {
  net.textContent = text
  net.className = ok ? "net ok" : "net bad"
}

// ---------- views ----------

function viewCheck() {
  app.innerHTML = `
  <section class="hero">
    <h1>Check before you pay</h1>
    <p>Got a trading app, a "SEBI registered" advisory site or an IPO-allotment Telegram group from a stranger? Paste it here. The registry is public and nobody can take it down by pressuring a host.</p>
    <form id="checkForm" class="check">
      <input id="q" name="q" autocomplete="off" placeholder="Paste a website, Play Store link, t.me link or WhatsApp channel" required />
      <select id="kind" aria-label="What is it">
        <option value="">Auto-detect</option>
        ${KINDS.map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join("")}
      </select>
      <button type="submit">Check</button>
    </form>
    <p class="hint">Try <button class="linkish" data-try="https://pay.secure-login-tradebrokr.example/kyc">pay.secure-login-tradebrokr.example</button>, <button class="linkish" data-try="t.me/swdemo_ipo_allotment_vip">t.me/swdemo_ipo_allotment_vip</button> or <button class="linkish" data-try="safe-and-unknown.example">safe-and-unknown.example</button>.</p>
    <div id="result"></div>
  </section>
  <section>
    <h2>Live feed <span id="liveDot" class="dot" title="WebSocket entity events"></span></h2>
    <p class="sub">New reports and confirmations appear here as they land on chain, pushed over a WebSocket subscription. No refresh loop.</p>
    <div id="liveLog" class="livelog"></div>
    <div id="feed" class="cards"><p class="muted">Loading reports from Arkiv…</p></div>
  </section>`
  const form = document.getElementById("checkForm") as HTMLFormElement
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    runCheck()
  })
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-try]")) {
    b.addEventListener("click", () => {
      ;(document.getElementById("q") as HTMLInputElement).value = b.dataset.try!
      runCheck()
    })
  }
  renderLiveLog()
  renderFeed()
}

async function runCheck() {
  const raw = (document.getElementById("q") as HTMLInputElement).value
  const chosen = (document.getElementById("kind") as HTMLSelectElement).value as Kind | ""
  const kind = chosen || guessKind(raw)
  const out = document.getElementById("result")!
  let target: string
  try {
    target = normaliseTarget(kind, raw)
  } catch (e) {
    out.innerHTML = `<div class="verdict warn">${esc(e instanceof RejectedTarget ? e.message : String(e))}</div>`
    return
  }
  out.innerHTML = `<p class="muted">Querying Arkiv…</p>`
  let rows: Report[]
  try {
    rows = await checkTarget(reader, kind, target)
    await loadConfs(rows)
  } catch (e) {
    out.innerHTML = `<div class="verdict warn">${esc(friendly(e))}</div>`
    return
  }
  const tried = kind === "site" ? domainCandidates(target) : [target]
  const queryText = `app = str('scamwatch-in') AND type = str('report') AND kind = str('${kind}') AND ${
    tried.length > 1 ? `(${tried.map((t) => `target = str('${t}')`).join(" OR ")})` : `target = str('${tried[0]}')`
  }`
  const q = `<details class="q"><summary>Exact query sent to Arkiv</summary><code>${esc(queryText)}</code></details>`
  if (rows.length === 0) {
    out.innerHTML = `<div class="verdict none">
      <strong>No report found for <span class="mono">${esc(target)}</span>.</strong>
      That does not make it safe. Before you pay anyone:
      <ul>
        <li>Check that the adviser or analyst is on SEBI's <a href="https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=13" target="_blank" rel="noopener">Investment Adviser</a> or <a href="https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14" target="_blank" rel="noopener">Research Analyst</a> register, and the broker on the <a href="https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=30" target="_blank" rel="noopener">stock broker</a> register.</li>
        <li>Never transfer money to a personal bank account or UPI ID for "trading".</li>
        <li>No one can guarantee IPO allotment or fixed returns.</li>
      </ul>${q}</div>`
    return
  }
  const anyTrusted = rows.some((r) => trustOf(r, confCache.get(r.key.toLowerCase()) ?? []).length > 0)
  out.innerHTML = `<div class="verdict ${anyTrusted ? "bad" : "warn"}">
      <strong>${rows.length} report${rows.length > 1 ? "s" : ""} for <span class="mono">${esc(target)}</span>.</strong>
      ${anyTrusted ? "At least one is attested by a trusted reviewer." : "Community reports, not yet attested by a trusted reviewer."}
      Do not send money. If you already have, call 1930 or file at <a href="https://cybercrime.gov.in/" target="_blank" rel="noopener">cybercrime.gov.in</a>.
      ${q}</div>
    <div class="cards">${rows.map(card).join("")}</div>`
}

function renderLiveLog() {
  const el = document.getElementById("liveLog")
  if (el) el.innerHTML = liveLog.slice(0, 5).map((l) => `<div>${l}</div>`).join("")
}

async function renderFeed() {
  const el = document.getElementById("feed")
  if (!el) return
  if (feed.length === 0) {
    try {
      feed = await recentReports(reader, 60)
      await loadConfs(feed)
    } catch (e) {
      el.innerHTML = `<p class="muted">${esc(friendly(e))}</p>`
      return
    }
  }
  const el2 = document.getElementById("feed")
  if (!el2) return
  el2.innerHTML = feed.length ? feed.slice(0, 30).map(card).join("") : `<p class="muted">No live reports yet.</p>`
}

let browseState: { page?: BrowsePage; rows: Report[] } = { rows: [] }

function viewBrowse() {
  app.innerHTML = `
  <section>
    <h1>Browse reports</h1>
    <form id="bf" class="filters">
      <label>Category
        <select name="category"><option value="">Any</option>${CATEGORIES.map((c) => `<option value="${c}">${CATEGORY_LABEL[c]}</option>`).join("")}</select>
      </label>
      <label>Severity from <select name="min">${[1, 2, 3, 4, 5].map((n) => `<option ${n === 1 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>to <select name="max">${[1, 2, 3, 4, 5].map((n) => `<option ${n === 5 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Filed in the last
        <select name="since"><option value="">any time</option><option value="1">24 hours</option><option value="3">3 days</option><option value="7">7 days</option><option value="30">30 days</option></select>
      </label>
      <button type="submit">Search</button>
    </form>
    <details class="q"><summary>Exact query sent to Arkiv</summary><code id="bq"></code></details>
    <div id="br" class="cards"></div>
    <button id="more" class="secondary" hidden>Load more (next cursor page)</button>
  </section>`
  const form = document.getElementById("bf") as HTMLFormElement
  const run = async () => {
    const d = new FormData(form)
    const since = d.get("since") ? Math.floor(Date.now() / 1000) - Number(d.get("since")) * 86400 : undefined
    const f = {
      category: (d.get("category") as Category) || undefined,
      minSeverity: Number(d.get("min")),
      maxSeverity: Number(d.get("max")),
      sinceUnix: since,
    }
    document.getElementById("bq")!.textContent = browseQuery(reader, f).toString()
    document.getElementById("br")!.innerHTML = `<p class="muted">Querying Arkiv…</p>`
    const page = await browse(reader, f, 10)
    browseState = { page, rows: page.reports }
    await drawBrowse()
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    run()
  })
  document.getElementById("more")!.addEventListener("click", async () => {
    if (!browseState.page?.next) return
    const page = await browseState.page.next()
    browseState = { page, rows: [...browseState.rows, ...page.reports].sort((a, b) => b.reportedAt - a.reportedAt) }
    await drawBrowse()
  })
  run()
}

async function drawBrowse() {
  await loadConfs(browseState.rows)
  const br = document.getElementById("br")
  if (!br) return
  br.innerHTML = browseState.rows.length ? browseState.rows.map(card).join("") : `<p class="muted">No reports match.</p>`
  ;(document.getElementById("more") as HTMLButtonElement).hidden = !browseState.page?.next
}

async function viewAttested() {
  app.innerHTML = `
  <section>
    <h1>Attested by trusted reviewers</h1>
    <p class="sub">A report counts as attested when a trusted reviewer filed it or confirmed it. "Trusted" is decided by the wallet that signed the entity on chain ($creator), never by a field anyone can write. The curator <span class="mono">${esc(short(CURATOR))}</span> is fixed in this app's source; it lists the other reviewers as attestor entities it signs.</p>
    <h2>Trusted reviewers</h2>
    <div id="att" class="attestors"></div>
    <h2>Reports</h2>
    <div id="ar" class="cards"><p class="muted">Querying Arkiv…</p></div>
  </section>`
  document.getElementById("att")!.innerHTML = [...attestors.values()]
    .map(
      (a) => `<div class="att"><div>${addrLink(a.attestor)}</div><div class="muted">${esc(a.about)}</div>${
        a.expiresAt ? `<div class="muted">Listing lease <span data-exp="${a.expiresAt}" data-prefix="ends in ">ends in ${remaining(a.expiresAt)}</span></div>` : ""
      }</div>`,
    )
    .join("")
  const known = new Map(feed.map((r) => [r.key.toLowerCase(), r] as const))
  let rows: { report: Report; by: Hex[] }[]
  try {
    rows = await attestedReports(reader, attestors.keys(), known)
  } catch (e) {
    const ar = document.getElementById("ar")
    if (ar) ar.innerHTML = `<p class="muted">${esc(friendly(e))}</p>`
    return
  }
  await loadConfs(rows.map((r) => r.report))
  const ar = document.getElementById("ar")
  if (ar) ar.innerHTML = rows.length ? rows.map((r) => card(r.report)).join("") : `<p class="muted">None yet.</p>`
}

async function viewReport(k: Hex) {
  app.innerHTML = `<p class="muted">Reading entity ${esc(short(k))} from Arkiv…</p>`
  const lk = k.toLowerCase()
  const r = feed.find((x) => x.key.toLowerCase() === lk) ?? (await getReport(reader, k))
  if (!r) {
    app.innerHTML = `<section><h1>Not found</h1><p>No live report with key <span class="mono">${esc(k)}</span>. It may have reached its Entity Expiration without enough confirmations. Its creation transaction is still on the <a href="${EXPLORER}/entity/${esc(k)}" target="_blank" rel="noopener">explorer</a>.</p></section>`
    return
  }
  const confs = confCache.get(lk) ?? (await confirmationsFor(reader, k))
  confCache.set(lk, confs)
  const indep = independentConfirmers(r, confs)
  const trust = trustOf(r, confs)
  app.innerHTML = `
  <section class="detail">
    <p><a href="#/">← Back</a></p>
    <div class="row1"><span class="kind">${esc(KIND_LABEL[r.kind])}</span>${sevPill(r.severity)}${trust.length ? `<span class="badge trusted">Attested</span>` : `<span class="badge">Community report</span>`}${r.synthetic ? `<span class="badge">Synthetic demo data</span>` : ""}</div>
    <h1 class="mono target">${esc(r.target)}</h1>
    <h2>${esc(r.title)}</h2>
    <p>${esc(r.description)}</p>
    ${r.evidence ? `<p><strong>Evidence:</strong> ${esc(r.evidence)}</p>` : ""}
    ${r.regulatorUrl ? `<p><a href="${esc(r.regulatorUrl)}" target="_blank" rel="noopener">Check the regulator's register</a></p>` : ""}

    <div class="facts">
      <div><span>Category</span>${esc(CATEGORY_LABEL[r.category])}</div>
      <div><span>Filed</span>${esc(new Date(r.reportedAt * 1000).toLocaleString("en-IN"))}</div>
      <div><span>Signed by ($creator)</span>${addrLink(r.creator)}</div>
      <div><span>Owner ($owner)</span>${addrLink(r.owner)}</div>
      <div><span>Entity Expiration</span><strong data-exp="${r.expiresAt}">expires in ${remaining(r.expiresAt)}</strong> <span class="muted">(block ${r.expiresAt})</span></div>
      <div><span>Creation flags</span>${r.readonly ? "read-only (nobody can edit it)" : "editable by owner"} · ${r.permissionlessExtension ? "anyone may extend its lifetime" : "only the owner may extend"}</div>
      <div><span>Entity</span><a class="mono" href="${EXPLORER}/entity/${esc(r.key)}" target="_blank" rel="noopener">${esc(short(r.key))}</a></div>
    </div>

    <h2>${indep.length} independent confirmation${indep.length === 1 ? "" : "s"}</h2>
    <p class="sub">Each confirmation is a separate entity signed by another wallet, written in one atomic batch with a Lifetime Extension of this report (+${LIFETIME_DAYS.confirmationExtension} days). An unconfirmed report lasts ${LIFETIME_DAYS.reportUnconfirmed} days. A reporter's own confirmation does not count.</p>
    <div class="confs">${
      confs.length
        ? confs
            .sort((a, b) => b.confirmedAt - a.confirmedAt)
            .map(
              (c) => `<div class="conf"><div>${addrLink(c.creator)} <span class="muted">${esc(ago(c.confirmedAt))}</span></div>${c.note ? `<div>${esc(c.note)}</div>` : ""}<div class="muted"><a href="${EXPLORER}/entity/${esc(c.key)}" target="_blank" rel="noopener">entity</a> · lives until block ${c.expiresAt}</div></div>`,
            )
            .join("")
        : `<p class="muted">None yet. If no one confirms it, this report expires on its own.</p>`
    }</div>

    <h2>Confirm this report</h2>
    <p class="sub">Seen this scam yourself? Confirm it from any wallet funded on Tiramisu. Your wallet signs the confirmation; ScamWatch never sees a key.</p>
    <div class="confirm">
      <input id="note" placeholder="Optional note (no names, phone numbers or UPI IDs)" maxlength="280" />
      <button id="cw">Confirm with browser wallet</button>
    </div>
    <div id="cwOut" class="muted"></div>
    <details class="q"><summary>Or with the CLI</summary><code>ARKIV_PRIVATE_KEY=0x… npx tsx cli/scamwatch.ts confirm --report ${esc(r.key)} --as confirmer1</code></details>
  </section>`
  document.getElementById("cw")!.addEventListener("click", async () => {
    const out = document.getElementById("cwOut")!
    try {
      const w = await browserWallet()
      out.textContent = "Waiting for your wallet to sign…"
      const res = await confirmReport(w, reader, r.key, (document.getElementById("note") as HTMLInputElement).value)
      out.innerHTML = `Confirmed in one batch. <a href="${EXPLORER}/tx/${esc(res.txHash)}" target="_blank" rel="noopener">View transaction</a>`
      setTimeout(() => viewReport(r.key), 3000)
    } catch (e) {
      out.textContent = e instanceof Error ? e.message : String(e)
    }
  })
}

async function browserWallet() {
  const eth = (window as any).ethereum
  if (!eth) throw new Error("No browser wallet found. Install one, or use the CLI.")
  const [account] = (await eth.request({ method: "eth_requestAccounts" })) as Hex[]
  const chainId = `0x${tiramisu.id.toString(16)}`
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] })
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: "Arkiv Tiramisu testnet",
          nativeCurrency: { name: "Golem", symbol: "GLM", decimals: 18 },
          rpcUrls: [RPC_HTTP],
          blockExplorerUrls: [EXPLORER],
        },
      ],
    })
  }
  return createWalletClient({ chain: tiramisu, transport: custom(eth), account: account! }) as any
}

function viewAbout() {
  app.innerHTML = `
  <section class="about">
    <h1>How it works</h1>
    <p>Fake trading apps, "guaranteed IPO allotment" Telegram groups and advisory sites that claim a SEBI registration they do not hold take money from Indian retail investors every day. A blocklist on a normal server can be taken offline by the people it names: a legal notice to the host, a complaint to the domain registrar, pressure on the operator. ScamWatch keeps the list on Arkiv, the Web3 database. This page is static files; it reads the registry straight from the Arkiv RPC, and anyone can run the same queries without us.</p>
    <h2>What is on Arkiv</h2>
    <ul>
      <li><strong>report</strong> entities: the kind of thing reported, its normalised target, category, severity and time as typed attributes you can query; the description and evidence in the payload. Created read-only, with permissionless extension. Unconfirmed reports expire after ${LIFETIME_DAYS.reportUnconfirmed} days.</li>
      <li><strong>confirmation</strong> entities: signed by a different wallet, pointing at a report. Each one is written in an atomic batch with a Lifetime Extension of the report.</li>
      <li><strong>attestor</strong> entities: signed by the curator, listing reviewers whose reports and confirmations get the Attested badge. A ${LIFETIME_DAYS.attestor}-day lease the curator renews.</li>
    </ul>
    <h2>What stays off Arkiv</h2>
    <p>Phone numbers, UPI IDs, bank accounts, names and emails are refused by the app before anything is signed, even hashed. Victim stories with personal detail belong with the police at 1930 and cybercrime.gov.in, not on a public ledger.</p>
    <h2>Trust</h2>
    <p>Anyone can write an entity that looks like a ScamWatch report. The app does not trust any field for that; it trusts the signer. The curator address <a class="mono" href="${EXPLORER}/address/${CURATOR}" target="_blank" rel="noopener">${CURATOR}</a> is fixed in the source, and the Attested badge only appears for reports filed or confirmed by wallets the curator listed on chain.</p>
    <p>Source, schema and reproduce steps: <a href="https://github.com/code4161/scamwatch-india" rel="noopener">github.com/code4161/scamwatch-india</a>.</p>
  </section>`
}

// ---------- live events ----------

// The public RPC gives each anonymous connection a budget of query cost units. A live feed that
// read back every entity created on the network spent it in minutes, so events are filtered on
// their creation flags first and the survivors are read in one batched query, at most every 10 s.
const REPORT_FLAGS = 3 // readonly + permissionlessExtension, as reportCreate sets them
const CONFIRMATION_FLAGS = 1 // readonly
let liveQueue: { key: Hex; block: bigint }[] = []
let liveTimer: ReturnType<typeof setTimeout> | undefined

function queueLive(key: Hex, block: bigint) {
  liveQueue.push({ key: key.toLowerCase() as Hex, block })
  if (!liveTimer) liveTimer = setTimeout(drainLive, Math.max(2000, lastDrain + 10000 - Date.now()))
}

let lastDrain = 0

async function drainLive() {
  liveTimer = undefined
  lastDrain = Date.now()
  const batch = liveQueue.splice(0, 20)
  if (liveQueue.length) liveTimer = setTimeout(drainLive, 10000)
  if (batch.length === 0) return
  const keys = batch.map((b) => eq("$key", key(b.key)))
  const page = await reader
    .select("*")
    .where(eq("app", str("scamwatch-in")), keys.length === 1 ? keys[0]! : or(...keys))
    .limit(20)
    .fetch()
    .catch(() => undefined)
  if (!page) return
  const onHome = location.hash === "" || location.hash === "#/"
  for (const raw of page.entities as any[]) {
    const k = raw.key.toLowerCase() as Hex
    const block = batch.find((b) => b.key === k)?.block
    const type = raw.attributes?.type?.value
    if (type === "report") {
      const r = toReport(raw)
      confCache.set(k, [])
      feed = [r, ...feed.filter((x) => x.key.toLowerCase() !== k)]
      liveLog.unshift(`New report: <a class="mono" href="#/r/${esc(k)}">${esc(r.target)}</a> (block ${block})`)
    } else if (type === "confirmation") {
      const target = String(raw.attributes?.report?.value ?? "").toLowerCase()
      confCache.delete(target)
      liveLog.unshift(
        `New confirmation for <a class="mono" href="#/r/${esc(target)}">${esc(raw.attributes?.target?.value ?? short(target))}</a> by ${esc(short(raw.creator))} (block ${block})`,
      )
      if (location.hash === `#/r/${target}`) viewReport(target as Hex)
    }
  }
  if (onHome && page.entities.length) {
    renderLiveLog()
    await loadConfs(feed)
    await renderFeed()
    for (const raw of page.entities as any[]) {
      flash(raw.key.toLowerCase())
      flash(String(raw.attributes?.report?.value ?? "").toLowerCase())
    }
  }
}

function startLive() {
  const dot = () => document.getElementById("liveDot")
  live.watchEntityEvents({
    onEntityCreated: (ev) => {
      if (ev.creationFlags.raw === REPORT_FLAGS || ev.creationFlags.raw === CONFIRMATION_FLAGS) {
        queueLive(ev.entityKey, ev.blockNumber)
      }
    },
    onExpiryExtended: (ev) => {
      const k = ev.entityKey.toLowerCase()
      const r = feed.find((x) => x.key.toLowerCase() === k)
      if (r) r.expiresAt = ev.expiresAt
      for (const el of document.querySelectorAll<HTMLElement>(`[data-key="${k}"] [data-exp]`)) el.dataset.exp = String(ev.expiresAt)
      tickExpiries()
    },
    onError: (err) => {
      setNet(`Live updates interrupted: ${err.message.slice(0, 80)}`, false)
      dot()?.classList.remove("on")
    },
  })
  dot()?.classList.add("on")
}

function flash(k: string) {
  const el = document.querySelector(`[data-key="${k}"]`)
  el?.classList.add("flash")
  setTimeout(() => el?.classList.remove("flash"), 2500)
}

// ---------- router ----------

async function route() {
  const h = location.hash.replace(/^#/, "") || "/"
  try {
    if (h.startsWith("/r/")) await viewReport(h.slice(3) as Hex)
    else if (h === "/browse") viewBrowse()
    else if (h === "/attested") await viewAttested()
    else if (h === "/about") viewAbout()
    else viewCheck()
  } catch (e) {
    app.innerHTML = `<section><h1>Could not reach Arkiv</h1><p>${esc(friendly(e))}</p></section>`
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
    a.classList.toggle("active", a.getAttribute("href") === `#${h}`)
  }
}

async function boot() {
  try {
    head = await reader.getBlockNumber()
    setNet(`Live on Arkiv Tiramisu (chain ${tiramisu.id}) · block ${head} · read directly from the public RPC`)
    net.insertAdjacentHTML("beforeend", `<span id="budget"></span>`)
    showBudget()
  } catch (e) {
    setNet(friendly(e), false)
  }
  // The SDK's client type narrows viem's public actions to a subset; watchBlockNumber is present
  // at runtime but missing from the type (see arkiv/friction.md).
  ;(live as any).watchBlockNumber({
    onBlockNumber: (b: bigint) => {
      head = b
      const t = net.firstChild
      if (t && t.nodeType === Node.TEXT_NODE) t.textContent = t.textContent!.replace(/block \d+/, `block ${b}`)
      tickExpiries()
    },
  })
  attestors = await trustedAttestors(reader, CURATOR).catch(() => attestors)
  // One read of the whole registry (it is small) serves the feed, report pages and the Attested
  // page from memory, so a visit costs a handful of queries against the anonymous budget.
  try {
    feed = await recentReports(reader, 200)
    await loadConfs(feed)
  } catch {}
  window.addEventListener("hashchange", route)
  await route()
  startLive()
}

boot()

// Exposed so anyone can run their own queries from the browser console.
;(window as any).scamwatch = { reader, checkTarget, normaliseTarget, browseQuery }
