"""ExtProc adapter: asks the OpenAI Decisions API which price tier a prompt needs, then rewrites the model name."""
import http.client
import json
import os
import queue
import sys
import time
import urllib.error
from concurrent import futures

import grpc
from envoy.config.core.v3 import base_pb2
from envoy.service.ext_proc.v3 import external_processor_pb2 as pb
from envoy.service.ext_proc.v3 import external_processor_pb2_grpc as pb_grpc
from envoy.type.v3 import http_status_pb2

DECISIONS_HOST = "api.openai.com"
DECISIONS_PATH = "/v1/decisions"
API_KEY = os.environ["OPENAI_API_KEY"]
PROFILE = json.load(open(os.environ.get("DECISIONS_PROFILE_PATH", "/etc/decisions/profile.json")))
DECISION_HEADERS = ("x-decision-tier", "x-decision-reason")

# Idle connections to OpenAI, reused across requests so a call skips the TCP
# and TLS handshake. Each thread takes its own connection out of the pool.
IDLE_CONNECTIONS = queue.LifoQueue()


def log(**fields):
    print(json.dumps(fields), flush=True)


def prompt_text(body):
    """Return the text of the last user message, or None."""
    for message in reversed(body.get("messages") or []):
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return " ".join(p.get("text", "") for p in content if p.get("type") == "text")
    return None


def decisions_post(body, headers):
    try:
        conn, reused = IDLE_CONNECTIONS.get_nowait(), True
    except queue.Empty:
        conn, reused = None, False
    while True:
        conn = conn or http.client.HTTPSConnection(DECISIONS_HOST, timeout=PROFILE["requestTimeoutMs"] / 1000)
        try:
            conn.request("POST", DECISIONS_PATH, body, headers)
            response = conn.getresponse()
            data = response.read()
        except (http.client.RemoteDisconnected, ConnectionError):
            conn.close()
            # The server closes connections that sit idle. Retry once on a
            # new connection when a pooled one turns out to be closed.
            if not reused:
                raise
            conn, reused = None, False
            continue
        except Exception:
            conn.close()
            raise
        if response.will_close:
            conn.close()
        else:
            IDLE_CONNECTIONS.put(conn)
        return response, data


def ask_decisions(text):
    question = PROFILE["question"]
    body = json.dumps({
        "model": PROFILE["decisionsModel"],
        "input": text[: PROFILE["maxPromptChars"]],
        "questions": [question],
    }).encode()
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    response, data = decisions_post(body, headers)
    if response.status != 200:
        raise urllib.error.HTTPError(DECISIONS_HOST + DECISIONS_PATH, response.status, response.reason, response.headers, None)
    answer = next(a for a in json.loads(data)["answers"] if a["name"] == question["name"])
    # The API returns probabilities as a list of {value, probability}.
    answer["probabilities"] = {p["value"]: p["probability"] for p in answer["probabilities"]}
    return answer


def decide(answer):
    """Apply the confidence gate. Returns (tier, reason, margin)."""
    ranked = sorted(answer["probabilities"].values(), reverse=True)
    margin = ranked[0] - ranked[1]
    if answer["confidence"] < PROFILE["minConfidence"] or margin < PROFILE["minMargin"]:
        return PROFILE["fallbackTier"], "low_confidence", margin
    return answer["choice"], "classified", margin


def header(key, value):
    return base_pb2.HeaderValueOption(header=base_pb2.HeaderValue(key=key, raw_value=value.encode()))


def reject(status, message):
    return pb.ProcessingResponse(
        immediate_response=pb.ImmediateResponse(
            status=http_status_pb2.HttpStatus(code=status),
            headers=pb.HeaderMutation(set_headers=[header("content-type", "application/json")]),
            body=json.dumps({"error": {"message": message, "type": "routing_error"}}).encode(),
        )
    )


def handle_body(raw):
    try:
        body = json.loads(raw)
    except ValueError:
        return pb.ProcessingResponse(request_body=pb.BodyResponse())
    # Only the virtual model name opts in. A request that names a real model
    # passes through untouched and costs no Decisions API call.
    if body.get("model") != PROFILE["virtualModel"]:
        return pb.ProcessingResponse(request_body=pb.BodyResponse())
    text = prompt_text(body)
    if not text:
        return reject(400, "auto_model requests need a user message")

    started = time.monotonic()
    try:
        answer = ask_decisions(text)
    except (OSError, http.client.HTTPException, KeyError, ValueError, StopIteration) as err:
        # Reject on a classifier outage rather than serve the fallback tier,
        # so the failure is visible to the client and in the logs.
        log(event="decisions_error", error=str(err))
        return reject(503, "routing classifier unavailable")
    latency_ms = round((time.monotonic() - started) * 1000)

    tier, reason, margin = decide(answer)
    model = PROFILE["tiers"][tier]
    log(
        event="routing_decision",
        original_model=body["model"],
        selected_model=model,
        tier=tier,
        decisions_choice=answer["choice"],
        reason=reason,
        confidence=round(answer["confidence"], 3),
        margin=round(margin, 3),
        probabilities={k: round(v, 3) for k, v in answer["probabilities"].items()},
        decisions_latency_ms=latency_ms,
    )

    body["model"] = model
    new_body = json.dumps(body).encode()
    return pb.ProcessingResponse(
        request_body=pb.BodyResponse(
            response=pb.CommonResponse(
                header_mutation=pb.HeaderMutation(
                    set_headers=[
                        header("x-decision-tier", tier),
                        header("x-decision-reason", reason),
                        # The gateway rejects a body mutation whose length
                        # disagrees with the request's content-length.
                        header("content-length", str(len(new_body))),
                    ]
                ),
                body_mutation=pb.BodyMutation(body=new_body),
            )
        )
    )


class Processor(pb_grpc.ExternalProcessorServicer):
    def Process(self, request_iterator, context):
        for request in request_iterator:
            kind = request.WhichOneof("request")
            if kind == "request_headers":
                # Drop any decision header the client sent, so a caller cannot
                # pick its own tier.
                yield pb.ProcessingResponse(
                    request_headers=pb.HeadersResponse(
                        response=pb.CommonResponse(
                            header_mutation=pb.HeaderMutation(remove_headers=list(DECISION_HEADERS))
                        )
                    )
                )
            elif kind == "request_body":
                yield handle_body(request.request_body.body)
            elif kind == "response_headers":
                yield pb.ProcessingResponse(response_headers=pb.HeadersResponse())
            elif kind == "request_trailers":
                yield pb.ProcessingResponse(request_trailers=pb.TrailersResponse())
            elif kind == "response_trailers":
                yield pb.ProcessingResponse(response_trailers=pb.TrailersResponse())
            elif kind == "response_body":
                yield pb.ProcessingResponse(response_body=pb.BodyResponse())


def main():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=32))
    pb_grpc.add_ExternalProcessorServicer_to_server(Processor(), server)
    server.add_insecure_port("[::]:50051")
    server.start()
    log(event="started", port=50051, tiers=PROFILE["tiers"])
    server.wait_for_termination()


if __name__ == "__main__":
    sys.exit(main())
