/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P40 — Whole-Life Carbon & Circularity Audit Data Model
 * Schema Version: p40-wlc-circularity-v1.0.0
 * Calculation Engine Version: p40-engine-v1.0.0
 */

export const P40_SCHEMA_VERSION = 'p40-wlc-circularity-v1.0.0' as const;
export const P40_ENGINE_VERSION = 'p40-engine-v1.0.0' as const;

export type P40ProvenanceClassification =
  | 'authoritative-project-data'
  | 'user-entered'
  | 'deterministically-derived'
  | 'published-reference-data'
  | 'explicit-scenario-assumption'
  | 'measured-or-imported'
  | 'unsupported-or-missing';

export type P40DataCompletenessStatus = 'complete' | 'partial' | 'unsupported';

export type P40MaterialUnit = 'kg' | 'tonne' | 'm2' | 'm3' | 'm' | 'item';

export type P40MaterialCategory =
  | 'substructure-foundation'
  | 'superstructure-frame'
  | 'superstructure-floors'
  | 'superstructure-roof'
  | 'external-envelope-facade'
  | 'fenestration-openings'
  | 'internal-partitions-walls'
  | 'internal-finishes-joinery'
  | 'mep-building-services'
  | 'external-site-works';

export type P40LifecycleStageCode =
  | 'A1-A3' // Product Stage (Raw material supply, transport, manufacturing)
  | 'A4'    // Construction Process Stage — Transport to site
  | 'A5'    // Construction Process Stage — Installation & site waste
  | 'B1-B3' // Use Stage — In-use release, maintenance, repair
  | 'B4-B5' // Use Stage — Component replacement & refurbishment
  | 'B6'    // Use Stage — Operational energy (kept strictly separate unless explicitly enabled)
  | 'B7'    // Use Stage — Operational water (kept strictly separate unless explicitly enabled)
  | 'C1-C4' // End-of-Life Stage (Deconstruction, transport, waste processing, disposal)
  | 'D';    // Benefits and loads beyond the system boundary (reuse, recovery, recycling — reported separately)

export type P40StageInclusionStatus =
  | 'included-complete'
  | 'included-partial'
  | 'excluded-by-scope'
  | 'missing-data'
  | 'unsupported';

export type P40EvidenceReviewStatus =
  | 'verified-reference'
  | 'published-generic'
  | 'user-provided-unverified'
  | 'scenario-assumption'
  | 'pending-review';

export type P40DisassemblyRating =
  | 'reversible-mechanical'      // Bolted, screwed, dry-jointed; high recovery feasibility
  | 'semi-reversible-hybrid'     // Partial mechanical + removable sealants/fixings
  | 'composite-bonded'           // Adhesives, wet mortar, laminated composites; low intact recovery
  | 'monolithic-cast-in-place'   // Cast-in-situ concrete, wet-applied screeds; requires crushing/downcycling
  | 'unassessed';

export type P40LocalRecoveryAvailability =
  | 'verified-local-infrastructure'
  | 'regional-specialist-only'
  | 'theoretical-only-unverified-local'
  | 'no-viable-recovery-pathway'
  | 'unknown-unverified';

/**
 * PHASE 8 — Traceable Evidence & Reference Ledger Record
 */
