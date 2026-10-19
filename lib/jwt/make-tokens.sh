#!/usr/bin/env bash
# Mints the workshop signing key, the public JWKS and one token per persona.
# Labs paste lib/jwt/public-jwks.json into the UI and send lib/jwt/tokens/<persona>.jwt.
# The private key (private.pem) stays on your machine; .gitignore excludes it.
# Rerun to mint a fresh key pair and tokens; then update any JWKS pasted into the UI.
set -euo pipefail
cd "$(dirname "$0")"

KID=workshop-1
ISS=solo-workshop
AUD=agentgateway
EXP=2082758400 # 2036-01-01T00:00:00Z

[ -f private.pem ] || openssl genrsa -out private.pem 2048 2>/dev/null

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# Public JWKS from the key's modulus and exponent.
python3 - "$KID" > public-jwks.json <<'PY'
import base64, json, re, subprocess, sys
text = subprocess.run(["openssl", "rsa", "-in", "private.pem", "-noout", "-text"],
                      capture_output=True, text=True, check=True).stdout
mod = re.search(r"modulus:\s*\n((?:\s+[0-9a-f:]+\n)+)", text).group(1)
n = bytes.fromhex(re.sub(r"[\s:]", "", mod)).lstrip(b"\x00")
e = int(re.search(r"publicExponent: (\d+)", text).group(1))
eb = e.to_bytes((e.bit_length() + 7) // 8, "big")
u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
print(json.dumps({"keys": [{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": sys.argv[1], "n": u(n), "e": u(eb)}]}, indent=2))
PY

mint() { # mint <file> <sub> <claim> <value>
  local header payload sig
  header=$(printf '{"alg":"RS256","typ":"JWT","kid":"%s"}' "$KID" | b64url)
  payload=$(printf '{"iss":"%s","aud":"%s","sub":"%s","%s":"%s","iat":%s,"exp":%s}' \
    "$ISS" "$AUD" "$2" "$3" "$4" "$(date +%s)" "$EXP" | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -sign private.pem -binary | b64url)
  printf '%s.%s.%s\n' "$header" "$payload" "$sig" > "tokens/$1.jwt"
}

mint alice alice team platform
mint bob bob team marketing
mint requester riley persona requester
mint buyer bailey persona buyer
mint finance-approver fran persona finance-approver
echo "wrote public-jwks.json and tokens/{alice,bob,requester,buyer,finance-approver}.jwt"
