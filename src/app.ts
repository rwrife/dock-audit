export type DeviceClass =
  "usb" | "display" | "audio_input" | "audio_output" | "network";

export type ScanHealth = "complete" | "partial" | "failed" | "unsupported";

export type MatchKind =
  | "exact"
  | "fallback"
  | "ambiguous"
  | "changed"
  | "missing"
  | "unexpected"
  | "unknown";

export interface CapabilityGap {
  class: DeviceClass;
  capability: string;
  kind:
    "access_denied" | "api_unavailable" | "query_failed" | "privacy_limited";
  message: string;
  error_code: number | null;
}

export interface Capability {
  source: string;
  stable: boolean;
}

export interface NormalizedField {
  value: string;
  source: string;
  stable: boolean;
}

export interface Observation {
  class: DeviceClass;
  label: string;
  attributes: Record<string, NormalizedField>;
  capabilities: Record<string, Capability>;
  identity_hashes: Record<string, string>;
}

export interface ProfileExpectation {
  id: string;
  class: DeviceClass;
  alias: string;
  required: boolean;
  expected_fields: Record<string, string>;
  identity_hashes: Record<string, string>;
  friendly_name: string | null;
}

export interface Profile {
  id: string;
  name: string;
  expectations: ProfileExpectation[];
}

export interface MatchExplanation {
  kind: MatchKind;
  reason: string;
  expectation_id: string | null;
  observation_index: number | null;
}

export interface ComparisonResult {
  matches: MatchExplanation[];
}

export interface InventoryReport {
  observations: Observation[];
  scan_health: Partial<Record<DeviceClass, ScanHealth>> &
    Record<string, ScanHealth>;
  capability_gaps: CapabilityGap[];
}

interface StoredProfile extends Profile {
  version: number;
  updated_at: string;
}

interface SnapshotProfileView {
  name: string;
  expectations: Array<{
    alias: string;
    class: DeviceClass;
    required: boolean;
  }>;
}

interface StoredSnapshot {
  id: string;
  profile_id: string;
  profile_version: number;
  profile_view: SnapshotProfileView;
  captured_at: string;
  report: InventoryReport;
  comparison: ComparisonResult;
}

export interface TimelineEvent {
  id: string;
  captured_at: string;
  category:
    | "scan_started"
    | "scan_completed"
    | "scan_failed"
    | "class_delta"
    | "operator";
  message: string;
  details: Record<string, string>;
}

export interface RetentionSettings {
  snapshot_limit: number;
  timeline_limit: number;
  timeline_days: number;
}

interface PersistedSettings extends RetentionSettings {
  timeline_capture_enabled: boolean;
  include_identifying_exports: boolean;
}

export interface BackupArchive {
  version: number;
  selected_profile_id: string | null;
  profiles: StoredProfile[];
  snapshots: StoredSnapshot[];
  timeline_events: TimelineEvent[];
  settings: PersistedSettings;
}

export interface RestoreConflictPreview {
  profiles_overwritten: number;
  profiles_added: number;
  snapshots_overwritten: number;
  snapshots_added: number;
  timeline_events_replaced: number;
}

interface PersistedState {
  selected_profile_id: string | null;
  profiles: StoredProfile[];
  snapshots: StoredSnapshot[];
  timeline_events: TimelineEvent[];
  settings: PersistedSettings;
}

interface CaptureDraft {
  selected: boolean;
  alias: string;
  required: boolean;
}

interface ResultItem {
  title: string;
  class: DeviceClass;
  kind: MatchKind;
  reason: string;
  identitySignals: string;
  required: boolean | null;
}

interface GroupedResult {
  report: InventoryReport;
  comparison: ComparisonResult;
  groups: Record<ResultGroupKey, ResultItem[]>;
}

type ResultGroupKey =
  "present" | "missing" | "unexpected" | "changed" | "ambiguous" | "unknown";

interface State {
  profileNameDraft: string;
  captureDrafts: CaptureDraft[];
  profiles: StoredProfile[];
  selectedProfileId: string | null;
  profileEditDraft: StoredProfile | null;
  snapshots: StoredSnapshot[];
  timelineEvents: TimelineEvent[];
  settings: PersistedSettings;
  observations: Observation[];
  scanHealth: Record<DeviceClass, ScanHealth>;
  capabilityGaps: CapabilityGap[];
  loadingInventory: boolean;
  inventoryError: string | null;
  runningCheck: boolean;
  checkProgress: number;
  checkStatus: string;
  result: GroupedResult | null;
  notice: string;
  includeIdentifyingExportFields: boolean;
  exportPreviewJson: string;
  exportPreviewMarkdown: string;
  restoreDraft: string;
  restorePreview: RestoreConflictPreview | null;
}

export interface DockAuditBackend {
  scanInventory(): Promise<InventoryReport>;
  compareProfile(
    profile: Profile,
    report: InventoryReport,
  ): Promise<ComparisonResult>;
}

export interface DockAuditStorage {
  load(): PersistedState;
  save(state: PersistedState): void;
}

export interface DockAuditApp {
  refreshInventory(): Promise<void>;
  waitForIdle(): Promise<void>;
  destroy(): void;
}

export interface DockAuditAppDependencies {
  backend: DockAuditBackend;
  storage?: DockAuditStorage;
  now?: () => Date;
  progressIntervalMs?: number;
}

const STORAGE_KEY = "dock-audit.issue6.v1";
const LEGACY_STORAGE_KEY = "dock-audit.issue5.v1";
const BACKUP_ARCHIVE_VERSION = 2;
const REDACTED = "[REDACTED]";
const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  snapshot_limit: 30,
  timeline_limit: 200,
  timeline_days: 7,
};
const ALL_CLASSES: DeviceClass[] = [
  "usb",
  "display",
  "audio_input",
  "audio_output",
  "network",
];

export const bootstrapScanHealth: Record<DeviceClass, ScanHealth> = {
  usb: "unsupported",
  display: "unsupported",
  audio_input: "unsupported",
  audio_output: "unsupported",
  network: "unsupported",
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultSettings(): PersistedSettings {
  return {
    ...DEFAULT_RETENTION_SETTINGS,
    timeline_capture_enabled: false,
    include_identifying_exports: false,
  };
}

function sanitizePositiveInt(
  value: unknown,
  fallback: number,
  min = 1,
  max = 500,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.round(value);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function normalizeSettings(
  raw: Partial<PersistedSettings> | null | undefined,
): PersistedSettings {
  const fallback = defaultSettings();
  return {
    timeline_capture_enabled: raw?.timeline_capture_enabled === true,
    include_identifying_exports: raw?.include_identifying_exports === true,
    snapshot_limit: sanitizePositiveInt(
      raw?.snapshot_limit,
      fallback.snapshot_limit,
      1,
      200,
    ),
    timeline_limit: sanitizePositiveInt(
      raw?.timeline_limit,
      fallback.timeline_limit,
      1,
      2000,
    ),
    timeline_days: sanitizePositiveInt(
      raw?.timeline_days,
      fallback.timeline_days,
      1,
      365,
    ),
  };
}

function parseTimelineEvents(raw: unknown): TimelineEvent[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry) => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const candidate = entry as Partial<TimelineEvent>;
      return {
        id:
          typeof candidate.id === "string" && candidate.id.length > 0
            ? candidate.id
            : randomId("timeline"),
        captured_at:
          typeof candidate.captured_at === "string" &&
          candidate.captured_at.length > 0
            ? candidate.captured_at
            : new Date(0).toISOString(),
        category:
          candidate.category === "scan_started" ||
          candidate.category === "scan_completed" ||
          candidate.category === "class_delta" ||
          candidate.category === "operator"
            ? candidate.category
            : "operator",
        message:
          typeof candidate.message === "string" ? candidate.message : "event",
        details:
          candidate.details && typeof candidate.details === "object"
            ? Object.fromEntries(
                Object.entries(candidate.details).map(([key, value]) => [
                  key,
                  typeof value === "string" ? value : JSON.stringify(value),
                ]),
              )
            : {},
      };
    })
    .sort((left, right) => right.captured_at.localeCompare(left.captured_at));
}

function defaultPersistedState(): PersistedState {
  return {
    selected_profile_id: null,
    profiles: [],
    snapshots: [],
    timeline_events: [],
    settings: defaultSettings(),
  };
}

