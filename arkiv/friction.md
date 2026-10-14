# Friction report

Kept while building ScamWatch India, 2026-10-14 onward. Versions: @arkiv-network/sdk 0.8.1 (latest on npm, published 2026-09-11), viem 2.57.6, Vite 6.4.4, Node 26.11.1 on macOS, Chrome headless for the browser checks. Network: Tiramisu, chain 7738577, public RPC and WebSocket endpoints from the challenge README.

Each entry: the surface, what we expected, what happened, how to reproduce, and what would fix it. Entries marked "worked" are tested paths that behaved as documented.

## 1. Faucet: needs a wallet sign-in and a CAPTCHA, so a script or agent cannot fund a wallet

Surface: Faucet, hub.arkiv.network/faucet.

Expected: the Tiramisu docs page says to get test GLM from the faucet, so we expected either a form that takes an address or an endpoint a CLI can call.

Actual: the page asks the visitor to connect a browser wallet ("Sign in with your wallet to claim testnet $GLM"), then shows an "I'm not a robot" CAPTCHA. The claim is a POST to /api/faucet with a recipient and a captchaToken; a GET to /api/faucet?recipient=<address> without a session returns {"error":"Unauthorized"}. The docs page does not mention the sign-in, the CAPTCHA, the amount per claim or the cooldown. Our build key lives in a secret manager and is never loaded into a browser wallet, so funding it needs a person with their own browser wallet who enters our address as the recipient.

Reproduce:

    curl -s "https://hub.arkiv.network/api/faucet?recipient=0xBc223395380a7d53BE453E1Dacde40A20A370D06"

Fix: state on the Tiramisu docs page that the faucet needs a connected wallet and a CAPTCHA, that the recipient can differ from the signed-in wallet, and the amount and cooldown. A rate-limited claim path for an access-key holder would let a CLI fund itself.

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

Actual: as documented. toString() returns the exact query string, which we show in the UI and in the README so a judge can paste it. Range operators on a str attribute throw UnsupportedOperatorError before the network. Attribute names are validated client-side, and "key" is reserved. The README warns that a bare number defaults to i32, so a u64 attribute queried with a bare number matches nothing; we always pass u64() on both sides.