export interface P40CarbonFactorEvidenceRecord {
  factorId: string;
  title: string;
  organization: string;
  sourceIdentifierOrLink: string;
  datasetVersion: string;
  publicationYear: number;
  geography: string;
  applicabilityNotes: string;
  applicableCategory: P40MaterialCategory;
  applicableMaterialName: string;
  declaredUnit: P40MaterialUnit;
  /** A1-A3 cradle-to-gate carbon factor in kgCO2e per declaredUnit (null if missing/unsupported) */
  a1a3FactorKgCO2ePerUnit: number | null;
  /** A4 transport factor in kgCO2e per tonne-km if applicable */
  a4TransportKgCO2ePerTonneKm?: number | null;
  /** C1-C4 end-of-life factor in kgCO2e per declaredUnit (null if unknown) */
  c1c4FactorKgCO2ePerUnit?: number | null;
  /** Module D net benefit/load beyond boundary in kgCO2e per declaredUnit (reported separately) */
  moduleDFactorKgCO2ePerUnit?: number | null;
  /** Biogenic carbon storage in A1-A3 (kgCO2e per unit, typically negative for bio-based) */
  biogenicStorageKgCO2ePerUnit?: number | null;
  /** Physical density in kg/m3 for explicit unit conversions */
  densityKgPerM3?: number | null;
  /** Reference service life in years (for B4 replacement modeling) */
  referenceServiceLifeYears?: number | null;
  /** Typical construction site waste percentage for A5 */
  defaultSiteWastePercent?: number | null;
  coveredStages: P40LifecycleStageCode[];
  provenance: P40ProvenanceClassification;
  reviewStatus: P40EvidenceReviewStatus;
  uncertaintyRangePercent: number;
  knownLimitations: string[];
}

/**
 * PHASE 3 — Material Inventory Record
 */
export interface P40MaterialInventoryItem {
  itemId: string;
  materialName: string;
  assemblyOrElementName: string;
  category: P40MaterialCategory;
  /** Optional assignment to specific room IDs from project.floorPlan.rooms */
  assignedRoomIds: string[];
  /** Optional assignment to building floor level (null = whole building) */
  assignedFloorLevel: number | null;
  /** Optional parent assembly ID — if present and includedInParentAssembly is true, excluded from sum to prevent double counting */
  parentAssemblyItemId?: string | null;
  includedInParentAssembly: boolean;
  /** Quantity value — null when missing/unknown (never silently replaced with 0) */
  quantity: number | null;
  unit: P40MaterialUnit;
  /** Optional physical thickness (m) required for m2 <-> m3 or m2 <-> kg conversions */
  thicknessM?: number | null;
  /** Optional density override (kg/m3) */
  densityKgPerM3?: number | null;
  quantityProvenance: P40ProvenanceClassification;
  quantitySourceDescription: string;
  /** Linked carbon factor ID from the evidence ledger */
  linkedFactorId: string | null;
  /** Explicit replacement interval in years for B4-B5 (null = use factor reference or no replacement assumed) */
  customServiceLifeYears?: number | null;
  replacementAssumptionSource: string;
  /** Site waste rate (%) for A5 */
  siteWastePercent?: number | null;
  /** Transport distance (km) for A4 */
  transportDistanceKm?: number | null;
  /** Circularity attributes per material item */
  recycledContentPercent?: number | null;
  recycledContentProvenance: P40ProvenanceClassification;
  reusePotentialPercent?: number | null;
  theoreticalRecyclabilityPercent?: number | null;
  localRecoveryAvailability: P40LocalRecoveryAvailability;
  disassemblyRating: P40DisassemblyRating;
  circularityNotes: string;
  isFlaggedIncomplete: boolean;
  flagReason?: string;
}

/**
 * PHASE 5 — Life-Cycle Assessment Boundaries & Settings
 */
export interface P40LifecycleBoundarySettings {
  assessmentPeriodYears: number;
  functionalUnitDescription: string;
  grossInternalFloorAreaM2: number | null;
  includedStages: Record<P40LifecycleStageCode, boolean>;
  includeBiogenicCarbonBalance: boolean;
  reportModuleDSeparately: boolean;
  /** Operational energy (B6) kept separate from embodied carbon unless explicitly configured */
  includeOperationalEnergyInWholeLife: boolean;
  annualOperationalElectricityKwhPerYear: number | null;
  gridElectricityFactorKgCO2ePerKwh: number | null;
  operationalEnergyProvenance: P40ProvenanceClassification;
  replacementMethodologyNote: string;
  moduleDMethodologyNote: string;
}

/**
 * PHASE 4 — Deterministic Material Calculation Result
 */
export interface P40UnitConversionTrace {
  isCompatible: boolean;
  inputQuantity: number | null;
  inputUnit: P40MaterialUnit;
  targetUnit: P40MaterialUnit;
  convertedQuantity: number | null;
  massKg: number | null;
  formulaUsed: string;
  errorMessage?: string;
}

