'use strict';

/*
 * email-html.js
 * ---------------------------------------------------------------------------
 * Renders the release / pre-release announcement as HTML in the LANA house
 * email style.
 *
 * Style authority: ~/Documents/LanaAI/lana-mailer/templates/TEMPLATE_GUIDE.md
 *   palette   background #ffffff / #fafaf9, borders #e8e5e3,
 *             text #1c1917 (primary) / #57534e (body) / #a8a29e (muted),
 *             code #1c1917 bg with #d6d3d1 text
 *   type      -apple-system stack, body 14px/1.7, headers 24px weight 300
 *   layout    600px max width, 12px radius card, 40px content padding,
 *             callouts #fafaf9 with 8px radius
 *   voice     short sentences, first person, no em-dashes, no buzzwords,
 *             sign off as a real person
 *
 * Inline styles only. Email clients strip <style> tags.
 */

const C = {
  bg: '#ffffff',
  bgAlt: '#fafaf9',
  border: '#e8e5e3',
  text: '#1c1917',
  body: '#57534e',
  muted: '#a8a29e',
  codeBg: '#1c1917',
  codeText: '#d6d3d1',
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO = "'SF Mono', Monaco, monospace";

// Platform folder -> human framing. `blurb` explains who the build is for, so
// the reader picks correctly without knowing our filename conventions.
const PLATFORMS = {
  'macos-arm64': {
    name: 'macOS, Apple Silicon',
    blurb: 'For M1, M2, M3 and M4 Macs.',
  },
  'macos-x64': {
    name: 'macOS, Intel',
    blurb: 'For Intel based Macs.',
  },
  windows: {
    name: 'Windows',
    blurb: 'For 64 bit Windows 10 and 11.',
  },
  linux: {
    name: 'Linux',
    blurb: 'AppImage and .deb builds.',
  },
};

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// The primary artifact is what most people want: the installer, not the zip.
function isPrimary(file) {
  return /\.(dmg|exe|AppImage)$/i.test(file);
}

function label(file) {
  if (/\.dmg$/i.test(file)) return 'Download the installer';
  if (/-setup\.exe$/i.test(file)) return 'Download the installer';
  if (/\.exe$/i.test(file)) return 'Download the installer';
  if (/\.AppImage$/i.test(file)) return 'Download the AppImage';
  if (/\.deb$/i.test(file)) return 'Download the .deb';
  return 'Download the .zip';
}

function button(href, text) {
  return (
    `<a href="${esc(href)}" style="background: ${C.codeBg}; color: #ffffff; ` +
    `padding: 12px 28px; border-radius: 8px; text-decoration: none; ` +
    `font-size: 13px; font-weight: 500; display: inline-block;">${esc(text)}</a>`
  );
}

function quietLink(href, text) {
  return (
    `<a href="${esc(href)}" style="color: ${C.body}; font-size: 12px; ` +
    `text-decoration: none; border-bottom: 1px solid #d6d3d1;">${esc(text)}</a>`
  );
}

function sectionLabel(text) {
  return (
    `<p style="font-size: 12px; font-weight: 600; color: #44403c; ` +
    `text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 12px 0;">` +
    `${esc(text)}</p>`
  );
}

/**
 * @param {object}  opts
 * @param {string}  opts.tag           e.g. v4.1.0-pre.d117678
 * @param {string}  opts.version       e.g. 4.1.0-pre.d117678
 * @param {array}   opts.artifacts     {platform, file, sizeMB, sha256, url}
 * @param {boolean} opts.preRelease
 * @param {string}  opts.releaseUrl
 * @param {string[]} opts.changes      changelog lines, already plain text
 * @param {boolean} opts.notarized     macOS builds are notarized
 * @param {boolean} opts.windowsUnsigned
 * @param {string}  opts.signOff       name to sign as
 * @param {string}  [opts.logoCid]     Content-ID of the inline LANA AI wordmark.
 *                                     Omit to fall back to the text wordmark.
 *                                     Source asset: src/img/logo-dark.png
 */
function renderReleaseEmailHtml({
  tag,
  version,
  artifacts = [],
  preRelease = true,
  releaseUrl,
  changes = [],
  notarized = true,
  windowsUnsigned = true,
  signOff = 'Michael',
  logoCid = null,
}) {
  const kind = preRelease ? 'pre-release' : 'release';

  // ---- download cards, one per platform we actually built ----------------
  const cards = [];
  for (const [folder, meta] of Object.entries(PLATFORMS)) {
    const items = artifacts.filter((a) => a.platform === folder);
    if (!items.length) continue;

    const primary = items.find((a) => isPrimary(a.file)) || items[0];
    const others = items.filter((a) => a !== primary);

    const alt = others.length
      ? `<span style="color: ${C.muted}; font-size: 12px; margin-left: 14px;">or ` +
        others.map((o) => quietLink(o.url, o.file.replace(/^.*?--/, '').replace(/^genesis--/, ''))).join(', ') +
        `</span>`
      : '';

    cards.push(
      `<div style="background: ${C.bgAlt}; border: 1px solid ${C.border}; border-radius: 8px; padding: 20px 24px; margin-bottom: 12px;">` +
        `<p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: ${C.text};">${esc(meta.name)}</p>` +
        `<p style="margin: 0 0 16px 0; font-size: 12px; color: ${C.muted};">${esc(meta.blurb)} ${esc(primary.sizeMB)} MB.</p>` +
        button(primary.url, label(primary.file)) +
        alt +
      `</div>`
    );
  }

  // ---- checksums, kept out of the way but still present -------------------
  const checksums = artifacts
    .map(
      (a) =>
        `<p style="margin: 0 0 10px 0; font-size: 11px; color: ${C.muted}; font-family: ${MONO}; line-height: 1.5; word-break: break-all;">` +
        `${esc(a.file)}<br>${esc(a.sha256)}</p>`
    )
    .join('');

  // A real list, not <br>-joined text. Explicit margins and padding because
  // email clients disagree wildly on default list spacing.
  const changeItems = changes
    .map((c) => {
      const t = c.replace(/^-\s*/, '').trim();
      // Commit subjects often read "area: what changed". Bold the area so the
      // list scans vertically instead of as a wall of sentences.
      const m = t.match(/^([a-z0-9 .\-_/]{2,28}):\s+(.*)$/i);
      const text = m
        ? `<strong style="color: ${C.text}; font-weight: 600;">${esc(m[1])}</strong>${esc(': ' + m[2])}`
        : esc(t);
      return (
        `<li style="color: ${C.body}; font-size: 14px; line-height: 1.6; ` +
        `margin: 0 0 10px 0; padding-left: 4px;">${text}</li>`
      );
    })
    .join('\n      ');

  const changeList = changes.length
    ? `<hr style="border: none; border-top: 1px solid ${C.border}; margin: 32px 0;">` +
      sectionLabel("What's new") +
      `<ul style="margin: 0 0 24px 0; padding: 0 0 0 20px; list-style-type: disc;">
      ${changeItems}
    </ul>`
    : '';

  // Header brand mark. When a Content-ID is supplied the LANA AI wordmark is
  // embedded as an inline attachment (cid:), which renders even in clients that
  // block remote images. `alt` carries the wordmark text for anyone whose
  // client strips images entirely, so the header never comes up blank.
  const brandMark = logoCid
    ? `<img src="cid:${esc(logoCid)}" alt="Lana AI" width="118" height="35" ` +
      `style="display: inline-block; vertical-align: middle; width: 118px; height: 35px; border: 0; ` +
      `font-size: 18px; font-weight: 600; color: ${C.text}; letter-spacing: 0.5px;">`
    : `<span style="font-size: 18px; font-weight: 600; color: ${C.text}; letter-spacing: 0.5px; vertical-align: middle;">Lana AI</span>`;

  const strong = (t) =>
    `<strong style="color: ${C.text}; font-weight: 600;">${t}</strong>`;

  const notes = [];
  if (preRelease) {
    notes.push(
      `${strong('This is a test build.')} Please keep it inside the team. ` +
        'Do not pass it on to anyone outside the group.'
    );
  }
  if (notarized) {
    notes.push(
      `${strong('The Mac builds are notarized by Apple.')} They open normally, ` +
        'with no security warning to click through.'
    );
  }
  if (windowsUnsigned) {
    notes.push(
      `${strong('The Windows build is not signed yet.')} SmartScreen may warn ` +
        'you the first time. Click "More info", then "Run anyway". A signing ' +
        'certificate is coming.'
    );
  }

  return (
`<div style="font-family: ${FONT}; max-width: 600px; margin: 0 auto; background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 12px; overflow: hidden;">

  <div style="background: ${C.bgAlt}; padding: 32px 40px; border-bottom: 1px solid ${C.border};">
    ${brandMark}
    <span style="font-size: 14px; color: ${C.muted}; margin-left: 10px; font-weight: 300; vertical-align: middle;">Desktop Client</span>
  </div>

  <div style="padding: 40px;">
    <h1 style="font-size: 24px; font-weight: 300; color: ${C.text}; margin: 0 0 8px 0;">A new build is ready</h1>
    <p style="color: ${C.body}; font-size: 14px; line-height: 1.7; margin: 0 0 24px 0;">
      Version <strong style="color: ${C.text}; font-weight: 600;">${esc(version)}</strong> is up as a ${esc(kind)}. Grab the build for your machine below, then let me know what breaks.
    </p>

    ${sectionLabel('Download')}
    ${cards.join('\n    ')}

    <div style="background: ${C.bgAlt}; border: 1px solid ${C.border}; border-radius: 8px; padding: 20px 24px; margin: 24px 0;">
      ${sectionLabel('Installing')}
      <p style="color: ${C.body}; font-size: 14px; line-height: 1.8; margin: 0;">
        <strong style="color: ${C.text};">On Mac</strong>, open the .dmg and drag Lana AI into Applications. Replace the old copy when it asks.<br>
        <strong style="color: ${C.text};">On Windows</strong>, run the installer and follow the prompts.
      </p>
    </div>

    <div style="background: ${C.bgAlt}; border: 1px solid ${C.border}; border-radius: 8px; padding: 20px 24px; margin: 0 0 24px 0;">
      ${sectionLabel('Good to know')}
      ${notes
        .map(
          (n, i) =>
            `<p style="color: ${C.body}; font-size: 14px; line-height: 1.7; margin: 0 0 ${
              i === notes.length - 1 ? '0' : '14px'
            } 0;">${n}</p>`
        )
        .join('\n      ')}
    </div>

    ${changeList}

    <hr style="border: none; border-top: 1px solid ${C.border}; margin: 32px 0;">

    ${sectionLabel('Verify your download')}
    <p style="color: ${C.body}; font-size: 13px; line-height: 1.7; margin: 0 0 14px 0;">
      Optional. Run <code style="font-family: ${MONO}; font-size: 12px; background: ${C.bgAlt}; border: 1px solid ${C.border}; border-radius: 4px; padding: 2px 6px;">shasum -a 256 &lt;file&gt;</code> and match it against the value here.
    </p>
    ${checksums}

    <p style="margin: 24px 0 0 0;">
      ${quietLink(releaseUrl, 'View the full release page →')}
    </p>

    <p style="color: ${C.muted}; font-size: 12px; line-height: 1.6; margin: 32px 0 0 0;">
      Reply here if anything looks wrong.<br><br>- ${esc(signOff)}
    </p>
  </div>

</div>`
  );
}

module.exports = { renderReleaseEmailHtml, PLATFORMS };
