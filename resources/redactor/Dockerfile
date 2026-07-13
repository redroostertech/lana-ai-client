# Lana Cloud — Redactor (Presidio + spaCy) image.
#
# Build context MUST be services/redactor (Railway "Root Directory" =
# services/redactor). Listen port is env-driven via $PORT.
#
# CRITICAL (PII safety): presidio-analyzer, presidio-anonymizer, spacy AND the
# en_core_web_lg spaCy model (~587MB, a direct-URL dependency in pyproject.toml)
# MUST all be present at runtime. If the model is missing the redactor silently
# degrades to regex-only matching and leaks names/orgs to the inference upstream.
# `pip install -e .` pulls every one of them (the model URL dep included), and
# the build-time verification step below FAILS THE BUILD if spaCy cannot load
# en_core_web_lg. Never remove that check.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml ./
COPY redactor ./redactor

# Installs FastAPI/uvicorn + presidio-analyzer + presidio-anonymizer + spacy +
# en_core_web_lg (the ~587MB model is a direct-URL dep in pyproject.toml).
RUN pip install --upgrade pip && pip install -e .

# Bake-in verification: fail the image build if the large model is not loadable.
# This is the guardrail against the silent regex-only degrade described above.
RUN python -c "import spacy; spacy.load('en_core_web_lg'); print('en_core_web_lg OK')"

ENV PORT=18081
EXPOSE 18081

# Container HEALTHCHECK (G6/Hazard-2). The lean image only loads en_core_web_lg at
# boot (lifespan), so it warms up faster than Dockerfile.full — but it still loads
# the model before /healthz answers, so it gets a start-period too (shorter). The
# probe (healthcheck.py) tries https then http, so it works whether or not the TLS
# cert env is set. Railway's gate is healthcheckTimeout in railway.json.
COPY healthcheck.py ./healthcheck.py
HEALTHCHECK --interval=15s --timeout=10s --start-period=120s --retries=10 \
  CMD ["python", "healthcheck.py"]

# uvicorn binds 0.0.0.0 so Railway's private network can reach it; $PORT is
# resolved at container start (sh -c so the env var expands).
#
# TLS (security-posture-audit G6, wire-level): OPT-IN and default OFF. When BOTH
# REDACTOR_SSL_CERTFILE and REDACTOR_SSL_KEYFILE are set, uvicorn terminates TLS
# and the gateway can reach the redactor over https://redactor.railway.internal
# (the most sensitive internal hop, since the redactor sees cleartext PII). When
# either is unset (the DEFAULT) uvicorn serves plaintext exactly as before, so a
# deploy that ships this image without mounting certs is byte-identical to today.
# The entrypoint script picks the flags based on those env vars.
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
CMD ["./entrypoint.sh"]
