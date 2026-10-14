# Demo video script

Length: under 3 minutes. Record the screen at a phone-like width for the first shot and a laptop width for the rest. Keep a terminal open in the repo with ARKIV_PRIVATE_KEY loaded for shot 6, and use report 0x9e49d1b0fcf65c3d519c06320fe31c5ab714515e4f97d309c894b3bdde8f63a1 (com.example.niftyprotrader) for shot 6, which confirmer2 has not confirmed yet.

| # | time | on screen | say |
|---|---|---|---|
| 1 | 0:00 to 0:20 | the live app on a phone-width window, home page | "A stranger adds your father to a stock-tips WhatsApp group, and the group sends him a trading app. Before he pays, he pastes the link here. ScamWatch India is a public registry of investment scams that target people in India." |
| 2 | 0:20 to 0:45 | paste pay.secure-login-tradebrokr.example, press Check, open "Exact query sent to Arkiv" | "It finds a report filed against the parent domain. This page has no backend: the query you see goes from the browser straight to Arkiv's public RPC. If our site vanished, the data and the query still work." |
| 3 | 0:45 to 1:05 | paste safe-and-unknown.example | "No report does not mean safe. The app sends people to SEBI's registers, the 1930 helpline and cybercrime.gov.in." |
| 4 | 1:05 to 1:40 | open the attested report; point at Signed by, Owner, flags, countdown, confirmations | "Every report is signed. The chain records who created it, and that is what the Attested badge trusts, never a field someone can type. Reports are read-only once filed, and anyone may extend them. An unconfirmed report expires in 7 days; each confirmation from another wallet adds 30." |
| 5 | 1:40 to 2:00 | Browse: category Stock tips, severity 3 to 5, last 7 days, Load more | "Typed attributes make this a real query: severity and time are numeric ranges, results page with a cursor." |
| 6 | 2:00 to 2:35 | split screen: terminal runs npx tsx cli/scamwatch.ts confirm --report 0x9e49d1b0fcf65c3d519c06320fe31c5ab714515e4f97d309c894b3bdde8f63a1 --as confirmer2; home page live feed | "A second wallet confirms a report. One batch creates the confirmation and extends the report. The feed is subscribed over a WebSocket, so it appears here and the countdown moves out with no reload." |
| 7 | 2:35 to 2:55 | the Attested page, then the explorer page for the curator address | "Trusted reviewers are listed by the curator on chain, as 90-day leases it renews. Phone numbers, UPI IDs and names never go on chain. It is all open source, MIT, on GitHub." |
