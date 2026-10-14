# Friction report

Kept while building ScamWatch India, 2026-10-14 onward. Versions: @arkiv-network/sdk 0.8.1 (latest on npm, published 2026-09-11), viem 2.57.6, Vite 6.4.4, Node 26.11.1 on macOS, Chrome headless for the browser checks. Network: Tiramisu, chain 7738577, public RPC and WebSocket endpoints from the challenge README.

Each entry: the surface, what we expected, what happened, how to reproduce, and what would fix it. Entries marked "worked" are tested paths that behaved as documented.

## 1. Faucet: wallet sign-in and CAPTCHA, and the claim went to the connected wallet, not the recipient

Surface: Faucet, hub.arkiv.network/faucet.

Expected: the Tiramisu docs page says to get test GLM from the faucet, so we expected a form that takes an address, or an endpoint a CLI can call. Once we saw the form, we expected the GLM to go to the address typed in its recipient field.

Actual: the page asks the visitor to connect a browser wallet ("Sign in with your wallet to claim testnet $GLM"), then shows an "I'm not a robot" CAPTCHA. The claim is a POST to /api/faucet with a recipient and a captchaToken; a GET to /api/faucet?recipient=<address> without a session returns {"error":"Unauthorized"}. The docs page does not mention the sign-in, the CAPTCHA, the amount per claim or the cooldown. Our build key lives in a secret manager and never goes into a browser wallet, so a person had to claim with their own wallet.

On 2026-10-14 the owner signed in with a Keplr EVM account (0xAa50DB2d7c5593429C212Ed73FDA26b9D13B76c1) and set the recipient field to our curator address 0xBc223395380a7d53BE453E1Dacde40A20A370D06. The faucet sent 10 GLM to the connected Keplr account and ignored the recipient field; the curator stayed at 0 until a manual transfer (transaction 0xba9fbb31bdc6efbe150a560080a96764961f9f8cdd6983613e25e8a8b0b93f04, block 574633). Keplr also did not show the balance on the custom Tiramisu chain, so the claim looked as if it had failed.

Reproduce:

    curl -s "https://hub.arkiv.network/api/faucet?recipient=0xBc223395380a7d53BE453E1Dacde40A20A370D06"

Then claim in the browser with one wallet connected and a different address in the recipient field, and read both balances with eth_getBalance.

Fix: send to the recipient field, or remove the field if the faucet only pays the signed-in wallet. On the Tiramisu docs page, state the sign-in, the CAPTCHA, the amount and the cooldown. A rate-limited claim path for an access-key holder would let a CLI fund itself.

## 2. AGENTS.md suggests range-filtering on $createdAt; SDK 0.8.1 refuses it

Surface: TypeScript SDK query builder, and the challenge's AGENTS.md.

Expected: AGENTS.md says "sort on the client, or range-filter on $createdAt", so we planned "reports from the last 7 days" as a $createdAt range.

Actual: the SDK throws before sending anything:

    InvalidPredicateError "$createdAt" is returned in query results but carries no index, so it cannot be filtered on. Select it and filter the results in JavaScript instead.

The SDK source (src/query/expression.ts) lists the queryable system attributes as $key, $owner, $creator and $expiresAt. $createdAt is also a block number, not a time.

Reproduce:

    import { gte } from "@arkiv-network/sdk/query"
    import { u64 } from "@arkiv-network/sdk/attr"
    gte("$createdAt", u64(1))

Fix: correct AGENTS.md to point at a numeric user attribute. We store reported_at as a u64 of Unix seconds and range on that. The SDK's error message was clear enough to fix it in a minute.

## 3. Public client type hides viem actions that exist at runtime

Surface: TypeScript SDK, createPublicClient.

Expected: the README says the SDK extends viem's clients, so we expected watchBlockNumber for the expiry countdowns.

Actual: PublicArkivActions is a Pick of ten viem actions (getBalance, getBlock, getBlockNumber, getChainId, getLogs, getTransaction, getTransactionCount, getTransactionReceipt, waitForTransactionReceipt, watchEvent). createPublicClient does extend all of viem's publicActions at runtime, so watchBlockNumber works, but tsc reports "Property 'watchBlockNumber' does not exist". We cast to any (src/web/main.ts, boot).

Reproduce: call client.watchBlockNumber on a client from createPublicClient and run tsc.

Fix: type the client with the full PublicActions, or document the narrowing and the reason.

## 4. Entity events carry no attributes, so a filtered live feed reads every new entity

