# Discovery capability entries

`enabled_apps` is both the organization entitlement manifest and the source for
the desktop app switcher. Entries with navigable routes appear in the switcher;
entries with `route.type: "capability"` enable native or background client
functionality without creating a navigation item.

## Contract

```json
{
  "id": "screen-diction",
  "label": "Screen Dictation",
  "description": "System-wide dictation and screen-aware voice assistance",
  "colors": ["#60a5fa", "#2563eb", "#7c3aed", "#0f172a"],
  "route": {
    "type": "capability",
    "meta": {
      "platforms": ["darwin", "win32", "linux"],
      "default_enabled": true,
      "required": false,
      "hints": {
        "Getting started": [
          "Place the cursor in an editable field.",
          "Press Command+Shift+Space to dictate."
        ],
        "Shortcuts": {
          "Dictation": "Command+Shift+Space",
          "Agent mode": "Command+Shift+A"
        },
        "Permissions": "Microphone and Accessibility access are requested only when used."
      }
    }
  }
}
```

Supported platform identifiers match `process.platform`: `darwin`, `win32`,
and `linux`. An explicit platform list restricts activation to those values; an
omitted or empty list means the capability is platform-neutral.

`default_enabled` defaults to `true`. `required: true` keeps the capability
active and disables its Settings dropdown. `hints` is a display-only dictionary:
each key may map to a string, an array of strings, or a one-level dictionary of
string labels and values. The client bounds keys and values before rendering.

## Client behavior

- Login preserves validated capability entries in the cached `enabledApps`
  entitlement manifest.
- `normalizeAppList()` continues to return only navigable apps, so capability
  entries never appear in the sidebar or produce empty links.
- Electron enables Screen Dictation only when the exact `screen-diction`
  capability is present and supports the current platform.
- Settings > Capabilities lists every discovery capability and stores optional
  activation preferences locally per organization and device. A local setting
  can turn an entitlement off; it can never create an entitlement.
- Startup without the capability creates no overlay and registers no global
  shortcuts. Discovery refreshes enable or disable it without an app restart.
- Unknown route types and unknown capability ids remain inert.

This client gate controls feature availability and presentation. Backend APIs
must continue to authenticate every request; server-side entitlement checks
should be used where a capability also protects billable or sensitive service
access.
