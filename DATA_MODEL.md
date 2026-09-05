# Local data model and identifier boundaries

`dock-audit-core` owns the version-1 SQLite schema. The caller supplies the
application-data path; no path is hard-coded and the storage layer makes no
network request.

## Stored records

| Record      | Stored fields                                                                         | Identifier rule                                                                               |
| ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Profile     | ID, user name, selected expectations, alias, required flag                            | Only user-selected expectations are stored.                                                   |
| Expectation | device class, friendly name when selected, keyed local identity hashes                | Raw serials and raw stable identifiers are not accepted by this type.                         |
| Snapshot    | ID, profile ID, observations, normalized attributes, capability metadata, scan health | Adapters must hash stable identifiers before constructing an observation.                     |
| Backup      | Version, profiles, snapshots                                                          | Restore validates version and profile references before one SQLite transaction replaces data. |

Each normalized attribute carries its source and expected stability. A profile
may retain selected expected attribute values; when a stable identity matches but
one of those values changes or becomes unavailable, comparison reports `changed`.
Duplicate friendly names are `ambiguous`, never `missing`.

The core model does not create or persist a hashing key. The Windows adapter can
accept a caller-managed local key, but the current application deliberately does
not supply one, so it emits no durable identity hashes. This is a privacy-safe
capability gap rather than a claim that devices are missing. Raw serial numbers,
endpoint IDs, and MAC addresses are never stored in normalized observations.
See [WINDOWS_ADAPTERS.md](WINDOWS_ADAPTERS.md) for exact Windows field limits.

## Migration and recovery

Opening a database applies the idempotent version-1 schema migration and sets
SQLite `user_version` to 1. A malformed or incompatible backup is rejected before
the replacement transaction starts; an error leaves existing rows unchanged.
Future migrations must preserve this property and increment the version.

## Remaining risks

User-selected aliases and friendly names can still be identifying in a shared
profile. Exports, timeline retention, full erase, encryption-at-rest, and a
protected hashing-key lifecycle are not implemented by this issue and must not
be represented as delivered.