Surface: watchEntityEvents over WebSocket.

Expected: a way to watch only entities matching a predicate (for us, app = scamwatch-in).

Actual: EntityCreated carries entityKey, owner, expiresAt and creationFlags, and fires for every entity on the network. The feed reads each new entity by key to learn whether it is ours (src/web/main.ts, startLive). On a busy network that is one query per entity anyone creates.

Reproduce: open the live feed and create any entity from another app; the page issues a $key query for it.

Fix: a server-side filter on watchEntityEvents (a query string), or attribute data in the event.

## 5. ExpiryExtended names the owner, not the extender

Surface: watchEntityEvents, ExpiryExtended event.

Expected: with permissionless extension, the event would say who extended.

Actual: as the SDK's own type comment says, the event carries the entity's owner, not the sender. Our confirmations are separate entities with their own $creator, so the UI never needs the extender; an app that relied on extension alone would have to read every transaction.

Fix: include the sender in the event.

## 6. Lifetime Extension sets, and a duration counts from now (worked, once read carefully)

Surface: extendEntity and executeBatch.

Expected, before reading the source: "extend by 30 days".

Actual, as documented in the SDK: an extension sets a new expiry, a duration counts from the current block, and the engine rejects an extension that does not move the expiry later. A naive ExpirationTime.fromDays(30) on a report with 35 days left would revert, and because confirmations are batched, it would revert the confirmation too. We compute the target block as the later of the report's expiry and the head, plus 30 days of blocks, and pass ExpirationTime.atBlock(target) (src/lib/writer.ts, extendedExpiry).

Fix: none needed in the SDK. A one-line note in the docs' extendEntity section about combining it with atBlock would save the next builder a source read.

## 7. Reads from a static page in the browser (worked)

Surface: TypeScript SDK in the browser through Vite, HTTP and WebSocket transports.

Expected: we were ready for Node polyfills (Buffer, zlib) or WASM loading trouble, since the package depends on brotli-wasm.

Actual: no polyfills and no config. vite build produced one 361 kB script (113 kB gzipped). The compression module that imports brotli-wasm is not imported by anything else in src, so it never reached the bundle. Headless Chrome against the GitHub Pages deployment read the block height over HTTP and opened the WebSocket subscription with no errors.

Reproduce:

    npm ci && npm run build
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --virtual-time-budget=15000 --dump-dom https://code4161.github.io/scamwatch-india/ | grep 'class="dot'

## 8. Query builder and attribute types (worked)

Surface: select().where().limit().fetch(), createdBy(), cursor pagination, tagged attribute values.

Expected: the rules in AGENTS.md.

Actual: as documented. toString() returns the exact query string, which we show in the UI and in the README so a judge can paste it. Range operators on a str attribute throw UnsupportedOperatorError before the network. "key" is a reserved attribute name. Cursor pagination returned 5 and 5 of our 12 reports for limit(5), with both pages read at the same block.

The SDK README warns that a bare number defaults to i32. Measured on our data on 2026-10-14: severity >= 3 written bare matched **0** reports, and severity >= u64(3) matched **10**. Nothing errors; the query is simply empty. We pass u64() on both sides everywhere.

Fix: a warning when a predicate's type differs from every stored type of that attribute would turn a silent zero into an answer.

## 9. Node rejects upper-case attribute names that the SDK accepts

Surface: TypeScript SDK attribute validation and the Tiramisu node, createEntity and executeBatch.

Expected: the SDK's validateAttributeName accepts reportedAt (its grammar is a letter, then letters, digits, ".", "-" or "_"), so we expected the node to accept it.

Actual: the transaction was rejected before it landed:

    Transaction failed: an attribute name holds "U" (0x55) at byte 7, which is outside the name charset ("A"-"Z", "a"-"z", "0"-"9", ".", "-" and "_", with a letter first)

The message lists "A"-"Z" as allowed while rejecting "U". A lower-case name in the same script landed (transaction 0x96769addac21a58f6f60415541217a0359cfe52f8da87165000708e20731c6f0). Our first seed of 12 reports failed this way; we renamed reportedAt and confirmedAt to reported_at and confirmed_at.

Reproduce:

    import { validateAttributeName } from "@arkiv-network/sdk/attr"
    validateAttributeName("swprobeUpper")   // passes
    await wallet.createEntity({ attributes: { swprobeUpper: 1 }, payload: new Uint8Array(),
      contentType: "application/octet-stream", expires: ExpirationTime.fromHours(1) })   // rejected