export interface P40MaterialCalculationResult {
  itemId: string;
  materialName: string;
  assemblyOrElementName: string;
  category: P40MaterialCategory;
  status: 'calculated-complete' | 'calculated-partial' | 'excluded-double-counting' | 'missing-quantity' | 'missing-factor' | 'incompatible-units';
  statusExplanation: string;
  unitConversion: P40UnitConversionTrace;
  linkedFactor: P40CarbonFactorEvidenceRecord | null;
  /** Stage-level emissions in kgCO2e (null when stage is missing data or excluded, never silently 0) */
  stageEmissionsKgCO2e: Record<P40LifecycleStageCode, number | null>;
  /** Upfront embodied carbon A1-A5 (kgCO2e) */
  upfrontEmbodiedKgCO2e: number | null;
  /** Total lifecycle embodied carbon A1-C4 (kgCO2e) */
  totalEmbodiedAtoCKgCO2e: number | null;
  /** Separate Module D potential net benefit/load (kgCO2e) */
  moduleDBenefitOrLoadKgCO2e: number | null;
  replacementCyclesCount: number;
  formulaTrace: string[];
  uncertaintyPercent: number;
  warnings: string[];
}

export interface P40StageBreakdownResult {
  stageCode: P40LifecycleStageCode;
  stageTitle: string;
  inclusionStatus: P40StageInclusionStatus;
  /** Null when unassessed, excluded, or missing data */
  emissionsKgCO2e: number | null;
  emissionsTCO2e: number | null;
  intensityKgCO2ePerM2: number | null;
  contributingItemsCount: number;
  missingItemsCount: number;
  explanation: string;
}

/**
 * PHASE 6 — Circularity Intelligence Opportunity & Audit
 */
export interface P40CircularityOpportunity {
  opportunityId: string;
  targetItemId: string | null;
  targetMaterialOrElement: string;
  category:
    | 'material-reuse'
    | 'repair-refurbishment'
    | 'design-for-disassembly'
    | 'recyclability-recovery'
    | 'recycled-content'
    | 'waste-reduction'
    | 'alternative-material'
    | 'future-adaptation';
  title: string;
  basisAndEvidence: string;
  assumptions: string[];
  potentialEmbodiedSavingKgCO2e: number | null;
  theoreticalRecoveryInfo: string;
  verifiedLocalAvailabilityStatus: P40LocalRecoveryAvailability;
  disassemblyClassification: P40DisassemblyRating;
  unresolvedConstraints: string[];
  recommendedAction: string;
}

export interface P40CircularityAuditSummary {
  totalEvaluatedMassKg: number | null;
  massWithKnownRecycledContentKg: number | null;
  weightedRecycledContentPercent: number | null;
  reversibleDisassemblyMassSharePercent: number | null;
  verifiedLocalRecoveryMassSharePercent: number | null;
  theoreticalRecyclableMassSharePercent: number | null;
  opportunities: P40CircularityOpportunity[];
  circularityWarnings: string[];
}

/**
 * Complete Deterministic Calculation Output for a Scenario / Audit
 */
