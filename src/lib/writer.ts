// Every write the registry makes. Used by the CLI (key from an env var) and by the browser's
// "confirm with your wallet" button (an injected wallet). Nothing here holds a key.

import type { Hex } from "viem"
import { addr, key, str, u64 } from "@arkiv-network/sdk/attr"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import type { WalletArkivClient } from "@arkiv-network/sdk"
import {
  A,
  APP,
  type AttestorPayload,
  BLOCKS_PER_DAY,
  type Category,
  type ConfirmationPayload,
  type Kind,
  LIFETIME_DAYS,
  type ReportPayload,
  SCHEMA_VERSION,
} from "./schema"
import { normaliseTarget } from "./normalise"
import { confirmationsFor, getReport, type Reader } from "./registry"

// biome-ignore lint/suspicious/noExplicitAny: transport, chain and account generics do not matter here.
export type Writer = WalletArkivClient<any, any, any, any>

export type ReportInput = {
  kind: Kind
  target: string
  category: Category
  severity: number
  payload: ReportPayload
  reportedAt?: number
}

const nowUnix = () => Math.floor(Date.now() / 1000)

/** Builds the create operation for a report, so a seed can batch several into one transaction. */
export function reportCreate(input: ReportInput) {
  if (!Number.isInteger(input.severity) || input.severity < 1 || input.severity > 5) {
    throw new Error("severity must be a whole number from 1 to 5")
  }
  return {
    attributes: {
      [A.app]: str(APP),
      [A.type]: str("report"),
      [A.v]: u64(SCHEMA_VERSION),
      [A.kind]: str(input.kind),
      [A.target]: str(normaliseTarget(input.kind, input.target)),
      [A.category]: str(input.category),
      [A.severity]: u64(input.severity),
      [A.reportedAt]: u64(input.reportedAt ?? nowUnix()),
    },
    payload: jsonToPayload(input.payload),
    contentType: "application/json",
    // Unconfirmed reports fade after a week. Confirmations extend them.
    expires: ExpirationTime.fromDays(LIFETIME_DAYS.reportUnconfirmed),
    // readonly: nobody, not even the reporter, can rewrite a report once filed.
    // permissionlessExtension: any wallet can extend it, which is how a confirmation keeps it alive.
    flags: { readonly: true, permissionlessExtension: true },
  }
}

export async function fileReport(w: Writer, input: ReportInput) {
  return w.createEntity(reportCreate(input))
}

export async function fileReports(w: Writer, inputs: ReportInput[]) {
  return w.executeBatch({ creates: inputs.map(reportCreate) })
}

/** The block a confirmation pushes a report's expiry to: 30 days past its current expiry or now. */
export function extendedExpiry(currentExpiry: bigint, head: bigint): bigint {
  const base = currentExpiry > head ? currentExpiry : head
  return base + BigInt(LIFETIME_DAYS.confirmationExtension * BLOCKS_PER_DAY)
}

/**
 * Confirms a report from a wallet other than the reporter's. One atomic batch: create the
 * confirmation and extend the report's lifetime to the same block. Either both land or neither
 * does, so a confirmation can never exist without the extension it paid for, or the reverse.
 */
export async function confirmReport(
  w: Writer,
  reader: Reader,
  reportKey: Hex,
  note: string,
  confirmedAt = nowUnix(),
) {
  const me = w.account!.address.toLowerCase()
  const report = await getReport(reader, reportKey)
  if (!report) throw new Error(`No live report ${reportKey}. It may have expired.`)
  if (report.creator.toLowerCase() === me) {
    throw new Error("A reporter cannot confirm their own report. Ask another wallet to confirm it.")
  }
  if (!report.permissionlessExtension) {
    throw new Error("This report was not created with permissionless extension, so only its owner can extend it.")
  }
  const existing = await confirmationsFor(reader, reportKey)
  if (existing.some((c) => c.creator.toLowerCase() === me)) {
    throw new Error("This wallet has already confirmed this report.")
  }
  const head = await reader.getBlockNumber()
  const target = extendedExpiry(report.expiresAt, head)
  const payload: ConfirmationPayload = { note, synthetic: true }
  return w.executeBatch({
    creates: [
      {
        attributes: {
          [A.app]: str(APP),
          [A.type]: str("confirmation"),
          [A.v]: u64(SCHEMA_VERSION),
          [A.report]: key(reportKey),
          [A.kind]: str(report.kind),
          [A.target]: str(report.target),
          [A.confirmedAt]: u64(confirmedAt),
        },
        payload: jsonToPayload(payload),
        contentType: "application/json",
        // A confirmation lives exactly as long as the extension it bought.
        expires: ExpirationTime.atBlock(target),
        flags: { readonly: true },
      },
    ],
    extensions: [{ entityKey: reportKey, expires: ExpirationTime.atBlock(target) }],
  })
}

/** The curator lists a wallet as a trusted attestor. A 90-day lease the curator renews. */
export async function addAttestor(w: Writer, attestor: Hex, label: string, about: string) {
  const payload: AttestorPayload = { about, synthetic: true }
  return w.createEntity({
    attributes: {
      [A.app]: str(APP),
      [A.type]: str("attestor"),
      [A.v]: u64(SCHEMA_VERSION),
      [A.attestor]: addr(attestor),
      [A.label]: str(label),
    },
    payload: jsonToPayload(payload),
    contentType: "application/json",
    expires: ExpirationTime.fromDays(LIFETIME_DAYS.attestor),
  })
}

export async function renewAttestor(w: Writer, entityKey: Hex) {
  return w.extendEntity({ entityKey, expires: ExpirationTime.fromDays(LIFETIME_DAYS.attestor) })
}
