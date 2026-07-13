"""Round-trip tests for TRUE document redaction (redactor/document_redact.py).

The critical assertion is BURN-IN: after redacting a generated PDF/DOCX we
RE-EXTRACT the text from the output and prove the seeded PII strings are GONE
(not merely covered) while surrounding non-PII prose survives.

Detection is exercised through the REAL engine.redact so the span -> geometry
mapping is tested end to end. To keep the test hermetic and fast we drive the
engine with its deterministic regex/heuristic backstops (SSN + labeled DOB) plus
a matter-vault ``protected_terms`` entry for the name/address, rather than
requiring the heavy Presidio/spaCy analyzer to be loaded. The mapping code does
not care which layer produced an entity span.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from redactor import document_redact
from redactor.engine import RedactionUnavailable, redact

fitz = pytest.importorskip("fitz")
docx = pytest.importorskip("docx")


# Seeded PII. SSN is caught by the regex backstop; NAME + ADDRESS are declared as
# protected terms so detection is deterministic without the NER model.
SSN = "123-45-6789"
NAME = "Jonathan Redwood"
ADDRESS = "742 Evergreen Terrace"
KEEP_1 = "This agreement is entered into by the parties."
KEEP_2 = "The premises shall be used for lawful purposes only."


def _redact_fn(text):
    return redact(
        text,
        protected_terms=[
            {"term": NAME, "category": "PERSON"},
            {"term": ADDRESS, "category": "LOCATION"},
        ],
    )


def _detect_fn(text):
    """Detect-only counterpart of _redact_fn for the PROPOSE path."""
    from redactor.engine import detect

    return detect(
        text,
        protected_terms=[
            {"term": NAME, "category": "PERSON"},
            {"term": ADDRESS, "category": "LOCATION"},
        ],
    )


def _make_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    lines = [
        KEEP_1,
        f"Client name: {NAME}",
        f"Residence: {ADDRESS}",
        f"SSN {SSN}",
        KEEP_2,
    ]
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=12)
        y += 24
    out = io.BytesIO()
    doc.save(out)
    doc.close()
    return out.getvalue()


def _make_docx() -> bytes:
    d = docx.Document()
    d.add_paragraph(KEEP_1)
    d.add_paragraph(f"Client name: {NAME}")
    d.add_paragraph(f"Residence: {ADDRESS}")
    d.add_paragraph(f"SSN {SSN}")
    # A table cell with PII, to exercise the table walk.
    table = d.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "SSN on file"
    table.rows[0].cells[1].text = f"SSN {SSN}"
    d.add_paragraph(KEEP_2)
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


def _extract_pdf_text(data: bytes) -> str:
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        return "\n".join(page.get_text("text") for page in doc)
    finally:
        doc.close()


def _extract_docx_text(data: bytes) -> str:
    d = docx.Document(io.BytesIO(data))
    parts = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)


# --- PDF burn-in ------------------------------------------------------------
def test_pdf_burn_in_removes_pii_keeps_prose():
    result = document_redact.redact_pdf(_make_pdf(), _redact_fn)
    assert result.fmt == "pdf"

    extracted = _extract_pdf_text(result.content)
    # BURN-IN PROOF: the sensitive strings are un-extractable from the output.
    assert SSN not in extracted
    assert NAME not in extracted
    assert "Redwood" not in extracted
    assert ADDRESS not in extracted
    assert "Evergreen" not in extracted
    # Non-PII prose survives.
    assert "agreement is entered into" in extracted
    assert "lawful purposes only" in extracted

    # Report accounts for each entity type.
    counts = result.report["entity_counts"]
    assert counts.get("US_SSN", 0) >= 1
    assert counts.get("PERSON", 0) >= 1
    assert counts.get("LOCATION", 0) >= 1
    assert result.report["total_entities"] >= 3
    assert all("page" in loc and "rects" in loc for loc in result.report["locations"])


def test_pdf_burn_in_destroys_underlying_glyphs_not_just_visual():
    """Redacted regions must contain NO text glyphs at all (apply_redactions
    deletes them), proving true removal rather than an opaque overlay box."""
    result = document_redact.redact_pdf(_make_pdf(), _redact_fn)
    doc = fitz.open(stream=result.content, filetype="pdf")
    try:
        # Searching the output for the raw SSN must find zero hits on any page.
        for page in doc:
            assert page.search_for(SSN) == []
            assert page.search_for("Redwood") == []
    finally:
        doc.close()


# --- DOCX replacement -------------------------------------------------------
def test_docx_replaces_pii_keeps_prose():
    result = document_redact.redact_docx(_make_docx(), _redact_fn)
    assert result.fmt == "docx"

    extracted = _extract_docx_text(result.content)
    assert SSN not in extracted
    assert NAME not in extracted
    assert "Redwood" not in extracted
    assert ADDRESS not in extracted
    # Tokenized replacement is present (proves replace, not delete).
    assert "[REDACTED_US_SSN_" in extracted
    # Non-PII prose survives.
    assert "agreement is entered into" in extracted
    assert "lawful purposes only" in extracted
    # Table cell PII was redacted too.
    counts = result.report["entity_counts"]
    assert counts.get("US_SSN", 0) >= 2  # body paragraph + table cell


# --- DOCX non-body regions (headers/footers/metadata) residue (L1) ----------
def _make_docx_with_headers_footers_metadata() -> bytes:
    """A DOCX seeding PII in a running header, a footer, and core metadata —
    the exact regions the old body-only walk left un-redacted."""
    d = docx.Document()
    d.add_paragraph(KEEP_1)
    d.add_paragraph(f"Client name: {NAME}")
    section = d.sections[0]
    # Setting header/footer text unlinks the region and creates its own part.
    section.header.paragraphs[0].text = f"Case caption: {NAME} - SSN {SSN}"
    section.footer.paragraphs[0].text = f"Matter residence: {ADDRESS}"
    d.core_properties.author = NAME
    d.core_properties.title = f"Matter file for {NAME}"
    d.core_properties.subject = f"Residence {ADDRESS}"
    d.add_paragraph(KEEP_2)
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


def test_docx_redacts_all_regions_true_zip_residue():
    """TRUE residue test: unzip the OUTPUT and prove the seeded PII appears in
    NONE of the .xml parts (header/footer/metadata included), not just the body."""
    src = _make_docx_with_headers_footers_metadata()

    # Sanity: the SOURCE really does leak the PII into non-body parts.
    src_zip = zipfile.ZipFile(io.BytesIO(src))
    src_blob = b"".join(src_zip.read(n) for n in src_zip.namelist() if n.endswith(".xml"))
    assert NAME.encode() in src_blob
    assert ADDRESS.encode() in src_blob

    result = document_redact.redact_docx(src, _redact_fn)
    assert result.fmt == "docx"

    seeds = [NAME, "Redwood", ADDRESS, "Evergreen", SSN]
    zf = zipfile.ZipFile(io.BytesIO(result.content))
    for part in zf.namelist():
        if not part.endswith(".xml"):
            continue
        text = zf.read(part).decode("utf-8", "ignore")
        for seed in seeds:
            assert seed not in text, f"{seed!r} leaked in {part}"

    # Report notes which regions were processed.
    regions = set(result.report["regions"])
    assert {"body", "header", "footer", "metadata"} <= regions


def test_docx_fails_closed_on_unrewritable_footnote_text():
    """A DOCX carrying real text in a part we cannot safely rewrite (footnotes)
    must FAIL CLOSED, not emit a partially-redacted document."""
    base = _make_docx()
    # Inject a footnotes.xml part with real w:t text into the zip.
    footnotes = (
        '<?xml version="1.0"?>'
        '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:footnote w:id="1"><w:p><w:r><w:t>Secret witness {NAME}</w:t></w:r></w:p></w:footnote>'
        "</w:footnotes>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base)) as zin, zipfile.ZipFile(buf, "w") as zout:
        for item in zin.namelist():
            zout.writestr(item, zin.read(item))
        zout.writestr("word/footnotes.xml", footnotes)

    with pytest.raises(document_redact.PartialRedactionError):
        document_redact.redact_docx(buf.getvalue(), _redact_fn)


# --- dispatch + fail-closed -------------------------------------------------
def test_dispatch_sniffs_pdf_and_docx():
    pdf = _make_pdf()
    docx_bytes = _make_docx()
    assert document_redact.sniff_format(pdf, "x.pdf", "application/pdf") == "pdf"
    assert document_redact.sniff_format(docx_bytes, "x.docx", None) == "docx"
    with pytest.raises(document_redact.UnsupportedDocument):
        document_redact.sniff_format(b"plain text", "x.txt", "text/plain")


def test_fail_closed_propagates_and_emits_nothing():
    """If the detector raises RedactionUnavailable (strict, NER down), no
    document is produced — the exception propagates to the caller."""

    def _strict_unavailable(_text):
        raise RedactionUnavailable("ner_unavailable")

    with pytest.raises(RedactionUnavailable):
        document_redact.redact_pdf(_make_pdf(), _strict_unavailable)
    with pytest.raises(RedactionUnavailable):
        document_redact.redact_docx(_make_docx(), _strict_unavailable)


# --- OCR (skip-guarded) -----------------------------------------------------
def _make_scanned_pdf() -> bytes:
    """A PDF whose page is an IMAGE of text (no text layer) — a 'scanned' doc."""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1200, 400), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 40)
    except Exception:
        font = ImageFont.load_default()
    draw.text((40, 40), "Patient record", fill="black", font=font)
    draw.text((40, 140), f"SSN {SSN}", fill="black", font=font)
    draw.text((40, 240), "End of record", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    doc = fitz.open()
    page = doc.new_page(width=612, height=204)
    page.insert_image(page.rect, stream=buf.getvalue())
    out = io.BytesIO()
    doc.save(out)
    doc.close()
    return out.getvalue()


@pytest.mark.skipif(
    not document_redact.ocr_available(),
    reason="tesseract binary not installed (OCR unavailable)",
)
def test_ocr_scanned_pdf_burn_in():
    scanned = _make_scanned_pdf()
    # Sanity: the source really has no extractable text layer.
    src = fitz.open(stream=scanned, filetype="pdf")
    assert src[0].get_text("words") == []
    src.close()

    result = document_redact.redact_pdf(scanned, _redact_fn)
    assert result.report["ocr"]["used"] is True
    # OCR text feeds the same detect + burn path; the SSN should be tallied and
    # its region redacted. (OCR of the name/address is font-dependent, so we
    # assert on the deterministic SSN backstop.)
    assert result.report["entity_counts"].get("US_SSN", 0) >= 1


def test_ocr_unavailable_reported_cleanly(monkeypatch):
    """When OCR is unavailable, a scanned page is flagged, not silently passed."""
    monkeypatch.setattr(document_redact, "ocr_available", lambda: False)
    scanned = _make_scanned_pdf()
    result = document_redact.redact_pdf(scanned, _redact_fn)
    pages = result.report["ocr"]["pages"]
    assert any(
        p.get("reason") == "ocr_unavailable" for p in pages
    ), pages


# ===========================================================================
# Human-in-the-loop: PROPOSE (detect only) + APPLY (burn approved subset).
# ===========================================================================
_CONTRACT_KEYS = {"id", "type", "start", "end", "text", "confidence",
                  "source", "page", "rects"}


def _rect_for_pdf_term(data: bytes, term: str) -> list[float]:
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        r = doc[0].search_for(term)[0]
        return [r.x0, r.y0, r.x1, r.y1]
    finally:
        doc.close()


# --- PROPOSE: PDF -----------------------------------------------------------
def test_propose_pdf_returns_contract_spans_and_does_not_alter_doc():
    data = _make_pdf()
    proposal = document_redact.propose_document(data, _detect_fn,
                                                filename="x.pdf")
    assert proposal["format"] == "pdf"
    assert proposal["page_count"] == 1
    spans = proposal["proposed_spans"]
    assert spans, "expected proposed spans"

    # Every span is the FULL shared contract shape.
    for s in spans:
        assert _CONTRACT_KEYS <= set(s), s
        assert s["page"] == 0
        assert s["rects"] and all(len(r) == 4 for r in s["rects"])
        assert 0.0 <= s["confidence"] <= 1.0
        assert s["id"] == f"0:{s['start']}:{s['end']}:{s['type']}"

    # Provenance is correct per layer: SSN via regex backstop, NAME/ADDRESS via
    # the declared protected terms.
    ssn = next(s for s in spans if s["type"] == "US_SSN")
    assert ssn["source"] == "regex"
    assert ssn["text"] == SSN
    person = next(s for s in spans if s["type"] == "PERSON")
    assert person["source"] == "term"

    # PROPOSE MUST NOT ALTER THE DOC: the original bytes still carry the PII.
    extracted = _extract_pdf_text(data)
    assert SSN in extracted
    assert NAME in extracted


# --- APPLY: PDF subset (honor human REJECT) ---------------------------------
def test_apply_pdf_burns_only_approved_subset():
    data = _make_pdf()
    proposal = document_redact.propose_document(data, _detect_fn)
    # Approve ONLY the SSN; REJECT the name/address spans.
    approved = [s for s in proposal["proposed_spans"] if s["type"] == "US_SSN"]
    assert approved

    out = document_redact.apply_document(data, approved, filename="x.pdf")
    assert out["format"] == "pdf"
    extracted = _extract_pdf_text(out["redacted_document"])
    # Approved SSN is GONE; rejected name/address SURVIVE.
    assert SSN not in extracted
    assert NAME in extracted
    assert ADDRESS in extracted
    assert out["report"]["entity_counts"].get("US_SSN", 0) >= 1


# --- APPLY: PDF added span (not originally proposed) ------------------------
def test_apply_pdf_burns_added_span():
    data = _make_pdf()
    # A human ADDS a redaction over a non-PII word that was never proposed.
    added = {
        "id": "0:0:0:CUSTOM",
        "type": "CUSTOM",
        "start": 0,
        "end": 0,
        "text": "agreement",
        "confidence": 1.0,
        "source": "regex",
        "page": 0,
        "rects": [_rect_for_pdf_term(data, "agreement")],
    }
    out = document_redact.apply_document(data, [added], filename="x.pdf")
    extracted = _extract_pdf_text(out["redacted_document"])
    assert "agreement" not in extracted
    assert out["report"]["entity_counts"].get("CUSTOM", 0) >= 1


# --- PROPOSE / APPLY: DOCX --------------------------------------------------
def test_propose_docx_returns_null_geometry_and_apply_subset():
    data = _make_docx()
    proposal = document_redact.propose_document(data, _detect_fn,
                                                filename="x.docx")
    assert proposal["format"] == "docx"
    spans = proposal["proposed_spans"]
    assert spans
    for s in spans:
        assert _CONTRACT_KEYS <= set(s), s
        assert s["page"] is None
        assert s["rects"] is None

    ssn = next(s for s in spans if s["type"] == "US_SSN")
    assert ssn["source"] == "regex"

    # Approve ONLY the SSN spans; REJECT the name.
    approved = [s for s in spans if s["type"] == "US_SSN"]
    out = document_redact.apply_document(data, approved, filename="x.docx")
    assert out["format"] == "docx"
    extracted = _extract_docx_text(out["redacted_document"])
    assert SSN not in extracted
    assert "[REDACTED_US_SSN_" in extracted
    # Rejected name survives.
    assert NAME in extracted
