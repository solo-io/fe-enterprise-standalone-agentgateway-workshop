#!/usr/bin/env bash
# Creates the workshop's TLS files in this folder. The workshop ships these files, so you only need to run
# this script to make new ones (for example after they expire). Needs openssl.
#
#   ca.crt / ca.key                    workshop certificate authority (CA) that signs the others
#   localhost.crt / localhost.key      server certificate for localhost and 127.0.0.1
#   foo.example.com.crt / .key         server certificate for foo.example.com
#   bar.example.com.crt / .key         server certificate for bar.example.com
#   client.crt / client.key            client certificate for mutual TLS (mTLS)
#
# The gateway reads these files at /config/tls/... because setup/ is mounted at /config.
# Workshop use only: the private keys are public in the workshop repository.
set -euo pipefail
cd "$(dirname "$0")"

DAYS=825 # longest validity that macOS accepts for a server certificate

openssl req -x509 -new -newkey rsa:2048 -nodes -sha256 -days 3650 \
  -subj "/O=agentgateway workshop/CN=agentgateway workshop CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout ca.key -out ca.crt

# leaf <name> <subject CN> <subjectAltName> <extendedKeyUsage>
leaf() {
  openssl req -new -newkey rsa:2048 -nodes -subj "/O=agentgateway workshop/CN=$2" \
    -keyout "$1.key" -out "$1.csr"
  openssl x509 -req -sha256 -days "$DAYS" -in "$1.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -extfile <(printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=%s\n%s\n' "$4" "$3") \
    -out "$1.crt"
  rm -f "$1.csr"
}

leaf localhost localhost "subjectAltName=DNS:localhost,IP:127.0.0.1" serverAuth
leaf foo.example.com foo.example.com "subjectAltName=DNS:foo.example.com" serverAuth
leaf bar.example.com bar.example.com "subjectAltName=DNS:bar.example.com" serverAuth
leaf client workshop-client "" clientAuth

rm -f ca.srl
chmod 644 ./*.crt ./*.key # the gateway runs as your user and must read the keys
echo "Created TLS files in $(pwd)"