function pruneByRetention(state: PersistedState, now: Date): PersistedState {
  const snapshotLimit = state.settings.snapshot_limit;
  const timelineLimit = state.settings.timeline_limit;
  const retentionMs = state.settings.timeline_days * 24 * 60 * 60 * 1000;
  const oldestAllowed = now.getTime() - retentionMs;

  const prunedSnapshots = state.snapshots.slice(0, snapshotLimit);
  const prunedTimeline = state.timeline_events
    .filter((event) => {
      const parsed = Date.parse(event.captured_at);
      return Number.isFinite(parsed) && parsed >= oldestAllowed;
    })
    .slice(0, timelineLimit);

  return {
    ...state,
    snapshots: prunedSnapshots,
    timeline_events: prunedTimeline,
  };
}

function normalizePersistedState(raw: Partial<PersistedState>): PersistedState {
  const selectedProfileId =
    typeof raw.selected_profile_id === "string"
      ? raw.selected_profile_id
      : null;
  const profiles = Array.isArray(raw.profiles)
    ? (raw.profiles as StoredProfile[])
    : [];
  const snapshots = Array.isArray(raw.snapshots)
    ? (raw.snapshots as StoredSnapshot[])
    : [];
  const settings = normalizeSettings(raw.settings);
  const timelineEvents = parseTimelineEvents(raw.timeline_events);

  return pruneByRetention(
    {
      selected_profile_id: selectedProfileId,
      profiles,
      snapshots,
      timeline_events: timelineEvents,
      settings,
    },
    new Date(),
  );
}

export function createLocalStorageStorage(
  backing: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): DockAuditStorage {
  return {
    load(): PersistedState {
      const raw =
        backing.getItem(STORAGE_KEY) ?? backing.getItem(LEGACY_STORAGE_KEY);
      if (raw === null) {
        return defaultPersistedState();
      }
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        return normalizePersistedState(parsed);
      } catch {
        return defaultPersistedState();
      }
    },
    save(state: PersistedState): void {
      backing.setItem(STORAGE_KEY, JSON.stringify(state));
    },
  };
}

export function createMemoryStorage(
  seed?: Partial<PersistedState>,
): DockAuditStorage {
  const normalizedSeed = normalizePersistedState(
    seed ?? defaultPersistedState(),
  );
  let state: PersistedState = {
    ...defaultPersistedState(),
    ...normalizedSeed,
    profiles: clone(normalizedSeed.profiles),
    snapshots: clone(normalizedSeed.snapshots),
    timeline_events: clone(normalizedSeed.timeline_events),
    settings: clone(normalizedSeed.settings),
  };

  return {
    load(): PersistedState {
      return clone(state);
    },
    save(nextState: PersistedState): void {
      state = clone(nextState);
    },
  };
}

function normalizeScanHealth(
  raw: InventoryReport["scan_health"],
): Record<DeviceClass, ScanHealth> {
  return {
    usb: raw.usb ?? "unsupported",
    display: raw.display ?? "unsupported",
    audio_input: raw.audio_input ?? "unsupported",
    audio_output: raw.audio_output ?? "unsupported",
    network: raw.network ?? "unsupported",
  };
}

function classesWithIncompleteScan(
  health: Record<DeviceClass, ScanHealth>,
): DeviceClass[] {
  return ALL_CLASSES.filter(
    (deviceClass) => health[deviceClass] !== "complete",
  );
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function humanizeClass(deviceClass: DeviceClass): string {
  return deviceClass.replace(/_/g, " ");
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) {
    element.className = className;
  }
  return element;
}

function looksSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return [
    "serial",
    "mac",
    "path",
    "username",
    "machine",
    "host",
    "account",
  ].some((needle) => lowered.includes(needle));
}

function looksExportSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return (
    looksSensitiveKey(key) ||
    lowered.includes("identity") ||
    lowered.includes("hash") ||
    lowered.includes("serial") ||
    lowered.includes("guid") ||
    lowered.includes("udid") ||
    lowered.includes("uuid") ||
    lowered.includes("hostname")
  );
}

function looksLikeMacAddress(value: string): boolean {
  return /(?:^|\b)(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}(?:\b|$)/i.test(value);
}

function looksLikeLocalPath(value: string): boolean {
  return (
    /[a-z]:\\(?:[^\\\r\n]+\\?)+/i.test(value) ||
    /\/(?:Users|home|private|var|Volumes)\/[^\s]+/.test(value)
  );
}

function looksLikeHighEntropyIdentifier(value: string): boolean {
  if (value === REDACTED) {
    return false;
  }
  const compact = value.replace(/[^a-z0-9]/gi, "");
  if (compact.length < 16) {
    return false;
  }
  return /[a-z]/i.test(compact) && /\d/.test(compact);
}

function redactStringValue(value: string): string {
  if (value === REDACTED) {
    return REDACTED;
  }
  if (
    looksLikeMacAddress(value) ||
    looksLikeLocalPath(value) ||
    looksLikeHighEntropyIdentifier(value)
  ) {
    return REDACTED;
  }
  return value;
}

function sortForDeterminism(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortForDeterminism(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortForDeterminism(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortForDeterminism(value), null, 2);
}

function redactValue(value: unknown, keyPath: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, keyPath));
  }
  if (typeof value === "string") {
    const lastKey = keyPath[keyPath.length - 1] ?? "";
    if (looksExportSensitiveKey(lastKey)) {
      return REDACTED;
    }
    return redactStringValue(value);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (looksExportSensitiveKey(key)) {
          return [key, REDACTED];
        }
        return [key, redactValue(entry, [...keyPath, key])];
      }),
    );
  }
  return value;
}

export function redactForExport<T>(
  value: T,
  includeIdentifyingFields: boolean,
): T {
  if (includeIdentifyingFields) {
    return clone(value);
  }
  return redactValue(clone(value), []) as T;
}

function sortedStateForExport(state: PersistedState): PersistedState {
  const profiles = [...state.profiles].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const snapshots = [...state.snapshots].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const timelineEvents = [...state.timeline_events].sort((left, right) => {
    const timestamp = left.captured_at.localeCompare(right.captured_at);
    if (timestamp !== 0) {
      return timestamp;
    }
    return left.id.localeCompare(right.id);
  });
  return {
    selected_profile_id: state.selected_profile_id,
    profiles,
    snapshots,
    timeline_events: timelineEvents,
    settings: clone(state.settings),
  };
}

export function createBackupArchive(state: PersistedState): BackupArchive {
  const normalized = sortedStateForExport(state);
  return {
    version: BACKUP_ARCHIVE_VERSION,
    selected_profile_id: normalized.selected_profile_id,
    profiles: normalized.profiles,
    snapshots: normalized.snapshots,
    timeline_events: normalized.timeline_events,
    settings: normalized.settings,
  };
}

export function parseBackupArchive(raw: string): BackupArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Backup JSON is malformed.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Backup JSON must be an object.");
  }

  const candidate = parsed as Partial<BackupArchive>;
  if (candidate.version !== BACKUP_ARCHIVE_VERSION) {
    throw new Error(
      `Unsupported backup version. Expected ${BACKUP_ARCHIVE_VERSION}.`,
    );
  }

  const normalized = normalizePersistedState({
    selected_profile_id:
      typeof candidate.selected_profile_id === "string"
        ? candidate.selected_profile_id
        : null,
    profiles: Array.isArray(candidate.profiles)
      ? (candidate.profiles as StoredProfile[])
      : [],
    snapshots: Array.isArray(candidate.snapshots)
      ? (candidate.snapshots as StoredSnapshot[])
      : [],
    timeline_events: Array.isArray(candidate.timeline_events)
      ? (candidate.timeline_events as TimelineEvent[])
      : [],
    settings:
      candidate.settings && typeof candidate.settings === "object"
        ? (candidate.settings as PersistedSettings)
        : defaultSettings(),
  });

  const profileIds = new Set(normalized.profiles.map((profile) => profile.id));
  if (
    normalized.selected_profile_id !== null &&
    !profileIds.has(normalized.selected_profile_id)
  ) {
    throw new Error(
      "Backup selected_profile_id does not refer to an included profile.",
    );
  }
  if (
    normalized.snapshots.some(
      (snapshot) =>
        !profileIds.has(snapshot.profile_id) || snapshot.id.length === 0,
    )
  ) {
    throw new Error("Backup snapshots reference missing profiles.");
  }

  return {
    version: BACKUP_ARCHIVE_VERSION,
    selected_profile_id: normalized.selected_profile_id,
    profiles: normalized.profiles,
    snapshots: normalized.snapshots,
    timeline_events: normalized.timeline_events,
    settings: normalized.settings,
  };
}

