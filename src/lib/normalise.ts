// Turns whatever a person pastes (a full URL, a Play Store link, a t.me link, "@handle") into the
// one canonical target string stored in the report's "target" attribute, so an exact-match query
// finds it. It also refuses anything that identifies a person: phone numbers, UPI IDs, emails.
// Those must never reach Arkiv, in plaintext or hashed.

import type { Kind } from "./schema"

export class RejectedTarget extends Error {}

const PHONE_RE = /^\+?[\d\s()-]{8,}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// UPI virtual payment addresses look like name@bank (no dot after the @).
const UPI_RE = /^[a-z0-9._-]{2,}@[a-z]{2,}$/i

function refusePersonalData(raw: string): void {
  const s = raw.trim()
  if (PHONE_RE.test(s)) {
    throw new RejectedTarget(
      "That looks like a phone number. ScamWatch never stores phone numbers. Report the website, app or channel instead.",
    )
  }
  if (UPI_RE.test(s)) {
    throw new RejectedTarget(
      "That looks like a UPI ID. ScamWatch never stores UPI IDs. Report it to your bank and to 1930.",
    )
  }
  if (EMAIL_RE.test(s) && !/^https?:/i.test(s)) {
    throw new RejectedTarget("That looks like an email address. ScamWatch never stores email addresses.")
  }
}

function hostOf(raw: string): string {
  const withScheme = raw.includes("://") ? raw : "http:" + "//" + raw
  let host: string
  try {
    host = new URL(withScheme).hostname
  } catch {
    throw new RejectedTarget(`"${raw}" is not a website address.`)
  }
  host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "")
  if (!host.includes(".")) throw new RejectedTarget(`"${raw}" is not a website address.`)
  return host
}

/** Every domain a site report could be filed under: the host and each parent above the TLD. */
export function domainCandidates(host: string): string[] {
  const parts = host.split(".")
  const out: string[] = []
  for (let i = 0; i <= parts.length - 2; i++) out.push(parts.slice(i).join("."))
  return out
}

export function normaliseTarget(kind: Kind, raw: string): string {
  const input = raw.trim()
  if (!input) throw new RejectedTarget("Paste a link, app id or channel handle.")
  refusePersonalData(input)
  let out: string
  switch (kind) {
    case "site":
      out = hostOf(input)
      break
    case "app": {
      // Accept a Play Store link or a bare package id.
      const m = input.match(/[?&]id=([A-Za-z0-9_.]+)/)
      out = (m?.[1] ?? input).toLowerCase()
      if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(out)) {
        throw new RejectedTarget(`"${input}" is not an Android package id like com.example.app.`)
      }
      break
    }
    case "telegram": {
      const m = input.match(/(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_+]+)/i)
      out = (m?.[1] ?? input.replace(/^@/, "")).toLowerCase()
      if (!/^(\+[a-z0-9_-]{6,}|[a-z][a-z0-9_]{4,31})$/i.test(out)) {
        throw new RejectedTarget(`"${input}" is not a Telegram channel link or handle.`)
      }
      break
    }
    case "whatsapp_channel": {
      if (/wa\.me\/\+?\d/i.test(input)) {
        throw new RejectedTarget(
          "wa.me links point at a phone number. Only WhatsApp channel links (whatsapp.com/channel/...) can be reported.",
        )
      }
      const m = input.match(/whatsapp\.com\/channel\/([A-Za-z0-9]+)/i)
      out = m?.[1] ?? input
      if (!/^[A-Za-z0-9]{10,40}$/.test(out)) {
        throw new RejectedTarget(`"${input}" is not a WhatsApp channel link.`)
      }
      break
    }
  }
  if (new TextEncoder().encode(out).length > 128) throw new RejectedTarget("That target is too long.")
  return out
}

/** Best guess at what kind of thing was pasted, for the check box. */
export function guessKind(raw: string): Kind {
  const s = raw.trim().toLowerCase()
  if (/(^|\/\/|\.)(t\.me|telegram\.me)\//.test(s) || s.startsWith("@")) return "telegram"
  if (s.includes("whatsapp.com/channel/") || s.includes("wa.me/")) return "whatsapp_channel"
  if (s.includes("play.google.com/") || /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/.test(s) && !s.includes("/") && /^(com|in|org|net|io|app)\./.test(s)) return "app"
  return "site"
}
