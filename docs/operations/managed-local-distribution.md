# Build and operate a managed local distribution

This profile is a starting point for a desktop or locally served browser installation with no
remote clients, T3 Connect, product telemetry, or OTLP export. It is a technical deployment
candidate, not an organizational approval or a sandbox. Keep mobile and hosted web applications
out of this deployment.

## Prepare the policy and agent runtimes

Copy [managed-local-policy.json](./examples/managed-local-policy.json) into your deployment
workspace. Replace the organization and absolute agent paths. Install those binaries and their
configuration through device management, with administrator-only write access. Configure the
agents' model gateway, approvals, MCP servers, and credentials through their own managed
configuration. Pin any required gateway environment variables under each driver's
`limits.providers.instances.environment`; keep credentials out of the policy.

The profile permits only Codex and Claude, caps permission modes at Supervised, disables agent
browser access, and stops T3's own update flow. The ceiling also prevents users from supplying
their own provider binary, launch arguments, configuration home, or per-instance environment.
The environment that launches T3 and the agents' own configuration still matter: control shell
profiles, `PATH`, runtime injection variables, and agent configuration with device management.
The policy alone does not guarantee that all model traffic reaches your gateway.

Run the built candidate's `t3 policy check policy.json` before deployment. Install the policy
through one of the [machine-wide policy sources](../user/managed-policy.md#where-the-policy-goes),
then restart T3 and run `t3 policy show`. A configuration profile and a policy file on the same
machine conflict; deploy exactly one. Missing policy means an unmanaged application, so device
management must install the policy before allowing the application to run.

## Build a pinned candidate

Use a clean checkout of an exact reviewed commit, the Node version in `package.json`, Vite+, and
a Rust toolchain for the target platform's resource monitor. macOS packaging also requires Xcode
command-line tools. Include the repository's `assets/` directory if using a sparse checkout.
Do not copy a developer's `.env`, `.env.local`, credentials, or T3 data into the checkout. Keep
Clerk and relay tracing build variables unset, including their `VITE_` aliases. In particular,
do not configure `T3CODE_RELAY_CLIENT_OTLP_TRACES_URL`,
`T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET`, or `T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN`.
The locally served renderer sends its ordinary diagnostic traces only to its local server;
separately configured relay traces are a different exporter.

```sh
vp i --frozen-lockfile
vp run check:changed
T3CODE_TELEMETRY_CHANNEL=stable vp run dist:desktop:artifact \
  --platform mac --target dmg --arch arm64 --build-version 0.1.9-local.1 \
  --output-dir release/managed-local
```

Choose the version to match the reviewed upstream baseline. Setting the telemetry build channel
to `stable` disables the source-only managed-policy path override; it does not enable analytics
against the policy. The artifact command defaults to an unsigned build and never publishes. Use
`--signed` with your distribution's signing and notarization credentials for a deliverable macOS
package. Keep those credentials in the build system. The build retains T3's application identity
and policy domain, so install a candidate only on an isolated test machine or replace the managed
installation deliberately.

Record the commit, lockfile hash, build version, toolchain, dependency license notices, package
hash, signing result, and policy fingerprint together. Retain the MIT license and generated
third-party notices. Distribute the reviewed package and its policy through device management;
do not use upstream auto-update or `npx t3` as a replacement deployment path.

## Verify the installed package

Use an isolated T3 home and synthetic projects. Never start the candidate against an existing
installation's live database. Test the package, including its desktop process and renderer, with
the installed machine-wide policy; a source run with a development policy override does not
verify release policy loading.

| Exercise                                                                                                          | Expected observation                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and idle                                                                                                  | Only loopback HTTP/WebSocket listening; policy fingerprint matches `t3 policy show`. No T3 relay, analytics, update, or OTLP requests. |
| All three OTLP URLs set in settings, T3 environment variables, standard OTEL variables, and desktop startup input | No trace, metric, log, or renderer proxy export reaches the collector; running export status is off. Local diagnostic files remain.    |
| Endpoint check from Settings or RPC                                                                               | A policy refusal before any collector request.                                                                                         |
| Remote pairing, Connect login, LAN/Tailscale exposure, and a previously paired device                             | Access is refused and existing remote sessions are removed.                                                                            |
| Allowed agent on a synthetic project                                                                              | Model calls use the managed gateway; approvals work; file, shell, and MCP access matches the agent configuration.                      |
| Disallowed driver, altered binary or environment, broader permission mode, and queued/scheduled work              | The policy refuses the operation.                                                                                                      |
| Update or nightly installation                                                                                    | Refused; a replacement package comes only from the controlled distribution process.                                                    |
| Missing, malformed, conflicting, or unsupported policy                                                            | Missing policy is unmanaged; the deployment control must prevent launch. Other policy failures stop startup.                           |

Capture outbound requests from the desktop, server, renderer, and agent subprocesses with the
organization's network observation tooling. Cover startup, an agent turn, an error, reconnect,
and shutdown. Distinguish approved model, repository, and MCP traffic from diagnostics. Unit
tests and a mock collector demonstrate individual guards, not a complete egress allowlist.

Local logs and traces can contain project identifiers, paths, commands, and diagnostic details.
Apply a retention policy and restrict access to the T3 home. Web previews, repository operations,
MCP servers, terminals, model runtimes, and other tools can still make network requests; control
those with the operating environment and the providers' own settings. Users with administrator
rights can replace the application or remove its policy.

## Maintain the distribution

Assign owners for gateway configuration, package signing, policy rollout, security updates, and
review of new data flows. Rebase small changes onto upstream, review new dependencies and
network clients, rerun the package verification, then distribute a new pinned build. Policy
changes require a restart. Preserve the previous package and matching policy for rollback; do
not assume a database written by a newer version can be opened safely by an older one.
