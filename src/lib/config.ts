// Public configuration. No secrets live here or anywhere in this repo.

import type { Hex } from "viem"

export const RPC_HTTP = "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
export const RPC_WS = "wss://rpc.tiramisu.db-chain.testnet.arkiv.network"
export const EXPLORER = "https://tiramisu.explorer.arkiv.network"

// The registry's root of trust. Attestor entities count only when this address created them.
export const CURATOR: Hex = "0xBc223395380a7d53BE453E1Dacde40A20A370D06"
