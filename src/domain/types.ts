/**
 * Domain model for Rack Power Planner & Audit.
 *
 * Conventions:
 *  - `null` always means "unknown / not supplied". It is never treated as 0.
 *  - Power values are in watts (W), currents in amperes (A), voltage in volts (V).
 *  - AC values describe input power drawn from a PDU/feed. DC values describe PSU output.
 *  - Full precision is kept internally; rounding is a display concern only.
 */

export type ID = string;
export type Lang = 'mn' | 'en';
export type Mode = 'planning' | 'audit';

export const SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type VerificationStatus =
  | 'verified' // checked against an accessible manufacturer document
  | 'unverified' // source named but not checked, or template only
  | 'user_supplied' // value entered/overridden by the user
  | 'measured' // field measurement
  | 'assumption' // explicit planning assumption
  | 'demo'; // synthetic demonstration data

export interface SourceRef {
  title: string;
  url?: string;
  revision?: string;
  accessDate?: string; // ISO date
  note?: string;
}

export interface Sourced<T> {
  value: T | null;
  status: VerificationStatus;
  source?: SourceRef;
  /** For a template field that the user changed: the original value. */
  original?: T | null;
  /** Configuration this value applies to (e.g. "2x 1400 W, 230 V"). */
  appliesTo?: string;
}

// ---------------------------------------------------------------------------
// Categories / catalog
// ---------------------------------------------------------------------------

export type DeviceCategory =
  | 'rack_server'
  | 'gpu_server'
  | 'tower_server'
  | 'switch'
  | 'poe_switch'
  | 'router'
  | 'firewall'
  | 'storage_array'
  | 'disk_enclosure'
  | 'san_switch'
  | 'tape_library'
  | 'backup_appliance'
  | 'mgmt_appliance'
  | 'ups'
  | 'pdu'
  | 'passive'
  | 'custom';

export type PassiveKind = 'blanking' | 'patch_panel' | 'cable_manager' | 'shelf' | 'other';

export type Airflow = 'front_to_back' | 'back_to_front' | 'side_to_side' | 'unknown';

export type InletType = 'C14' | 'C20' | 'C16' | 'C8' | 'C6' | 'DC_terminal' | 'other' | 'unknown';
export type OutletType = 'C13' | 'C19' | 'C15' | 'C5' | 'C7' | 'Schuko' | 'other';

export type RedundancyMode =
  | 'single'
  | '1+1'
  | 'N+1'
  | 'N+N'
  | 'load_sharing' // nonredundant: all PSUs needed
  | 'vendor_fault_tolerant' // vendor-defined, may throttle
  | 'unknown';

export interface PsuOption {
  id: ID;
  label: string;
  ratedDcW: Sourced<number>;
  inputType: 'AC' | 'DC';
  inputVoltageMin: number | null;
  inputVoltageMax: number | null;
  inlet: InletType;
  efficiency: Sourced<number>;
  /** Verified output derating by input voltage, if any. */
  derating?: { maxInputV: number; outputW: number }[];
}

