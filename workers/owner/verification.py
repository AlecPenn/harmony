"""Local WebAuthn verification; original HARMONY integration, using Yubico fido2."""
import hashlib
import re
from fido2.server import Fido2Server
from fido2.webauthn import (AttestedCredentialData, AuthenticationResponse, RegistrationResponse,
    UserVerificationRequirement, AuthenticatorAttachment, ResidentKeyRequirement)

RP_ID = "harmony.local"
ORIGIN = "https://harmony.local"

def server():
    value = Fido2Server({"id": RP_ID, "name": "HARMONY local owner"},
                       verify_origin=lambda origin: origin == ORIGIN)
    value.timeout = 60000
    return value

def parse_request(value):
    if not isinstance(value, dict) or value.get("operation") not in ("enroll", "verify"):
        raise ValueError("Invalid owner request")
    expected = {"operation", "requestId", "challenge", "window"}
    if value["operation"] == "verify":
        expected |= {"credential", "counter"}
    if set(value) != expected or not isinstance(value["requestId"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["requestId"]):
        raise ValueError("Invalid owner request")
    if not isinstance(value["challenge"], str) or not re.fullmatch(r"[a-f0-9]{128}", value["challenge"]):
        raise ValueError("Invalid owner challenge")
    if not isinstance(value["window"], str) or not re.fullmatch(r"[1-9][0-9]{0,19}", value["window"]):
        raise ValueError("Invalid owner window")
    if value["operation"] == "verify":
        if not isinstance(value["credential"], str) or not re.fullmatch(r"(?:[a-f0-9]{2}){1,1536}", value["credential"]):
            raise ValueError("Invalid owner credential")
        if type(value["counter"]) is not int or not 0 <= value["counter"] <= 0xffffffff:
            raise ValueError("Invalid owner counter")
    return value

def verify_assertion(service, state, credential, response, previous_counter):
    if AuthenticationResponse.from_dict(response).response.client_data.cross_origin:
        raise ValueError("Cross-origin assertion")
    service.authenticate_complete(state, [credential], response)
    counter = AuthenticationResponse.from_dict(response).response.authenticator_data.counter
    if (counter != 0 or previous_counter != 0) and counter <= previous_counter:
        raise ValueError("Owner counter did not advance")
    return counter

def run(value, client, cancel):
    value = parse_request(value)
    service = server()
    challenge = bytes.fromhex(value["challenge"])
    if cancel.is_set():
        raise ValueError("Cancelled")
    if value["operation"] == "enroll":
        options, state = service.register_begin(
            {"id": hashlib.sha256(challenge).digest(), "name": "local-owner", "displayName": "HARMONY local owner"},
            user_verification=UserVerificationRequirement.REQUIRED,
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key_requirement=ResidentKeyRequirement.DISCOURAGED,
            challenge=challenge)
        response = client.make_credential(options.public_key, event=cancel)
        if RegistrationResponse.from_dict(response).response.client_data.cross_origin:
            raise ValueError("Cross-origin enrollment")
        auth = service.register_complete(state, response)
        if len(bytes(auth.credential_data)) > 1536:
            raise ValueError("Oversized credential")
        result = {"credential": bytes(auth.credential_data).hex(), "counter": auth.counter}
    else:
        credential = AttestedCredentialData(bytes.fromhex(value["credential"]))
        options, state = service.authenticate_begin([credential], user_verification=UserVerificationRequirement.REQUIRED, challenge=challenge)
        response = client.get_assertion(options.public_key, event=cancel).get_response(0)
        result = {"counter": verify_assertion(service, state, credential, response, value["counter"])}
    if cancel.is_set():
        raise ValueError("Cancelled")
    return {"requestId": value["requestId"], "result": "verified", **result}
