// The ScamWatch India data contract on Arkiv. Shared by the web app, the CLI and the verify script,
// so every reader and writer agrees on attribute names, types and lifetimes. Documented in
// arkiv/schema.md.

export const APP = "scamwatch-in"
export const SCHEMA_VERSION = 1

export const KINDS = ["site", "app", "telegram", "whatsapp_channel"] as const
export type Kind = (typeof KINDS)[number]

export const CATEGORIES = [
  "fake_trading_app",
  "tips_group",
  "fake_sebi_claim",
  "broker_clone",
  "ponzi_other",
] as const
export type Category = (typeof CATEGORIES)[number]

export const KIND_LABEL: Record<Kind, string> = {
  site: "Website",
  app: "Android app",
  telegram: "Telegram channel",
  whatsapp_channel: "WhatsApp channel",
}

export const CATEGORY_LABEL: Record<Category, string> = {
  fake_trading_app: "Fake trading app",
  tips_group: "Stock tips / IPO allotment group",
  fake_sebi_claim: "False SEBI registration claim",
  broker_clone: "Clone of a real broker",
  ponzi_other: "Ponzi or other investment scheme",
}

export const SEVERITY_LABEL: Record<number, string> = {
  1: "Suspicious",
  2: "Misleading",
  3: "Likely scam",
  4: "Scam, money lost",
  5: "Active scam, large losses",
}

// Entity Expiration per type, in days. Blocks are 2 seconds on Tiramisu (SDK BLOCK_TIME).
export const LIFETIME_DAYS = {
  // An unconfirmed report fades out after a week unless someone else vouches for it.
  reportUnconfirmed: 7,
  // Each confirmation pushes the report's expiry out by this much (Lifetime Extension).
  confirmationExtension: 30,
  // A curator's attestor listing is a lease the curator renews; if it lapses, the badge goes.
  attestor: 90,
} as const

export const BLOCK_SECONDS = 2
export const BLOCKS_PER_DAY = (24 * 60 * 60) / BLOCK_SECONDS

// Attribute names. Kept short and stable: they are the public data contract.
export const A = {
  app: "app",
  type: "type",
  v: "v",
  kind: "kind",
  target: "target",
  category: "category",
  severity: "severity",
  reportedAt: "reported_at",
  report: "report",
  confirmedAt: "confirmed_at",
  attestor: "attestor",
  label: "label",
} as const

export type ReportPayload = {
  title: string
  description: string
  evidence: string
  regulatorUrl?: string
  synthetic: boolean
}

export type ConfirmationPayload = {
  note: string
  synthetic: boolean
}

export type AttestorPayload = {
  about: string
  synthetic: boolean
}