export interface P40CalculationResult {
  engineVersion: typeof P40_ENGINE_VERSION;
  schemaVersion: typeof P40_SCHEMA_VERSION;
  evaluatedAt: string;
  completenessStatus: P40DataCompletenessStatus;
  completenessExplanation: string;
  boundarySettings: P40LifecycleBoundarySettings;
  itemResults: P40MaterialCalculationResult[];
  stageBreakdown: P40StageBreakdownResult[];
  categoryBreakdown: Array<{
    category: P40MaterialCategory;
    label: string;
    embodiedAtoCKgCO2e: number | null;
    shareOfEmbodiedPercent: number | null;
    itemCount: number;
  }>;
  totals: {
    /** Product stage A1-A3 (kgCO2e) */
    productStageA1A3KgCO2e: number | null;
    /** Upfront embodied carbon A1-A5 (kgCO2e) */
    upfrontEmbodiedA1A5KgCO2e: number | null;
    /** In-use embodied B1-B5 (kgCO2e) */
    inUseEmbodiedB1B5KgCO2e: number | null;
    /** End-of-life embodied C1-C4 (kgCO2e) */
    endOfLifeC1C4KgCO2e: number | null;
    /** Total embodied carbon A1-C4 (kgCO2e) */
    totalEmbodiedAtoCKgCO2e: number | null;
    totalEmbodiedAtoCTCO2e: number | null;
    embodiedIntensityKgCO2ePerM2: number | null;
    /** Operational carbon B6-B7 over assessment period (null unless explicitly enabled & supplied) */
    operationalCarbonB6B7KgCO2e: number | null;
    /** Whole-life carbon A1-C4 including operational only when compatible and enabled */
    wholeLifeCarbonAtoCKgCO2e: number | null;
    wholeLifeIntensityKgCO2ePerM2: number | null;
    /** Module D reported strictly separately from A-C */
    moduleDSeparateKgCO2e: number | null;
    overallUncertaintyRangePercent: number;
  };
  provenanceSummary: {
    totalItemsCount: number;
    calculatedItemsCount: number;
    excludedDoubleCountedCount: number;
    missingOrIncompatibleCount: number;
    unverifiedFactorsCount: number;
    countsByProvenance: Record<P40ProvenanceClassification, number>;
  };
  circularitySummary: P40CircularityAuditSummary;
  warningsAndLimitations: string[];
}

/**
 * PHASE 7 — Alternative Design Scenario & Comparison Model
 */
export interface P40AuditScenario {
  scenarioId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  isBaseline: boolean;
  boundarySettings: P40LifecycleBoundarySettings;
  inventory: P40MaterialInventoryItem[];
  scenarioAssumptions: string[];
  keyTradeoffs: string[];
}

export interface P40ScenarioComparisonResult {
  baselineScenarioId: string;
  baselineScenarioName: string;
  candidateScenarioId: string;
  candidateScenarioName: string;
  areBoundariesCompatible: boolean;
  compatibilityIssues: string[];
  baselineEmbodiedAtoCKgCO2e: number | null;
  candidateEmbodiedAtoCKgCO2e: number | null;
  /** Absolute difference (candidate - baseline) in kgCO2e; null if boundaries incompatible or data missing */
  deltaEmbodiedAtoCKgCO2e: number | null;
  /** Percentage difference when baseline is valid and nonzero, and boundaries are compatible */
  deltaEmbodiedPercent: number | null;
  baselineUpfrontA1A5KgCO2e: number | null;
  candidateUpfrontA1A5KgCO2e: number | null;
  deltaUpfrontKgCO2e: number | null;
  deltaUpfrontPercent: number | null;
  includedStagesBaseline: P40LifecycleStageCode[];
  includedStagesCandidate: P40LifecycleStageCode[];
  baselineCompleteness: P40DataCompletenessStatus;
  candidateCompleteness: P40DataCompletenessStatus;
  materialDifferences: Array<{
    category: P40MaterialCategory;
    baselineMaterialName: string;
    candidateMaterialName: string;
    baselineKgCO2e: number | null;
    candidateKgCO2e: number | null;
    deltaKgCO2e: number | null;
    deltaPercent: number | null;
    factorSourceComparison: string;
  }>;
  circularityComparison: {
    baselineReversibleSharePercent: number | null;
    candidateReversibleSharePercent: number | null;
    baselineRecycledContentPercent: number | null;
    candidateRecycledContentPercent: number | null;
    summaryNote: string;
  };
  tradeoffsAndWarnings: string[];
}

/**
 * Root P40 State attached to Project
 */
export interface ProjectP40AuditState {
  schemaVersion: typeof P40_SCHEMA_VERSION;
  engineVersion: typeof P40_ENGINE_VERSION;
  updatedAt: string;
  activeScenarioId: string;
  scenarios: P40AuditScenario[];
  evidenceLedger: P40CarbonFactorEvidenceRecord[];
  lastPreApplySnapshotId?: string;
  auditNotes: string[];
}
