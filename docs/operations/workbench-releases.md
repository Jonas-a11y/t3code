# Local Code Workbench releases

The **Workbench macOS Release** GitHub Actions workflow builds the personal
fork for macOS arm64 after application changes land on `managed-local`. It can
also be started manually from the repository's Actions page. Each successful
run publishes the app ZIP, the matching source archive, checksums, and the
`latest-mac.yml` update manifest as a GitHub release. The workflow checks that
the packaged app starts and opens an existing thread before publishing.

Workbench uses the existing **Settings → About** update controls and sidebar
update button. Its feed is `Jonas-a11y/t3code`; updates include the bundled
server and web client and preserve the Workbench app identity and data home.
Older locally built copies without a feed need a one-time replacement before
they can receive these updates. Stable is the Workbench release track; this
workflow does not publish Nightly builds.

The workflow signs the app with the personal Workbench update certificate
stored in the repository secrets `WORKBENCH_MAC_CERTIFICATE` (base64 PKCS#12)
and `WORKBENCH_MAC_CERTIFICATE_PASSWORD`. Keep a private backup of that
certificate and key: changing the signing certificate breaks automatic updates
from installations signed with the previous one. The certificate is self-signed;
it provides signer continuity for macOS updates, without Apple Developer ID
signing or notarization. No certificate trust or Gatekeeper settings are changed.
