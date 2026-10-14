// Wallets for the CLI. The curator key comes from ARKIV_PRIVATE_KEY and is never written anywhere.
// The demo community wallets (reporters, confirmers, a partner attestor) are derived from it in
// memory, so their addresses are stable across runs without storing a second secret.

import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { concat, type Hex, http, keccak256, stringToHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const ROLES = {
  curator: "Curator: root of trust; lists attestors; confirms reports it has checked",
  partner: "Partner attestor: listed by the curator, so its confirmations carry the trusted badge",
  reporter1: "Community reporter (untrusted)",
  reporter2: "Community reporter (untrusted)",
  reporter3: "Community reporter (untrusted)",
  confirmer1: "Community confirmer (untrusted)",
  confirmer2: "Community confirmer (untrusted)",
} as const
export type Role = keyof typeof ROLES

function rootKey(): Hex {
  const k = process.env.ARKIV_PRIVATE_KEY?.trim()
  if (!k) throw new Error("ARKIV_PRIVATE_KEY is not set. Load it into this process's environment.")
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex
}

export function keyFor(role: Role): Hex {
  const root = rootKey()
  if (role === "curator") return root
  return keccak256(concat([root, stringToHex(`scamwatch-india:demo-wallet:${role}`)]))
}

export function accountFor(role: Role) {
  return privateKeyToAccount(keyFor(role))
}

// Query cost as the RPC reports it, so verify can say what one full read of the registry costs.
export const usage = { calls: 0, cost: 0, remaining: undefined as number | undefined, limit: undefined as number | undefined }

// retryCount 0: on a 429 viem otherwise sleeps the whole Retry-After before failing.
export const publicClient = createPublicClient({
  chain: tiramisu,
  transport: http(undefined, {
    retryCount: 0,
    onFetchResponse(res) {
      usage.calls++
      usage.cost += Number(res.headers.get("Arkiv-Cost") ?? 0)
      const m = /limit=(\d+),\s*remaining=(\d+)/.exec(res.headers.get("RateLimit") ?? "")
      if (m) {
        usage.limit = Number(m[1])
        usage.remaining = Number(m[2])
      }
    },
  }),
})

export function walletFor(role: Role) {
  return createWalletClient({ chain: tiramisu, transport: http(), account: accountFor(role) })
}
