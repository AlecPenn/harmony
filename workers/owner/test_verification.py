import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".runtime" / "owner"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import hashlib
import threading
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fido2.cose import ES256
from fido2.webauthn import (AttestedCredentialData, AuthenticatorData, CollectedClientData,
    AttestationObject, RegistrationResponse, AuthenticationResponse,
    AuthenticatorAttestationResponse, AuthenticatorAssertionResponse)
from verification import ORIGIN, RP_ID, parse_request, run

class Client:
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential = AttestedCredentialData.create(bytes(16), b"fixture-id", ES256.from_cryptography_key(self.key.public_key()))
        self.origin = ORIGIN
        self.challenge = None
        self.flags = AuthenticatorData.FLAG.UP | AuthenticatorData.FLAG.UV
        self.counter = 1
        self.signature_bad = False
        self.cross_origin = False
        self.rp = RP_ID
        self.calls = 0
    def data(self, kind, options):
        return CollectedClientData.create(kind, self.challenge or options.challenge, self.origin, cross_origin=self.cross_origin)
    def make_credential(self, options, event):
        self.calls += 1
        assert options.authenticator_selection.user_verification == "required"
        assert options.authenticator_selection.authenticator_attachment == "platform"
        data = self.data("webauthn.create", options)
        auth = AuthenticatorData.create(hashlib.sha256(self.rp.encode()).digest(), self.flags | AuthenticatorData.FLAG.AT, 0, self.credential)
        return RegistrationResponse(raw_id=self.credential.credential_id, response=AuthenticatorAttestationResponse(client_data=data, attestation_object=AttestationObject.create("none", auth, {})))
    def get_assertion(self, options, event):
        self.calls += 1
        assert options.user_verification == "required"
        data = self.data("webauthn.get", options)
        auth = AuthenticatorData.create(hashlib.sha256(self.rp.encode()).digest(), self.flags, self.counter)
        signature = self.key.sign(bytes(auth) + data.hash, ec.ECDSA(hashes.SHA256()))
        if self.signature_bad:
            signature = bytes(len(signature))
        response = AuthenticationResponse(raw_id=self.credential.credential_id, response=AuthenticatorAssertionResponse(client_data=data, authenticator_data=auth, signature=signature))
        class Selection:
            def get_response(self, index):
                return response
        return Selection()

def request(client, operation="verify"):
    value = {"operation": operation, "requestId": "a" * 64, "challenge": "b" * 128, "window": "123"}
    if operation == "verify":
        value.update(credential=bytes(client.credential).hex(), counter=0)
    return value

def test_enrollment_and_real_signed_assertion():
    client = Client()
    enrolled = run(request(client, "enroll"), client, threading.Event())
    assert enrolled["credential"] == bytes(client.credential).hex()
    assert run(request(client), client, threading.Event())["counter"] == 1

@pytest.mark.parametrize("change", ["origin", "challenge", "rp", "presence", "verification", "signature", "cross_origin"])
def test_invalid_proof_is_rejected(change):
    client = Client()
    if change == "origin": client.origin = "https://attacker.invalid"
    if change == "challenge": client.challenge = b"other challenge must not work" * 2
    if change == "rp": client.rp = "attacker.invalid"
    if change == "presence": client.flags = AuthenticatorData.FLAG.UV
    if change == "verification": client.flags = AuthenticatorData.FLAG.UP
    if change == "signature": client.signature_bad = True
    if change == "cross_origin": client.cross_origin = True
    with pytest.raises(Exception): run(request(client), client, threading.Event())

@pytest.mark.parametrize("counter,previous,allowed", [(0,0,True),(1,0,True),(2,1,True),(1,1,False),(0,1,False)])
def test_counter_replay_policy(counter, previous, allowed):
    client = Client(); client.counter = counter
    value = request(client); value["counter"] = previous
    if allowed: assert run(value, client, threading.Event())["counter"] == counter
    else:
        with pytest.raises(ValueError): run(value, client, threading.Event())

def test_cancelled_request_never_invokes_authenticator():
    client = Client(); cancel = threading.Event(); cancel.set()
    with pytest.raises(ValueError): run(request(client), client, cancel)
    assert client.calls == 0

@pytest.mark.parametrize("patch", [{"operation":"other"},{"window":"0"},{"challenge":"00"},{"counter":True},{"counter":-1},{"credential":"ff"*1537},{"extra":1}])
def test_request_bounds(patch):
    with pytest.raises(ValueError): parse_request({**request(Client()), **patch})
