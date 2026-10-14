// Browser end-to-end check against the deployed site, driven over the Chrome DevTools protocol.
//
// 1. Opens the live feed in headless Chrome and waits for the WebSocket subscription.
// 2. Files a new synthetic report from the CLI library and checks that the page shows it with no reload.
// 3. Opens a report page with a test wallet provider injected as window.ethereum. The provider
//    signs in this Node process (the key never enters the page) and the page's own
//    "Confirm with browser wallet" button sends the batch.
//
//   ARKIV_PRIVATE_KEY=... npx tsx scripts/e2e-browser.ts [site url]

import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Hex } from "viem"
import { accountFor, publicClient, walletFor } from "../cli/wallets"
import { fileReport } from "../src/lib/writer"
import { confirmationsFor } from "../src/lib/registry"

const SITE = process.argv[2] ?? "https://code4161.github.io/scamwatch-india/"
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9333
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "swe2e-"))}`,
  "about:blank",
])

async function cdpTarget(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as any[]
      const page = list.find((t) => t.type === "page")
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(200)
  }
  throw new Error("Chrome did not start")
}

const ws = new WebSocket(await cdpTarget())
await new Promise((r) => ws.addEventListener("open", r))
let id = 0
const pending = new Map<number, (v: any) => void>()
const listeners: ((m: any) => void)[] = []
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data))
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m)
    pending.delete(m.id)
  } else for (const l of listeners) l(m)
})
function send(method: string, params: any = {}): Promise<any> {
  const n = ++id
  ws.send(JSON.stringify({ id: n, method, params }))
  return new Promise((r) => pending.set(n, r))
}
async function evaluate(expression: string): Promise<any> {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}
async function waitFor(expression: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await evaluate(expression)) return true
    await sleep(500)
  }
  return false
}

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`)
  if (!ok) failures++
}

const consoleLines: string[] = []
listeners.push((m) => {
  if (m.method === "Runtime.consoleAPICalled") consoleLines.push(`${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ")}`.slice(0, 300))
  if (m.method === "Runtime.exceptionThrown") consoleLines.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`.slice(0, 300))
})
await send("Page.enable")
await send("Runtime.enable")

// Step 1 and 2: the live feed reacts to a real event.
await send("Page.navigate", { url: SITE })
check("WebSocket subscription opens", await waitFor(`!!document.querySelector("#liveDot.on")`, 20000))
check("feed lists reports", await waitFor(`document.querySelectorAll("#feed .card").length > 0`, 20000))
const before = await evaluate(`document.querySelectorAll("#feed .card").length`)

const handle = `swdemo_upper_circuit_${Date.now().toString(36)}`
const filed = await fileReport(walletFor("reporter1"), {
  kind: "telegram",
  target: handle,
  category: "tips_group",
  severity: 3,
  payload: {
    title: "'Upper circuit' penny stock calls channel",
    description: "Posts daily 'upper circuit guaranteed' calls on illiquid stocks and sells a paid VIP tier.",
    evidence: "Synthetic report filed by the browser end-to-end check.",
    synthetic: true,
  },
})
console.log(`filed ${filed.entityKey} tx ${filed.txHash}`)
const t0 = Date.now()
const appeared = await waitFor(`!!document.querySelector('[data-key="${filed.entityKey.toLowerCase()}"]')`, 30000)
check("new report appears in the feed without a reload", appeared, `${((Date.now() - t0) / 1000).toFixed(1)} s after the receipt`)
const after = await evaluate(`document.querySelectorAll("#feed .card").length`)
const log = await evaluate(`document.getElementById("liveLog").innerText`)
check("live log names the new target", String(log).includes(handle), String(log).split("\n")[0])
console.log(`cards before ${before}, after ${after}; status bar: ${await evaluate('document.getElementById("net").innerText')}`)
if (consoleLines.length) console.log(`page console:\n  ${consoleLines.slice(0, 15).join("\n  ")}`)

// Step 3: the page's own confirm button through an injected wallet provider.
const signer = walletFor("confirmer2")
const signerAddress = accountFor("confirmer2").address
await send("Runtime.addBinding", { name: "__swSign" })
listeners.push(async (m) => {
  if (m.method !== "Runtime.bindingCalled" || m.params.name !== "__swSign") return
  const { reqId, tx } = JSON.parse(m.params.payload)
  let result: { hash?: string; error?: string }
  try {
    const hash = await signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : 0n,
      gas: tx.gas ? BigInt(tx.gas) : undefined,
    } as any)
    result = { hash }
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) }
  }
  await evaluate(`window.__swResolve(${JSON.stringify(reqId)}, ${JSON.stringify(result)})`)
})
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const rpc = ${JSON.stringify("https://rpc.tiramisu.db-chain.testnet.arkiv.network")}
    const waiters = new Map(); let n = 0
    window.__swResolve = (id, r) => { const w = waiters.get(id); waiters.delete(id); r.error ? w.reject(new Error(r.error)) : w.resolve(r.hash) }
    window.__swCalls = []
    window.ethereum = {
      request: async ({ method, params }) => {
        window.__swCalls.push(method)
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [${JSON.stringify(signerAddress)}]
        if (method === "eth_chainId") return "0x7614d1"
        if (method === "wallet_switchEthereumChain") return null
        if (method === "eth_sendTransaction") {
          const id = String(++n)
          return new Promise((resolve, reject) => { waiters.set(id, { resolve, reject }); window.__swSign(JSON.stringify({ reqId: id, tx: params[0] })) })
        }
        const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })
        const j = await res.json(); if (j.error) throw Object.assign(new Error(j.error.message), j.error); return j.result
      },
      on() {}, removeListener() {},
    }
  })()`,
})
// A hash change keeps the same document, so leave the page first for the injected provider to load.
await send("Page.navigate", { url: "about:blank" })
await sleep(500)
await send("Page.navigate", { url: `${SITE}#/r/${filed.entityKey}` })
await waitFor(`!!document.getElementById("cw")`, 20000)
await evaluate(`document.getElementById("note").value = "Seen the same channel (synthetic)."; document.getElementById("cw").click(); true`)
// Success shows as the button's message, or as the page re-rendering with the new confirmation
// when the live feed sees it first.
const shortSigner = `${signerAddress.slice(0, 6)}…${signerAddress.slice(-4)}`
const done = await waitFor(
  `/Confirmed in one batch|Error|failed|rejected/i.test(document.getElementById("cwOut")?.innerText ?? "") || document.querySelector(".confs")?.innerText.includes(${JSON.stringify(shortSigner)})`,
  60000,
)
const out = await evaluate(`document.getElementById("cwOut")?.innerText`)
const listed = await evaluate(`document.querySelector(".confs")?.innerText.includes(${JSON.stringify(shortSigner)})`)
check("browser confirm button sends the batch", done && (String(out).startsWith("Confirmed") || listed === true), out ? String(out) : `page lists ${shortSigner} under confirmations`)
check("report page shows 1 independent confirmation", await waitFor(`/1 independent confirmation/.test(document.body.innerText)`, 20000))
console.log(`provider calls: ${(await evaluate("window.__swCalls.join(', ')")) ?? ""}`)
const confs = await confirmationsFor(publicClient as any, filed.entityKey as Hex)
check(
  "confirmation readable through the SDK",
  confs.some((c) => c.creator.toLowerCase() === signerAddress.toLowerCase()),
  `${confs.length} confirmation(s)`,
)

ws.close()
chrome.kill()
process.exit(failures ? 1 : 0)
