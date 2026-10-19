# Workshop JWTs

Labs that use JWT authentication paste `public-jwks.json` into the UI and send these tokens:

| File | `sub` | Claim |
|---|---|---|
| `tokens/alice.jwt` | `alice` | `team: platform` |
| `tokens/bob.jwt` | `bob` | `team: marketing` |
| `tokens/requester.jwt` | `riley` | `persona: requester` |
| `tokens/buyer.jwt` | `bailey` | `persona: buyer` |
| `tokens/finance-approver.jwt` | `fran` | `persona: finance-approver` |

All tokens have `iss: solo-workshop`, `aud: agentgateway`, and expire on 2036-01-01.

To mint a new key pair and tokens, run `./make-tokens.sh`. It writes `private.pem`, which stays on your machine. After you mint new tokens, paste the new `public-jwks.json` into any JWT policy you configured.