Fix: make the SDK grammar and the node agree, and correct the node's error text.

## 10. Explorer shows an absolute expiry block as a duration

Surface: Block Explorer, entity page.

Expected: the expiry of report 0xc70641410d53fc0b6a280a484bad195825f458fd28246c8a2ec666542cc1a8b5, which the SDK reads as block 4765119, about 97 days after the read at block 574778 (7 days at creation plus three 30-day extensions).

Actual: the entity page says "Expires 4765119 blocks (~110d 7h) from block 574753". 4765119 is the absolute block; 4765119 blocks of 2 seconds is the 110 days shown. The operation history on the same page is right: one create and three extends, each with its transaction.

Reproduce: open https://tiramisu.explorer.arkiv.network/entity/0xc70641410d53fc0b6a280a484bad195825f458fd28246c8a2ec666542cc1a8b5 and compare with getEntity(key).expiresAt.

Fix: show "expires at block N (about D days from now)".

## 11. Anonymous query budget is undocumented, and viem waits out the whole Retry-After

Surface: public HTTP RPC (arkiv_query), the SDK's HTTP transport, and the Access Keys docs page.

Expected: the Access Keys page says the public RPC "works without one, at the default rate limit". We expected a per-second limit.

Actual: after about 40 minutes of building and testing from one IP, every arkiv_query returned HTTP 429:

    ratelimit: limit=10000, remaining=0, reset=2604
    retry-after: 2604
    {"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}

eth_blockNumber and eth_getTransactionReceipt kept working. Two things made this costly. First, viem's HTTP transport honours Retry-After, so an SDK query sleeps for the full 2604 seconds before it fails: our CLI and the web page looked frozen, with no error. Second, our first live feed read back every entity created on the network to find our own (entry 4), and Tiramisu creates entities every block, so an open tab spent the budget on other people's data.

Measured after the reset (2026-10-14 18:33 UTC): every arkiv_query cost **100** units in the Arkiv-Cost header, both for select "*" with limit 200 and for select key with limit 1, so the 10000-unit budget is **100 queries** per window from one IP. A second limit of 600 requests per 60 seconds counts every call; eth_blockNumber carried no Arkiv-Cost header. While under budget, the RateLimit header shows only the per-minute limit, so a client cannot see how much of the 10000 is left until it is gone.

What we changed: the transports use retryCount 0 and show a plain message with the reset time; the page reads the RateLimit header (exposed to browsers through CORS, which helped) and shows the remaining budget in the status bar; the live feed filters EntityCreated events on their creation flags (our reports are created with flags 3, our confirmations with 1) and reads the survivors in one batched OR query, at most once every 10 seconds; one registry read at load serves the feed, report pages and the Attested page from memory, so a visit costs 3 queries at load; and a 429 with a Retry-After of a minute or less is waited out once. An access key would raise the limit, but the docs advise keeping it out of the browser, and a backend would undo the censorship-resistance point, so each visitor reads on their own anonymous budget.

Reproduce: send arkiv_query calls from one IP until the 429 arrives, then call any SDK query with the default http() transport and time it.

Fix: state the anonymous budget (10000 cost units, the window, 100 units per query) on the Access Keys page; report the remaining cost budget in a header before it runs out; have the SDK pass retryCount 0 or cap the Retry-After wait for arkiv_query; a server-side filter on watchEntityEvents (entry 4) removes most of the load.

## 12. Writes, batches and costs (worked)

Surface: createEntity, executeBatch with creates and extensions, extendEntity through a batch, plain GLM transfers.

Expected: the documented behaviour, and costs small enough to fund six demo wallets from one faucet claim.

Actual, measured on 2026-10-14 from transaction receipts at a gas price of about 1 gwei:

| write | gas | GLM |
|---|---|---|
| one attestor entity (createEntity) | 107,576 | 0.000108 |
| four reports in one executeBatch | 510,000 | 0.000510 |
| one confirmation plus one Lifetime Extension in one executeBatch | 126,360 | 0.000126 |
| plain GLM transfer | 21,000 | 0.000021 |

Everything the seven wallets wrote up to the seed and the first two end-to-end runs (12 seed reports, 13 confirmations, 1 attestor, the probes in entries 9 and 11, two test reports) cost **0.0038 GLM** in gas, read from the balances afterwards. We gave each demo wallet 0.05 GLM. A read straight after a write saw the new state, so the seed could confirm a report in the block after filing it and stack three confirmations on one report.

