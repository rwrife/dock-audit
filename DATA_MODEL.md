# Local data model and identifier boundaries

`dock-audit-core` owns the version-1 SQLite schema. The caller supplies the
application-data path; no path is hard-coded and the storage layer makes no
network request.

## Stored records

| Record      | Stored fields                                                          | Identifier rule                                                                               |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Profile     | ID, user name, selected expectations, alias, required flag             | Only user-selected expectations are stored.                                                   |
| Expectation | device class, friendly name when selected, keyed local identity hashes | Raw serials and raw stable identifiers are not accepted by this type.                         |
| Snapshot    | ID, profile ID, observations, capability metadata, scan health         | Adapters must hash stable identifiers before constructing an observation.                     |
| Backup      | Version, profiles, snapshots                                           | Restore validates version and profile references before one SQLite transaction replaces data. |

The current core model does not yet create a hashing key or collect hardware
identifiers: those responsibilities belong to the future native adapters. Until
they exist, this is a contract, not evidence of hardware collection or platform
compatibility. Friendly names are weak signals and comparison reports them only
as `fallback`, never `exact`.

## Migration and recovery

Opening a database applies the idempotent version-1 schema migration and sets
SQLite `user_version` to 1. A malformed or incompatible backup is rejected before
the replacement transaction starts; an error leaves existing rows unchanged.
Future migrations must preserve this property and increment the version.

## Remaining risks

User-selected aliases and friendly names can still be identifying in a shared
profile. Exports, timeline retention, full erase, encryption-at-rest, and the
adapter hashing-key lifecycle are not implemented by this issue and must not be
represented as delivered.
