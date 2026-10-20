"""Guardrail webhook: Jev scores each policy rule and judges regex-found values for masking."""
import http.client
import json
import os
import queue
import re
import signal
import sys
import time
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

JEV_HOST = "api.typesafe.ai"
JEV_PATH = "/v1/systemone"
API_KEY = os.environ["TYPESAFE_AI_API_KEY"]
POLICY = json.load(open(os.environ.get("GUARDRAIL_POLICY_PATH", "/etc/guardrail/policy.json")))
DETECTORS = [(d["label"], re.compile(d["pattern"])) for d in POLICY["mask"]["detectors"]]

# Idle connections to Jev, reused across requests so a call skips the TCP and
# TLS handshake. Each thread takes its own connection out of the pool.
IDLE_CONNECTIONS = queue.LifoQueue()


def log(**fields):
    print(json.dumps(fields), flush=True)


def jev_post(body, headers):
    try:
        conn, reused = IDLE_CONNECTIONS.get_nowait(), True
    except queue.Empty:
        conn, reused = None, False
    while True:
        conn = conn or http.client.HTTPSConnection(JEV_HOST, timeout=POLICY["requestTimeoutMs"] / 1000)
        try:
            conn.request("POST", JEV_PATH, body, headers)
            response = conn.getresponse()
            data = response.read()
        except (http.client.RemoteDisconnected, ConnectionError):
            conn.close()
            # Jev closes connections that sit idle. Retry once on a new
            # connection when a pooled one turns out to be closed.
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


def ask_jev(state, questions):
    body = json.dumps({"model": POLICY["jevModel"], "state": state, "questions": questions}).encode()
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    response, data = jev_post(body, headers)
    if response.status != 200:
        raise urllib.error.HTTPError(JEV_HOST + JEV_PATH, response.status, response.reason, response.headers, None)
    result = json.loads(data)
    return result["answers"], result["usage"]["input_tokens"]


def find_candidates(texts):
    """Return (text_index, start, end, label, value) for every regex match.

    Detectors run in policy order, and a later detector skips spans an earlier
    one already claimed, so a card number is not also reported as a phone number.
    """
    found = []
    for index, text in enumerate(texts):
        claimed = []
        for label, pattern in DETECTORS:
            for match in pattern.finditer(text):
                start, end = match.span()
                if any(start < c_end and c_start < end for c_start, c_end in claimed):
                    continue
                claimed.append((start, end))
                found.append((index, start, end, label, match.group()))
    return found


def mask_question(value):
    question = dict(POLICY["mask"]["question"])
    question["instructions"] = {"value": value, "question": question["instructions"]}
    return question


def apply_masks(texts, candidates, flags):
    masked = list(texts)
    # Replace from the end of each text so earlier offsets stay valid.
    hits = [c for c, flag in zip(candidates, flags) if flag]
    for index, start, end, label, _ in sorted(hits, key=lambda c: (c[0], -c[1])):
        masked[index] = masked[index][:start] + f"<{label}>" + masked[index][end:]
    return masked


def classify(state, texts, rules):
    """Ask every rule and every mask candidate in one Jev call."""
    candidates = find_candidates(texts)
    questions = {rule["id"]: rule["question"] for rule in rules}
    for i, candidate in enumerate(candidates):
        questions[f"mask_{i}"] = mask_question(candidate[4])
    if not questions:
        return {}, candidates, [], 0, 0
    started = time.monotonic()
    answers, tokens = ask_jev(state, questions)
    latency_ms = round((time.monotonic() - started) * 1000)
    threshold = POLICY["mask"]["threshold"]
    flags = [answers[f"mask_{i}"]["noul"] >= threshold for i in range(len(candidates))]
    return answers, candidates, flags, latency_ms, tokens


def candidate_log(candidates, answers):
    return [
        {"label": c[3], "value": c[4], "score": round(answers[f"mask_{i}"]["noul"], 2) if answers else None}
        for i, c in enumerate(candidates)
    ]


def handle_request(payload):
    messages = payload["body"]["messages"]
    texts = [m.get("content") or "" for m in messages]
    rules = POLICY["reject"]
    try:
        answers, candidates, flags, latency_ms, tokens = classify({"messages": messages}, texts, rules)
    except (OSError, http.client.HTTPException, KeyError, ValueError) as err:
        # Without a classifier the webhook cannot check the reject rules, so it
        # blocks the request instead of letting it through unchecked.
        log(event="jev_error", hook="request", error=str(err))
        return {"action": {"body": "guardrail classifier unavailable", "status_code": 503, "reason": "jev_error"}}

    scores = {rule["id"]: round(answers[rule["id"]]["noul"], 2) for rule in rules}
    matched = [rule for rule in rules if answers[rule["id"]]["noul"] >= rule["threshold"]]
    decision = dict(event="decision", hook="request", scores=scores,
                    candidates=candidate_log(candidates, answers), jev_latency_ms=latency_ms, input_tokens=tokens)

    if matched:
        rule = max(matched, key=lambda r: answers[r["id"]]["noul"])
        log(action="REJECT", rule=rule["id"], **decision)
        return {"action": {"body": rule["message"], "status_code": 403, "reason": rule["id"]}}
    if any(flags):
        masked = apply_masks(texts, candidates, flags)
        log(action="MASK", **decision)
        return {"action": {
            "body": {"messages": [{"role": m["role"], "content": t} for m, t in zip(messages, masked)]},
            "reason": "masked sensitive values",
        }}
    log(action="PASS", **decision)
    return {"action": {"reason": "no rule matched"}}


def handle_response(payload):
    choices = payload["body"]["choices"]
    texts = [c["message"].get("content") or "" for c in choices]
    try:
        answers, candidates, flags, latency_ms, tokens = classify({"responses": texts}, texts, [])
    except (OSError, http.client.HTTPException, KeyError, ValueError) as err:
        # Fall back to masking every regex match, so an outage over-masks
        # instead of leaking a value Jev never judged.
        log(event="jev_error", hook="response", error=str(err))
        answers, latency_ms, tokens = {}, 0, 0
        candidates = find_candidates(texts)
        flags = [True] * len(candidates)

    decision = dict(event="decision", hook="response",
                    candidates=candidate_log(candidates, answers), jev_latency_ms=latency_ms, input_tokens=tokens)
    if any(flags):
        masked = apply_masks(texts, candidates, flags)
        log(action="MASK", **decision)
        return {"action": {
            "body": {"choices": [{"message": {"role": c["message"]["role"], "content": t}} for c, t in zip(choices, masked)]},
            "reason": "masked sensitive values",
        }}
    log(action="PASS", **decision)
    return {"action": {"reason": "nothing to mask"}}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        handlers = {"/request": handle_request, "/response": handle_response}
        if self.path not in handlers:
            self.send_error(404)
            return
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
        except ValueError:
            self.send_error(400)
            return
        data = json.dumps(handlers[self.path](payload)).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    # PID 1 ignores SIGTERM unless it installs a handler, so without this
    # the pod waits out the full termination grace period on every restart.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    log(event="started", port=8000, rules=[r["id"] for r in POLICY["reject"]],
        detectors=[label for label, _ in DETECTORS])
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
