// Synthetic demo data. Every domain uses the reserved .example TLD (RFC 2606), every app id sits
// under com.example, and every channel handle starts with "swdemo". None of it names a real company
// or person. The patterns are modelled on the investment-scam types Indian regulators warn about;
// the regulator links point at SEBI's public registers, where anyone can check a claimed
// registration, and do not say anything about the synthetic names.

import type { Role } from "./wallets"
import type { ReportInput } from "../src/lib/writer"

export const SEBI_IA = "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=13"
export const SEBI_RA = "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14"
export const SEBI_BROKERS = "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=30"

const DAY = 86400

export type SeedReport = {
  id: string
  by: Role
  daysAgo: number
  input: Omit<ReportInput, "reportedAt">
  confirmedBy: Role[]
}

const syn = { synthetic: true as const }

export const SEED: SeedReport[] = [
  {
    id: "r1",
    by: "reporter1",
    daysAgo: 4,
    confirmedBy: ["confirmer1", "partner"],
    input: {
      kind: "app",
      target: "com.example.niftyprotrader",
      category: "fake_trading_app",
      severity: 5,
      payload: {
        title: "Nifty Pro Trader app shows fake profits, blocks withdrawal",
        description:
          "Installed from a link in a WhatsApp group, not from the Play Store. The app showed a 340% 'profit' on a deposit, then asked for a 20% 'tax' before any withdrawal. Nothing was paid out.",
        evidence: "Deposit requested to a personal account, not a broker. App not listed by any SEBI-registered broker.",
        regulatorUrl: SEBI_BROKERS,
        ...syn,
      },
    },
  },
  {
    id: "r2",
    by: "reporter2",
    daysAgo: 3,
    confirmedBy: ["curator", "confirmer2"],
    input: {
      kind: "telegram",
      target: "https://t.me/swdemo_ipo_allotment_vip",
      category: "tips_group",
      severity: 4,
      payload: {
        title: "'Guaranteed IPO allotment' Telegram channel",
        description:
          "Promises guaranteed allotment in oversubscribed IPOs for an upfront 'processing fee'. IPO allotment is by lottery through the registrar; no one can guarantee it.",
        evidence: "Fee asked for over chat; no broker or registrar named.",
        regulatorUrl: SEBI_RA,
        ...syn,
      },
    },
  },
  {
    id: "r3",
    by: "reporter1",
    daysAgo: 6,
    confirmedBy: ["partner"],
    input: {
      kind: "site",
      target: "https://www.sebi-certified-advisory.example/plans",
      category: "fake_sebi_claim",
      severity: 4,
      payload: {
        title: "Advisory site shows a registration number that is not on SEBI's register",
        description:
          "Sells 'sure-shot' F&O calls and displays an IA registration number in the footer. The number does not match any entry on SEBI's Investment Adviser register.",
        evidence: "Search the claimed number on SEBI's Investment Adviser register (link).",
        regulatorUrl: SEBI_IA,
        ...syn,
      },
    },
  },
  {
    id: "r4",
    by: "reporter3",
    daysAgo: 2,
    confirmedBy: ["confirmer1"],
    input: {
      kind: "site",
      target: "secure-login-tradebrokr.example",
      category: "broker_clone",
      severity: 5,
      payload: {
        title: "Look-alike login page for a well-known broker",
        description:
          "Copy of a broker's login screen on a misspelt domain, sent by SMS as a 'KYC update'. Captures client ID, password and OTP.",
        evidence: "Domain differs from the broker's official domain by one letter. Always type the broker's address yourself.",
        regulatorUrl: SEBI_BROKERS,
        ...syn,
      },
    },
  },
  {
    id: "r5",
    by: "reporter2",
    daysAgo: 1,
    confirmedBy: [],
    input: {
      kind: "whatsapp_channel",
      target: "https://whatsapp.com/channel/0029SWDEMOstockgurucalls",
      category: "tips_group",
      severity: 3,
      payload: {
        title: "WhatsApp channel pushing a 'stock of the day' pump",
        description:
          "Daily buy calls on a thinly traded small-cap with claims of 'operator news'. Members are pushed to a paid VIP group.",
        evidence: "Not a registered research analyst. Calls posted before price spikes, then silence.",
        regulatorUrl: SEBI_RA,
        ...syn,
      },
    },
  },
  {
    id: "r6",
    by: "reporter3",
    daysAgo: 5,
    confirmedBy: ["confirmer1", "confirmer2", "curator"],
    input: {
      kind: "site",
      target: "doubleyourmoney-in30days.example",
      category: "ponzi_other",
      severity: 5,
      payload: {
        title: "'Double your money in 30 days' crypto-and-stocks scheme",
        description:
          "Fixed daily returns paid from new deposits, with referral levels. Early members get paid; later ones cannot withdraw.",
        evidence: "Promised fixed returns of several percent a day; no regulated entity named.",
        ...syn,
      },
    },
  },
  {
    id: "r7",
    by: "reporter1",
    daysAgo: 1,
    confirmedBy: [],
    input: {
      kind: "app",
      target: "https://play.google.com/store/apps/details?id=com.example.institutional.ipo",
      category: "fake_trading_app",
      severity: 4,
      payload: {
        title: "'Institutional account' app offering block deals at a discount",
        description:
          "After joining a 'stock market learning' group, members are told to install an app for 'institutional' or 'QIB' accounts with IPO and block-deal discounts. Balances shown are not held at any depository.",
        evidence: "Holdings never appear in the CDSL or NSDL statement.",
        regulatorUrl: SEBI_BROKERS,
        ...syn,
      },
    },
  },
  {
    id: "r8",
    by: "reporter2",
    daysAgo: 6,
    confirmedBy: ["confirmer2"],
    input: {
      kind: "telegram",
      target: "@swdemo_banknifty_jackpot",
      category: "tips_group",
      severity: 3,
      payload: {
        title: "BankNifty 'jackpot' option calls for a monthly fee",
        description: "Charges a subscription for intraday option calls and shows only winning screenshots.",
        evidence: "No research analyst registration shown.",
        regulatorUrl: SEBI_RA,
        ...syn,
      },
    },
  },
  {
    id: "r9",
    by: "reporter3",
    daysAgo: 0,
    confirmedBy: [],
    input: {
      kind: "site",
      target: "pro.tradebrokr-premium.example",
      category: "broker_clone",
      severity: 4,
      payload: {
        title: "Fake 'pro' trading portal using a real broker's name",
        description:
          "Portal claims to be a premium version of a known broker's platform and asks for deposits by bank transfer to an individual.",
        evidence: "Registered brokers never take client money into a personal account.",
        regulatorUrl: SEBI_BROKERS,
        ...syn,
      },
    },
  },
  {
    id: "r10",
    by: "reporter1",
    daysAgo: 3,
    confirmedBy: ["confirmer2"],
    input: {
      kind: "site",
      target: "rbi-sebi-approved-fd-plus.example",
      category: "fake_sebi_claim",
      severity: 2,
      payload: {
        title: "Deposit scheme that calls itself 'RBI and SEBI approved'",
        description: "Advertises a 'guaranteed 24% FD-plus' and uses regulator logos without any registration detail.",
        evidence: "Neither regulator approves individual return products like this.",
        regulatorUrl: SEBI_IA,
        ...syn,
      },
    },
  },
  {
    id: "r11",
    by: "reporter2",
    daysAgo: 2,
    confirmedBy: [],
    input: {
      kind: "app",
      target: "com.example.mutualfund.sip.bonus",
      category: "ponzi_other",
      severity: 1,
      payload: {
        title: "'SIP bonus' app promising a fixed monthly payout",
        description: "Claims to be a mutual fund app but pays a fixed 'bonus' for referrals. Not on any AMC's list of apps.",
        evidence: "Mutual funds cannot promise fixed returns.",
        ...syn,
      },
    },
  },
  {
    id: "r12",
    by: "reporter3",
    daysAgo: 4,
    confirmedBy: ["partner", "confirmer1"],
    input: {
      kind: "telegram",
      target: "t.me/swdemo_premarket_insider",
      category: "tips_group",
      severity: 5,
      payload: {
        title: "'Insider' pre-market calls channel that moves people to a fake app",
        description:
          "Starts with free pre-market calls, then moves members to a 'private trading app' where deposits cannot be withdrawn.",
        evidence: "Same pattern as the fake trading app reports in this registry.",
        regulatorUrl: SEBI_RA,
        ...syn,
      },
    },
  },
]

export const PARTNER_ATTESTOR = {
  label: "Demo investor-awareness volunteers",
  about:
    "Synthetic stand-in for a volunteer group that checks reports against SEBI's public registers before confirming them.",
}

export function seedReportedAt(daysAgo: number): number {
  return Math.floor(Date.now() / 1000) - daysAgo * DAY - Math.floor(Math.random() * 3600)
}
