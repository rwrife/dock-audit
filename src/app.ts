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

interface PersistedState {
  selected_profile_id: string | null;
  profiles: StoredProfile[];
  snapshots: StoredSnapshot[];
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

const STORAGE_KEY = "dock-audit.issue5.v1";
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

function defaultPersistedState(): PersistedState {
  return {
    selected_profile_id: null,
    profiles: [],
    snapshots: [],
  };
}

export function createLocalStorageStorage(
  backing: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): DockAuditStorage {
  return {
    load(): PersistedState {
      const raw = backing.getItem(STORAGE_KEY);
      if (raw === null) {
        return defaultPersistedState();
      }
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        return {
          selected_profile_id:
            typeof parsed.selected_profile_id === "string"
              ? parsed.selected_profile_id
              : null,
          profiles: Array.isArray(parsed.profiles)
            ? (parsed.profiles as StoredProfile[])
            : [],
          snapshots: Array.isArray(parsed.snapshots)
            ? (parsed.snapshots as StoredSnapshot[])
            : [],
        };
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
  let state: PersistedState = {
    ...defaultPersistedState(),
    ...seed,
    profiles: clone(seed?.profiles ?? []),
    snapshots: clone(seed?.snapshots ?? []),
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
  return deviceClass.replaceAll("_", " ");
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

  const persisted = storage.load();
  const state: State = {
    profileNameDraft: "",
    captureDrafts: [],
    profiles: persisted.profiles,
    selectedProfileId: persisted.selected_profile_id,
    profileEditDraft: null,
    snapshots: persisted.snapshots,
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

  function persistState(): void {
    storage.save({
      selected_profile_id: state.selectedProfileId,
      profiles: state.profiles,
      snapshots: state.snapshots,
    });
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
      state.notice = `Saved profile “${profile.name}” with ${profile.expectations.length} expectations.`;
      setProfileEditDraftFromSelection();
      persistState();
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
          state.notice =
            "Saved profile edits. Historical snapshots keep the profile version captured at check time.";
          setProfileEditDraftFromSelection();
          persistState();
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
          state.selectedProfileId = state.profiles[0]?.id ?? null;
          setProfileEditDraftFromSelection();
          state.notice =
            "Deleted selected profile. Existing snapshots were preserved without rewrite.";
          persistState();
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
      textElement("h2", `Snapshots (${state.snapshots.length})`),
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
      state.snapshots.slice(0, 8).forEach((snapshot) => {
        const item = document.createElement("li");
        item.className = "snapshot-item";
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
        );
        list.append(item);
      });
      snapshotSection.append(list);
    }

    card.append(snapshotSection);

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
    state.loadingInventory = true;
    state.inventoryError = null;
    render();

    try {
      const report = await backend.scanInventory();
      state.observations = clone(report.observations);
      state.scanHealth = normalizeScanHealth(report.scan_health);
      state.capabilityGaps = clone(report.capability_gaps);
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
    } finally {
      state.loadingInventory = false;
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

    const checkId = activeCheckId + 1;
    activeCheckId = checkId;
    state.runningCheck = true;
    state.checkProgress = 8;
    state.checkStatus = "Scanning inventory for selected profile…";
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
      state.snapshots = state.snapshots.slice(0, 30);
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
    } finally {
      if (checkId === activeCheckId) {
        state.runningCheck = false;
        state.checkProgress = 100;
      }
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
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