export interface DeviceTemplate {
  id: ID;
  category: DeviceCategory;
  vendor: string;
  model: string;
  family?: string;
  heightU: Sourced<number>;
  depthMm: Sourced<number>;
  weightKg: Sourced<number>;
  airflow: Sourced<Airflow>;
  /** PSU options verified as compatible with this model. Empty = none verified. */
  psuOptions: PsuOption[];
  supportedPsuCounts: Sourced<number[]>;
  supportedModes: Sourced<RedundancyMode[]>;
  /** Whole-system AC estimates published by the manufacturer for a stated configuration. */
  typicalAcW: Sourced<number>;
  maxAcW: Sourced<number>;
  isPassive?: boolean;
  passiveKind?: PassiveKind;
  /** True when this record was created or changed by the user. */
  userDefined?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Device instances
// ---------------------------------------------------------------------------

export type Placement =
  | { kind: 'rack'; startU: number; heightU: number }
  | { kind: 'zero_u'; side: 'left' | 'right' }
  | { kind: 'outside' }
  | {
      kind: 'shelf';
      shelfId: ID;
      /** Explicitly confirmed by the user; null means not confirmed. */
      confirmedHeightU: number | null;
      confirmedDepthMm: number | null;
      confirmedWeightKg: number | null;
    }
  | { kind: 'unplaced' };

export type PsuState = 'ok' | 'failed' | 'removed' | 'standby';

export interface PsuConnection {
  /** Outlet on a PDU (AC) */
  outletId: ID | null;
  /** DC bus (DC PSUs) */
  dcBusId?: ID | null;
}

export interface Psu {
  id: ID;
  label: string;
  /** Rated DC output in W (nameplate). Inventory value, not consumption. */
  ratedDcW: number | null;
  state: PsuState;
  inputType: 'AC' | 'DC';
  inputVoltageMin: number | null;
  inputVoltageMax: number | null;
  /** Efficiency assumption for this PSU (0,1]; null = unknown -> device/project default. */
  efficiency: number | null;
  inlet: InletType;
  connection: PsuConnection;
  /** Was the PSU option verified as compatible with the device model? */
  compatVerified: boolean;
  /** Verified output derating by voltage (copied from verified option). */
  derating?: { maxInputV: number; outputW: number }[];
  /** Measured AC input of this PSU in W (optional; summed once to whole-device). */
  measuredAcW?: number | null;
}

export type SharingMode = 'equal' | 'configured' | 'measured' | 'hot_standby';

export interface PowerDomain {
  id: ID;
  name: string;
  mode: RedundancyMode;
  /** N for N+1 / N+N: PSUs required to carry the load. null = unknown. */
  requiredPsus: number | null;
  /** Fraction of the device load carried by this domain (domains sum to 1). */
  loadFraction: number;
  sharing: SharingMode;
  /** For configured sharing: fraction per PSU id. */
  shares?: Record<ID, number>;
  psus: Psu[];
}

export type PowerBasis = 'measured' | 'estimated' | 'manufacturer' | 'component' | 'psu_proxy' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';

export interface PowerMeasurement {
  /** Whole-device AC input W. If method is per_psu_sum, this is the sum of PSU readings. */
  totalW: number;
  method: 'whole_device' | 'per_psu_sum' | 'pdu_outlet' | 'clamp_meter';
  window: string; // e.g. "instant", "24h avg", "7d peak"
  timestamp: string; // ISO datetime
  source: string; // e.g. "iDRAC", "iLO", "PDU outlet meter"
}

export interface ComponentEstimate {
  cpuCount: number;
  cpuTdpW: number;
  gpuCount: number;
  gpuTdpW: number;
  memoryW: number;
  disksW: number;
  fansW: number;
  boardW: number;
  otherW: number;
}

export interface PsuProxy {
  /** User-supplied assumed DC load in W (low confidence). */
  assumedDcW: number;
}

export interface DevicePower {
  /** Passive item: genuinely 0 W (distinct from unknown). */
  passiveZero: boolean;
  measured: PowerMeasurement | null;
  /** Typical estimated whole-device AC input W (workload-specific). */
  typicalW: number | null;
  typicalSource: string;
  /** Design / peak sustained AC input W. */
  designW: number | null;
  designSource: string;
  /** Manufacturer whole-system estimate — overrides component totals. */
  manufacturerW: number | null;
  manufacturerSource: string;
  component: ComponentEstimate | null;
  useComponentEstimate: boolean;
  proxy: PsuProxy | null;
  useProxy: boolean;
  confidence: Confidence;
  /** Device PF; null -> project default (assumption). */
  pf: number | null;
  /** Efficiency used for DC<->AC conversion; null -> project default (assumption). */
  efficiency: number | null;
  assumptions: string;
}

export interface PoeConfig {
  /** Base switch AC input W excluding PoE (typical / design). */
  baseTypicalW: number | null;
  baseDesignW: number | null;
  /** Delivered PoE DC load W (typical / design). */
  deliveredTypicalW: number | null;
  deliveredDesignW: number | null;
  /** PoE conversion efficiency; null = use project assumption. */
  efficiency: number | null;
  budgetW: number | null;
  /** Fraction of delivered PoE power going to endpoints inside this rack. */
  inRackFraction: number;
}

export interface Cooling {
  liquidCooled: boolean;
  /** Fraction of heat rejected to liquid (0..1). null = unknown. */
  liquidFraction: number | null;
}

export interface DeviceInstance {
  id: ID;
  name: string;
  templateId: ID | null;
  category: DeviceCategory;
  vendor: string;
  model: string;
  rackId: ID;
  placement: Placement;
  passiveKind?: PassiveKind;
  /** Critical device: single-cord without ATS is flagged. */
  critical: boolean;
  inputType: 'AC' | 'DC';
  depthMm: number | null;
  weightKg: number | null;
  airflow: Airflow;
  power: DevicePower;
  domains: PowerDomain[];
  poe: PoeConfig | null;
  /** Device powered over PoE by a switch (does not draw from PDU). */
  poweredByPoeSwitchId?: ID | null;
  cooling: Cooling;
  /** GPU server counts (informational; estimates go via component mode). */
  cpuCount?: number | null;
  gpuCount?: number | null;
  /** Field keys the user changed from the template. */
  userOverrides: string[];
  /** Label/asset tag seen on site (audit). */
  assetLabel?: string;
  /** Shelf capacity for shelves (passive) */
  shelfCapacityKg?: number | null;
  notes: string;
}

// ---------------------------------------------------------------------------
// Electrical infrastructure
// ---------------------------------------------------------------------------

export type FeedLetter = 'A' | 'B' | 'C';
export type Phase = 'L1' | 'L2' | 'L3';
export type BankPhase = Phase | 'L1-L2' | 'L2-L3' | 'L3-L1';
export type PduTopology = '1ph' | '3ph_wye' | '3ph_delta';

export interface PduCapabilities {
  inputMetering: boolean;
  outletMetering: boolean;
  remoteMonitoring: boolean;
  outletSwitching: boolean;
  envSensors: boolean;
}

export interface Outlet {
  id: ID;
  index: number; // 1-based display number
  type: OutletType;
  /** Outlet current rating in A (region/product-specific). null = unknown. */
  ratedA: number | null;
}

export interface OutletBank {
  id: ID;
  name: string;
  /** Phase or line pair this bank is connected to. null = unknown mapping. */
  phase: BankPhase | null;
  breakerA: number | null;
  outlets: Outlet[];
}

export interface Pdu {
  id: ID;
  name: string;
  rackId: ID;
  templateId: ID | null;
  vendor: string;
  model: string;
  mounting: 'zero_u' | 'horizontal';
  side: 'left' | 'right';
  /** For horizontal PDUs: rack unit range */
  startU: number | null;
  heightU: number;
  feed: FeedLetter;
  /** Upstream: branch circuit or ATS output. */
  upstream: { kind: 'branch'; id: ID } | { kind: 'ats'; id: ID } | null;
  topology: PduTopology;
  /** 1ph: supply voltage; 3ph: line-to-line voltage. */
  voltage: number | null;
  /** Nominal (un-derated) input current rating per phase. */
  nominalA: number | null;
  /** Published usable/continuous current per phase (already derated by mfr). */
  usableA: number | null;
  usableKw: number | null;
  usableKva: number | null;
  plug: string;
  capabilities: PduCapabilities;
  banks: OutletBank[];
  provenance: VerificationStatus;
  sourceNote?: string;
}

export interface PduTemplate {
  id: ID;
  vendor: string;
  model: string;
  mounting: 'zero_u' | 'horizontal';
  heightU: number;
  topology: PduTopology;
  voltage: Sourced<number>;
  nominalA: Sourced<number>;
  usableA: Sourced<number>;
  usableKw: Sourced<number>;
  usableKva: Sourced<number>;
  plug: Sourced<string>;
  outlets: Sourced<{ type: OutletType; count: number }[]>;
  capabilities: Sourced<PduCapabilities>;
  generic?: boolean;
  description?: string;
}

export interface BranchCircuit {
  id: ID;
  name: string;
  breakerA: number | null;
  /** Breaker rating is already a usable/continuous rating (no further derating). */
  breakerIsUsable: boolean;
  phases: 1 | 3;
  voltage: number | null;
  upsId: ID | null;
  /** Directly fed by a source (no UPS). */
  sourceId: ID | null;
}

export interface Ups {
  id: ID;
  name: string;
  ratedKw: number | null;
  ratedKva: number | null;
  redundancy: 'single' | 'N+1' | '2N' | 'unknown';
  sourceId: ID | null;
  /** Are all other loads on this UPS known? */
  otherLoadsKnown: boolean;
  otherLoadW: number | null;
  efficiency: number | null;
  inRack: boolean;
  rackDeviceId: ID | null;
  runtime: { minutes: number; atLoadW: number; evidence: string } | null;
}

export interface UpstreamSource {
  id: ID;
  name: string;
  kind: 'utility' | 'generator' | 'other' | 'unknown';
  note: string;
}

export interface Ats {
  id: ID;
  name: string;
  primaryBranchId: ID | null;
  secondaryBranchId: ID | null;
  ratedA: number | null;
  transfer: 'open_transition' | 'closed_transition' | 'unknown';
  /** Has the transfer path been validated (test/evidence)? */
  validated: boolean;
}

export interface DcBus {
  id: ID;
  name: string;
  /** Nominal voltage, e.g. -48 */
  voltage: number;
  capacityA: number | null;
  rectifierEfficiency: number | null;
  /** PDU outlets feeding the rectifier input (AC side). */
  rectifierOutletIds: ID[];
}

// ---------------------------------------------------------------------------
// Rack / project
// ---------------------------------------------------------------------------

export interface InletReading {
  id: ID;
  position: 'top' | 'middle' | 'bottom';
  tempC: number;
  timestamp: string;
}

export interface Rack {
  id: ID;
  name: string;
  site: string;
  heightU: number;
  usableDepthMm: number | null;
  ratedWeightKg: number | null;
  /** Usable rack power budget (configured), W. */
  powerBudgetW: number | null;
  powerBudgetConfirmed: boolean;
  coolingCapacityW: number | null;
  liquidCoolingCapacityW: number | null;
  feedCount: 1 | 2;
  topology: PduTopology;
  nominalVoltage: number;
  frequencyHz: number;
  inletReadings: InletReading[];
  notes: string;
}

export interface Policy {
  id: ID;
  name: string;
  version: string;
  /** Alert threshold as fraction of nominal limit (e.g. 0.7). */
  alertFraction: number;
  /** Apply planning derating to un-derated nominal ratings. */
  applyPlanningDerate: boolean;
  planningDerateFraction: number;
  /** Stale measurement age in days. */
  staleDays: number;
  phaseImbalanceDefinition: 'max_dev_from_mean' | 'max_minus_min_over_max';
  phaseImbalanceFraction: number;
  /** Recommended inlet envelope (verified applicable class). */
  inletRecommendedMinC: number;
  inletRecommendedMaxC: number;
  /** Envelope verified as applicable to this equipment? */
  inletEnvelopeVerified: boolean;
  /** Verified allowable / manufacturer hard limit (Fail threshold). */
  inletAllowableMaxC: number | null;
  inletAllowableMinC: number | null;
  inletAllowableSource: string;
  /** Optional growth reserve fraction applied once to the design load. */
  growthReserveFraction: number;
  /** Rule IDs disabled or overridden by policy. */
  overrides: Record<string, { disabled?: boolean; note?: string }>;
}

export interface Assumptions {
  defaultPf: number;
  pfConfirmed: boolean;
  defaultEfficiency: number;
  poeEfficiency: number;
  hoursPerDay: number;
  daysPerMonth: number;
  /** Tariff MNT per kWh; null = not entered (no cost shown). */
  tariffPerKwh: number | null;
  currency: string;
  pue: number | null;
  /** Default normal load sharing across PSUs (assumption). */
  defaultSharing: SharingMode;
}

export type CheckStatus = 'pass' | 'warning' | 'fail' | 'unknown' | 'na';

export interface Evidence {
  id: ID;
  kind: 'photo' | 'note' | 'document';
  name: string;
  mime: string;
  size: number;
  /** IndexedDB blob key; blob stored separately. */
  blobKey: string | null;
  note: string;
  createdAt: string;
}

export interface ManualCheck {
  id: ID;
  rackId: ID;
  key: string; // checklist item key
  status: CheckStatus;
  comment: string;
  evidenceIds: ID[];
  responsible: string;
  action: string;
  dueDate: string;
}

export interface FindingAck {
  findingKey: string;
  note: string;
  by: string;
  at: string;
}

export interface Snapshot {
  id: ID;
  kind: 'planned' | 'installed' | 'proposed';
  label: string;
  createdAt: string;
  /** Serialized racks/devices/pdus at that time. */
  data: {
    racks: Rack[];
    devices: DeviceInstance[];
    pdus: Pdu[];
  };
}

export interface AuditMeta {
  auditor: string;
  customer: string;
  date: string;
  notes: string;
}

export interface Project {
  schemaVersion: number;
  id: ID;
  name: string;
  customer: string;
  site: string;
  mode: Mode;
  createdAt: string;
  updatedAt: string;
  racks: Rack[];
  devices: DeviceInstance[];
  pdus: Pdu[];
  branches: BranchCircuit[];
  upses: Ups[];
  sources: UpstreamSource[];
  atses: Ats[];
  dcBuses: DcBus[];
  catalog: {
    /** User-created/overridden device templates (built-in catalog is code). */
    devices: DeviceTemplate[];
    pdus: PduTemplate[];
  };
  policy: Policy;
  assumptions: Assumptions;
  manualChecks: ManualCheck[];
  evidence: Evidence[];
  acks: FindingAck[];
  snapshots: Snapshot[];
  audit: AuditMeta;
  isDemo: boolean;
}
