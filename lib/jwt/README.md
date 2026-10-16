# Workshop JWTs

Labs that use JWT authentication paste `public-jwks.json` into the UI and send these tokens:

| File | `sub` | `team` |
|---|---|---|
| `tokens/alice.jwt` | `alice` | `platform` |
| `tokens/bob.jwt` | `bob` | `marketing` |

All tokens have `iss: solo-workshop`, `aud: agentgateway`, and expire on 2036-01-01.

To mint a new key pair and tokens, run `./make-tokens.sh`. It writes `private.pem`, which stays on your machine. After you mint new tokens, paste the new `public-jwks.json` into any JWT policy you configured.
