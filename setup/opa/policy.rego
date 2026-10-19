package envoy.authz

import rego.v1

# The gateway sends OPA every request. OPA answers with an object:
# allowed, and for a denial, the HTTP status and body to return.
default result := {
	"allowed": false,
	"http_status": 403,
	"body": "denied by OPA: send a valid workshop token\n",
}

headers := input.attributes.request.http.headers

# Check the token's signature, issuer and audience against the workshop JWKS.
claims := payload if {
	[_, bearer] := split(headers.authorization, "Bearer ")
	[valid, _, payload] := io.jwt.decode_verify(bearer, {
		"cert": json.marshal(data.jwks),
		"iss": "solo-workshop",
		"aud": "agentgateway",
	})
	valid
}

# The model the client asked for, from the request body. Clients send the provider prefix.
model := json.unmarshal(input.attributes.request.http.body).model

# Models the marketing team may use.
marketing_models := {"openai/gpt-4o-mini"}

result := {"allowed": true} if claims.team == "platform"

result := {"allowed": true} if {
	claims.team == "marketing"
	model in marketing_models
}

result := {
	"allowed": false,
	"http_status": 403,
	"body": sprintf("denied by OPA: team %s may not use model %s\n", [claims.team, model]),
} if {
	claims.team == "marketing"
	not model in marketing_models
}
