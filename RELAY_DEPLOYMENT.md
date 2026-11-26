# PINX relay setup

The relay lets the GitHub Pages PWA communicate with the PINX Android app when both phones can reach the internet. Local Wi-Fi pairing remains available as a fallback. The relay uses Cloudflare Workers with a Durable Object; usage may exceed the provider's free allowance and incur charges.

## Deploy the relay

1. Sign in to a Cloudflare account with Wrangler, then run `npx wrangler@latest deploy` from this repository.
2. Copy the deployed `workers.dev` HTTPS URL into `relay-config.json` as the `endpoint` value, for example `https://pinx-relay.example.workers.dev`.
3. Commit and deploy that config change to GitHub Pages.
4. Build and install the updated PINX Android app from the attached Android project. It reads the relay endpoint from the deployed config and registers a new private relay room whenever Wi-Fi sharing starts.

The Cloudflare account and deployment are not configured by this repository. Do not publish device keys; the app generates them locally. Each relay room uses a random UUID and the fixed pairing PIN `123456`, with temporary lockout after repeated incorrect PIN attempts.

## Pair

Start Wi-Fi pairing in PINX and open the generated GitHub Pages link on the iPhone. Enter `123456`. Both devices need internet access while using the relay. The local Android-served pairing link continues to work only when both devices are on the same Wi-Fi network.

Run the relay tests with:

```text
node --test tests/relay-worker.test.mjs
```
