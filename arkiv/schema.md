# ScamWatch India: Arkiv schema

Three entity types. All of them carry app = scamwatch-in and a type attribute, so every query starts from the registry's own entities. Anything the app filters on is a typed attribute; text a person reads is in the JSON payload, which Arkiv does not index.

SDK: @arkiv-network/sdk 0.8.1, network Tiramisu (chain 7738577). The code that writes these is src/lib/writer.ts and the code that reads them is src/lib/registry.ts.

## report

One scam website, Android app, Telegram channel or WhatsApp channel, filed by any wallet.

| attribute | type | meaning |
|---|---|---|
| app | str | always scamwatch-in |
| type | str | always report |
| v | u64 | schema version, 1 |
| kind | str | site, app, telegram or whatsapp_channel |
| target | str | the normalised target: a lower-case host without www for a site, an Android package id for an app, a lower-case handle for Telegram, a channel id for WhatsApp |
| category | str | fake_trading_app, tips_group, fake_sebi_claim, broker_clone or ponzi_other |
| severity | u64 | 1 to 5, numeric so it takes a range |
| reportedAt | u64 | Unix seconds when filed, numeric so it takes a range |

Payload (application/json): title, description, evidence, an optional regulatorUrl (a public register where the reader can check a claim, such as SEBI's Investment Adviser register), and synthetic (true for demo data).

Creation flags: **readonly** and **permissionlessExtension**. Nobody, the reporter included, can change a report after filing it. Any wallet can extend its lifetime, which is what a confirmation does.

Entity Expiration: **7 days** from filing. A report nobody else vouches for disappears from every query on its own.

There is no confirmations counter on the report. Only the owner can patch an entity, and the report is read-only, so the count is derived: the number of distinct confirmation creators, not counting the reporter.

## confirmation

Another wallet vouching for a report.

| attribute | type | meaning |
|---|---|---|
| app | str | scamwatch-in |
| type | str | confirmation |
| v | u64 | 1 |
| report | key | the report's entity key |
| kind | str | copied from the report |
| target | str | copied from the report, so a target's whole history is one query |
| confirmedAt | u64 | Unix seconds |

Payload: note, synthetic.

Creation flags: readonly.

Entity Expiration: the same block the confirmation extends the report to. A confirmation lives exactly as long as the extension it bought.

Write path: one atomic batch (executeBatch) from the confirmer's wallet holding two operations, the create of the confirmation and a Lifetime Extension of the report. The report's new expiry is **30 days** past the later of its current expiry and the current block, so the extension always moves the expiry later and never reverts for being shorter. The CLI and the browser refuse a confirmation from the report's own creator and a second confirmation from the same wallet.

## attestor

The curator listing a wallet whose reports and confirmations carry the Attested badge.

| attribute | type | meaning |
|---|---|---|
| app | str | scamwatch-in |
| type | str | attestor |
| v | u64 | 1 |
| attestor | addr | the listed wallet |
| label | str | a display name |

Payload: about, synthetic.

Creation flags: none. Only the curator can extend or delete it.

Entity Expiration: **90 days**, renewed by the curator with extendEntity. A listing the curator stops renewing lapses, and the badge goes with it.

Trust: an attestor entity counts only when its $creator is the curator address fixed in src/lib/config.ts (0xBc223395380a7d53BE453E1Dacde40A20A370D06). Anyone can write an entity with the same attributes; the app ignores it because the signer is wrong.

## Queries the app runs

Each is the exact string the SDK sends, printed by builder.toString().

Is this link reported? Exact target, compound with kind. For a website the host and every parent domain go in one OR, so pay.example-broker.example also finds a report against example-broker.example.

    app = str('scamwatch-in') AND type = str('report') AND kind = str('site') AND (target = str('pay.secure-login-tradebrokr.example') OR target = str('secure-login-tradebrokr.example'))

Recent reports by category and severity range, optionally filed since a time. Cursor pagination, 10 per page in the browser, 200 per page in the CLI; sorted newest first in the client because Arkiv has no server-side ordering.

    app = str('scamwatch-in') AND type = str('report') AND severity >= u64(3) AND severity <= u64(5) AND category = str('tips_group') AND reportedAt >= u64(1760000000)

Trusted attestors (createdBy the curator):

    app = str('scamwatch-in') AND type = str('attestor') AND $creator = addr(0xBc223395380a7d53BE453E1Dacde40A20A370D06)

Reports confirmed by a trusted attestor (createdBy each attestor), then each report by key:

    app = str('scamwatch-in') AND type = str('confirmation') AND $creator = addr(<attestor>)
    $key = key(<report key>) AND app = str('scamwatch-in') AND type = str('report')

Confirmations of one report, and of a page of reports in one OR (20 keys per query):

    app = str('scamwatch-in') AND type = str('confirmation') AND report = key(<report key>)

Live feed: watchEntityEvents on a WebSocket transport with no fromBlock. EntityCreated events are read back by key and kept when app is scamwatch-in; ExpiryExtended events move a card's countdown in place.
