import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from rtcexpress_server import RTCExpressError, RTCExpressServer, TokenResponse


class _Handler(BaseHTTPRequestHandler):
    reply = (200, {})
    last_body: dict = {}
    last_path = ""

    def do_POST(self):  # noqa: N802 (http.server naming)
        length = int(self.headers.get("Content-Length", 0))
        type(self).last_body = json.loads(self.rfile.read(length) or b"{}")
        type(self).last_path = self.path
        status, body = type(self).reply
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class CreateTokenTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}/"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _Handler.reply = (200, {"token": "tok_123", "expiresIn": 3600})
        _Handler.last_body = {}
        self.client = RTCExpressServer("app_1", "secret_1", server_url=self.base_url)

    def test_sends_credentials_and_options(self):
        result = self.client.create_token("alice", room_id="support-42", role="host")
        self.assertEqual(result, TokenResponse(token="tok_123", expires_in=3600))
        self.assertEqual(_Handler.last_path, "/v1/token")
        self.assertEqual(
            _Handler.last_body,
            {"appId": "app_1", "appSecret": "secret_1", "userId": "alice", "roomId": "support-42", "role": "host"},
        )

    def test_optional_fields_left_out(self):
        self.client.create_token("bob")
        self.assertEqual(_Handler.last_body, {"appId": "app_1", "appSecret": "secret_1", "userId": "bob"})

    def test_api_error_has_status_and_message(self):
        _Handler.reply = (401, {"error": "Invalid app credentials"})
        with self.assertRaises(RTCExpressError) as ctx:
            self.client.create_token("alice")
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(ctx.exception.message, "Invalid app credentials")

    def test_rate_limit_is_429(self):
        _Handler.reply = (429, {"error": "Too many token requests"})
        with self.assertRaises(RTCExpressError) as ctx:
            self.client.create_token("alice")
        self.assertEqual(ctx.exception.status, 429)

    def test_malformed_success_response(self):
        _Handler.reply = (200, {"nope": True})
        with self.assertRaisesRegex(RTCExpressError, "Unexpected response"):
            self.client.create_token("alice")

    def test_network_failure_is_status_0(self):
        offline = RTCExpressServer("a", "s", server_url="http://127.0.0.1:1", timeout=2)
        with self.assertRaises(RTCExpressError) as ctx:
            offline.create_token("alice")
        self.assertEqual(ctx.exception.status, 0)

    def test_missing_values_fail_before_request(self):
        with self.assertRaisesRegex(ValueError, "app_id"):
            RTCExpressServer("", "s")
        with self.assertRaisesRegex(ValueError, "app_secret"):
            RTCExpressServer("a", "")
        with self.assertRaisesRegex(ValueError, "user_id"):
            self.client.create_token("")


if __name__ == "__main__":
    unittest.main()
