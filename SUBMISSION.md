# Devfolio submission draft

Answers for the Arkiv: Global Tour Stop project form, in the order of docs/submission-checklist.md in the rules repo.

## Standard fields

Project name: ScamWatch India

Tagline: Check an investment app, site or Telegram group before you pay. A scam registry nobody can take down.

Project links: https://github.com/code4161/scamwatch-india and the demo video link.

Tracks: Best Indian Use Case, Censorship Resistance, Security.

The problem it solves:

Indian retail investors lose money every day to fake trading apps, "guaranteed IPO allotment" Telegram groups, advisory sites that display a SEBI registration they do not hold, and clones of real brokers' login pages. Press reports of I4C data put stock trading scam losses at Rs 4,636 crore from 2,28,094 complaints in January to September 2024. Before paying, people ask a relative or search the name, and the blocklists that exist sit on servers that the people they name can pressure off the internet. ScamWatch India is a public registry on Arkiv. Paste a link into one box and see whether it has been reported, how severe, who confirmed it and whether a trusted reviewer stands behind it. The page is static and reads straight from the chain, so there is no server of ours to take down, and every report is signed by the wallet that filed it.

Challenges I ran into:

The faucet needs a browser wallet sign-in and a CAPTCHA, and our build key never leaves a secret manager, so funding the wallet needed a separate step. AGENTS.md suggests range-filtering on $createdAt, which SDK 0.8.1 refuses because the field is not indexed; we store reportedAt as a u64 instead. A confirmation has to keep a report alive without being able to edit it, which led to read-only reports with permissionless extension and a batch that creates the confirmation and extends the report in one transaction. Lifetime Extension sets an expiry rather than adding to it, so a naive 30-day extension of a report with more time left would revert the whole batch; we extend to an absolute block 30 days past the later of the current expiry and the head. Keeping personal data off the chain meant writing a normaliser that refuses phone numbers, UPI IDs, emails and wa.me links before anything is signed.

## Arkiv questions

1. Live app URL: https://code4161.github.io/scamwatch-india/

2. Does any team member hold Indian nationality? Yes.

3. Why Arkiv?

A scam blocklist is only useful if the people on it cannot remove it. On Postgres or our own API they can: a legal notice to the host, a registrar complaint, pressure on the operator, or a quiet edit. IPFS gives immutable files but no query for "is this domain reported?" without an index someone runs, and no expiry. A subgraph is an index someone hosts. On Arkiv the page is static files and every read goes from the visitor's browser to the public RPC, so nothing of ours stands between a reader and the data; anyone can rerun the queries in the README without our site. Trust comes from $creator, which the chain sets, so the Attested badge cannot be faked by writing a field. Reports are created read-only, so nobody, us included, can soften one after filing. Permissionless extension means the community, not an operator, decides how long a report lives: each confirmation from another wallet extends it, and an unconfirmed report expires by itself after 7 days. What stays off Arkiv on purpose: phone numbers, UPI IDs, bank accounts, names and emails, in plaintext or hashed; the app refuses them before signing.

4. How do you use Arkiv?

Attributes vs payload: kind, target and category are str attributes for exact matches; severity and reportedAt are u64 for ranges; description and evidence sit in the JSON payload because nothing filters on them. https://github.com/code4161/scamwatch-india/blob/main/src/lib/writer.ts

Compound queries with OR: the check box matches kind plus the host and every parent domain in one query, so pay.x.example finds a report on x.example. https://github.com/code4161/scamwatch-india/blob/main/src/lib/registry.ts

Numeric ranges and cursor pagination: the Browse page filters severity from/to and "filed in the last N days", sorts newest first in the client and loads the next page from the SDK cursor. Same file, browse and browseQuery.

createdBy and $creator: the curator address is fixed in src/lib/config.ts; attestor entities count only when createdBy the curator, and the Attested page lists reports filed or confirmed by those wallets. Every report page shows $creator and $owner linked to the explorer.

Entity Expiration per type: unconfirmed report 7 days; confirmation expires at the block it extended the report to; attestor listing 90 days. Every card shows a countdown. https://github.com/code4161/scamwatch-india/blob/main/src/lib/schema.ts

Lifetime Extension as a lease: each confirmation extends its report by 30 days; the curator renews attestor listings with extendEntity, and a listing it stops renewing lapses with its badge.

Creation flags: reports are readonly and permissionlessExtension, so evidence cannot be edited and any wallet can keep a report alive.

Batch writes: executeBatch creates the confirmation and extends the report in one transaction, so the count and the countdown never disagree; the seed files each reporter's reports in one batch.

watchEntityEvents over WebSocket: the live feed subscribes with a webSocket() transport and no fromBlock; new reports and confirmations appear without a reload and ExpiryExtended moves a countdown in place. https://github.com/code4161/scamwatch-india/blob/main/src/web/main.ts

5. Friction report: https://github.com/code4161/scamwatch-india/blob/main/arkiv/friction.md

6. Wallet addresses that create your Arkiv entities:

    0xBc223395380a7d53BE453E1Dacde40A20A370D06  curator: root of trust, lists attestors, files and confirms checked reports
    0x6280DC60F7C2c64f542F2434417E162fA55674eB  partner attestor listed by the curator
    0xE420E6a6A2D62d40Ed655B0eC1DD986A3E4B479e  community reporter 1
    0xF87d07F38b87CcF9b46dd4Db1bE6A5b7C61a42c9  community reporter 2
    0x4A11db0B190E87eFc4C57A7a09e9b008CA919658  community reporter 3
    0xdaF2De1e4D2bb0c4cba3621754D0C3651E07a538  community confirmer 1
    0x5268fE727771a577C875212Cf6f2FE273a3a2EaB  community confirmer 2

7. Schema: https://github.com/code4161/scamwatch-india/blob/main/arkiv/schema.md

8. How can judges reproduce your Arkiv usage?

Open the live app and paste pay.secure-login-tradebrokr.example into the check box; open "Exact query sent to Arkiv" to see the string, then open the report to see $creator, $owner, creation flags, the expiry countdown and each confirmation's signer. Without our site: clone the repo, run npm ci, then npx tsx cli/scamwatch.ts verify, which lists every live report with its confirmations and lifetime and the attestors found by createdBy. The README's Reproduce section has the exact query strings.

9. Pre-existing work you reused: None.

10. Arkiv surfaces you used: TypeScript SDK, WebSocket events, Docs, Faucet, Block Explorer.

11. Other surface: not applicable.

13. Which LLMs did you use? Claude (Anthropic), as a coding assistant.

14. What is the one thing Arkiv should improve first? A server-side filter on watchEntityEvents. Today every app's live feed receives every entity created on the network and has to read each one back to see whether it is its own.

15. Open to a 20-minute feedback call with the Arkiv team? The owner's choice.

16. This is our team's work, built between 9 and 18 October, with pre-existing and third-party work disclosed: Yes.

17. Our repo is public under the MIT licence, and every link is accessible to judges: Yes.

18. I plan to attend Devcon 8 in Mumbai: the owner's choice.
