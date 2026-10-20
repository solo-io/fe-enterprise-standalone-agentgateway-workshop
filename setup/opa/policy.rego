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

# The model the client asked for. OPA parses the JSON request body into parsed_body.
# Clients send the provider prefix.
model := input.parsed_body.model

# Models the marketing team may use.
marketing_models := {"openai/gpt-6-luna"}

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

# MCP rules (labs/mcp/mcp-opa-authorization.md).
# The platform rule above already lets the platform team call any tool.
# MCP clients send JSON-RPC messages to the path /mcp. OPA parses each message into parsed_body.
mcp_request if startswith(input.attributes.request.http.path, "/mcp")

rpc := input.parsed_body

# Tools the marketing team may not call.
marketing_denied_tools := {"get_full_page"}

# Marketing may start a session, list tools, and send other MCP messages.
result := {"allowed": true} if {
	mcp_request
	claims.team == "marketing"
	not rpc.method == "tools/call"
}

# Marketing may call tools that are not on the denied list.
result := {"allowed": true} if {
	mcp_request
	claims.team == "marketing"
	rpc.method == "tools/call"
	not rpc.params.name in marketing_denied_tools
}

result := {
	"allowed": false,
	"http_status": 403,
	"body": sprintf("denied by OPA: team %s may not call tool %s\n", [claims.team, rpc.params.name]),
} if {
	mcp_request
	claims.team == "marketing"
	rpc.method == "tools/call"
	rpc.params.name in marketing_denied_tools
}