export function previewRestoreConflicts(
  current: PersistedState,
  incoming: BackupArchive,
): RestoreConflictPreview {
  const currentProfileIds = new Set(
    current.profiles.map((profile) => profile.id),
  );
  const incomingProfileIds = new Set(
    incoming.profiles.map((profile) => profile.id),
  );
  const currentSnapshotIds = new Set(
    current.snapshots.map((snapshot) => snapshot.id),
  );

  let profilesOverwritten = 0;
  incomingProfileIds.forEach((id) => {
    if (currentProfileIds.has(id)) {
      profilesOverwritten += 1;
    }
  });

  let snapshotsOverwritten = 0;
  incoming.snapshots.forEach((snapshot) => {
    if (currentSnapshotIds.has(snapshot.id)) {
      snapshotsOverwritten += 1;
    }
  });

  return {
    profiles_overwritten: profilesOverwritten,
    profiles_added: incoming.profiles.length - profilesOverwritten,
    snapshots_overwritten: snapshotsOverwritten,
    snapshots_added: incoming.snapshots.length - snapshotsOverwritten,
    timeline_events_replaced: current.timeline_events.length,
  };
}

function classObservationCounts(
  observations: Observation[],
): Record<DeviceClass, number> {
  const counts: Record<DeviceClass, number> = {
    usb: 0,
    display: 0,
    audio_input: 0,
    audio_output: 0,
    network: 0,
  };
  observations.forEach((observation) => {
    counts[observation.class] += 1;
  });
  return counts;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function createSupportReport(
  state: PersistedState,
  runtime: {
    scanHealth: Record<DeviceClass, ScanHealth>;
    capabilityGaps: CapabilityGap[];
    notice: string;
  },
  includeIdentifyingFields: boolean,
): { payload: unknown; json: string; markdown: string } {
  const deterministicState = sortedStateForExport(state);
  const payloadBase = {
    schema_version: BACKUP_ARCHIVE_VERSION,
    privacy: {
      include_identifying_fields: includeIdentifyingFields,
      default_redaction_token: REDACTED,
      warning:
        "Native observations are capability-aware and not electrical truth. Redaction defaults to enabled.",
    },
    state: deterministicState,
    runtime: {
      scan_health: runtime.scanHealth,
      capability_gaps: runtime.capabilityGaps,
      observation_counts: classObservationCounts(
        deterministicState.snapshots[0]?.report.observations ?? [],
      ),
      notice: runtime.notice,
      baseline_network_statement:
        "Dock Audit baseline scan/check/export/backup flows do not require network or cloud telemetry.",
    },
  };

  const payload = redactForExport(payloadBase, includeIdentifyingFields);
  const json = stableStringify(payload);

  const markdownLines = [
    "# Dock Audit support report",
    "",
    `- Schema version: ${BACKUP_ARCHIVE_VERSION}`,
    `- Identifying fields included: ${includeIdentifyingFields ? "yes" : "no"}`,
    `- Profiles: ${deterministicState.profiles.length}`,
    `- Snapshots: ${deterministicState.snapshots.length}`,
    `- Timeline events: ${deterministicState.timeline_events.length}`,
    "",
    "## Scan health",
    "",
    "| Class | Health |",
    "| --- | --- |",
    ...ALL_CLASSES.map(
      (deviceClass) =>
        `| ${markdownEscape(humanizeClass(deviceClass))} | ${markdownEscape(runtime.scanHealth[deviceClass])} |`,
    ),
    "",
    "## Capability gaps",
    "",
    runtime.capabilityGaps.length === 0
      ? "None."
      : runtime.capabilityGaps
          .map(
            (gap) =>
              `- ${humanizeClass(gap.class)} / ${gap.capability}: ${gap.message}`,
          )
          .join("\n"),
    "",
    "## Full field preview (deterministic JSON)",
    "",
    "```json",
    json,
    "```",
  ];

  return {
    payload,
    json,
    markdown: markdownLines.join("\n"),
  };
}

function expectationFromObservation(
  observation: Observation,
  draft: CaptureDraft,
  index: number,
): ProfileExpectation {
  const expectedFields: Record<string, string> = {};
  for (const [field, normalized] of Object.entries(observation.attributes)) {
    if (normalized.stable && !looksSensitiveKey(field)) {
      expectedFields[field] = normalized.value;
    }
  }

  const identityHashes: Record<string, string> = {};
  for (const [field, value] of Object.entries(observation.identity_hashes)) {
    if (!looksSensitiveKey(field)) {
      identityHashes[field] = value;
    }
  }

  return {
    id: randomId(`expectation-${index}`),
    class: observation.class,
    alias: draft.alias.trim() || observation.label,
    required: draft.required,
    expected_fields: expectedFields,
    identity_hashes: identityHashes,
    friendly_name: observation.label,
  };
}

function stableSignalSummary(
  expectation: ProfileExpectation | undefined,
): string {
  if (!expectation) {
    return "No profile expectation context.";
  }
  const signals = Object.keys(expectation.identity_hashes);
  if (signals.length === 0) {
    return "No stable identity signal approved; comparison relied on friendly names and class.";
  }
  return `Stable identity signal keys: ${signals.join(", ")} (hashed values hidden by default).`;
}

function keyByExpectationId(profile: Profile): Map<string, ProfileExpectation> {
  return new Map(
    profile.expectations.map((expectation) => [expectation.id, expectation]),
  );
}

export function compareProfileFallback(
  profile: Profile,
  report: InventoryReport,
): ComparisonResult {
  const observations = report.observations;
  const health = normalizeScanHealth(report.scan_health);
  const used = observations.map(() => false);
  const matches: MatchExplanation[] = [];
  const expectations = [...profile.expectations].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  for (const expected of expectations) {
    const candidates = observations
      .map((observed, index) => ({ observed, index }))
      .filter(({ observed, index }) => {
        if (used[index] || observed.class !== expected.class) {
          return false;
        }
        return Object.entries(expected.identity_hashes).some(
          ([key, value]) => observed.identity_hashes[key] === value,
        );
      })
      .map(({ index }) => index);

    if (candidates.length === 1) {
      const [index] = candidates;
      if (index === undefined) {
        continue;
      }
      used[index] = true;
      const changedFields = Object.entries(expected.expected_fields)
        .filter(([field, expectedValue]) => {
          return (
            observations[index]?.attributes[field]?.value !== expectedValue
          );
        })
        .map(([field]) => field);
      const changed = changedFields.length > 0;
      matches.push({
        kind: changed ? "changed" : "exact",
        reason: changed
          ? `A stable local identity hash matched, but expected fields changed or were unavailable: ${changedFields.join(", ")}.`
          : "A stable local identity hash matched.",
        expectation_id: expected.id,
        observation_index: index,
      });
      continue;
    }

    if (candidates.length > 1) {
      matches.push({
        kind: "ambiguous",
        reason: "More than one observation shared a stable identity signal.",
        expectation_id: expected.id,
        observation_index: null,
      });
      continue;
    }

    const friendlyNameMatches = observations
      .map((observed, index) => ({ observed, index }))
      .filter(({ observed, index }) => {
        return (
          !used[index] &&
          observed.class === expected.class &&
          expected.friendly_name !== null &&
          observed.label === expected.friendly_name
        );
      })
      .map(({ index }) => index);

    if (friendlyNameMatches.length === 1) {
      const [index] = friendlyNameMatches;
      if (index === undefined) {
        continue;
      }
      used[index] = true;
      matches.push({
        kind: "fallback",
        reason:
          "Only a friendly-name signal matched; this is not an exact identity match.",
        expectation_id: expected.id,
        observation_index: index,
      });
      continue;
    }

    if (friendlyNameMatches.length > 1) {
      matches.push({
        kind: "ambiguous",
        reason: "More than one observation shared a friendly-name signal.",
        expectation_id: expected.id,
        observation_index: null,
      });
      continue;
    }

    const classHealth = health[expected.class];
    if (
      classHealth === "failed" ||
      classHealth === "partial" ||
      classHealth === "unsupported"
    ) {
      matches.push({
        kind: "unknown",
        reason:
          "This device class was not scanned completely, so absence is unknown.",
        expectation_id: expected.id,
        observation_index: null,
      });
      continue;
    }

    matches.push({
      kind: "missing",
      reason: "No matching observation was found in a complete scan.",
      expectation_id: expected.id,
      observation_index: null,
    });
  }

  observations.forEach((observation, index) => {
    if (!used[index]) {
      matches.push({
        kind: "unexpected",
        reason: `Unexpected ${observation.class} observation.`,
        expectation_id: null,
        observation_index: index,
      });
    }
  });

  return { matches };
}

function compareKindToGroup(kind: MatchKind): ResultGroupKey {
  switch (kind) {
    case "exact":
    case "fallback":
      return "present";
    case "missing":
      return "missing";
    case "unexpected":
      return "unexpected";
    case "changed":
      return "changed";
    case "ambiguous":
      return "ambiguous";
    case "unknown":
      return "unknown";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function groupComparisonResult(
  profile: Profile,
  report: InventoryReport,
  comparison: ComparisonResult,
): GroupedResult {
  const expectationById = keyByExpectationId(profile);
  const health = normalizeScanHealth(report.scan_health);
  const groups: Record<ResultGroupKey, ResultItem[]> = {
    present: [],
    missing: [],
    unexpected: [],
    changed: [],
    ambiguous: [],
    unknown: [],
  };

  for (const match of comparison.matches) {
    const expectation =
      match.expectation_id !== null
        ? expectationById.get(match.expectation_id)
        : undefined;
    const observation =
      match.observation_index === null
        ? undefined
        : report.observations[match.observation_index];

    const targetClass = expectation?.class ?? observation?.class ?? "usb";

    let kind = match.kind;
    let reason = match.reason;
    if (kind === "missing" && health[targetClass] !== "complete") {
      kind = "unknown";
      reason =
        "This class has incomplete scan health, so Dock Audit blocks missing-device conclusions and records unknown instead.";
    }

    const item: ResultItem = {
      title:
        expectation?.alias ?? observation?.label ?? "Unlabeled observation",
      class: targetClass,
      kind,
      reason,
      identitySignals:
        kind === "unexpected"
          ? "No expectation matched this observation."
          : stableSignalSummary(expectation),
      required: expectation ? expectation.required : null,
    };

    groups[compareKindToGroup(kind)].push(item);
  }

  return {
    report,
    comparison,
    groups,
  };
}

function createSnapshot(
  profile: StoredProfile,
  report: InventoryReport,
  comparison: ComparisonResult,
  now: () => Date,
): StoredSnapshot {
  return {
    id: randomId("snapshot"),
    profile_id: profile.id,
    profile_version: profile.version,
    profile_view: {
      name: profile.name,
      expectations: profile.expectations.map((expectation) => ({
        alias: expectation.alias,
        class: expectation.class,
        required: expectation.required,
      })),
    },
    captured_at: now().toISOString(),
    report: clone(report),
    comparison: clone(comparison),
  };
}

function summaryLine(result: GroupedResult): string {
  const requiredMissing = result.groups.missing.filter(
    (item) => item.required === true,
  ).length;
  return [
    `Present ${result.groups.present.length}`,
    `Changed ${result.groups.changed.length}`,
    `Missing ${result.groups.missing.length} (${requiredMissing} required)`,
    `Unexpected ${result.groups.unexpected.length}`,
    `Ambiguous ${result.groups.ambiguous.length}`,
    `Unknown ${result.groups.unknown.length}`,
  ].join(" · ");
}

function baseInventoryNotice(
  state: State,
  health: Record<DeviceClass, ScanHealth>,
): string {
  if (state.inventoryError) {
    return state.inventoryError;
  }
  const incomplete = classesWithIncompleteScan(health);
  if (incomplete.length === 0 && state.capabilityGaps.length === 0) {
    return "Read-only inventory completed with complete class health. Native observations are capability-aware and not electrical truth.";
  }
  const blocked = incomplete.map(humanizeClass).join(", ");
  return `Read-only inventory completed with limitations. Classes with incomplete scan health: ${blocked}. Missing-device conclusions are blocked for these classes.`;
}

export function createDockAuditApp(
  root: HTMLElement,
  dependencies: DockAuditAppDependencies,
): DockAuditApp {
  const backend = dependencies.backend;
  const storage = dependencies.storage ?? createLocalStorageStorage();
  const now = dependencies.now ?? (() => new Date());
  const progressIntervalMs = dependencies.progressIntervalMs ?? 150;

  const persisted = pruneByRetention(storage.load(), now());
  const state: State = {
    profileNameDraft: "",
    captureDrafts: [],
    profiles: persisted.profiles,
    selectedProfileId: persisted.selected_profile_id,
    profileEditDraft: null,
    snapshots: persisted.snapshots,
    timelineEvents: persisted.timeline_events,
    settings: persisted.settings,
    observations: [],
    scanHealth: clone(bootstrapScanHealth),
    capabilityGaps: [],
    loadingInventory: false,
    inventoryError: null,
    runningCheck: false,
    checkProgress: 0,
    checkStatus: "",
    result: null,
    notice: "",
    includeIdentifyingExportFields: false,
    exportPreviewJson: "",
    exportPreviewMarkdown: "",
    restoreDraft: "",
    restorePreview: null,
  };

  if (
    state.selectedProfileId !== null &&
    !state.profiles.some((profile) => profile.id === state.selectedProfileId)
  ) {
    state.selectedProfileId = null;
  }
  if (state.selectedProfileId === null && state.profiles.length > 0) {
    state.selectedProfileId = state.profiles[0]?.id ?? null;
  }

  let activeCheckId = 0;
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;
  let idlePromise: Promise<void> = Promise.resolve();

  function setProfileEditDraftFromSelection(): void {
    const selected = state.profiles.find(
      (profile) => profile.id === state.selectedProfileId,
    );
    state.profileEditDraft = selected ? clone(selected) : null;
  }

  setProfileEditDraftFromSelection();

  function currentPersistedState(): PersistedState {
    return {
      selected_profile_id: state.selectedProfileId,
      profiles: state.profiles,
      snapshots: state.snapshots,
      timeline_events: state.timelineEvents,
      settings: state.settings,
    };
  }

  function applyRetentionToLiveState(): void {
    const pruned = pruneByRetention(currentPersistedState(), now());
    state.snapshots = pruned.snapshots;
    state.timelineEvents = pruned.timeline_events;
    state.settings = pruned.settings;
  }

  function persistState(): void {
    applyRetentionToLiveState();
    storage.save(currentPersistedState());
  }

  function addTimelineEvent(
    category: TimelineEvent["category"],
    message: string,
    details: Record<string, string> = {},
  ): void {
    if (!state.settings.timeline_capture_enabled) {
      return;
    }
    const event: TimelineEvent = {
      id: randomId("timeline"),
      captured_at: now().toISOString(),
      category,
      message,
      details,
    };
    state.timelineEvents.unshift(event);
    applyRetentionToLiveState();
  }

  function captureClassDeltaTimeline(
    previousObservations: Observation[],
    nextObservations: Observation[],
  ): void {
    if (!state.settings.timeline_capture_enabled) {
      return;
    }

    const before = classObservationCounts(previousObservations);
    const after = classObservationCounts(nextObservations);
    ALL_CLASSES.forEach((deviceClass) => {
      const delta = after[deviceClass] - before[deviceClass];
      if (delta === 0) {
        return;
      }
      addTimelineEvent(
        "class_delta",
        `${humanizeClass(deviceClass)} count changed by ${delta > 0 ? "+" : ""}${delta}.`,
        {
          class: deviceClass,
          previous_count: String(before[deviceClass]),
          current_count: String(after[deviceClass]),
        },
      );
    });
  }

  function rebuildExportPreviews(): void {
    const exportState = currentPersistedState();
    const report = createSupportReport(
      exportState,
      {
        scanHealth: state.scanHealth,
        capabilityGaps: state.capabilityGaps,
        notice: state.notice,
      },
      state.includeIdentifyingExportFields,
    );
    state.exportPreviewJson = report.json;
    state.exportPreviewMarkdown = report.markdown;
  }

  function downloadTextFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function applyBackupArchive(archive: BackupArchive): void {
    const nextState: PersistedState = pruneByRetention(
      {
        selected_profile_id: archive.selected_profile_id,
        profiles: clone(archive.profiles),
        snapshots: clone(archive.snapshots),
        timeline_events: clone(archive.timeline_events),
        settings: clone(archive.settings),
      },
      now(),
    );

    state.selectedProfileId = nextState.selected_profile_id;
    state.profiles = nextState.profiles;
    state.snapshots = nextState.snapshots;
    state.timelineEvents = nextState.timeline_events;
    state.settings = nextState.settings;
    setProfileEditDraftFromSelection();
    persistState();
  }

  function render(): void {
    if (destroyed) {
      return;
    }

    root.className = "app-shell";
    root.replaceChildren();

    const card = document.createElement("main");
    card.className = "status-card";
    card.setAttribute("aria-labelledby", "app-title");

    card.append(textElement("p", "Local-first desk checks", "eyebrow"));
    const title = textElement("h1", "Dock Audit", "app-title");
    title.id = "app-title";
    card.append(title);

    card.append(
      textElement(
        "p",
        "Capture expected desk devices, then run a conservative check that explains present, missing, changed, ambiguous, unexpected, and unknown outcomes.",
        "lede",
      ),
    );

    const status = textElement("div", "", "notice");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.append(textElement("span", "!", "notice__icon"));
    const statusCopy = document.createElement("div");
    statusCopy.append(textElement("strong", "Inventory status"));
    statusCopy.append(
      textElement("p", baseInventoryNotice(state, state.scanHealth)),
    );
    status.append(statusCopy);
    card.append(status);

    const healthSection = document.createElement("section");
    healthSection.className = "scan-health-section";
    healthSection.append(textElement("h2", "Scan health by class"));
    const healthList = document.createElement("ul");
    healthList.className = "scan-health";
    ALL_CLASSES.forEach((deviceClass) => {
      healthList.append(
        textElement(
          "li",
          `${humanizeClass(deviceClass)}: ${state.scanHealth[deviceClass]}`,
        ),
      );
    });
    healthSection.append(healthList);
    card.append(healthSection);

    if (state.capabilityGaps.length > 0) {
      const gaps = document.createElement("section");
      gaps.className = "capability-gaps";
      gaps.append(textElement("h2", "Capability gaps"));
      const list = document.createElement("ul");
      state.capabilityGaps.forEach((gap) => {
        list.append(
          textElement(
            "li",
            `${humanizeClass(gap.class)} / ${gap.capability}: ${gap.message}`,
          ),
        );
      });
      gaps.append(list);
      card.append(gaps);
    }

    const captureSection = document.createElement("section");
    captureSection.className = "workflow-section";
    captureSection.append(
      textElement("h2", "1) Capture observations and save a profile"),
    );

    const captureForm = document.createElement("form");
    captureForm.className = "profile-form";

    const nameLabel = textElement("label", "Profile name", "field-label");
    nameLabel.setAttribute("for", "profile-name");
    const nameInput = document.createElement("input");
    nameInput.id = "profile-name";
    nameInput.name = "profile-name";
    nameInput.className = "text-input";
    nameInput.value = state.profileNameDraft;
    nameInput.placeholder = "Home desk";
    nameInput.required = true;
    nameInput.addEventListener("input", () => {
      state.profileNameDraft = nameInput.value;
    });

    const inventoryActions = document.createElement("div");
    inventoryActions.className = "inline-actions";

    const rescanButton = textElement(
      "button",
      "Re-scan inventory",
      "secondary-button",
    );
    rescanButton.type = "button";
    rescanButton.disabled = state.loadingInventory;
    rescanButton.addEventListener("click", () => {
      void refreshInventory();
    });

    const saveProfileButton = textElement(
      "button",
      "Save profile",
      "primary-button",
    );
    saveProfileButton.type = "submit";
    saveProfileButton.disabled = state.loadingInventory;

    inventoryActions.append(rescanButton, saveProfileButton);

    const observationFieldset = document.createElement("fieldset");
    observationFieldset.className = "observation-list";
    observationFieldset.disabled = state.loadingInventory;
    const legend = textElement("legend", "Observed devices (sanitized)");
    observationFieldset.append(legend);

    if (state.loadingInventory) {
      observationFieldset.append(textElement("p", "Scanning inventory…"));
    } else if (state.observations.length === 0) {
      observationFieldset.append(
        textElement(
          "p",
          "No observations are currently available on this host. You can still inspect scan health and capability gaps.",
        ),
      );
    } else {
      state.observations.forEach((observation, index) => {
        const draft = state.captureDrafts[index];
        if (!draft) {
          return;
        }

        const row = document.createElement("div");
        row.className = "observation-item";

        const selectWrap = document.createElement("div");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = `select-observation-${index}`;
        checkbox.checked = draft.selected;
        checkbox.addEventListener("change", () => {
          draft.selected = checkbox.checked;
          render();
        });

        const rowLabel = textElement(
          "label",
          `${observation.label} (${humanizeClass(observation.class)})`,
        );
        rowLabel.setAttribute("for", checkbox.id);
        selectWrap.append(checkbox, rowLabel);

        const aliasLabel = textElement("label", "Alias", "field-label");
        aliasLabel.setAttribute("for", `alias-${index}`);
        const aliasInput = document.createElement("input");
        aliasInput.id = `alias-${index}`;
        aliasInput.className = "text-input";
        aliasInput.value = draft.alias;
        aliasInput.disabled = !draft.selected;
        aliasInput.addEventListener("input", () => {
          draft.alias = aliasInput.value;
        });

        const requiredWrap = document.createElement("label");
        requiredWrap.className = "checkbox-label";
        const requiredInput = document.createElement("input");
        requiredInput.type = "checkbox";
        requiredInput.checked = draft.required;
        requiredInput.disabled = !draft.selected;
        requiredInput.addEventListener("change", () => {
          draft.required = requiredInput.checked;
        });
        requiredWrap.append(
          requiredInput,
          document.createTextNode("Required expectation"),
        );

        const identityKeys = Object.keys(observation.identity_hashes);
        const identitySummary =
          identityKeys.length > 0
            ? `Stable identity signal keys: ${identityKeys.join(", ")} (values hidden).`
            : "No stable identity hash was available for this observation.";

        row.append(
          selectWrap,
          aliasLabel,
          aliasInput,
          requiredWrap,
          textElement("p", identitySummary, "subtle"),
        );
        observationFieldset.append(row);
      });
    }

    captureForm.append(
      nameLabel,
      nameInput,
      inventoryActions,
      observationFieldset,
    );
    captureForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const profileName = state.profileNameDraft.trim();
      if (profileName.length === 0) {
        state.notice = "Profile name is required before saving.";
        render();
        return;
      }

      const expectations = state.captureDrafts
        .map((draft, index) => ({ draft, index }))
        .filter((entry) => entry.draft.selected)
        .map(({ draft, index }) => {
          const observation = state.observations[index];
          if (!observation) {
            return null;
          }
          return expectationFromObservation(observation, draft, index);
        })
        .filter(
          (expectation): expectation is ProfileExpectation =>
            expectation !== null,
        );

      if (expectations.length === 0) {
        state.notice = "Select at least one observed device to save a profile.";
        render();
        return;
      }

      const profile: StoredProfile = {
        id: randomId("profile"),
        name: profileName,
        expectations,
        version: 1,
        updated_at: now().toISOString(),
      };

      state.profiles.unshift(profile);
      state.selectedProfileId = profile.id;
      state.profileNameDraft = "";
      addTimelineEvent(
        "operator",
        "Saved profile from captured observations.",
        {
          profile_id: profile.id,
          expectation_count: String(profile.expectations.length),
        },
      );
      state.notice = `Saved profile “${profile.name}” with ${profile.expectations.length} expectations.`;
      setProfileEditDraftFromSelection();
      persistState();
      rebuildExportPreviews();
      render();
    });

    captureSection.append(captureForm);
    card.append(captureSection);

    const manageSection = document.createElement("section");
    manageSection.className = "workflow-section";
    manageSection.append(
      textElement("h2", "2) Review, edit, and delete profiles"),
    );

    if (state.profiles.length === 0) {
      manageSection.append(
        textElement(
          "p",
          "No saved profiles yet. Capture observations and save one above.",
        ),
      );
    } else {
      const chooserLabel = textElement(
        "label",
        "Selected profile",
        "field-label",
      );
      chooserLabel.setAttribute("for", "profile-chooser");
      const chooser = document.createElement("select");
      chooser.id = "profile-chooser";
      chooser.className = "text-input";
      state.profiles.forEach((profile) => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = `${profile.name} (v${profile.version})`;
        if (profile.id === state.selectedProfileId) {
          option.selected = true;
        }
        chooser.append(option);
      });
      chooser.addEventListener("change", () => {
        state.selectedProfileId = chooser.value;
        setProfileEditDraftFromSelection();
        persistState();
        render();
      });

      manageSection.append(chooserLabel, chooser);

      const draft = state.profileEditDraft;
      if (draft) {
        const editNameLabel = textElement(
          "label",
          "Profile display name",
          "field-label",
        );
        editNameLabel.setAttribute("for", "profile-edit-name");
        const editNameInput = document.createElement("input");
        editNameInput.id = "profile-edit-name";
        editNameInput.className = "text-input";
        editNameInput.value = draft.name;
        editNameInput.addEventListener("input", () => {
          draft.name = editNameInput.value;
        });

        manageSection.append(editNameLabel, editNameInput);

        const expectationList = document.createElement("ul");
        expectationList.className = "expectation-list";
        draft.expectations.forEach((expectation, index) => {
          const item = document.createElement("li");
          item.className = "expectation-item";

          const aliasLabel = textElement("label", "Alias", "field-label");
          aliasLabel.setAttribute("for", `edit-alias-${index}`);

          const aliasInput = document.createElement("input");
          aliasInput.id = `edit-alias-${index}`;
          aliasInput.className = "text-input";
          aliasInput.value = expectation.alias;
          aliasInput.addEventListener("input", () => {
            expectation.alias = aliasInput.value;
          });

          const requiredLabel = document.createElement("label");
          requiredLabel.className = "checkbox-label";
          const requiredInput = document.createElement("input");
          requiredInput.type = "checkbox";
          requiredInput.checked = expectation.required;
          requiredInput.addEventListener("change", () => {
            expectation.required = requiredInput.checked;
          });
          requiredLabel.append(
            requiredInput,
            document.createTextNode("Required"),
          );

          item.append(
            textElement(
              "strong",
              `${humanizeClass(expectation.class)} expectation`,
            ),
            aliasLabel,
            aliasInput,
            requiredLabel,
            textElement("p", stableSignalSummary(expectation), "subtle"),
          );
          expectationList.append(item);
        });

        const profileActions = document.createElement("div");
        profileActions.className = "inline-actions";

        const saveEdits = textElement(
          "button",
          "Save profile edits",
          "secondary-button",
        );
        saveEdits.type = "button";
        saveEdits.addEventListener("click", () => {
          const index = state.profiles.findIndex(
            (profile) => profile.id === draft.id,
          );
          if (index < 0) {
            return;
          }
          const next = clone(draft);
          next.name =
            next.name.trim() ||
            state.profiles[index]?.name ||
            "Unnamed profile";
          next.version = (state.profiles[index]?.version ?? 0) + 1;
          next.updated_at = now().toISOString();
          state.profiles[index] = next;
          addTimelineEvent("operator", "Saved profile edits.", {
            profile_id: next.id,
            profile_version: String(next.version),
          });
          state.notice =
            "Saved profile edits. Historical snapshots keep the profile version captured at check time.";
          setProfileEditDraftFromSelection();
          persistState();
          rebuildExportPreviews();
          render();
        });

        const deleteProfile = textElement(
          "button",
          "Delete selected profile",
          "danger-button",
        );
        deleteProfile.type = "button";
        deleteProfile.addEventListener("click", () => {
          const deleting = state.selectedProfileId;
          if (!deleting) {
            return;
          }
          state.profiles = state.profiles.filter(
            (profile) => profile.id !== deleting,
          );
          state.snapshots = state.snapshots.filter(
            (snapshot) => snapshot.profile_id !== deleting,
          );
          state.selectedProfileId = state.profiles[0]?.id ?? null;
          setProfileEditDraftFromSelection();
          addTimelineEvent(
            "operator",
            "Deleted profile and linked snapshots.",
            {
              profile_id: deleting,
            },
          );
          state.notice =
            "Deleted selected profile and removed linked snapshots from local history.";
          persistState();
          rebuildExportPreviews();
          render();
        });

        profileActions.append(saveEdits, deleteProfile);
        manageSection.append(expectationList, profileActions);
      }
    }

    card.append(manageSection);

    const checkSection = document.createElement("section");
    checkSection.className = "workflow-section";
    checkSection.append(textElement("h2", "3) Check desk"));

    const checkActions = document.createElement("div");
    checkActions.className = "inline-actions";

    const checkButton = textElement("button", "Check desk", "primary-button");
    checkButton.type = "button";
    checkButton.disabled =
      state.selectedProfileId === null || state.runningCheck;
    checkButton.addEventListener("click", () => {
      void runDeskCheck();
    });

    const cancelButton = textElement(
      "button",
      "Cancel check",
      "secondary-button",
    );
    cancelButton.type = "button";
    cancelButton.disabled = !state.runningCheck;
    cancelButton.addEventListener("click", () => {
      cancelDeskCheck();
    });

    checkActions.append(checkButton, cancelButton);
    checkSection.append(checkActions);

    if (state.runningCheck || state.checkStatus) {
      const progressBlock = document.createElement("div");
      progressBlock.className = "progress-block";
      const progress = document.createElement("progress");
      progress.max = 100;
      progress.value = state.checkProgress;
      progressBlock.append(
        progress,
        textElement("p", state.checkStatus, "subtle"),
      );
      checkSection.append(progressBlock);
    }

    if (state.result) {
      const result = state.result;
      checkSection.append(textElement("h3", "Latest check result"));
      checkSection.append(
        textElement("p", summaryLine(result), "summary-line"),
      );

      const incomplete = classesWithIncompleteScan(
        normalizeScanHealth(result.report.scan_health),
      );
      if (incomplete.length > 0) {
        checkSection.append(
          textElement(
            "p",
            `Missing-device conclusions are blocked for: ${incomplete
              .map(humanizeClass)
              .join(", ")}.`,
            "subtle",
          ),
        );
      }

      const orderedGroups: ResultGroupKey[] = [
        "present",
        "changed",
        "missing",
        "unexpected",
        "ambiguous",
        "unknown",
      ];

      orderedGroups.forEach((groupKey) => {
        const entries = result.groups[groupKey];
        const headerText = `${groupKey.charAt(0).toUpperCase()}${groupKey.slice(1)} (${entries.length})`;
        const section = document.createElement("section");
        section.className = "result-group";
        section.append(textElement("h4", headerText));

        if (entries.length === 0) {
          section.append(textElement("p", "None."));
        } else {
          const list = document.createElement("ul");
          entries.forEach((item) => {
            const li = document.createElement("li");
            li.className = "result-item";
            li.append(
              textElement(
                "strong",
                `${item.title} (${humanizeClass(item.class)})${
                  item.required === false ? " (optional)" : ""
                }`,
              ),
            );
            li.append(textElement("p", `Reason: ${item.reason}`));
            li.append(textElement("p", item.identitySignals, "subtle"));
            list.append(li);
          });
          section.append(list);
        }

        checkSection.append(section);
      });
    }

    card.append(checkSection);

    const snapshotSection = document.createElement("section");
    snapshotSection.className = "workflow-section";
    snapshotSection.append(
      textElement(
        "h2",
        `4) Snapshots and retention (${state.snapshots.length})`,
      ),
    );

    const retentionGrid = document.createElement("div");
    retentionGrid.className = "retention-grid";

    const snapshotRetentionLabel = textElement(
      "label",
      "Snapshot retention limit",
      "field-label",
    );
    snapshotRetentionLabel.setAttribute("for", "snapshot-retention-limit");
    const snapshotRetentionInput = document.createElement("input");
    snapshotRetentionInput.id = "snapshot-retention-limit";
    snapshotRetentionInput.className = "text-input compact-input";
    snapshotRetentionInput.type = "number";
    snapshotRetentionInput.min = "1";
    snapshotRetentionInput.max = "200";
    snapshotRetentionInput.value = String(state.settings.snapshot_limit);

    const timelineRetentionLabel = textElement(
      "label",
      "Timeline event limit",
      "field-label",
    );
    timelineRetentionLabel.setAttribute("for", "timeline-retention-limit");
    const timelineRetentionInput = document.createElement("input");
    timelineRetentionInput.id = "timeline-retention-limit";
    timelineRetentionInput.className = "text-input compact-input";
    timelineRetentionInput.type = "number";
    timelineRetentionInput.min = "1";
    timelineRetentionInput.max = "2000";
    timelineRetentionInput.value = String(state.settings.timeline_limit);

    const timelineDaysLabel = textElement(
      "label",
      "Timeline retention days",
      "field-label",
    );
    timelineDaysLabel.setAttribute("for", "timeline-retention-days");
    const timelineDaysInput = document.createElement("input");
    timelineDaysInput.id = "timeline-retention-days";
    timelineDaysInput.className = "text-input compact-input";
    timelineDaysInput.type = "number";
    timelineDaysInput.min = "1";
    timelineDaysInput.max = "365";
    timelineDaysInput.value = String(state.settings.timeline_days);

    const saveRetentionButton = textElement(
      "button",
      "Save retention settings",
      "secondary-button",
    );
    saveRetentionButton.type = "button";
    saveRetentionButton.addEventListener("click", () => {
      state.settings = normalizeSettings({
        ...state.settings,
        snapshot_limit: Number(snapshotRetentionInput.value),
        timeline_limit: Number(timelineRetentionInput.value),
        timeline_days: Number(timelineDaysInput.value),
      });
      addTimelineEvent("operator", "Retention settings updated.", {
        snapshot_limit: String(state.settings.snapshot_limit),
        timeline_limit: String(state.settings.timeline_limit),
        timeline_days: String(state.settings.timeline_days),
      });
      state.notice =
        "Saved retention settings. Future snapshots and timeline events are pruned deterministically.";
      persistState();
      rebuildExportPreviews();
      render();
    });

    retentionGrid.append(
      snapshotRetentionLabel,
      snapshotRetentionInput,
      timelineRetentionLabel,
      timelineRetentionInput,
      timelineDaysLabel,
      timelineDaysInput,
      saveRetentionButton,
    );
    snapshotSection.append(
      textElement(
        "p",
        "Configure local retention and use targeted deletion controls below.",
        "subtle",
      ),
      retentionGrid,
    );

    if (state.snapshots.length === 0) {
      snapshotSection.append(
        textElement(
          "p",
          "No snapshots yet. Run Check desk to save a historical comparison snapshot.",
        ),
      );
    } else {
      const list = document.createElement("ul");
      list.className = "snapshot-list";
      state.snapshots.forEach((snapshot) => {
        const item = document.createElement("li");
        item.className = "snapshot-item";
        const deleteSnapshotButton = textElement(
          "button",
          "Delete snapshot",
          "danger-button",
        );
        deleteSnapshotButton.type = "button";
        deleteSnapshotButton.setAttribute(
          "aria-label",
          `Delete snapshot ${snapshot.id}`,
        );
        deleteSnapshotButton.addEventListener("click", () => {
          state.snapshots = state.snapshots.filter(
            (entry) => entry.id !== snapshot.id,
          );
          state.notice = "Deleted snapshot from local history.";
          persistState();
          rebuildExportPreviews();
          render();
        });

        item.append(
          textElement(
            "strong",
            `${snapshot.profile_view.name} (version ${snapshot.profile_version}) · ${new Date(snapshot.captured_at).toLocaleString()}`,
          ),
          textElement(
            "p",
            `Expectations at capture: ${snapshot.profile_view.expectations
              .map(
                (expectation) =>
                  `${expectation.alias} (${humanizeClass(expectation.class)}${
                    expectation.required ? ", required" : ", optional"
                  })`,
              )
              .join("; ")}`,
          ),
          deleteSnapshotButton,
        );
        list.append(item);
      });
      snapshotSection.append(list);
    }

    card.append(snapshotSection);

    const timelineSection = document.createElement("section");
    timelineSection.className = "workflow-section";
    timelineSection.append(
      textElement("h2", "5) Private app-session timeline"),
    );

    const timelineState = state.settings.timeline_capture_enabled
      ? "Recording enabled"
      : "Recording disabled";
    timelineSection.append(
      textElement(
        "p",
        `${timelineState}. Events are captured only while the app is open and capture is enabled.`,
        "subtle",
      ),
    );

    const timelineActions = document.createElement("div");
    timelineActions.className = "inline-actions";

    const toggleTimeline = textElement(
      "button",
      state.settings.timeline_capture_enabled
        ? "Disable timeline capture"
        : "Enable timeline capture",
      "secondary-button",
    );
    toggleTimeline.type = "button";
    toggleTimeline.addEventListener("click", () => {
      state.settings.timeline_capture_enabled =
        !state.settings.timeline_capture_enabled;
      if (state.settings.timeline_capture_enabled) {
        addTimelineEvent("operator", "Timeline capture enabled by user.");
      }
      state.notice = state.settings.timeline_capture_enabled
        ? "Timeline capture enabled for this app session."
        : "Timeline capture disabled. Existing timeline remains local.";
      persistState();
      rebuildExportPreviews();
      render();
    });

    const clearTimeline = textElement(
      "button",
      "Delete timeline only",
      "danger-button",
    );
    clearTimeline.type = "button";
    clearTimeline.addEventListener("click", () => {
      state.timelineEvents = [];
      state.notice =
        "Cleared timeline events. Profiles and snapshots were preserved.";
      persistState();
      rebuildExportPreviews();
      render();
    });

    timelineActions.append(toggleTimeline, clearTimeline);
    timelineSection.append(timelineActions);

    if (state.timelineEvents.length === 0) {
      timelineSection.append(
        textElement(
          "p",
          "No timeline events captured in this session yet.",
          "subtle",
        ),
      );
    } else {
      const timelineList = document.createElement("ul");
      timelineList.className = "snapshot-list";
      state.timelineEvents.forEach((event) => {
        const item = document.createElement("li");
        item.className = "snapshot-item";
        const details = Object.entries(event.details)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ");
        item.append(
          textElement(
            "strong",
            `${new Date(event.captured_at).toLocaleString()} · ${event.message}`,
          ),
          textElement(
            "p",
            `Category: ${event.category}${details.length > 0 ? ` · ${details}` : ""}`,
            "subtle",
          ),
        );
        timelineList.append(item);
      });
      timelineSection.append(timelineList);
    }

    card.append(timelineSection);

    rebuildExportPreviews();

    const exportSection = document.createElement("section");
    exportSection.className = "workflow-section";
    exportSection.append(
      textElement("h2", "6) Redacted support export and backup/restore"),
    );

    const includeIdentityLabel = document.createElement("label");
    includeIdentityLabel.className = "checkbox-label";
    const includeIdentityInput = document.createElement("input");
    includeIdentityInput.type = "checkbox";
    includeIdentityInput.checked = state.includeIdentifyingExportFields;
    includeIdentityInput.addEventListener("change", () => {
      state.includeIdentifyingExportFields = includeIdentityInput.checked;
      rebuildExportPreviews();
      render();
    });
    includeIdentityLabel.append(
      includeIdentityInput,
      document.createTextNode(
        "Include potentially re-identifying fields in this export",
      ),
    );

    const exportWarning = state.includeIdentifyingExportFields
      ? "Warning: you enabled potentially identifying fields for this export. Review before sharing."
      : "Default export redacts serials, MAC addresses, machine/user names, local paths, and high-entropy identifiers.";
    exportSection.append(textElement("p", exportWarning, "subtle"));

    const exportActions = document.createElement("div");
    exportActions.className = "inline-actions";

    const downloadJsonButton = textElement(
      "button",
      "Download redacted JSON report",
      "primary-button",
    );
    downloadJsonButton.type = "button";
    downloadJsonButton.addEventListener("click", () => {
      rebuildExportPreviews();
      downloadTextFile(
        "dock-audit-support-report.json",
        state.exportPreviewJson,
      );
      state.notice =
        "Downloaded support JSON report from the local app session.";
      render();
    });

    const downloadMarkdownButton = textElement(
      "button",
      "Download Markdown report",
      "secondary-button",
    );
    downloadMarkdownButton.type = "button";
    downloadMarkdownButton.addEventListener("click", () => {
      rebuildExportPreviews();
      downloadTextFile(
        "dock-audit-support-report.md",
        state.exportPreviewMarkdown,
      );
      state.notice =
        "Downloaded support Markdown report from the local app session.";
      render();
    });

    const downloadBackupButton = textElement(
      "button",
      "Download versioned backup",
      "secondary-button",
    );
    downloadBackupButton.type = "button";
    downloadBackupButton.addEventListener("click", () => {
      const backup = createBackupArchive(currentPersistedState());
      downloadTextFile("dock-audit-backup-v2.json", stableStringify(backup));
      state.notice = "Downloaded versioned local backup archive.";
      render();
    });

    exportActions.append(
      downloadJsonButton,
      downloadMarkdownButton,
      downloadBackupButton,
    );
    exportSection.append(includeIdentityLabel, exportActions);

    const previewLabel = textElement("h3", "Export preview (all fields)");
    const jsonPreview = document.createElement("pre");
    jsonPreview.className = "export-preview";
    jsonPreview.textContent = state.exportPreviewJson;

    const markdownPreview = document.createElement("pre");
    markdownPreview.className = "export-preview";
    markdownPreview.textContent = state.exportPreviewMarkdown;

    exportSection.append(
      previewLabel,
      textElement("h4", "JSON"),
      jsonPreview,
      textElement("h4", "Markdown"),
      markdownPreview,
    );

    const restoreHeading = textElement("h3", "Restore from versioned backup");
    const restoreTextareaLabel = textElement(
      "label",
      "Paste backup JSON",
      "field-label",
    );
    restoreTextareaLabel.setAttribute("for", "restore-backup-json");
    const restoreTextarea = document.createElement("textarea");
    restoreTextarea.id = "restore-backup-json";
    restoreTextarea.className = "text-input restore-input";
    restoreTextarea.value = state.restoreDraft;
    restoreTextarea.addEventListener("input", () => {
      state.restoreDraft = restoreTextarea.value;
    });

    const restoreActions = document.createElement("div");
    restoreActions.className = "inline-actions";

    const previewRestoreButton = textElement(
      "button",
      "Preview restore conflicts",
      "secondary-button",
    );
    previewRestoreButton.type = "button";
    previewRestoreButton.addEventListener("click", () => {
      try {
        const archive = parseBackupArchive(state.restoreDraft);
        state.restorePreview = previewRestoreConflicts(
          currentPersistedState(),
          archive,
        );
        state.notice =
          "Restore preview is ready. Review conflict counts before applying.";
      } catch (error) {
        state.restorePreview = null;
        state.notice =
          error instanceof Error ? error.message : "Restore preview failed.";
      }
      render();
    });

    const applyRestoreButton = textElement(
      "button",
      "Apply restore (atomic)",
      "danger-button",
    );
    applyRestoreButton.type = "button";
    applyRestoreButton.addEventListener("click", () => {
      const before = stableStringify(currentPersistedState());
      try {
        const archive = parseBackupArchive(state.restoreDraft);
        state.restorePreview = previewRestoreConflicts(
          currentPersistedState(),
          archive,
        );
        applyBackupArchive(archive);
        state.notice =
          "Backup restore applied atomically. Local profiles, snapshots, and timeline were replaced in one commit.";
        rebuildExportPreviews();
      } catch (error) {
        const after = stableStringify(currentPersistedState());
        if (before !== after) {
          throw new Error("Atomic restore contract violated in-memory state.");
        }
        state.notice =
          error instanceof Error ? error.message : "Backup restore failed.";
      }
      render();
    });

    const eraseAllButton = textElement(
      "button",
      "Erase all local data",
      "danger-button",
    );
    eraseAllButton.type = "button";
    eraseAllButton.addEventListener("click", () => {
      state.profiles = [];
      state.snapshots = [];
      state.timelineEvents = [];
      state.selectedProfileId = null;
      state.profileEditDraft = null;
      state.result = null;
      state.settings = {
        ...defaultSettings(),
        timeline_capture_enabled: false,
      };
      state.notice =
        "Erased all local profiles, snapshots, and timeline events. Future capture is disabled until re-enabled.";
      persistState();
      rebuildExportPreviews();
      render();
    });

    restoreActions.append(
      previewRestoreButton,
      applyRestoreButton,
      eraseAllButton,
    );
    exportSection.append(
      restoreHeading,
      restoreTextareaLabel,
      restoreTextarea,
      restoreActions,
    );

    if (state.restorePreview) {
      exportSection.append(
        textElement(
          "p",
          `Conflict preview: profiles overwritten ${state.restorePreview.profiles_overwritten}, profiles added ${state.restorePreview.profiles_added}, snapshots overwritten ${state.restorePreview.snapshots_overwritten}, snapshots added ${state.restorePreview.snapshots_added}, current timeline entries replaced ${state.restorePreview.timeline_events_replaced}.`,
          "subtle",
        ),
      );
    }

    card.append(exportSection);

    const noticeLine = textElement("p", state.notice, "privacy-note");
    noticeLine.setAttribute("role", "status");
    noticeLine.setAttribute("aria-live", "polite");
    card.append(noticeLine);

    card.append(
      textElement(
        "p",
        "Inventory uses ordinary-user, read-only native APIs. It does not establish physical/electrical truth and does not send telemetry.",
        "privacy-note",
      ),
    );

    root.append(card);
  }

  function replaceCaptureDraftsFromObservations(): void {
    state.captureDrafts = state.observations.map((observation) => ({
      selected: false,
      alias: observation.label,
      required: true,
    }));
  }

  async function refreshInventory(): Promise<void> {
    const previousObservations = clone(state.observations);
    addTimelineEvent("scan_started", "Inventory scan started.");
    state.loadingInventory = true;
    state.inventoryError = null;
    render();

    try {
      const report = await backend.scanInventory();
      state.observations = clone(report.observations);
      state.scanHealth = normalizeScanHealth(report.scan_health);
      state.capabilityGaps = clone(report.capability_gaps);
      captureClassDeltaTimeline(previousObservations, state.observations);
      addTimelineEvent("scan_completed", "Inventory scan completed.", {
        observation_count: String(state.observations.length),
      });
      replaceCaptureDraftsFromObservations();
      state.notice =
        "Inventory refreshed. Review observations and choose expected devices before saving a profile.";
    } catch {
      state.observations = [];
      state.scanHealth = clone(bootstrapScanHealth);
      state.capabilityGaps = [];
      state.captureDrafts = [];
      state.inventoryError =
        "The native inventory scan did not complete. Dock Audit will not claim missing devices from this failed scan.";
      state.notice = state.inventoryError;
      addTimelineEvent(
        "scan_failed",
        "Inventory scan failed before completion.",
      );
    } finally {
      state.loadingInventory = false;
      persistState();
      rebuildExportPreviews();
      render();
    }
  }

  function selectedProfile(): StoredProfile | null {
    if (state.selectedProfileId === null) {
      return null;
    }
    return (
      state.profiles.find(
        (profile) => profile.id === state.selectedProfileId,
      ) ?? null
    );
  }

  function cancelDeskCheck(): void {
    if (!state.runningCheck) {
      return;
    }
    activeCheckId += 1;
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    state.runningCheck = false;
    state.checkProgress = 0;
    state.checkStatus = "Check canceled. Existing results were preserved.";
    state.notice = state.checkStatus;
    render();
  }

  async function runDeskCheck(): Promise<void> {
    const profile = selectedProfile();
    if (!profile) {
      state.notice = "Select a profile before running Check desk.";
      render();
      return;
    }

    const previousObservations = clone(state.observations);
    const checkId = activeCheckId + 1;
    activeCheckId = checkId;
    state.runningCheck = true;
    state.checkProgress = 8;
    state.checkStatus = "Scanning inventory for selected profile…";
    addTimelineEvent("scan_started", "Desk check inventory scan started.", {
      profile_id: profile.id,
      profile_name: profile.name,
    });
    render();

    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }

    progressTimer = setInterval(() => {
      if (state.runningCheck && state.checkProgress < 90) {
        state.checkProgress = Math.min(90, state.checkProgress + 7);
        render();
      }
    }, progressIntervalMs);

    try {
      const report = await backend.scanInventory();
      if (checkId !== activeCheckId) {
        return;
      }
      state.observations = clone(report.observations);
      state.scanHealth = normalizeScanHealth(report.scan_health);
      state.capabilityGaps = clone(report.capability_gaps);
      captureClassDeltaTimeline(previousObservations, state.observations);
      state.checkStatus = "Comparing expected profile against observations…";
      state.checkProgress = Math.max(state.checkProgress, 92);
      render();

      let comparison: ComparisonResult;
      try {
        comparison = await backend.compareProfile(profile, report);
      } catch {
        comparison = compareProfileFallback(profile, report);
      }

      if (checkId !== activeCheckId) {
        return;
      }

      const grouped = groupComparisonResult(profile, report, comparison);
      state.result = grouped;
      const snapshot = createSnapshot(profile, report, grouped.comparison, now);
      state.snapshots.unshift(snapshot);
      addTimelineEvent("scan_completed", "Desk check comparison completed.", {
        present: String(grouped.groups.present.length),
        changed: String(grouped.groups.changed.length),
        missing: String(grouped.groups.missing.length),
        unexpected: String(grouped.groups.unexpected.length),
        ambiguous: String(grouped.groups.ambiguous.length),
        unknown: String(grouped.groups.unknown.length),
      });
      persistState();

      state.checkStatus = `Check complete. ${summaryLine(grouped)}`;
      state.notice = state.checkStatus;
    } catch {
      if (checkId !== activeCheckId) {
        return;
      }
      state.checkStatus =
        "Check desk failed before a complete scan. Dock Audit kept prior results and did not conclude any device was missing.";
      state.notice = state.checkStatus;
      addTimelineEvent(
        "scan_failed",
        "Desk check failed before completing comparison.",
      );
    } finally {
      if (checkId === activeCheckId) {
        state.runningCheck = false;
        state.checkProgress = 100;
      }
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      persistState();
      rebuildExportPreviews();
      render();
    }
  }

  render();
  idlePromise = refreshInventory();

  return {
    refreshInventory,
    waitForIdle(): Promise<void> {
      return idlePromise;
    },
    destroy(): void {
      destroyed = true;
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      root.replaceChildren();
    },
  };
}
