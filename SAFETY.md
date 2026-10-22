# Safety

This server talks to the LightBurn / MillMage REST API. The API, and therefore
this server, **cannot start, stop, pause or move a machine**. It can read state,
read project data, change cut settings in the open project, and import files.

Even so, cut settings control laser power, speed, passes and other parameters
that directly affect how a machine behaves. Please read this page once.

## The operator reviews every setting

Any cut setting created or changed through this server (the `update_cut` and
`apply_material_to_cut` tools) must be reviewed and verified in LightBurn or
MillMage **before the job is run**. Values suggested by an AI assistant are not
known to be correct, safe or appropriate for your machine, material or process.

The intended workflow is:

1. The assistant prepares or modifies the project through this server.
2. You review the resulting job and its settings in LightBurn / MillMage.
3. You start the job yourself, only after deciding it is safe to run.

Every write operation in this server ends with the sentence
*"Review these settings in LightBurn before running the job."* for this reason.

## No remote or unattended operation

LightBurn Software does not endorse, recommend or support remote or unattended
operation of lasers, CNC machines or other machinery. This server's HTTP mode
and the tunnel setup for ChatGPT exist so that URL-based assistants can **read
and prepare** a project; they are not a remote control, and they do not make
leaving a running machine alone acceptable.

Machines that generate heat, sparks, smoke or motion must be supervised by a
responsible operator who can respond immediately.

## Not a safety system

This server, the REST API, cameras and monitoring tools are convenience tools.
They are not safety systems and must not replace operator supervision,
emergency stops, machine safeguards, fire prevention or workplace procedures.

## Security

- The pairing secret is stored in your per-user config file and is never
  returned by a tool or written into client configs. Treat it like a password.
- HTTP mode always requires an access token. If you expose the server through
  a tunnel, the URL containing the token is a secret too. Rotate it with
  `lightburn-mcp token --rotate` if it leaks.
- Enabling "Allow API Access From Network" in LightBurn widens the attack
  surface of LightBurn itself. Only do this on networks you trust.

## Licensing

This project is MIT-licensed. Use of the LightBurn / MillMage API is governed
by LightBurn Software's API EULA and policies, see the upstream repository:
<https://github.com/LightBurnSoftware/LightBurn-REST> (`API-EULA.md`,
`SAFETY.md`, `POLICY.md`). This project is not affiliated with LightBurn
Software.
