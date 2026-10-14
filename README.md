# ScamWatch India

A public registry of investment-scam websites, Android apps, Telegram channels and WhatsApp channels that target people in India. Anyone can check a link before paying, file a report or confirm one. The registry lives on Arkiv, the Web3 database, and the web app reads it straight from the chain in the browser.

Live app: **https://code4161.github.io/scamwatch-india/**

Tracks: Best Indian Use Case, Censorship Resistance, Security.

## Who uses it

Indian retail investors and the family members they ask before they pay. The pattern is familiar to anyone in a family WhatsApp group: a stranger adds you to a "stock market learning" group, the group pushes a trading app that is not on the Play Store, the app shows large profits, and withdrawal needs one more fee. Other variants promise guaranteed IPO allotment, sell "sure-shot" F&O calls from a site displaying a SEBI registration number it does not hold, or clone a real broker's login page.

Press reports of Indian Cyber Crime Coordination Centre (I4C) data put losses to stock trading scams at **Rs 4,636 crore from 2,28,094 complaints** and to investment scams at **Rs 3,216 crore from 1,00,360 complaints**, both for January to September 2024 ([The Wire](https://thewire.in/tech/india-lost-rs-11333-crore-to-cyber-fraud-in-2024), [Entrepreneur India](https://india.entrepreneur.com/news-and-trends/digital-fear-how-stock-trading-scams-investment-frauds/483665)).

What changes for them: paste the link into one box and see whether others have reported it, how severe, who confirmed it and whether a trusted reviewer stands behind it. When nothing is found the app says that this does not make it safe, and links SEBI's Investment Adviser, Research Analyst and stock broker registers, the 1930 helpline and cybercrime.gov.in.

## Why Arkiv

A blocklist is only useful if the people on it cannot remove it. On a normal server they can: a legal notice to the host, a complaint to the domain registrar, pressure on whoever runs the database, or a quiet edit by an operator. Scam operators use exactly these routes against the hosted lists that name them.

On Arkiv:

- **No backend of ours to take down.** The web app is static files on GitHub Pages. Every read goes from the visitor's browser to the public Arkiv RPC. If our site disappeared, anyone could run the same queries from the README with the SDK, or rebuild the page from this repo.
- **Trust comes from the signer.** Every report and confirmation carries its $creator, set by the chain and impossible to forge. The Attested badge depends on that, not on any field a writer controls.
- **Reports cannot be edited after filing.** Reports are created read-only, so neither a compromised reporter account nor we can quietly soften one.
- **Lifetime follows the community, not an operator.** Reports are created with permissionless extension, so any wallet that confirms a report keeps it alive. An unconfirmed report expires by itself after 7 days.

Postgres loses all four: the operator can delete or edit rows, and every reader depends on the operator's server. IPFS gives immutable files but no queries ("is this domain reported?" needs an index someone runs) and no expiry. A subgraph is an index someone hosts. Our own API is the thing that gets the legal notice.

What stays off Arkiv on purpose: phone numbers, UPI IDs, bank account numbers, names and email addresses, in plaintext or hashed. The app and the CLI refuse them before anything is signed (src/lib/normalise.ts), including wa.me links, which point at a phone number. Victim accounts with personal detail belong with the police at 1930 and cybercrime.gov.in, not on a public ledger.

## How it uses Arkiv

Schema, expiry per type and every query string: [arkiv/schema.md](arkiv/schema.md). Feature by feature:

| feature | where in code | what the user sees | why |
|---|---|---|---|
| Typed attributes vs payload | src/lib/writer.ts, reportCreate | the check box and filters | kind, target, category are str for exact match; severity and reported_at are u64 for ranges; description and evidence sit in the payload because nobody filters on them |
| Compound predicates and OR | src/lib/registry.ts, checkTarget | checking pay.x.example finds a report against x.example | one query covers the host and each parent domain |
| Numeric ranges and cursor pagination | src/lib/registry.ts, browse | Browse page: severity from/to, "filed in the last 7 days", Load more | ranges need numbers; the next page uses the cursor the SDK returns |
| createdBy | src/lib/registry.ts, trustedAttestors and attestedReports | the Attested badge and the Attested page | trust is the signer, not a field |
| $creator and $owner | src/web/main.ts, viewReport | "Signed by" and "Owner" on every report, linked to the explorer | readers can see who stands behind a report |
| Entity Expiration per type | src/lib/schema.ts, LIFETIME_DAYS | countdown on every card | unconfirmed report 7 days; confirmation lives as long as its extension; attestor listing 90 days |
| Lifetime Extension | src/lib/writer.ts, confirmReport and renewAttestor | each confirmation adds 30 days to the countdown | a report survives only while people keep vouching for it; a reviewer listing survives only while the curator renews it |
| Creation flags | src/lib/writer.ts, reportCreate | "read-only, anyone may extend" on the report page | readonly protects evidence; permissionless extension lets the community keep a report alive |
| Batch writes | src/lib/writer.ts, confirmReport and fileReports | a confirmation and its extension land together | a confirmation without its extension, or the reverse, would make the count and the countdown disagree |
| watchEntityEvents over WebSocket | src/web/main.ts, startLive | the live feed and the green dot; new reports slide in, countdowns move on extension | no refresh loop; the transport is webSocket() with no fromBlock |

## Wallets that create the entities

All on Tiramisu. Explorer: https://tiramisu.explorer.arkiv.network/address/<address>.

| role | address |
|---|---|
| Curator: root of trust, fixed in src/lib/config.ts; lists attestors; files and confirms reports it has checked; funds the demo wallets | 0xBc223395380a7d53BE453E1Dacde40A20A370D06 |
| Partner attestor: listed by the curator, so its confirmations carry the Attested badge | 0x6280DC60F7C2c64f542F2434417E162fA55674eB |
| Community reporter 1 | 0xE420E6a6A2D62d40Ed655B0eC1DD986A3E4B479e |
| Community reporter 2 | 0xF87d07F38b87CcF9b46dd4Db1bE6A5b7C61a42c9 |
| Community reporter 3 | 0x4A11db0B190E87eFc4C57A7a09e9b008CA919658 |
| Community confirmer 1 | 0xdaF2De1e4D2bb0c4cba3621754D0C3651E07a538 |
| Community confirmer 2 | 0x5268fE727771a577C875212Cf6f2FE273a3a2EaB |

The six demo wallets are derived in memory from the curator key (cli/wallets.ts), so no second secret is stored anywhere.

All demo data is synthetic. Every domain uses the reserved .example TLD, every app id sits under com.example, and every channel handle starts with swdemo. None of it names a real company or person.

## Setup

Node 22 or newer.

    git clone https://github.com/code4161/scamwatch-india
    cd scamwatch-india
    npm ci
    npm run dev          # the web app on localhost
    npm run build        # static files in dist/

The CLI reads without a key:

    npx tsx cli/scamwatch.ts verify
    npx tsx cli/scamwatch.ts check --kind site --target https://pay.secure-login-tradebrokr.example/kyc

Writing needs a funded Tiramisu key in the environment, never in a file:

    export ARKIV_PRIVATE_KEY=0x...
    npx tsx cli/scamwatch.ts whoami
    npx tsx cli/scamwatch.ts report --kind telegram --target t.me/swdemo_example_channel --category tips_group --severity 3 --title "..." --description "..."
    npx tsx cli/scamwatch.ts confirm --report 0x<report key> --as confirmer1
    npx tsx cli/scamwatch.ts seed     # the synthetic dataset

## Reproduce

1. Open https://code4161.github.io/scamwatch-india/. The bar under the header shows the live Tiramisu block height, read from the public RPC.
2. Paste pay.secure-login-tradebrokr.example into the check box. The app finds the report filed against secure-login-tradebrokr.example. Open "Exact query sent to Arkiv" to see the string:

        app = str('scamwatch-in') AND type = str('report') AND kind = str('site') AND (target = str('pay.secure-login-tradebrokr.example') OR target = str('secure-login-tradebrokr.example'))

3. Open the report. It shows $creator, $owner, the creation flags, the expiry countdown and each confirmation with its signer. Follow the entity link to the explorer.
4. Run the same read without our site:

        npx tsx cli/scamwatch.ts check --kind site --target pay.secure-login-tradebrokr.example
        npx tsx cli/scamwatch.ts verify

   verify lists every live report with its confirmation count and remaining lifetime, the trusted attestors found by createdBy, and prints a browse query string.
5. Keep the home page open and run a confirm from the CLI. The confirmation appears in the live feed and the report's countdown moves out by 30 days without a reload.
