/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P40 — Whole-Life Carbon & Circularity Audit Engine
 * Deterministic, UI-independent calculation service implementing:
 * - Material inventory derivation from existing project geometry & records
 * - Explicit unit conversions with density & thickness validation
 * - Double-counting prevention for parent/child assemblies and P41 IFC elements
 * - Whole-life assessment boundaries (EN 15978 stages A1-A3, A4, A5, B1-B3, B4-B5, B6, B7, C1-C4, D)
 * - Circularity intelligence distinguishing theoretical recyclability from verified local recovery
 * - Alternative scenario comparison with boundary compatibility checks
 * - Traceable evidence & reference ledger
 * - Safe snapshot-backed apply and rollback
 */

import { Project } from '../types/project';
import {
  P40_ENGINE_VERSION,
  P40_SCHEMA_VERSION,
  P40AuditScenario,
  P40CalculationResult,
  P40CarbonFactorEvidenceRecord,
  P40CircularityAuditSummary,
  P40CircularityOpportunity,
  P40DataCompletenessStatus,
  P40LifecycleBoundarySettings,
  P40LifecycleStageCode,
  P40MaterialCalculationResult,
  P40MaterialCategory,
  P40MaterialInventoryItem,
  P40MaterialUnit,
  P40ProvenanceClassification,
  P40ScenarioComparisonResult,
  P40StageBreakdownResult,
  P40UnitConversionTrace,
  ProjectP40AuditState,
} from '../types/p40CarbonCircularity';
import { createProjectSnapshot } from './versioningService';

export const P40_CATEGORY_LABELS: Record<P40MaterialCategory, string> = {
  'substructure-foundation': 'Substructure & Foundations',
  'superstructure-frame': 'Superstructure Frame (Columns & Beams)',
  'superstructure-floors': 'Superstructure Upper Floor Slabs',
  'superstructure-roof': 'Superstructure Roof Deck & Membrane',
  'external-envelope-facade': 'External Envelope & Facade Cladding',
  'fenestration-openings': 'Windows, Doors & Glazed Openings',
  'internal-partitions-walls': 'Internal Partitions & Linings',
  'internal-finishes-joinery': 'Internal Finishes & Flooring',
  'mep-building-services': 'MEP Building Services',
  'external-site-works': 'External Site Works & Hardscaping',
};

export const P40_STAGE_TITLES: Record<P40LifecycleStageCode, string> = {
  'A1-A3': 'A1–A3 Product Stage (Raw Material Supply, Transport, Manufacturing)',
  'A4': 'A4 Construction Process — Transport to Site',
  'A5': 'A5 Construction Process — Site Waste & Installation',
  'B1-B3': 'B1–B3 Use Stage — In-Use Release, Maintenance & Repair',
  'B4-B5': 'B4–B5 Use Stage — Component Replacement & Refurbishment',
  'B6': 'B6 Operational Energy Use (Kept Separate from Embodied Carbon)',
  'B7': 'B7 Operational Water Use (Kept Separate from Embodied Carbon)',
  'C1-C4': 'C1–C4 End-of-Life Stage (Deconstruction, Processing, Disposal)',
  'D': 'Module D Benefits & Loads Beyond System Boundary (Reported Separately)',
};

/**
 * PHASE 8 — Built-in Reference Evidence Ledger
 * Documented reference datasets (ICE v3.0 / RICS WLCA 2nd Ed / CIBSE TM65 benchmarks).
 * Note: Reference values are clearly labelled as published generic benchmarks, not supplier-specific EPD claims.
 */
export const P40_REFERENCE_EVIDENCE_LEDGER: P40CarbonFactorEvidenceRecord[] = [
  {
    factorId: 'p40-ref-concrete-c30-cem1',
    title: 'Ready-Mix Concrete C30/37 (CEM I Baseline with 2% Reinforcement Allowance)',
    organization: 'Circular Ecology / University of Bath (ICE Database)',
    sourceIdentifierOrLink: 'ICE-v3.0-CONC-C30-37-CEM1',
    datasetVersion: 'ICE v3.0 (2019)',
    publicationYear: 2019,
    geography: 'UK / Global Generic Benchmark',
    applicabilityNotes: 'Standard structural concrete foundations, slabs, and frame elements using conventional Portland cement.',
    applicableCategory: 'substructure-foundation',
    applicableMaterialName: 'Ready-Mix Structural Concrete C30/37',
    declaredUnit: 'kg',
    a1a3FactorKgCO2ePerUnit: 0.159,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 0.014,
    moduleDFactorKgCO2ePerUnit: -0.008,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 2400,
    referenceServiceLifeYears: 60,
    defaultSiteWastePercent: 5,
    coveredStages: ['A1-A3', 'A4', 'A5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 15,
    knownLimitations: [
      'Generic regional average; actual batch GWP depends on local clinker ratio and supplementary cementitious materials (GGBS/fly ash).',
      'End-of-life crushing downcycles concrete into aggregate sub-base rather than closed-loop structural cement.',
    ],
  },
  {
    factorId: 'p40-ref-concrete-c30-ggbs50',
    title: 'Low-Carbon Concrete C30/37 (50% GGBS Cement Replacement Mix)',
    organization: 'Circular Ecology / RICS WLCA Benchmark Reference',
    sourceIdentifierOrLink: 'ICE-v3.0-CONC-C30-37-GGBS50',
    datasetVersion: 'ICE v3.0 / RICS WLCA 2024',
    publicationYear: 2024,
    geography: 'Europe / International Benchmark',
    applicabilityNotes: 'Lower-clinker structural concrete mix with 50% Ground Granulated Blast-furnace Slag (GGBS) replacement.',
    applicableCategory: 'substructure-foundation',
    applicableMaterialName: 'Low-Carbon Concrete C30/37 (50% GGBS)',
    declaredUnit: 'kg',
    a1a3FactorKgCO2ePerUnit: 0.102,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 0.013,
    moduleDFactorKgCO2ePerUnit: -0.010,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 2400,
    referenceServiceLifeYears: 60,
    defaultSiteWastePercent: 5,
    coveredStages: ['A1-A3', 'A4', 'A5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 12,
    knownLimitations: [
      'Slower early-age strength gain may affect cold-weather formwork striking schedules.',
      'Requires verification of regional GGBS supply chain availability.',
    ],
  },
  {
    factorId: 'p40-ref-steel-sections-avg',
    title: 'Structural Steel Sections (Global/UK Average BOF/EAF Mix)',
    organization: 'Circular Ecology / Worldsteel LCI',
    sourceIdentifierOrLink: 'ICE-v3.0-STEEL-SECTIONS-AVG',
    datasetVersion: 'ICE v3.0 (2019)',
    publicationYear: 2019,
    geography: 'Global Average Benchmark',
    applicabilityNotes: 'Hot-rolled structural steel beams and columns with standard global recycled scrap share (~40%).',
    applicableCategory: 'superstructure-frame',
    applicableMaterialName: 'Hot-Rolled Structural Steel Sections',
    declaredUnit: 'kg',
    a1a3FactorKgCO2ePerUnit: 1.55,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 0.025,
    moduleDFactorKgCO2ePerUnit: -0.62,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 7850,
    referenceServiceLifeYears: 60,
    defaultSiteWastePercent: 2,
    coveredStages: ['A1-A3', 'A4', 'A5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 18,
    knownLimitations: [
      'High variation between Basic Oxygen Furnace (BOF) and Electric Arc Furnace (EAF) production routes.',
      'Direct section reuse at end-of-life requires bolted connections and structural re-testing.',
    ],
  },
  {
    factorId: 'p40-ref-steel-eaf-high-scrap',
    title: 'Electric Arc Furnace (EAF) Structural Steel (High Recycled Scrap Route)',
    organization: 'RICS WLCA / European EAF Reference Dataset',
    sourceIdentifierOrLink: 'WLCA-2024-STEEL-EAF-HIGH-SCRAP',
    datasetVersion: 'RICS WLCA 2024 Reference',
    publicationYear: 2024,
    geography: 'Europe / North America',
    applicabilityNotes: 'Structural steel sections produced via Electric Arc Furnace with >85% scrap feedstock.',
    applicableCategory: 'superstructure-frame',
    applicableMaterialName: 'EAF Recycled Structural Steel Sections',
    declaredUnit: 'kg',
    a1a3FactorKgCO2ePerUnit: 0.68,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 0.025,
    moduleDFactorKgCO2ePerUnit: -0.15,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 7850,
    referenceServiceLifeYears: 60,
    defaultSiteWastePercent: 2,
    coveredStages: ['A1-A3', 'A4', 'A5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 14,
    knownLimitations: [
      'Lower Module D net credit compared to virgin BOF steel because input already contains high scrap fraction.',
      'Requires mill-specific procurement verification.',
    ],
  },
  {
    factorId: 'p40-ref-mass-timber-clt',
    title: 'Engineered Mass Timber (Cross-Laminated Timber / Glulam Elements)',
    organization: 'Circular Ecology / Wood for Good Reference',
    sourceIdentifierOrLink: 'ICE-v3.0-TIMBER-CLT-GLULAM',
    datasetVersion: 'ICE v3.0 / EN 15804 Reference',
    publicationYear: 2022,
    geography: 'Europe / UK / Global Reference',
    applicabilityNotes: 'Kiln-dried engineered structural timber slabs, walls, columns, and beams from certified forestry.',
    applicableCategory: 'superstructure-floors',
    applicableMaterialName: 'Cross-Laminated Timber (CLT) / Glulam',
    declaredUnit: 'kg',
    a1a3FactorKgCO2ePerUnit: 0.437,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 0.045,
    moduleDFactorKgCO2ePerUnit: -0.28,
    biogenicStorageKgCO2ePerUnit: -1.64,
    densityKgPerM3: 480,
    referenceServiceLifeYears: 60,
    defaultSiteWastePercent: 4,
    coveredStages: ['A1-A3', 'A4', 'A5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 15,
    knownLimitations: [
      'Biogenic carbon storage (-1.64 kgCO2e/kg) is balanced by +1.64 kgCO2e/kg release in C3-C4 per EN 15978.',
      'Requires moisture protection during construction and acoustic detailing for floors.',
    ],
  },
  {
    factorId: 'p40-ref-clay-brick-facade',
    title: 'Fired Clay Facing Brick & Cement Mortar Facade Leaf',
    organization: 'Circular Ecology / Brick Development Association',
    sourceIdentifierOrLink: 'ICE-v3.0-MASONRY-CLAY-BRICK',
    datasetVersion: 'ICE v3.0 (2019)',
    publicationYear: 2019,
    geography: 'UK / Global Generic Benchmark',
    applicabilityNotes: 'Standard exterior clay masonry cavity wall leaf laid in cementitious mortar.',
    applicableCategory: 'external-envelope-facade',
    applicableMaterialName: 'Fired Clay Brick Masonry',
    declaredUnit: 'kg',
    a1a3FactorKgCO2ePerUnit: 0.213,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 0.012,
    moduleDFactorKgCO2ePerUnit: -0.006,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 1900,
    referenceServiceLifeYears: 60,
    defaultSiteWastePercent: 8,
    coveredStages: ['A1-A3', 'A4', 'A5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 15,
    knownLimitations: [
      'Portland cement mortar prevents intact brick salvaging; lime mortar is required for whole-brick reuse.',
    ],
  },
  {
    factorId: 'p40-ref-reclaimed-brick-lime',
    title: 'Reclaimed Clay Facing Brick Laid in Reversible Lime Mortar',
    organization: 'RICS WLCA Circularity Benchmark Reference',
    sourceIdentifierOrLink: 'WLCA-2024-RECLAIMED-BRICK-LIME',
    datasetVersion: 'RICS WLCA 2024 Reference',
    publicationYear: 2024,
    geography: 'Europe / UK Benchmark',
    applicabilityNotes: 'Salvaged facing bricks cleaned and re-laid with hydraulic lime mortar enabling future disassembly.',
    applicableCategory: 'external-envelope-facade',
    applicableMaterialName: 'Reclaimed Clay Brick in Lime Mortar',
    declaredUnit: 'kg',
    a1a3FactorKgCO2ePerUnit: 0.048,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 0.010,
    moduleDFactorKgCO2ePerUnit: -0.035,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 1850,
    referenceServiceLifeYears: 60,
    defaultSiteWastePercent: 5,
    coveredStages: ['A1-A3', 'A4', 'A5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 20,
    knownLimitations: [
      'Subject to local reclamation yard batch availability and frost-resistance testing.',
    ],
  },
  {
    factorId: 'p40-ref-alu-double-glazing',
    title: 'Double-Glazed Thermally Broken Aluminium Window Assembly',
    organization: 'CIBSE TM65 / ICE v3.0 Fenestration Benchmark',
    sourceIdentifierOrLink: 'ICE-v3.0-WIN-ALU-DG',
    datasetVersion: 'ICE v3.0 / RICS WLCA 2021',
    publicationYear: 2021,
    geography: 'Global Generic Benchmark',
    applicabilityNotes: 'Exterior window and glazed door assemblies per m2 opening area.',
    applicableCategory: 'fenestration-openings',
    applicableMaterialName: 'Double-Glazed Aluminium Window Assembly',
    declaredUnit: 'm2',
    a1a3FactorKgCO2ePerUnit: 165.0,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 6.5,
    moduleDFactorKgCO2ePerUnit: -42.0,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 1100,
    referenceServiceLifeYears: 30,
    defaultSiteWastePercent: 2,
    coveredStages: ['A1-A3', 'A4', 'A5', 'B4-B5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 18,
    knownLimitations: [
      'Typical 30-year service life triggers 1 full replacement cycle over a 60-year study period.',
    ],
  },
  {
    factorId: 'p40-ref-timber-alu-glazing',
    title: 'Timber-Aluminium Composite Window Assembly (High-Recycled Alu Clad)',
    organization: 'European Fenestration Reference Dataset',
    sourceIdentifierOrLink: 'EN15804-WIN-TIMBER-ALU-REF',
    datasetVersion: '2023 Reference Dataset',
    publicationYear: 2023,
    geography: 'Europe / UK',
    applicabilityNotes: 'Engineered timber frame with demountable recycled aluminium external weather cladding.',
    applicableCategory: 'fenestration-openings',
    applicableMaterialName: 'Timber-Aluminium Composite Window',
    declaredUnit: 'm2',
    a1a3FactorKgCO2ePerUnit: 88.0,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 4.8,
    moduleDFactorKgCO2ePerUnit: -19.0,
    biogenicStorageKgCO2ePerUnit: -18.5,
    densityKgPerM3: 900,
    referenceServiceLifeYears: 35,
    defaultSiteWastePercent: 2,
    coveredStages: ['A1-A3', 'A4', 'A5', 'B4-B5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 15,
    knownLimitations: [
      'Assumes Gasket-mounted glazing units can be replaced separately from primary timber frames if maintained.',
    ],
  },
  {
    factorId: 'p40-ref-gypsum-steel-partition',
    title: 'Gypsum Plasterboard on Light-Gauge Steel Stud Partition',
    organization: 'Circular Ecology / GPDA Reference',
    sourceIdentifierOrLink: 'ICE-v3.0-PART-GYPSUM-STEEL',
    datasetVersion: 'ICE v3.0 (2019)',
    publicationYear: 2019,
    geography: 'Global Generic Benchmark',
    applicabilityNotes: 'Internal non-loadbearing partition wall assembly (2x12.5mm gypsum board + steel C-studs + acoustic batts).',
    applicableCategory: 'internal-partitions-walls',
    applicableMaterialName: 'Gypsum & Steel Stud Partition Assembly',
    declaredUnit: 'm2',
    a1a3FactorKgCO2ePerUnit: 24.5,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 2.1,
    moduleDFactorKgCO2ePerUnit: -3.2,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 320,
    referenceServiceLifeYears: 30,
    defaultSiteWastePercent: 10,
    coveredStages: ['A1-A3', 'A4', 'A5', 'B4-B5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 15,
    knownLimitations: [
      'Taped and jointed plasterboard suffers high breakage during strip-out unless demountable panel joints are specified.',
    ],
  },
  {
    factorId: 'p40-ref-demountable-timber-partition',
    title: 'Demountable Timber Stud & Recycled Gypsum Acoustic Partition',
    organization: 'Drylining & Bio-Insulation Reference Benchmark',
    sourceIdentifierOrLink: 'EN15804-PART-DEMOUNT-TIMBER',
    datasetVersion: '2023 Reference Dataset',
    publicationYear: 2023,
    geography: 'Europe / UK',
    applicabilityNotes: 'Dry-jointed timber stud partition with screw-fixed recycled gypsum boards and wood-fibre insulation.',
    applicableCategory: 'internal-partitions-walls',
    applicableMaterialName: 'Demountable Timber & Recycled Gypsum Partition',
    declaredUnit: 'm2',
    a1a3FactorKgCO2ePerUnit: 13.2,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 1.8,
    moduleDFactorKgCO2ePerUnit: -1.5,
    biogenicStorageKgCO2ePerUnit: -11.4,
    densityKgPerM3: 280,
    referenceServiceLifeYears: 30,
    defaultSiteWastePercent: 6,
    coveredStages: ['A1-A3', 'A4', 'A5', 'B4-B5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 14,
    knownLimitations: [
      'Requires dry batten/clip detailing instead of wet skim plaster to preserve board disassembly.',
    ],
  },
  {
    factorId: 'p40-ref-porcelain-tile-screed',
    title: 'Vitrified Porcelain Tile Flooring on Cement-Sand Screed Bed',
    organization: 'Circular Ecology / ICE v3.0',
    sourceIdentifierOrLink: 'ICE-v3.0-FINISH-PORCELAIN-SCREED',
    datasetVersion: 'ICE v3.0 (2019)',
    publicationYear: 2019,
    geography: 'Global Generic Benchmark',
    applicabilityNotes: 'Adhesive-bonded ceramic/porcelain floor tile over 50mm cement screed.',
    applicableCategory: 'internal-finishes-joinery',
    applicableMaterialName: 'Porcelain Tile on Cement Screed',
    declaredUnit: 'm2',
    a1a3FactorKgCO2ePerUnit: 29.8,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 2.4,
    moduleDFactorKgCO2ePerUnit: -0.9,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 2000,
    referenceServiceLifeYears: 25,
    defaultSiteWastePercent: 7,
    coveredStages: ['A1-A3', 'A4', 'A5', 'B4-B5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 16,
    knownLimitations: [
      'Wet cement adhesive bond prevents intact tile recovery at refurbishment.',
    ],
  },
  {
    factorId: 'p40-ref-floating-engineered-timber-floor',
    title: 'Floating Engineered Oak Timber Flooring on Cork Acoustic Underlay',
    organization: 'European Parquet Federation (FEP) Reference',
    sourceIdentifierOrLink: 'FEP-2022-FLOATING-OAK-CORK',
    datasetVersion: '2022 Reference Dataset',
    publicationYear: 2022,
    geography: 'Europe / International',
    applicabilityNotes: 'Click-lock floating engineered timber plank floor laid without wet adhesives over recycled cork.',
    applicableCategory: 'internal-finishes-joinery',
    applicableMaterialName: 'Floating Engineered Timber & Cork Floor',
    declaredUnit: 'm2',
    a1a3FactorKgCO2ePerUnit: 11.4,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 1.5,
    moduleDFactorKgCO2ePerUnit: -2.1,
    biogenicStorageKgCO2ePerUnit: -14.2,
    densityKgPerM3: 650,
    referenceServiceLifeYears: 30,
    defaultSiteWastePercent: 5,
    coveredStages: ['A1-A3', 'A4', 'A5', 'B4-B5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 15,
    knownLimitations: [
      'Not suitable for wet-room zones without waterproof membrane detailing.',
    ],
  },
  {
    factorId: 'p40-ref-mep-services-gia',
    title: 'MEP Building Services Allowance (HVAC, Electrical, Plumbing per m2 GIA)',
    organization: 'CIBSE TM65 / RICS WLCA 2nd Ed Benchmark',
    sourceIdentifierOrLink: 'CIBSE-TM65-MEP-RES-COMM',
    datasetVersion: 'CIBSE TM65 (2021)',
    publicationYear: 2021,
    geography: 'UK / Global Reference',
    applicabilityNotes: 'Composite building services embodied carbon benchmark normalized per m2 Gross Internal Area.',
    applicableCategory: 'mep-building-services',
    applicableMaterialName: 'MEP Building Services Composite Allowance',
    declaredUnit: 'm2',
    a1a3FactorKgCO2ePerUnit: 75.0,
    a4TransportKgCO2ePerTonneKm: 0.105,
    c1c4FactorKgCO2ePerUnit: 4.5,
    moduleDFactorKgCO2ePerUnit: -12.0,
    biogenicStorageKgCO2ePerUnit: 0,
    densityKgPerM3: 450,
    referenceServiceLifeYears: 20,
    defaultSiteWastePercent: 3,
    coveredStages: ['A1-A3', 'A4', 'A5', 'B4-B5', 'C1-C4', 'D'],
    provenance: 'published-reference-data',
    reviewStatus: 'published-generic',
    uncertaintyRangePercent: 25,
    knownLimitations: [
      'Area-based benchmark; replace with component-specific CIBSE TM65 Mid-Level calculations once plant schedules are finalized.',
    ],
  },
];

/**
 * PHASE 4 — Explicit Unit Conversion Engine
 * Validates unit compatibility and physical properties (thicknessM, densityKgPerM3) before converting.
 * Never silently substitutes 0 or guesses missing physical constants.
 */
export function convertP40MaterialQuantity(params: {
  quantity: number | null;
  sourceUnit: P40MaterialUnit;
  targetUnit: P40MaterialUnit;
  thicknessM?: number | null;
  densityKgPerM3?: number | null;
}): P40UnitConversionTrace {
  const { quantity, sourceUnit, targetUnit, thicknessM, densityKgPerM3 } = params;

  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) {
    return {
      isCompatible: false,
      inputQuantity: null,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: null,
      massKg: null,
      formulaUsed: 'Missing quantity input',
      errorMessage: 'Material quantity is missing or not a finite number. Missing quantities are never assumed to be zero.',
    };
  }

  if (quantity < 0) {
    return {
      isCompatible: false,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: null,
      massKg: null,
      formulaUsed: 'Invalid negative quantity',
      errorMessage: `Material quantity cannot be negative (received ${quantity} ${sourceUnit}).`,
    };
  }

  // Genuine zero quantity is supported and distinct from missing data
  if (quantity === 0) {
    return {
      isCompatible: true,
      inputQuantity: 0,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: 0,
      massKg: 0,
      formulaUsed: `Explicit zero quantity: 0 ${sourceUnit} = 0 ${targetUnit}`,
    };
  }

  const hasThickness = typeof thicknessM === 'number' && Number.isFinite(thicknessM) && thicknessM > 0;
  const hasDensity = typeof densityKgPerM3 === 'number' && Number.isFinite(densityKgPerM3) && densityKgPerM3 > 0;

  // Derive massKg when possible for A4 transport and circularity mass metrics
  let massKg: number | null = null;
  if (sourceUnit === 'kg') {
    massKg = quantity;
  } else if (sourceUnit === 'tonne') {
    massKg = quantity * 1000;
  } else if (sourceUnit === 'm3' && hasDensity) {
    massKg = quantity * densityKgPerM3!;
  } else if (sourceUnit === 'm2' && hasThickness && hasDensity) {
    massKg = quantity * thicknessM! * densityKgPerM3!;
  }

  // Direct unit match
  if (sourceUnit === targetUnit) {
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: quantity,
      massKg,
      formulaUsed: `Direct unit match: ${quantity} ${sourceUnit}`,
    };
  }

  // Mass <-> Mass
  if (sourceUnit === 'kg' && targetUnit === 'tonne') {
    const converted = quantity / 1000;
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg: quantity,
      formulaUsed: `${quantity} kg ÷ 1,000 = ${converted} tonne`,
    };
  }
  if (sourceUnit === 'tonne' && targetUnit === 'kg') {
    const converted = quantity * 1000;
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg: converted,
      formulaUsed: `${quantity} tonne × 1,000 = ${converted} kg`,
    };
  }

  // Area <-> Volume
  if (sourceUnit === 'm2' && targetUnit === 'm3') {
    if (!hasThickness) {
      return {
        isCompatible: false,
        inputQuantity: quantity,
        inputUnit: sourceUnit,
        targetUnit,
        convertedQuantity: null,
        massKg: null,
        formulaUsed: 'Area (m2) to Volume (m3) requires positive thicknessM',
        errorMessage: 'Cannot convert m2 to m3 without a positive material thickness (thicknessM).',
      };
    }
    const converted = quantity * thicknessM!;
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg,
      formulaUsed: `${quantity} m2 × ${thicknessM} m thickness = ${converted} m3`,
    };
  }
  if (sourceUnit === 'm3' && targetUnit === 'm2') {
    if (!hasThickness) {
      return {
        isCompatible: false,
        inputQuantity: quantity,
        inputUnit: sourceUnit,
        targetUnit,
        convertedQuantity: null,
        massKg: null,
        formulaUsed: 'Volume (m3) to Area (m2) requires positive thicknessM',
        errorMessage: 'Cannot convert m3 to m2 without a positive material thickness (thicknessM).',
      };
    }
    const converted = quantity / thicknessM!;
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg,
      formulaUsed: `${quantity} m3 ÷ ${thicknessM} m thickness = ${converted} m2`,
    };
  }

  // Volume <-> Mass
  if (sourceUnit === 'm3' && (targetUnit === 'kg' || targetUnit === 'tonne')) {
    if (!hasDensity) {
      return {
        isCompatible: false,
        inputQuantity: quantity,
        inputUnit: sourceUnit,
        targetUnit,
        convertedQuantity: null,
        massKg: null,
        formulaUsed: `Volume (m3) to ${targetUnit} requires positive densityKgPerM3`,
        errorMessage: `Cannot convert m3 to ${targetUnit} without a positive material density (densityKgPerM3).`,
      };
    }
    const kg = quantity * densityKgPerM3!;
    const converted = targetUnit === 'kg' ? kg : kg / 1000;
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg: kg,
      formulaUsed:
        targetUnit === 'kg'
          ? `${quantity} m3 × ${densityKgPerM3} kg/m3 = ${kg} kg`
          : `(${quantity} m3 × ${densityKgPerM3} kg/m3) ÷ 1,000 = ${converted} tonne`,
    };
  }
  if ((sourceUnit === 'kg' || sourceUnit === 'tonne') && targetUnit === 'm3') {
    if (!hasDensity) {
      return {
        isCompatible: false,
        inputQuantity: quantity,
        inputUnit: sourceUnit,
        targetUnit,
        convertedQuantity: null,
        massKg: null,
        formulaUsed: `${sourceUnit} to Volume (m3) requires positive densityKgPerM3`,
        errorMessage: `Cannot convert ${sourceUnit} to m3 without a positive material density (densityKgPerM3).`,
      };
    }
    const kg = sourceUnit === 'kg' ? quantity : quantity * 1000;
    const converted = kg / densityKgPerM3!;
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg: kg,
      formulaUsed: `${kg} kg ÷ ${densityKgPerM3} kg/m3 = ${converted} m3`,
    };
  }

  // Area <-> Mass
  if (sourceUnit === 'm2' && (targetUnit === 'kg' || targetUnit === 'tonne')) {
    if (!hasThickness || !hasDensity) {
      return {
        isCompatible: false,
        inputQuantity: quantity,
        inputUnit: sourceUnit,
        targetUnit,
        convertedQuantity: null,
        massKg: null,
        formulaUsed: `Area (m2) to ${targetUnit} requires both thicknessM and densityKgPerM3`,
        errorMessage: `Cannot convert m2 to ${targetUnit} without both positive thicknessM (${thicknessM ?? 'missing'}) and densityKgPerM3 (${densityKgPerM3 ?? 'missing'}).`,
      };
    }
    const kg = quantity * thicknessM! * densityKgPerM3!;
    const converted = targetUnit === 'kg' ? kg : kg / 1000;
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg: kg,
      formulaUsed:
        targetUnit === 'kg'
          ? `${quantity} m2 × ${thicknessM} m × ${densityKgPerM3} kg/m3 = ${kg} kg`
          : `(${quantity} m2 × ${thicknessM} m × ${densityKgPerM3} kg/m3) ÷ 1,000 = ${converted} tonne`,
    };
  }
  if ((sourceUnit === 'kg' || sourceUnit === 'tonne') && targetUnit === 'm2') {
    if (!hasThickness || !hasDensity) {
      return {
        isCompatible: false,
        inputQuantity: quantity,
        inputUnit: sourceUnit,
        targetUnit,
        convertedQuantity: null,
        massKg: null,
        formulaUsed: `${sourceUnit} to Area (m2) requires both thicknessM and densityKgPerM3`,
        errorMessage: `Cannot convert ${sourceUnit} to m2 without both positive thicknessM and densityKgPerM3.`,
      };
    }
    const kg = sourceUnit === 'kg' ? quantity : quantity * 1000;
    const converted = kg / (thicknessM! * densityKgPerM3!);
    return {
      isCompatible: true,
      inputQuantity: quantity,
      inputUnit: sourceUnit,
      targetUnit,
      convertedQuantity: converted,
      massKg: kg,
      formulaUsed: `${kg} kg ÷ (${thicknessM} m × ${densityKgPerM3} kg/m3) = ${converted} m2`,
    };
  }

  return {
    isCompatible: false,
    inputQuantity: quantity,
    inputUnit: sourceUnit,
    targetUnit,
    convertedQuantity: null,
    massKg: null,
    formulaUsed: `Incompatible units: ${sourceUnit} -> ${targetUnit}`,
    errorMessage: `Incompatible unit conversion from "${sourceUnit}" to "${targetUnit}".`,
  };
}

/**
 * PHASE 2 & 3 — Derive Material Inventory from Existing Project Data
 * Uses real project rooms, floors, structural coordination, and facade alternatives when available.
 * When rooms are absent, clearly marks quantities as 'explicit-scenario-assumption' or 'unsupported-or-missing'.
 */
export function deriveP40InventoryFromProject(project: Project): {
  grossInternalFloorAreaM2: number | null;
  inventory: P40MaterialInventoryItem[];
  derivationNotes: string[];
} {
  const unitToMetres = project.unit === 'feet' ? 0.3048 : 1.0;
  const floors = Math.max(1, project.floors || 1);
  const storeyHeightM = 3.0;
  const rooms = project.floorPlan?.rooms ?? [];
  const derivationNotes: string[] = [];

  let level1AreaM2 = 0;
  let totalRoomsAreaM2 = 0;
  let totalRoomsPerimeterM = 0;

  for (const r of rooms) {
    const wM = r.width * unitToMetres;
    const lM = r.length * unitToMetres;
    if (wM > 0 && lM > 0) {
      const area = wM * lM;
      totalRoomsAreaM2 += area;
      totalRoomsPerimeterM += 2 * (wM + lM);
      if ((r.floorLevel || 1) === 1) {
        level1AreaM2 += area;
      }
    }
  }

  let footprintM2: number;
  let gfaM2: number;
  let quantityProvenance: P40ProvenanceClassification;

  if (totalRoomsAreaM2 > 0) {
    footprintM2 = level1AreaM2 > 0 ? level1AreaM2 : totalRoomsAreaM2 / floors;
    const hasMultiFloorRooms = rooms.some((r) => (r.floorLevel || 1) > 1);
    gfaM2 = hasMultiFloorRooms ? totalRoomsAreaM2 : footprintM2 * floors;
    quantityProvenance = 'deterministically-derived';
    derivationNotes.push(
      `Derived ${gfaM2.toFixed(1)} m2 Gross Internal Floor Area across ${rooms.length} room(s) (${project.unit} converted to metric m2).`
    );
  } else {
    const plotW = Math.max(1, project.plotWidth * unitToMetres);
    const plotL = Math.max(1, project.plotLength * unitToMetres);
    footprintM2 = Number((plotW * plotL * 0.55).toFixed(2));
    gfaM2 = Number((footprintM2 * floors).toFixed(2));
    quantityProvenance = 'explicit-scenario-assumption';
    derivationNotes.push(
      'No 2D floor-plan rooms placed yet; baseline quantities use an explicit 55% plot footprint scenario assumption.'
    );
  }

  const allRoomIds = rooms.map((r) => r.id);
  const activeDesign = project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ?? project.designAlternatives?.[0];
  const primaryFacadeMat = activeDesign?.facade?.primaryMaterial ?? 'brick';
  const framingSystem = project.structuralCoordination?.framingSystem ?? 'reinforced-concrete-frame';
  const isSteelFrame = framingSystem === 'structural-steel-frame';
  const isTimberFrame = framingSystem === 'mass-timber-post-beam' || framingSystem === 'light-timber-framing';

  const inventory: P40MaterialInventoryItem[] = [];

  // 1. Substructure Foundation & Ground Slab
  inventory.push({
    itemId: 'p40-item-substructure-slab',
    materialName: 'Ready-Mix Concrete C30/37 Substructure',
    assemblyOrElementName: 'Ground Bearing Slab & Strip Footings (250mm eq.)',
    category: 'substructure-foundation',
    assignedRoomIds: rooms.filter((r) => (r.floorLevel || 1) === 1).map((r) => r.id),
    assignedFloorLevel: 1,
    includedInParentAssembly: false,
    quantity: Number(footprintM2.toFixed(2)),
    unit: 'm2',
    thicknessM: 0.25,
    densityKgPerM3: 2400,
    quantityProvenance,
    quantitySourceDescription: `Ground footprint (${footprintM2.toFixed(1)} m2) × 0.25m structural slab thickness`,
    linkedFactorId: 'p40-ref-concrete-c30-cem1',
    customServiceLifeYears: 60,
    replacementAssumptionSource: 'BS EN 15978 / RICS WLCA 60-year structural design life',
    siteWastePercent: 5,
    transportDistanceKm: 50,
    recycledContentPercent: 10,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: 0,
    theoreticalRecyclabilityPercent: 85,
    localRecoveryAvailability: 'verified-local-infrastructure',
    disassemblyRating: 'monolithic-cast-in-place',
    circularityNotes: 'Cast-in-situ concrete cannot be disassembled intact; locally crushed to RCA sub-base aggregate at EoL.',
    isFlaggedIncomplete: false,
  });

  // 2. Superstructure Frame
  const columns = project.structuralCoordination?.columns ?? [];
  const beams = project.structuralCoordination?.beams ?? [];
  let frameVolumeM3 = Number((gfaM2 * 0.045).toFixed(3));
  let frameDesc = `Estimated structural frame volume (${gfaM2.toFixed(1)} m2 GFA × 0.045 m3/m2 ratio)`;
  if (columns.length > 0 || beams.length > 0) {
    let calcVol = 0;
    for (const c of columns) {
      calcVol += (c.width || 0.35) * unitToMetres * (c.depth || 0.35) * unitToMetres * storeyHeightM * floors;
    }
    for (const b of beams) {
      const span = Math.max(1, Math.hypot(b.endX - b.startX, b.endY - b.startY) * unitToMetres);
      calcVol += (b.profileWidth || 0.3) * unitToMetres * (b.profileDepth || 0.45) * unitToMetres * span * floors;
    }
    if (calcVol > 0) {
      frameVolumeM3 = Number(calcVol.toFixed(3));
      frameDesc = `Derived from ${columns.length} structural columns and ${beams.length} beams across ${floors} floor(s)`;
    }
  }

  inventory.push({
    itemId: 'p40-item-superstructure-frame',
    materialName: isSteelFrame
      ? 'Hot-Rolled Structural Steel Sections'
      : isTimberFrame
        ? 'Engineered Glulam Timber Frame'
        : 'Reinforced Concrete Frame Columns & Beams',
    assemblyOrElementName: 'Primary Superstructure Frame',
    category: 'superstructure-frame',
    assignedRoomIds: allRoomIds,
    assignedFloorLevel: null,
    includedInParentAssembly: false,
    quantity: frameVolumeM3,
    unit: 'm3',
    densityKgPerM3: isSteelFrame ? 7850 : isTimberFrame ? 480 : 2400,
    quantityProvenance,
    quantitySourceDescription: frameDesc,
    linkedFactorId: isSteelFrame
      ? 'p40-ref-steel-sections-avg'
      : isTimberFrame
        ? 'p40-ref-mass-timber-clt'
        : 'p40-ref-concrete-c30-cem1',
    customServiceLifeYears: 60,
    replacementAssumptionSource: 'RICS WLCA primary structure lifespan (60 years)',
    siteWastePercent: isSteelFrame ? 2 : 5,
    transportDistanceKm: isSteelFrame ? 200 : 60,
    recycledContentPercent: isSteelFrame ? 40 : isTimberFrame ? 0 : 12,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: isSteelFrame || isTimberFrame ? 65 : 0,
    theoreticalRecyclabilityPercent: isSteelFrame ? 98 : 85,
    localRecoveryAvailability: isSteelFrame
      ? 'verified-local-infrastructure'
      : isTimberFrame
        ? 'regional-specialist-only'
        : 'verified-local-infrastructure',
    disassemblyRating: isSteelFrame || isTimberFrame ? 'reversible-mechanical' : 'monolithic-cast-in-place',
    circularityNotes:
      isSteelFrame || isTimberFrame
        ? 'Specify bolted reversible connections rather than welded/grouted joints to enable direct member reuse.'
        : 'Monolithic cast frame requires mechanical demolition at end-of-life.',
    isFlaggedIncomplete: false,
  });

  // 3. Upper Floor Slabs (when floors > 1)
  if (floors > 1) {
    const upperAreaM2 = Number((footprintM2 * (floors - 1)).toFixed(2));
    inventory.push({
      itemId: 'p40-item-upper-floors',
      materialName: isTimberFrame ? 'Cross-Laminated Timber (CLT) Floor Panels' : 'Reinforced Concrete Suspended Slabs',
      assemblyOrElementName: `Upper Floor Slabs (${floors - 1} Upper Level${floors > 2 ? 's' : ''})`,
      category: 'superstructure-floors',
      assignedRoomIds: rooms.filter((r) => (r.floorLevel || 1) > 1).map((r) => r.id),
      assignedFloorLevel: 2,
      includedInParentAssembly: false,
      quantity: upperAreaM2,
      unit: 'm2',
      thicknessM: 0.2,
      densityKgPerM3: isTimberFrame ? 480 : 2400,
      quantityProvenance,
      quantitySourceDescription: `${floors - 1} upper storey(s) × ${footprintM2.toFixed(1)} m2 footprint`,
      linkedFactorId: isTimberFrame ? 'p40-ref-mass-timber-clt' : 'p40-ref-concrete-c30-cem1',
      customServiceLifeYears: 60,
      replacementAssumptionSource: 'RICS WLCA structural floor slab lifespan (60 years)',
      siteWastePercent: 4,
      transportDistanceKm: 80,
      recycledContentPercent: isTimberFrame ? 0 : 10,
      recycledContentProvenance: 'published-reference-data',
      reusePotentialPercent: isTimberFrame ? 60 : 0,
      theoreticalRecyclabilityPercent: 85,
      localRecoveryAvailability: isTimberFrame ? 'regional-specialist-only' : 'verified-local-infrastructure',
      disassemblyRating: isTimberFrame ? 'reversible-mechanical' : 'monolithic-cast-in-place',
      circularityNotes: isTimberFrame
        ? 'Dry-screwed CLT floor panels can be lifted intact if screed is laid over a separation membrane.'
        : 'In-situ concrete slab requires crushing at end-of-life.',
      isFlaggedIncomplete: false,
    });
  }

  // 4. Roof Structure
  inventory.push({
    itemId: 'p40-item-roof-deck',
    materialName: isTimberFrame ? 'Engineered Timber Roof Deck' : 'Reinforced Concrete Roof Slab',
    assemblyOrElementName: 'Primary Roof Structure (220mm eq.)',
    category: 'superstructure-roof',
    assignedRoomIds: [],
    assignedFloorLevel: floors,
    includedInParentAssembly: false,
    quantity: Number(footprintM2.toFixed(2)),
    unit: 'm2',
    thicknessM: 0.22,
    densityKgPerM3: isTimberFrame ? 480 : 2400,
    quantityProvenance,
    quantitySourceDescription: `Roof footprint (${footprintM2.toFixed(1)} m2) × 0.22m thickness`,
    linkedFactorId: isTimberFrame ? 'p40-ref-mass-timber-clt' : 'p40-ref-concrete-c30-cem1',
    customServiceLifeYears: 60,
    replacementAssumptionSource: 'RICS WLCA primary roof deck lifespan (60 years)',
    siteWastePercent: 5,
    transportDistanceKm: 70,
    recycledContentPercent: isTimberFrame ? 0 : 10,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: isTimberFrame ? 55 : 0,
    theoreticalRecyclabilityPercent: 85,
    localRecoveryAvailability: isTimberFrame ? 'regional-specialist-only' : 'verified-local-infrastructure',
    disassemblyRating: isTimberFrame ? 'reversible-mechanical' : 'monolithic-cast-in-place',
    circularityNotes: 'Avoid fully adhered bitumen membranes directly onto structural deck to preserve deck recovery.',
    isFlaggedIncomplete: false,
  });

  // 5. External Facade & Fenestration
  const perimeterM = 4 * Math.sqrt(footprintM2) * 1.12;
  const grossFacadeM2 = perimeterM * storeyHeightM * floors;
  const glazingRatio = activeDesign?.facade?.windowStyle === 'floor-to-ceiling' ? 0.32 : 0.22;
  const windowAreaM2 = Number((grossFacadeM2 * glazingRatio).toFixed(2));
  const opaqueWallM2 = Number((grossFacadeM2 * (1 - glazingRatio)).toFixed(2));

  const isTimberFacade = primaryFacadeMat === 'timber';
  inventory.push({
    itemId: 'p40-item-external-facade',
    materialName: isTimberFacade ? 'Timber Facade Cladding & Backing' : 'Fired Clay Facing Brick Masonry',
    assemblyOrElementName: `External Opaque Facade Envelope (${primaryFacadeMat.toUpperCase()})`,
    category: 'external-envelope-facade',
    assignedRoomIds: allRoomIds,
    assignedFloorLevel: null,
    includedInParentAssembly: false,
    quantity: opaqueWallM2,
    unit: 'm2',
    thicknessM: isTimberFacade ? 0.18 : 0.215,
    densityKgPerM3: isTimberFacade ? 480 : 1900,
    quantityProvenance,
    quantitySourceDescription: `Gross facade (${grossFacadeM2.toFixed(1)} m2) minus ${Math.round(glazingRatio * 100)}% glazing`,
    linkedFactorId: isTimberFacade ? 'p40-ref-mass-timber-clt' : 'p40-ref-clay-brick-facade',
    customServiceLifeYears: 60,
    replacementAssumptionSource: 'RICS WLCA masonry/timber envelope lifespan (60 years)',
    siteWastePercent: isTimberFacade ? 5 : 8,
    transportDistanceKm: 120,
    recycledContentPercent: 0,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: isTimberFacade ? 50 : 15,
    theoreticalRecyclabilityPercent: 80,
    localRecoveryAvailability: 'verified-local-infrastructure',
    disassemblyRating: isTimberFacade ? 'reversible-mechanical' : 'composite-bonded',
    circularityNotes: isTimberFacade
      ? 'Ventilated rainscreen batten fixings allow selective board replacement.'
      : 'Conventional cement mortar prevents intact brick salvaging; specify lime mortar for brick reuse.',
    isFlaggedIncomplete: false,
  });

  inventory.push({
    itemId: 'p40-item-fenestration',
    materialName: 'Double-Glazed Aluminium Window & Door Assemblies',
    assemblyOrElementName: 'External Glazed Fenestration & Doors',
    category: 'fenestration-openings',
    assignedRoomIds: allRoomIds,
    assignedFloorLevel: null,
    includedInParentAssembly: false,
    quantity: windowAreaM2,
    unit: 'm2',
    thicknessM: 0.05,
    densityKgPerM3: 1100,
    quantityProvenance,
    quantitySourceDescription: `${Math.round(glazingRatio * 100)}% window-to-wall ratio across ${grossFacadeM2.toFixed(1)} m2 facade`,
    linkedFactorId: 'p40-ref-alu-double-glazing',
    customServiceLifeYears: 30,
    replacementAssumptionSource: 'RICS WLCA fenestration reference service life (30 years -> 1 replacement in 60y)',
    siteWastePercent: 2,
    transportDistanceKm: 200,
    recycledContentPercent: 35,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: 25,
    theoreticalRecyclabilityPercent: 92,
    localRecoveryAvailability: 'verified-local-infrastructure',
    disassemblyRating: 'semi-reversible-hybrid',
    circularityNotes: 'Aluminium frames have established local scrap remelting pathways; flat glass cullet requires clean separation.',
    isFlaggedIncomplete: false,
  });

  // 6. Internal Partitions
  const partitionAreaM2 = Number(
    Math.max(12, (totalRoomsPerimeterM > 0 ? totalRoomsPerimeterM * 0.55 : perimeterM * 1.3) * storeyHeightM * 0.85).toFixed(2)
  );
  inventory.push({
    itemId: 'p40-item-internal-partitions',
    materialName: 'Gypsum Plasterboard on Light-Gauge Steel Studs',
    assemblyOrElementName: 'Internal Room Partition Walls',
    category: 'internal-partitions-walls',
    assignedRoomIds: allRoomIds,
    assignedFloorLevel: null,
    includedInParentAssembly: false,
    quantity: partitionAreaM2,
    unit: 'm2',
    thicknessM: 0.125,
    densityKgPerM3: 320,
    quantityProvenance,
    quantitySourceDescription: `Derived from internal room perimeters (${partitionAreaM2.toFixed(1)} m2 net wall area)`,
    linkedFactorId: 'p40-ref-gypsum-steel-partition',
    customServiceLifeYears: 30,
    replacementAssumptionSource: 'RICS WLCA interior fit-out partition cycle (30 years)',
    siteWastePercent: 10,
    transportDistanceKm: 100,
    recycledContentPercent: 25,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: 10,
    theoreticalRecyclabilityPercent: 75,
    localRecoveryAvailability: 'regional-specialist-only',
    disassemblyRating: 'composite-bonded',
    circularityNotes: 'Wet plaster skim and taped joints hinder whole-board reuse; steel studs are locally recyclable.',
    isFlaggedIncomplete: false,
  });

  // 7. Internal Floor Finishes
  const treatedFloorM2 = Number((gfaM2 * 0.9).toFixed(2));
  inventory.push({
    itemId: 'p40-item-internal-finishes',
    materialName: 'Porcelain Tile Flooring on Cement Screed',
    assemblyOrElementName: 'Internal Floor Finishes & Screed Bed',
    category: 'internal-finishes-joinery',
    assignedRoomIds: allRoomIds,
    assignedFloorLevel: null,
    includedInParentAssembly: false,
    quantity: treatedFloorM2,
    unit: 'm2',
    thicknessM: 0.05,
    densityKgPerM3: 2000,
    quantityProvenance,
    quantitySourceDescription: `90% net treated floor area (${treatedFloorM2.toFixed(1)} m2)`,
    linkedFactorId: 'p40-ref-porcelain-tile-screed',
    customServiceLifeYears: 25,
    replacementAssumptionSource: 'RICS WLCA floor finishes replacement interval (25 years)',
    siteWastePercent: 7,
    transportDistanceKm: 150,
    recycledContentPercent: 10,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: 0,
    theoreticalRecyclabilityPercent: 50,
    localRecoveryAvailability: 'no-viable-recovery-pathway',
    disassemblyRating: 'composite-bonded',
    circularityNotes: 'Adhesive-bonded tiles and wet screed cannot be recovered intact; switch to floating click-lock flooring for circularity.',
    isFlaggedIncomplete: false,
  });

  // 8. MEP Building Services
  inventory.push({
    itemId: 'p40-item-mep-services',
    materialName: 'MEP Building Services Composite Allowance',
    assemblyOrElementName: 'HVAC, Domestic Water & Electrical Distribution',
    category: 'mep-building-services',
    assignedRoomIds: allRoomIds,
    assignedFloorLevel: null,
    includedInParentAssembly: false,
    quantity: Number(gfaM2.toFixed(2)),
    unit: 'm2',
    thicknessM: 0.04,
    densityKgPerM3: 450,
    quantityProvenance: project.mepCoordination ? 'deterministically-derived' : 'explicit-scenario-assumption',
    quantitySourceDescription: `CIBSE TM65 GIA-normalized services allowance across ${gfaM2.toFixed(1)} m2`,
    linkedFactorId: 'p40-ref-mep-services-gia',
    customServiceLifeYears: 20,
    replacementAssumptionSource: 'CIBSE TM65 / RICS WLCA building services plant & distribution cycle (20 years)',
    siteWastePercent: 3,
    transportDistanceKm: 250,
    recycledContentPercent: 30,
    recycledContentProvenance: 'published-reference-data',
    reusePotentialPercent: 15,
    theoreticalRecyclabilityPercent: 80,
    localRecoveryAvailability: 'regional-specialist-only',
    disassemblyRating: 'semi-reversible-hybrid',
    circularityNotes: 'Accessible surface/ceiling-void routing prevents structural slab chasing during 20-year plant replacement.',
    isFlaggedIncomplete: false,
  });

  // 9. P41 OpenBIM / IFC Preserved Elements (with strict double-counting guard)
  if (project.ifcInterop) {
    const mappedGlobalIds = new Set(project.ifcInterop.idMappings.map((m) => m.sourceGlobalId));
    for (const elem of project.ifcInterop.preservedElements ?? []) {
      const isAlreadyMapped = mappedGlobalIds.has(elem.globalId) || elem.preservationStatus === 'imported-and-editable';
      const firstQty = (elem.quantities ?? []).find((q) => Number.isFinite(q.value) && q.value > 0);
      if (!firstQty) continue;

      let unit: P40MaterialUnit = 'item';
      if (firstQty.quantityType === 'volume') unit = 'm3';
      else if (firstQty.quantityType === 'area') unit = 'm2';
      else if (firstQty.quantityType === 'length') unit = 'm';

      if (unit === 'm2' || unit === 'm3') {
        inventory.push({
          itemId: `p40-ifc-${elem.globalId}`,
          materialName: elem.materials.join(', ') || `IFC ${elem.ifcType} Material`,
          assemblyOrElementName: `IFC Element: ${elem.name} (${elem.globalId})`,
          category: 'superstructure-frame',
          assignedRoomIds: [],
          assignedFloorLevel: null,
          parentAssemblyItemId: isAlreadyMapped ? 'p40-item-superstructure-frame' : null,
          includedInParentAssembly: isAlreadyMapped,
          quantity: Number(firstQty.value.toFixed(3)),
          unit,
          thicknessM: unit === 'm2' ? 0.2 : null,
          densityKgPerM3: 2400,
          quantityProvenance: 'measured-or-imported',
          quantitySourceDescription: `Imported from P41 IFC (${elem.ifcType}, GlobalId ${elem.globalId})`,
          linkedFactorId: 'p40-ref-concrete-c30-cem1',
          customServiceLifeYears: 60,
          replacementAssumptionSource: 'IFC element default 60-year structural lifespan',
          siteWastePercent: 5,
          transportDistanceKm: 80,
          recycledContentPercent: null,
          recycledContentProvenance: 'unsupported-or-missing',
          reusePotentialPercent: null,
          theoreticalRecyclabilityPercent: 80,
          localRecoveryAvailability: 'unknown-unverified',
          disassemblyRating: 'unassessed',
          circularityNotes: isAlreadyMapped
            ? 'Marked as includedInParentAssembly to prevent double counting with native Plotify geometry.'
            : 'Imported IFC element; verify fastening method and local recovery pathway.',
          isFlaggedIncomplete: false,
        });
      }
    }
  }

  return {
    grossInternalFloorAreaM2: Number(gfaM2.toFixed(2)),
    inventory,
    derivationNotes,
  };
}

/**
 * Default P40 Lifecycle Boundary Settings
 * Operational energy (B6) and water (B7) are excluded by default so embodied carbon remains strictly separate
 * unless the user explicitly enables and provides operational data.
 */
export function createDefaultP40BoundarySettings(grossInternalFloorAreaM2: number | null): P40LifecycleBoundarySettings {
  return {
    assessmentPeriodYears: 60,
    functionalUnitDescription: 'Complete building gross internal floor area (m2 GIA) over Reference Study Period',
    grossInternalFloorAreaM2,
    includedStages: {
      'A1-A3': true,
      'A4': true,
      'A5': true,
      'B1-B3': false,
      'B4-B5': true,
      'B6': false,
      'B7': false,
      'C1-C4': true,
      'D': true,
    },
    includeBiogenicCarbonBalance: false,
    reportModuleDSeparately: true,
    includeOperationalEnergyInWholeLife: false,
    annualOperationalElectricityKwhPerYear: null,
    gridElectricityFactorKgCO2ePerKwh: 0.225,
    operationalEnergyProvenance: 'unsupported-or-missing',
    replacementMethodologyNote:
      'B4 component replacement cycles are calculated as max(0, ceil(AssessmentPeriodYears / ComponentServiceLifeYears) - 1) only when an explicit service life and replacement source are recorded.',
    moduleDMethodologyNote:
      'Module D reuse, recovery, and recycling benefits/loads beyond the system boundary are reported strictly separately and never subtracted from A–C embodied or whole-life totals (EN 15978).',
  };
}

/**
 * Creates a low-carbon, high-circularity alternative scenario from a baseline inventory
 */
export function createCircularAlternativeScenario(
  baselineScenario: P40AuditScenario
): P40AuditScenario {
  const nowIso = new Date().toISOString();
  const altInventory: P40MaterialInventoryItem[] = baselineScenario.inventory.map((item) => {
    if (item.category === 'substructure-foundation') {
      return {
        ...item,
        itemId: `${item.itemId}-alt`,
        materialName: 'Low-Carbon Concrete C30/37 (50% GGBS Replacement)',
        linkedFactorId: 'p40-ref-concrete-c30-ggbs50',
        recycledContentPercent: 50,
        recycledContentProvenance: 'explicit-scenario-assumption',
        circularityNotes: '50% GGBS industrial by-product cement replacement reduces clinker intensity.',
      };
    }
    if (item.category === 'superstructure-frame') {
      return {
        ...item,
        itemId: `${item.itemId}-alt`,
        materialName: 'EAF High-Scrap Structural Steel / Mass Timber Hybrid Frame',
        linkedFactorId: item.unit === 'm3' && (item.densityKgPerM3 ?? 0) > 3000
          ? 'p40-ref-steel-eaf-high-scrap'
          : 'p40-ref-mass-timber-clt',
        densityKgPerM3: item.unit === 'm3' && (item.densityKgPerM3 ?? 0) > 3000 ? 7850 : 480,
        recycledContentPercent: item.unit === 'm3' && (item.densityKgPerM3 ?? 0) > 3000 ? 85 : 0,
        recycledContentProvenance: 'explicit-scenario-assumption',
        reusePotentialPercent: 75,
        disassemblyRating: 'reversible-mechanical',
        localRecoveryAvailability: 'verified-local-infrastructure',
        circularityNotes: 'Bolted reversible connections specified for future structural member disassembly and direct reuse.',
      };
    }
    if (item.category === 'superstructure-floors' || item.category === 'superstructure-roof') {
      return {
        ...item,
        itemId: `${item.itemId}-alt`,
        materialName: 'Cross-Laminated Timber (CLT) Demountable Cassette Panels',
        linkedFactorId: 'p40-ref-mass-timber-clt',
        densityKgPerM3: 480,
        reusePotentialPercent: 65,
        disassemblyRating: 'reversible-mechanical',
        localRecoveryAvailability: 'regional-specialist-only',
        circularityNotes: 'Dry-jointed CLT cassettes screwed for non-destructive deconstruction.',
      };
    }
    if (item.category === 'external-envelope-facade') {
      return {
        ...item,
        itemId: `${item.itemId}-alt`,
        materialName: 'Reclaimed Clay Facing Brick in Reversible Lime Mortar',
        linkedFactorId: 'p40-ref-reclaimed-brick-lime',
        densityKgPerM3: 1850,
        recycledContentPercent: 80,
        recycledContentProvenance: 'explicit-scenario-assumption',
        reusePotentialPercent: 80,
        disassemblyRating: 'reversible-mechanical',
        localRecoveryAvailability: 'verified-local-infrastructure',
        circularityNotes: 'Hydraulic lime mortar enables cleaning and intact whole-brick recovery at end-of-life.',
      };
    }
    if (item.category === 'fenestration-openings') {
      return {
        ...item,
        itemId: `${item.itemId}-alt`,
        materialName: 'Timber-Aluminium Composite Window (Recycled Alu Clad)',
        linkedFactorId: 'p40-ref-timber-alu-glazing',
        densityKgPerM3: 900,
        customServiceLifeYears: 35,
        recycledContentPercent: 60,
        recycledContentProvenance: 'explicit-scenario-assumption',
        reusePotentialPercent: 45,
        disassemblyRating: 'reversible-mechanical',
        circularityNotes: 'Clip-on external aluminium weather cladding separates cleanly from timber frame.',
      };
    }
    if (item.category === 'internal-partitions-walls') {
      return {
        ...item,
        itemId: `${item.itemId}-alt`,
        materialName: 'Demountable Timber Stud & Screw-Fixed Recycled Gypsum Partition',
        linkedFactorId: 'p40-ref-demountable-timber-partition',
        densityKgPerM3: 280,
        siteWastePercent: 6,
        recycledContentPercent: 45,
        recycledContentProvenance: 'explicit-scenario-assumption',
        reusePotentialPercent: 55,
        disassemblyRating: 'reversible-mechanical',
        circularityNotes: 'Dry jointing trims replace wet plaster skim so boards can be unscrewed intact.',
      };
    }
    if (item.category === 'internal-finishes-joinery') {
      return {
        ...item,
        itemId: `${item.itemId}-alt`,
        materialName: 'Floating Engineered Oak Timber Flooring on Cork Underlay',
        linkedFactorId: 'p40-ref-floating-engineered-timber-floor',
        densityKgPerM3: 650,
        customServiceLifeYears: 30,
        recycledContentPercent: 30,
        recycledContentProvenance: 'explicit-scenario-assumption',
        reusePotentialPercent: 60,
        disassemblyRating: 'reversible-mechanical',
        localRecoveryAvailability: 'verified-local-infrastructure',
        circularityNotes: 'Adhesive-free click-lock installation allows lifting and re-laying.',
      };
    }
    return {
      ...item,
      itemId: `${item.itemId}-alt`,
    };
  });

  return {
    scenarioId: `p40-scen-circular-${Date.now()}`,
    name: 'Scenario B — Low-Carbon & Design-for-Disassembly (Circular Option)',
    description:
      'Substitutes 50% GGBS concrete, CLT/EAF structural elements, reclaimed brick in lime mortar, demountable partitions, and adhesive-free floating floor finishes.',
    createdAt: nowIso,
    updatedAt: nowIso,
    isBaseline: false,
    boundarySettings: { ...baselineScenario.boundarySettings },
    inventory: altInventory,
    scenarioAssumptions: [
      'Assumes regional availability of 50% GGBS ready-mix concrete and reclaimed facing bricks.',
      'Assumes structural connections are detailed with reversible mechanical bolts/screws instead of wet grouting.',
      'Maintains identical Reference Study Period (60 years) and Gross Internal Floor Area as Baseline Scenario A.',
    ],
    keyTradeoffs: [
      'GGBS concrete requires longer curing times before formwork striking in cold weather.',
      'Mass timber (CLT) floors require dedicated acoustic flanking strips and moisture protection during erection.',
      'Reclaimed brick in lime mortar requires batch testing for freeze-thaw durability.',
    ],
  };
}

/**
 * Initializes P40 state for a project without mutating existing unrelated project fields.
 */
export function initializeProjectP40AuditState(project: Project): ProjectP40AuditState {
  if (project.carbonCircularityAudit && project.carbonCircularityAudit.schemaVersion === P40_SCHEMA_VERSION) {
    return project.carbonCircularityAudit;
  }

  const nowIso = new Date().toISOString();
  const derived = deriveP40InventoryFromProject(project);
  const boundarySettings = createDefaultP40BoundarySettings(derived.grossInternalFloorAreaM2);

  const baselineScenario: P40AuditScenario = {
    scenarioId: 'p40-scen-baseline',
    name: 'Scenario A — Baseline Specification',
    description: 'Baseline material and assembly inventory derived from current project geometry and standard construction practices.',
    createdAt: nowIso,
    updatedAt: nowIso,
    isBaseline: true,
    boundarySettings,
    inventory: derived.inventory,
    scenarioAssumptions: [
      ...derived.derivationNotes,
      'Standard Reference Study Period of 60 years applied in accordance with BS EN 15978 / RICS WLCA.',
      'Operational energy (B6) and water (B7) are excluded from embodied totals unless explicitly enabled.',
    ],
    keyTradeoffs: [
      'Conventional CEM I concrete and cement-mortar brickwork have high upfront embodied carbon and low intact disassembly recovery.',
    ],
  };

  const circularScenario = createCircularAlternativeScenario(baselineScenario);

  return {
    schemaVersion: P40_SCHEMA_VERSION,
    engineVersion: P40_ENGINE_VERSION,
    updatedAt: nowIso,
    activeScenarioId: baselineScenario.scenarioId,
    scenarios: [baselineScenario, circularScenario],
    evidenceLedger: [...P40_REFERENCE_EVIDENCE_LEDGER],
    auditNotes: derived.derivationNotes,
  };
}

/**
 * PHASE 4, 5 & 6 — Deterministic Whole-Life Carbon & Circularity Evaluation Engine
 * Evaluates a P40 scenario against the evidence ledger.
 * Never silently substitutes 0 for missing quantities or missing carbon factors.
 */
export function evaluateP40Scenario(
  scenario: P40AuditScenario,
  evidenceLedger: P40CarbonFactorEvidenceRecord[]
): P40CalculationResult {
  const evaluatedAt = new Date().toISOString();
  const factorMap = new Map<string, P40CarbonFactorEvidenceRecord>(
    evidenceLedger.map((f) => [f.factorId, f])
  );
  const { boundarySettings, inventory } = scenario;
  const rspYears = Math.max(1, boundarySettings.assessmentPeriodYears || 60);
  const gfaM2 =
    boundarySettings.grossInternalFloorAreaM2 && boundarySettings.grossInternalFloorAreaM2 > 0
      ? boundarySettings.grossInternalFloorAreaM2
      : null;

  const itemResults: P40MaterialCalculationResult[] = [];
  const warningsAndLimitations: string[] = [];

  // Provenance counters
  const countsByProvenance: Record<P40ProvenanceClassification, number> = {
    'authoritative-project-data': 0,
    'user-entered': 0,
    'deterministically-derived': 0,
    'published-reference-data': 0,
    'explicit-scenario-assumption': 0,
    'measured-or-imported': 0,
    'unsupported-or-missing': 0,
  };

  let calculatedItemsCount = 0;
  let excludedDoubleCountedCount = 0;
  let missingOrIncompatibleCount = 0;
  let unverifiedFactorsCount = 0;

  // Stage accumulators
  const stageSums: Record<P40LifecycleStageCode, number> = {
    'A1-A3': 0,
    'A4': 0,
    'A5': 0,
    'B1-B3': 0,
    'B4-B5': 0,
    'B6': 0,
    'B7': 0,
    'C1-C4': 0,
    'D': 0,
  };
  const stageContribCounts: Record<P40LifecycleStageCode, number> = {
    'A1-A3': 0,
    'A4': 0,
    'A5': 0,
    'B1-B3': 0,
    'B4-B5': 0,
    'B6': 0,
    'B7': 0,
    'C1-C4': 0,
    'D': 0,
  };
  const stageMissingCounts: Record<P40LifecycleStageCode, number> = {
    'A1-A3': 0,
    'A4': 0,
    'A5': 0,
    'B1-B3': 0,
    'B4-B5': 0,
    'B6': 0,
    'B7': 0,
    'C1-C4': 0,
    'D': 0,
  };

  // Circularity mass accumulators
  let totalEvaluatedMassKg = 0;
  let massWithKnownRecycledContentKg = 0;
  let weightedRecycledMassKg = 0;
  let reversibleDisassemblyMassKg = 0;
  let verifiedLocalRecoveryMassKg = 0;
  let theoreticalRecyclableMassKg = 0;

  let weightedUncertaintyNumerator = 0;
  let weightedUncertaintyDenominator = 0;

  for (const item of inventory) {
    countsByProvenance[item.quantityProvenance] =
      (countsByProvenance[item.quantityProvenance] ?? 0) + 1;

    // 1. Double-Counting Prevention Guard
    if (item.includedInParentAssembly) {
      excludedDoubleCountedCount++;
      itemResults.push({
        itemId: item.itemId,
        materialName: item.materialName,
        assemblyOrElementName: item.assemblyOrElementName,
        category: item.category,
        status: 'excluded-double-counting',
        statusExplanation: `Excluded from totals because this material is marked as already included in parent assembly (${item.parentAssemblyItemId || 'parent element'}) to prevent double counting.`,
        unitConversion: {
          isCompatible: true,
          inputQuantity: item.quantity,
          inputUnit: item.unit,
          targetUnit: item.unit,
          convertedQuantity: item.quantity,
          massKg: null,
          formulaUsed: 'Excluded (included in parent assembly)',
        },
        linkedFactor: item.linkedFactorId ? factorMap.get(item.linkedFactorId) ?? null : null,
        stageEmissionsKgCO2e: {
          'A1-A3': null,
          'A4': null,
          'A5': null,
          'B1-B3': null,
          'B4-B5': null,
          'B6': null,
          'B7': null,
          'C1-C4': null,
          'D': null,
        },
        upfrontEmbodiedKgCO2e: null,
        totalEmbodiedAtoCKgCO2e: null,
        moduleDBenefitOrLoadKgCO2e: null,
        replacementCyclesCount: 0,
        formulaTrace: ['Double-counting prevention guard: item skipped from aggregation.'],
        uncertaintyPercent: 0,
        warnings: [],
      });
      continue;
    }

    // 2. Check linked factor
    const linkedFactor = item.linkedFactorId ? factorMap.get(item.linkedFactorId) ?? null : null;
    if (!linkedFactor || linkedFactor.a1a3FactorKgCO2ePerUnit === null || !Number.isFinite(linkedFactor.a1a3FactorKgCO2ePerUnit)) {
      missingOrIncompatibleCount++;
      stageMissingCounts['A1-A3']++;
      warningsAndLimitations.push(
        `Material "${item.materialName}" (${item.assemblyOrElementName}) has no valid carbon factor assigned; its emissions are reported as null (missing), never assumed zero.`
      );
      itemResults.push({
        itemId: item.itemId,
        materialName: item.materialName,
        assemblyOrElementName: item.assemblyOrElementName,
        category: item.category,
        status: 'missing-factor',
        statusExplanation: 'Missing or unsupported carbon factor. Cannot compute embodied carbon without a verified or user-provided factor.',
        unitConversion: {
          isCompatible: false,
          inputQuantity: item.quantity,
          inputUnit: item.unit,
          targetUnit: item.unit,
          convertedQuantity: null,
          massKg: null,
          formulaUsed: 'No carbon factor linked',
          errorMessage: 'No valid carbon factor linked.',
        },
        linkedFactor,
        stageEmissionsKgCO2e: {
          'A1-A3': null,
          'A4': null,
          'A5': null,
          'B1-B3': null,
          'B4-B5': null,
          'B6': null,
          'B7': null,
          'C1-C4': null,
          'D': null,
        },
        upfrontEmbodiedKgCO2e: null,
        totalEmbodiedAtoCKgCO2e: null,
        moduleDBenefitOrLoadKgCO2e: null,
        replacementCyclesCount: 0,
        formulaTrace: [],
        uncertaintyPercent: 0,
        warnings: ['Missing carbon factor'],
      });
      continue;
    }

    if (linkedFactor.reviewStatus === 'user-provided-unverified' || linkedFactor.reviewStatus === 'pending-review') {
      unverifiedFactorsCount++;
    }

    // 3. Validate quantity & unit conversion
    const effectiveDensity = item.densityKgPerM3 ?? linkedFactor.densityKgPerM3 ?? null;
    const conv = convertP40MaterialQuantity({
      quantity: item.quantity,
      sourceUnit: item.unit,
      targetUnit: linkedFactor.declaredUnit,
      thicknessM: item.thicknessM,
      densityKgPerM3: effectiveDensity,
    });

    if (!conv.isCompatible || conv.convertedQuantity === null) {
      missingOrIncompatibleCount++;
      stageMissingCounts['A1-A3']++;
      const isMissingQty = item.quantity === null || item.quantity === undefined || !Number.isFinite(item.quantity);
      warningsAndLimitations.push(
        `Material "${item.materialName}": ${conv.errorMessage || 'Incompatible unit conversion.'}`
      );
      itemResults.push({
        itemId: item.itemId,
        materialName: item.materialName,
        assemblyOrElementName: item.assemblyOrElementName,
        category: item.category,
        status: isMissingQty ? 'missing-quantity' : 'incompatible-units',
        statusExplanation: conv.errorMessage || 'Incompatible quantity and factor units.',
        unitConversion: conv,
        linkedFactor,
        stageEmissionsKgCO2e: {
          'A1-A3': null,
          'A4': null,
          'A5': null,
          'B1-B3': null,
          'B4-B5': null,
          'B6': null,
          'B7': null,
          'C1-C4': null,
          'D': null,
        },
        upfrontEmbodiedKgCO2e: null,
        totalEmbodiedAtoCKgCO2e: null,
        moduleDBenefitOrLoadKgCO2e: null,
        replacementCyclesCount: 0,
        formulaTrace: [conv.formulaUsed],
        uncertaintyPercent: linkedFactor.uncertaintyRangePercent,
        warnings: [conv.errorMessage || 'Unit conversion error'],
      });
      continue;
    }

    // Valid converted quantity
    calculatedItemsCount++;
    const convertedQty = conv.convertedQuantity;
    const itemWarnings: string[] = [];
    const formulaTrace: string[] = [
      `Unit Conversion: ${conv.formulaUsed}`,
    ];

    if (item.isFlaggedIncomplete) {
      itemWarnings.push(`Flagged by user: ${item.flagReason || 'Incomplete/requires verification'}`);
    }

    const stageEmissions: Record<P40LifecycleStageCode, number | null> = {
      'A1-A3': null,
      'A4': null,
      'A5': null,
      'B1-B3': null,
      'B4-B5': null,
      'B6': null,
      'B7': null,
      'C1-C4': null,
      'D': null,
    };

    // Stage A1-A3 Product Stage
    const rawA1A3Fossil = convertedQty * linkedFactor.a1a3FactorKgCO2ePerUnit;
    const bioStorage =
      boundarySettings.includeBiogenicCarbonBalance && typeof linkedFactor.biogenicStorageKgCO2ePerUnit === 'number'
        ? convertedQty * linkedFactor.biogenicStorageKgCO2ePerUnit
        : 0;
    const a1a3Kg = rawA1A3Fossil + bioStorage;

    if (boundarySettings.includedStages['A1-A3']) {
      stageEmissions['A1-A3'] = a1a3Kg;
      stageSums['A1-A3'] += a1a3Kg;
      stageContribCounts['A1-A3']++;
      formulaTrace.push(
        `A1–A3 Product Stage = ${convertedQty} ${linkedFactor.declaredUnit} × ${linkedFactor.a1a3FactorKgCO2ePerUnit} kgCO2e/${linkedFactor.declaredUnit}${
          bioStorage !== 0 ? ` + (${bioStorage.toFixed(2)} kgCO2e biogenic)` : ''
        } = ${a1a3Kg.toFixed(3)} kgCO2e`
      );
    }

    // Stage A4 Transport to site
    let a4Kg: number | null = null;
    if (boundarySettings.includedStages['A4']) {
      const distKm = item.transportDistanceKm ?? 80;
      const transportFactor = linkedFactor.a4TransportKgCO2ePerTonneKm ?? 0.105;
      if (conv.massKg !== null && conv.massKg >= 0 && distKm >= 0) {
        const tonnes = conv.massKg / 1000;
        a4Kg = tonnes * distKm * transportFactor;
        stageEmissions['A4'] = a4Kg;
        stageSums['A4'] += a4Kg;
        stageContribCounts['A4']++;
        formulaTrace.push(
          `A4 Transport = (${conv.massKg.toFixed(1)} kg ÷ 1000) × ${distKm} km × ${transportFactor} kgCO2e/t·km = ${a4Kg.toFixed(3)} kgCO2e`
        );
      } else {
        stageMissingCounts['A4']++;
        itemWarnings.push('A4 transport could not be calculated because element mass (kg) is unknown.');
      }
    }

    // Stage A5 Construction Waste
    let a5Kg: number | null = null;
    if (boundarySettings.includedStages['A5']) {
      const wastePct = item.siteWastePercent ?? linkedFactor.defaultSiteWastePercent ?? null;
      if (wastePct !== null && Number.isFinite(wastePct) && wastePct >= 0) {
        const baseForWaste = rawA1A3Fossil + (a4Kg ?? 0);
        a5Kg = baseForWaste * (wastePct / 100);
        stageEmissions['A5'] = a5Kg;
        stageSums['A5'] += a5Kg;
        stageContribCounts['A5']++;
        formulaTrace.push(
          `A5 Site Waste = (${rawA1A3Fossil.toFixed(2)} + ${(a4Kg ?? 0).toFixed(2)}) kgCO2e × ${wastePct}% waste rate = ${a5Kg.toFixed(3)} kgCO2e`
        );
      } else {
        stageMissingCounts['A5']++;
      }
    }

    // Stage C1-C4 End of Life
    let c1c4Kg: number | null = null;
    if (boundarySettings.includedStages['C1-C4']) {
      if (typeof linkedFactor.c1c4FactorKgCO2ePerUnit === 'number' && Number.isFinite(linkedFactor.c1c4FactorKgCO2ePerUnit)) {
        const fossilEol = convertedQty * linkedFactor.c1c4FactorKgCO2ePerUnit;
        const bioRelease =
          boundarySettings.includeBiogenicCarbonBalance && bioStorage < 0 ? Math.abs(bioStorage) : 0;
        c1c4Kg = fossilEol + bioRelease;
        stageEmissions['C1-C4'] = c1c4Kg;
        stageSums['C1-C4'] += c1c4Kg;
        stageContribCounts['C1-C4']++;
        formulaTrace.push(
          `C1–C4 End-of-Life = ${convertedQty} ${linkedFactor.declaredUnit} × ${linkedFactor.c1c4FactorKgCO2ePerUnit} kgCO2e/${linkedFactor.declaredUnit}${
            bioRelease > 0 ? ` + ${bioRelease.toFixed(2)} kgCO2e biogenic EoL release` : ''
          } = ${c1c4Kg.toFixed(3)} kgCO2e`
        );
      } else {
        stageMissingCounts['C1-C4']++;
        itemWarnings.push('C1–C4 end-of-life factor is missing for this material.');
      }
    }

    // Stage B4-B5 Replacement over Assessment Period
    let b4b5Kg: number | null = null;
    let replacementCyclesCount = 0;
    if (boundarySettings.includedStages['B4-B5']) {
      const serviceLife = item.customServiceLifeYears ?? linkedFactor.referenceServiceLifeYears ?? null;
      if (serviceLife !== null && Number.isFinite(serviceLife) && serviceLife > 0) {
        replacementCyclesCount = serviceLife < rspYears ? Math.max(0, Math.ceil(rspYears / serviceLife) - 1) : 0;
        const singleCycleKg =
          rawA1A3Fossil +
          (a4Kg ?? 0) +
          (a5Kg ?? 0) +
          (typeof linkedFactor.c1c4FactorKgCO2ePerUnit === 'number'
            ? convertedQty * linkedFactor.c1c4FactorKgCO2ePerUnit
            : 0);
        b4b5Kg = replacementCyclesCount * singleCycleKg;
        stageEmissions['B4-B5'] = b4b5Kg;
        stageSums['B4-B5'] += b4b5Kg;
        stageContribCounts['B4-B5']++;
        formulaTrace.push(
          `B4 Replacement = ${replacementCyclesCount} cycle(s) (RSP ${rspYears}y ÷ ${serviceLife}y lifespan, source: ${
            item.replacementAssumptionSource || 'reference service life'
          }) × ${singleCycleKg.toFixed(2)} kgCO2e/cycle = ${b4b5Kg.toFixed(3)} kgCO2e`
        );
      } else {
        stageMissingCounts['B4-B5']++;
        itemWarnings.push('No replacement service life specified; B4 replacement could not be assessed.');
      }
    }

    // Module D (Beyond System Boundary — strictly separate!)
    let moduleDKg: number | null = null;
    if (boundarySettings.includedStages['D']) {
      if (typeof linkedFactor.moduleDFactorKgCO2ePerUnit === 'number' && Number.isFinite(linkedFactor.moduleDFactorKgCO2ePerUnit)) {
        moduleDKg = convertedQty * linkedFactor.moduleDFactorKgCO2ePerUnit;
        stageEmissions['D'] = moduleDKg;
        stageSums['D'] += moduleDKg;
        stageContribCounts['D']++;
        formulaTrace.push(
          `Module D (Separate Beyond-Boundary Potential) = ${convertedQty} ${linkedFactor.declaredUnit} × ${linkedFactor.moduleDFactorKgCO2ePerUnit} kgCO2e/${linkedFactor.declaredUnit} = ${moduleDKg.toFixed(3)} kgCO2e`
        );
      } else {
        stageMissingCounts['D']++;
      }
    }

    const upfrontEmbodiedKg =
      (stageEmissions['A1-A3'] ?? 0) + (stageEmissions['A4'] ?? 0) + (stageEmissions['A5'] ?? 0);
    const totalEmbodiedAtoCKg =
      upfrontEmbodiedKg +
      (stageEmissions['B1-B3'] ?? 0) +
      (stageEmissions['B4-B5'] ?? 0) +
      (stageEmissions['C1-C4'] ?? 0);

    const isItemComplete =
      !item.isFlaggedIncomplete &&
      stageEmissions['A1-A3'] !== null &&
      (!boundarySettings.includedStages['A4'] || stageEmissions['A4'] !== null) &&
      (!boundarySettings.includedStages['C1-C4'] || stageEmissions['C1-C4'] !== null);

    itemResults.push({
      itemId: item.itemId,
      materialName: item.materialName,
      assemblyOrElementName: item.assemblyOrElementName,
      category: item.category,
      status: isItemComplete ? 'calculated-complete' : 'calculated-partial',
      statusExplanation: isItemComplete
        ? 'All included embodied lifecycle stages calculated deterministically.'
        : 'Partial calculation: one or more optional/secondary stages or flags require verification.',
      unitConversion: conv,
      linkedFactor,
      stageEmissionsKgCO2e: stageEmissions,
      upfrontEmbodiedKgCO2e: upfrontEmbodiedKg,
      totalEmbodiedAtoCKgCO2e: totalEmbodiedAtoCKg,
      moduleDBenefitOrLoadKgCO2e: moduleDKg,
      replacementCyclesCount,
      formulaTrace,
      uncertaintyPercent: linkedFactor.uncertaintyRangePercent,
      warnings: itemWarnings,
    });

    // Accumulate circularity mass metrics when massKg is known
    if (conv.massKg !== null && conv.massKg > 0) {
      totalEvaluatedMassKg += conv.massKg;
      if (typeof item.recycledContentPercent === 'number' && Number.isFinite(item.recycledContentPercent)) {
        massWithKnownRecycledContentKg += conv.massKg;
        weightedRecycledMassKg += conv.massKg * (item.recycledContentPercent / 100);
      }
      if (item.disassemblyRating === 'reversible-mechanical') {
        reversibleDisassemblyMassKg += conv.massKg;
      }
      if (item.localRecoveryAvailability === 'verified-local-infrastructure') {
        verifiedLocalRecoveryMassKg += conv.massKg;
      }
      if (typeof item.theoreticalRecyclabilityPercent === 'number' && Number.isFinite(item.theoreticalRecyclabilityPercent)) {
        theoreticalRecyclableMassKg += conv.massKg * (item.theoreticalRecyclabilityPercent / 100);
      }
    }

    const weight = Math.abs(totalEmbodiedAtoCKg);
    weightedUncertaintyNumerator += weight * linkedFactor.uncertaintyRangePercent;
    weightedUncertaintyDenominator += weight;
  }

  // Operational Energy (B6) — strictly separate from embodied carbon unless explicitly configured
  let operationalB6Kg: number | null = null;
  if (boundarySettings.includedStages['B6'] || boundarySettings.includeOperationalEnergyInWholeLife) {
    if (
      typeof boundarySettings.annualOperationalElectricityKwhPerYear === 'number' &&
      Number.isFinite(boundarySettings.annualOperationalElectricityKwhPerYear) &&
      boundarySettings.annualOperationalElectricityKwhPerYear >= 0 &&
      typeof boundarySettings.gridElectricityFactorKgCO2ePerKwh === 'number' &&
      Number.isFinite(boundarySettings.gridElectricityFactorKgCO2ePerKwh) &&
      boundarySettings.gridElectricityFactorKgCO2ePerKwh >= 0
    ) {
      operationalB6Kg =
        boundarySettings.annualOperationalElectricityKwhPerYear *
        boundarySettings.gridElectricityFactorKgCO2ePerKwh *
        rspYears;
      stageSums['B6'] = operationalB6Kg;
      stageContribCounts['B6'] = 1;
    } else {
      stageMissingCounts['B6'] = 1;
      warningsAndLimitations.push(
        'Stage B6 Operational Energy is enabled in boundary settings, but annual kWh/yr consumption or grid factor is missing; B6 is reported as missing (null), never assumed zero.'
      );
    }
  }

  // Build Stage Breakdown Table
  const allStageCodes: P40LifecycleStageCode[] = [
    'A1-A3',
    'A4',
    'A5',
    'B1-B3',
    'B4-B5',
    'B6',
    'B7',
    'C1-C4',
    'D',
  ];

  const stageBreakdown: P40StageBreakdownResult[] = allStageCodes.map((code) => {
    const isIncluded = boundarySettings.includedStages[code];
    const contrib = stageContribCounts[code];
    const missing = stageMissingCounts[code];

    if (!isIncluded) {
      return {
        stageCode: code,
        stageTitle: P40_STAGE_TITLES[code],
        inclusionStatus: 'excluded-by-scope',
        emissionsKgCO2e: null,
        emissionsTCO2e: null,
        intensityKgCO2ePerM2: null,
        contributingItemsCount: 0,
        missingItemsCount: 0,
        explanation: 'Excluded from current assessment scope.',
      };
    }

    if (contrib === 0) {
      return {
        stageCode: code,
        stageTitle: P40_STAGE_TITLES[code],
        inclusionStatus: 'missing-data',
        emissionsKgCO2e: null,
        emissionsTCO2e: null,
        intensityKgCO2ePerM2: null,
        contributingItemsCount: 0,
        missingItemsCount: Math.max(1, missing),
        explanation: 'Included in boundary scope, but required quantity or factor inputs are missing (never reported as 0).',
      };
    }

    const kg = stageSums[code];
    const status = missing > 0 ? 'included-partial' : 'included-complete';
    return {
      stageCode: code,
      stageTitle: P40_STAGE_TITLES[code],
      inclusionStatus: status,
      emissionsKgCO2e: kg,
      emissionsTCO2e: kg / 1000,
      intensityKgCO2ePerM2: gfaM2 ? kg / gfaM2 : null,
      contributingItemsCount: contrib,
      missingItemsCount: missing,
      explanation:
        status === 'included-complete'
          ? `Calculated across ${contrib} inventory record(s).`
          : `Partial stage total: calculated for ${contrib} record(s), with ${missing} record(s) missing data.`,
    };
  });

  // Totals
  const hasCalculatedItems = calculatedItemsCount > 0;
  const productStageA1A3Kg = hasCalculatedItems && boundarySettings.includedStages['A1-A3'] ? stageSums['A1-A3'] : null;
  const upfrontEmbodiedA1A5Kg = hasCalculatedItems
    ? (boundarySettings.includedStages['A1-A3'] ? stageSums['A1-A3'] : 0) +
      (boundarySettings.includedStages['A4'] ? stageSums['A4'] : 0) +
      (boundarySettings.includedStages['A5'] ? stageSums['A5'] : 0)
    : null;
  const inUseEmbodiedB1B5Kg =
    hasCalculatedItems && (boundarySettings.includedStages['B1-B3'] || boundarySettings.includedStages['B4-B5'])
      ? (boundarySettings.includedStages['B1-B3'] ? stageSums['B1-B3'] : 0) +
        (boundarySettings.includedStages['B4-B5'] ? stageSums['B4-B5'] : 0)
      : null;
  const endOfLifeC1C4Kg =
    hasCalculatedItems && boundarySettings.includedStages['C1-C4'] ? stageSums['C1-C4'] : null;

  const totalEmbodiedAtoCKg = hasCalculatedItems
    ? (upfrontEmbodiedA1A5Kg ?? 0) + (inUseEmbodiedB1B5Kg ?? 0) + (endOfLifeC1C4Kg ?? 0)
    : null;

  const wholeLifeCarbonAtoCKg =
    totalEmbodiedAtoCKg !== null
      ? boundarySettings.includeOperationalEnergyInWholeLife && operationalB6Kg !== null
        ? totalEmbodiedAtoCKg + operationalB6Kg
        : totalEmbodiedAtoCKg
      : null;

  const moduleDSeparateKg =
    hasCalculatedItems && boundarySettings.includedStages['D'] && stageContribCounts['D'] > 0
      ? stageSums['D']
      : null;

  // Category Breakdown
  const allCategories = Object.keys(P40_CATEGORY_LABELS) as P40MaterialCategory[];
  const categoryBreakdown = allCategories.map((cat) => {
    const catItems = itemResults.filter(
      (r) => r.category === cat && r.status !== 'excluded-double-counting' && r.totalEmbodiedAtoCKgCO2e !== null
    );
    const sumKg = catItems.length > 0 ? catItems.reduce((s, r) => s + (r.totalEmbodiedAtoCKgCO2e ?? 0), 0) : null;
    const share =
      sumKg !== null && totalEmbodiedAtoCKg !== null && totalEmbodiedAtoCKg > 0
        ? (sumKg / totalEmbodiedAtoCKg) * 100
        : null;
    return {
      category: cat,
      label: P40_CATEGORY_LABELS[cat],
      embodiedAtoCKgCO2e: sumKg,
      shareOfEmbodiedPercent: share,
      itemCount: catItems.length,
    };
  });

  // Determine Overall Completeness Status
  // Guard: Do not present a product-stage-only estimate as a complete whole-life carbon assessment!
  const hasAllEmbodiedLifecycleStages =
    boundarySettings.includedStages['A1-A3'] &&
    boundarySettings.includedStages['A4'] &&
    boundarySettings.includedStages['A5'] &&
    boundarySettings.includedStages['B4-B5'] &&
    boundarySettings.includedStages['C1-C4'];

  let completenessStatus: P40DataCompletenessStatus = 'complete';
  let completenessExplanation = '';

  if (!hasCalculatedItems) {
    completenessStatus = 'unsupported';
    completenessExplanation =
      'No inventory items have both valid quantities and compatible carbon factors. Assessment cannot be computed.';
  } else if (
    missingOrIncompatibleCount > 0 ||
    !hasAllEmbodiedLifecycleStages ||
    itemResults.some((r) => r.status === 'calculated-partial') ||
    (boundarySettings.includedStages['B6'] && operationalB6Kg === null)
  ) {
    completenessStatus = 'partial';
    const reasons: string[] = [];
    if (!hasAllEmbodiedLifecycleStages) {
      reasons.push(
        'Lifecycle boundary excludes one or more embodied stages (A4, A5, B4–B5, or C1–C4); product-stage or partial-stage estimates are never labelled as complete whole-life assessments'
      );
    }
    if (missingOrIncompatibleCount > 0) {
      reasons.push(`${missingOrIncompatibleCount} material record(s) have missing quantities, missing factors, or incompatible units`);
    }
    if (!boundarySettings.includeOperationalEnergyInWholeLife) {
      reasons.push('Operational energy (B6) is evaluated separately from embodied carbon (A–C)');
    }
    completenessExplanation = `Partial Assessment: ${reasons.join('; ')}.`;
  } else if (!boundarySettings.includeOperationalEnergyInWholeLife || operationalB6Kg === null) {
    completenessStatus = 'partial';
    completenessExplanation =
      'Embodied Lifecycle Complete (Stages A1–A5, B4–B5, C1–C4 assessed), but Operational Energy (B6) is excluded/separate — reported as an Embodied Lifecycle Audit rather than a combined Whole-Life (Embodied + Operational) total.';
  } else {
    completenessStatus = 'complete';
    completenessExplanation =
      'All included embodied (A1–C4) and operational (B6) stages have complete, compatible inputs within the documented Reference Study Period.';
  }

  // Circularity Summary & Evidence-Aware Opportunities
  const circularitySummary = evaluateP40CircularityIntelligence(
    inventory,
    itemResults,
    factorMap,
    {
      totalEvaluatedMassKg,
      massWithKnownRecycledContentKg,
      weightedRecycledMassKg,
      reversibleDisassemblyMassKg,
      verifiedLocalRecoveryMassKg,
      theoreticalRecyclableMassKg,
    }
  );

  const overallUncertaintyRangePercent =
    weightedUncertaintyDenominator > 0
      ? Number((weightedUncertaintyNumerator / weightedUncertaintyDenominator).toFixed(1))
      : 20;

  return {
    engineVersion: P40_ENGINE_VERSION,
    schemaVersion: P40_SCHEMA_VERSION,
    evaluatedAt,
    completenessStatus,
    completenessExplanation,
    boundarySettings,
    itemResults,
    stageBreakdown,
    categoryBreakdown,
    totals: {
      productStageA1A3KgCO2e: productStageA1A3Kg,
      upfrontEmbodiedA1A5KgCO2e: upfrontEmbodiedA1A5Kg,
      inUseEmbodiedB1B5KgCO2e: inUseEmbodiedB1B5Kg,
      endOfLifeC1C4KgCO2e: endOfLifeC1C4Kg,
      totalEmbodiedAtoCKgCO2e: totalEmbodiedAtoCKg,
      totalEmbodiedAtoCTCO2e: totalEmbodiedAtoCKg !== null ? totalEmbodiedAtoCKg / 1000 : null,
      embodiedIntensityKgCO2ePerM2:
        totalEmbodiedAtoCKg !== null && gfaM2 ? totalEmbodiedAtoCKg / gfaM2 : null,
      operationalCarbonB6B7KgCO2e: operationalB6Kg,
      wholeLifeCarbonAtoCKgCO2e: wholeLifeCarbonAtoCKg,
      wholeLifeIntensityKgCO2ePerM2:
        wholeLifeCarbonAtoCKg !== null && gfaM2 ? wholeLifeCarbonAtoCKg / gfaM2 : null,
      moduleDSeparateKgCO2e: moduleDSeparateKg,
      overallUncertaintyRangePercent,
    },
    provenanceSummary: {
      totalItemsCount: inventory.length,
      calculatedItemsCount,
      excludedDoubleCountedCount,
      missingOrIncompatibleCount,
      unverifiedFactorsCount,
      countsByProvenance,
    },
    circularitySummary,
    warningsAndLimitations,
  };
}

/**
 * PHASE 6 — Circularity Intelligence Engine
 * Distinguishes theoretical recyclability from verified local recovery availability.
 * Never fabricates circularity percentages when mass or recycled content is unknown.
 */
function evaluateP40CircularityIntelligence(
  inventory: P40MaterialInventoryItem[],
  itemResults: P40MaterialCalculationResult[],
  factorMap: Map<string, P40CarbonFactorEvidenceRecord>,
  massMetrics: {
    totalEvaluatedMassKg: number;
    massWithKnownRecycledContentKg: number;
    weightedRecycledMassKg: number;
    reversibleDisassemblyMassKg: number;
    verifiedLocalRecoveryMassKg: number;
    theoreticalRecyclableMassKg: number;
  }
): P40CircularityAuditSummary {
  const {
    totalEvaluatedMassKg,
    massWithKnownRecycledContentKg,
    weightedRecycledMassKg,
    reversibleDisassemblyMassKg,
    verifiedLocalRecoveryMassKg,
    theoreticalRecyclableMassKg,
  } = massMetrics;

  const hasMass = totalEvaluatedMassKg > 0;
  const opportunities: P40CircularityOpportunity[] = [];
  const circularityWarnings: string[] = [];

  const resultById = new Map(itemResults.map((r) => [r.itemId, r]));

  for (const item of inventory) {
    if (item.includedInParentAssembly) continue;
    const res = resultById.get(item.itemId);
    const currentKg = res?.totalEmbodiedAtoCKgCO2e ?? null;

    if (item.recycledContentProvenance === 'unsupported-or-missing' || item.recycledContentPercent === null) {
      circularityWarnings.push(
        `Material "${item.materialName}" has unknown/unverified recycled content; excluded from known recycled content numerator rather than assumed 0%.`
      );
    }

    if (item.localRecoveryAvailability === 'theoretical-only-unverified-local' || item.localRecoveryAvailability === 'unknown-unverified') {
      circularityWarnings.push(
        `Material "${item.materialName}": theoretical recyclability (${item.theoreticalRecyclabilityPercent ?? 'N/A'}%) is not backed by verified local recovery infrastructure (${item.localRecoveryAvailability}).`
      );
    }

    // 1. Concrete GGBS substitution opportunity
    if (item.linkedFactorId === 'p40-ref-concrete-c30-cem1' && res?.unitConversion.convertedQuantity) {
      const altFactor = factorMap.get('p40-ref-concrete-c30-ggbs50');
      const curFactor = factorMap.get('p40-ref-concrete-c30-cem1');
      if (altFactor && curFactor && altFactor.a1a3FactorKgCO2ePerUnit !== null && curFactor.a1a3FactorKgCO2ePerUnit !== null) {
        const savingKg =
          res.unitConversion.convertedQuantity *
          (curFactor.a1a3FactorKgCO2ePerUnit - altFactor.a1a3FactorKgCO2ePerUnit);
        opportunities.push({
          opportunityId: `circ-opp-ggbs-${item.itemId}`,
          targetItemId: item.itemId,
          targetMaterialOrElement: `${item.materialName} (${item.assemblyOrElementName})`,
          category: 'recycled-content',
          title: 'Substitute 50% GGBS Secondary Cementitious Mix',
          basisAndEvidence:
            'ICE v3.0 / RICS WLCA comparison between 100% CEM I C30/37 (0.159 kgCO2e/kg) and 50% GGBS C30/37 (0.102 kgCO2e/kg).',
          assumptions: [
            `Applied to ${res.unitConversion.convertedQuantity.toFixed(0)} kg derived concrete mass.`,
            'Assumes regional concrete batching plant supplies EN 15167 GGBS.',
          ],
          potentialEmbodiedSavingKgCO2e: savingKg > 0 ? Number(savingKg.toFixed(1)) : null,
          theoreticalRecoveryInfo: '85% theoretical crushing to recycled concrete aggregate (RCA); 0% intact structural reuse.',
          verifiedLocalAvailabilityStatus: item.localRecoveryAvailability,
          disassemblyClassification: item.disassemblyRating,
          unresolvedConstraints: [
            'Extended formwork striking times due to slower early strength gain.',
            'Does not make cast-in-situ concrete demountable.',
          ],
          recommendedAction: 'Specify 50% GGBS cement replacement in structural concrete clauses.',
        });
      }
    }

    // 2. Structural frame disassembly & EAF/Mass Timber opportunity
    if (item.category === 'superstructure-frame' && item.disassemblyRating === 'monolithic-cast-in-place') {
      opportunities.push({
        opportunityId: `circ-opp-dfd-frame-${item.itemId}`,
        targetItemId: item.itemId,
        targetMaterialOrElement: `${item.materialName} (${item.assemblyOrElementName})`,
        category: 'design-for-disassembly',
        title: 'Transition from Monolithic In-Situ Frame to Demountable Bolted Steel / Glulam System',
        basisAndEvidence:
          'ISO 20887 Design for Disassembly and Adaptability principles; RICS WLCA Circularity guidance.',
        assumptions: [
          'Replaces wet cast-in-situ joints with accessible bolted mechanical connections.',
        ],
        potentialEmbodiedSavingKgCO2e: currentKg !== null ? Number((currentKg * 0.28).toFixed(1)) : null,
        theoreticalRecoveryInfo: 'Bolted structural sections achieve up to 65–75% direct member reuse potential vs 0% for cast-in-situ.',
        verifiedLocalAvailabilityStatus: 'regional-specialist-only',
        disassemblyClassification: 'reversible-mechanical',
        unresolvedConstraints: [
          'Requires fire-protection boarding rather than intumescent coatings that complicate steel re-certification.',
          'Requires structural grid coordination and lifting access.',
        ],
        recommendedAction: 'Detail bolted splice plates and record structural section passports in documentation.',
      });
    }

    // 3. Masonry brick reclamation & lime mortar opportunity
    if (item.linkedFactorId === 'p40-ref-clay-brick-facade' && res?.unitConversion.convertedQuantity) {
      const altFactor = factorMap.get('p40-ref-reclaimed-brick-lime');
      const curFactor = factorMap.get('p40-ref-clay-brick-facade');
      if (altFactor && curFactor && altFactor.a1a3FactorKgCO2ePerUnit !== null && curFactor.a1a3FactorKgCO2ePerUnit !== null) {
        const savingKg =
          res.unitConversion.convertedQuantity *
          (curFactor.a1a3FactorKgCO2ePerUnit - altFactor.a1a3FactorKgCO2ePerUnit);
        opportunities.push({
          opportunityId: `circ-opp-brick-reuse-${item.itemId}`,
          targetItemId: item.itemId,
          targetMaterialOrElement: `${item.materialName} (${item.assemblyOrElementName})`,
          category: 'material-reuse',
          title: 'Specify Reclaimed Facing Bricks Laid in Reversible Hydraulic Lime Mortar',
          basisAndEvidence:
            'RICS WLCA reclaimed brick benchmark (0.048 kgCO2e/kg vs 0.213 kgCO2e/kg virgin fired brick) + reversible lime bedding.',
          assumptions: [
            'Assumes NHL 3.5 lime mortar softer than the brick unit so bricks can be cleaned and salvaged intact at EoL.',
          ],
          potentialEmbodiedSavingKgCO2e: savingKg > 0 ? Number(savingKg.toFixed(1)) : null,
          theoreticalRecoveryInfo: '80% intact whole-brick salvaging potential with lime mortar vs <5% with Portland cement mortar.',
          verifiedLocalAvailabilityStatus: 'verified-local-infrastructure',
          disassemblyClassification: 'reversible-mechanical',
          unresolvedConstraints: [
            'Reclaimed brick batches require sample testing for soluble salts and frost exposure class (F2).',
          ],
          recommendedAction: 'Replace CEM I masonry mortar with hydraulic lime mortar and source salvaged facing brick.',
        });
      }
    }

    // 4. Internal partitions waste reduction & demountability
    if (item.linkedFactorId === 'p40-ref-gypsum-steel-partition' && res?.unitConversion.convertedQuantity) {
      const altFactor = factorMap.get('p40-ref-demountable-timber-partition');
      const curFactor = factorMap.get('p40-ref-gypsum-steel-partition');
      if (altFactor && curFactor && altFactor.a1a3FactorKgCO2ePerUnit !== null && curFactor.a1a3FactorKgCO2ePerUnit !== null) {
        const savingKg =
          res.unitConversion.convertedQuantity *
          (curFactor.a1a3FactorKgCO2ePerUnit - altFactor.a1a3FactorKgCO2ePerUnit);
        opportunities.push({
          opportunityId: `circ-opp-partition-${item.itemId}`,
          targetItemId: item.itemId,
          targetMaterialOrElement: `${item.materialName} (${item.assemblyOrElementName})`,
          category: 'waste-reduction',
          title: 'Modular Demountable Partition System & Off-Cut Waste Reduction (10% → 6%)',
          basisAndEvidence:
            'EN 15804 demountable timber/gypsum partition reference (13.2 vs 24.5 kgCO2e/m2) with board-height modular coordination.',
          assumptions: [
            'Eliminates wet gypsum skim coat in favor of dry jointing gaskets so boards can be unscrewed during layout reconfiguration.',
          ],
          potentialEmbodiedSavingKgCO2e: savingKg > 0 ? Number(savingKg.toFixed(1)) : null,
          theoreticalRecoveryInfo: '75% theoretical gypsum closed-loop recycling, but requires clean segregation from wet plaster.',
          verifiedLocalAvailabilityStatus: 'regional-specialist-only',
          disassemblyClassification: 'reversible-mechanical',
          unresolvedConstraints: [
            'Requires acoustic seal verification at dry-jointed perimeter tracks.',
          ],
          recommendedAction: 'Coordinate storey ceiling heights with standard 2400mm/3000mm board lengths to cut site waste.',
        });
      }
    }

    // 5. Internal flooring adhesive-free refurbishment
    if (item.linkedFactorId === 'p40-ref-porcelain-tile-screed' && res?.unitConversion.convertedQuantity) {
      const altFactor = factorMap.get('p40-ref-floating-engineered-timber-floor');
      const curFactor = factorMap.get('p40-ref-porcelain-tile-screed');
      if (altFactor && curFactor && altFactor.a1a3FactorKgCO2ePerUnit !== null && curFactor.a1a3FactorKgCO2ePerUnit !== null) {
        const savingKg =
          res.unitConversion.convertedQuantity *
          (curFactor.a1a3FactorKgCO2ePerUnit - altFactor.a1a3FactorKgCO2ePerUnit);
        opportunities.push({
          opportunityId: `circ-opp-floor-finish-${item.itemId}`,
          targetItemId: item.itemId,
          targetMaterialOrElement: `${item.materialName} (${item.assemblyOrElementName})`,
          category: 'repair-refurbishment',
          title: 'Replace Wet-Bonded Screed & Tile with Click-Lock Floating Timber & Cork Floor',
          basisAndEvidence:
            'FEP EN 15804 floating parquet benchmark (11.4 kgCO2e/m2 vs 29.8 kgCO2e/m2 tiled screed) + elimination of wet screed.',
          assumptions: [
            'Dry-laid over acoustic cork underlay; individual worn planks can be sanded or swapped without jackhammering screed.',
          ],
          potentialEmbodiedSavingKgCO2e: savingKg > 0 ? Number(savingKg.toFixed(1)) : null,
          theoreticalRecoveryInfo: '60% direct plank reuse potential vs 0% for adhesive-bonded ceramic tile.',
          verifiedLocalAvailabilityStatus: 'verified-local-infrastructure',
          disassemblyClassification: 'reversible-mechanical',
          unresolvedConstraints: [
            'Wet areas (bathrooms) still require localized waterproof tanking and slip-resistant surfaces.',
          ],
          recommendedAction: 'Specify dry floating floor finishes in living, bedroom, and office zones.',
        });
      }
    }
  }

  return {
    totalEvaluatedMassKg: hasMass ? Number(totalEvaluatedMassKg.toFixed(1)) : null,
    massWithKnownRecycledContentKg: hasMass ? Number(massWithKnownRecycledContentKg.toFixed(1)) : null,
    weightedRecycledContentPercent:
      massWithKnownRecycledContentKg > 0
        ? Number(((weightedRecycledMassKg / massWithKnownRecycledContentKg) * 100).toFixed(1))
        : null,
    reversibleDisassemblyMassSharePercent: hasMass
      ? Number(((reversibleDisassemblyMassKg / totalEvaluatedMassKg) * 100).toFixed(1))
      : null,
    verifiedLocalRecoveryMassSharePercent: hasMass
      ? Number(((verifiedLocalRecoveryMassKg / totalEvaluatedMassKg) * 100).toFixed(1))
      : null,
    theoreticalRecyclableMassSharePercent: hasMass
      ? Number(((theoreticalRecyclableMassKg / totalEvaluatedMassKg) * 100).toFixed(1))
      : null,
    opportunities,
    circularityWarnings,
  };
}

/**
 * PHASE 7 — Alternative Scenario Comparison Engine
 * Validates that boundaries, units, assessment periods, and functional units are compatible before comparing.
 * Explicitly flags incompatible boundaries and refuses to produce misleading percentage rankings.
 */
export function compareP40Scenarios(
  baselineScenario: P40AuditScenario,
  candidateScenario: P40AuditScenario,
  evidenceLedger: P40CarbonFactorEvidenceRecord[]
): P40ScenarioComparisonResult {
  const baseEval = evaluateP40Scenario(baselineScenario, evidenceLedger);
  const candEval = evaluateP40Scenario(candidateScenario, evidenceLedger);

  const compatibilityIssues: string[] = [];

  // 1. Check Reference Study Period compatibility
  if (baselineScenario.boundarySettings.assessmentPeriodYears !== candidateScenario.boundarySettings.assessmentPeriodYears) {
    compatibilityIssues.push(
      `Incompatible Assessment Periods: Baseline uses ${baselineScenario.boundarySettings.assessmentPeriodYears} years vs Candidate ${candidateScenario.boundarySettings.assessmentPeriodYears} years.`
    );
  }

  // 2. Check Functional Unit (GFA m2) compatibility
  const baseGfa = baselineScenario.boundarySettings.grossInternalFloorAreaM2;
  const candGfa = candidateScenario.boundarySettings.grossInternalFloorAreaM2;
  if (baseGfa !== candGfa) {
    compatibilityIssues.push(
      `Different Gross Internal Floor Areas (Functional Units): Baseline is ${baseGfa ?? 'unspecified'} m2 vs Candidate ${candGfa ?? 'unspecified'} m2.`
    );
  }

  // 3. Check Included Lifecycle Stages compatibility (A1-C4)
  const embodiedStageKeys: P40LifecycleStageCode[] = ['A1-A3', 'A4', 'A5', 'B1-B3', 'B4-B5', 'C1-C4'];
  const mismatchedStages = embodiedStageKeys.filter(
    (st) => baselineScenario.boundarySettings.includedStages[st] !== candidateScenario.boundarySettings.includedStages[st]
  );
  if (mismatchedStages.length > 0) {
    compatibilityIssues.push(
      `Incompatible Lifecycle Stage Boundaries: Stages [${mismatchedStages.join(', ')}] differ in inclusion between Baseline and Candidate.`
    );
  }

  // 4. Check Biogenic Carbon Accounting compatibility
  if (baselineScenario.boundarySettings.includeBiogenicCarbonBalance !== candidateScenario.boundarySettings.includeBiogenicCarbonBalance) {
    compatibilityIssues.push(
      'Incompatible Biogenic Accounting: One scenario includes biogenic storage/release in totals while the other excludes it.'
    );
  }

  const areBoundariesCompatible = compatibilityIssues.length === 0;

  const baseEmbodied = baseEval.totals.totalEmbodiedAtoCKgCO2e;
  const candEmbodied = candEval.totals.totalEmbodiedAtoCKgCO2e;

  let deltaEmbodiedKg: number | null = null;
  let deltaEmbodiedPercent: number | null = null;

  if (areBoundariesCompatible && baseEmbodied !== null && candEmbodied !== null) {
    deltaEmbodiedKg = candEmbodied - baseEmbodied;
    if (baseEmbodied > 0) {
      deltaEmbodiedPercent = ((candEmbodied - baseEmbodied) / baseEmbodied) * 100;
    }
  }

  const baseUpfront = baseEval.totals.upfrontEmbodiedA1A5KgCO2e;
  const candUpfront = candEval.totals.upfrontEmbodiedA1A5KgCO2e;
  let deltaUpfrontKg: number | null = null;
  let deltaUpfrontPercent: number | null = null;

  if (areBoundariesCompatible && baseUpfront !== null && candUpfront !== null) {
    deltaUpfrontKg = candUpfront - baseUpfront;
    if (baseUpfront > 0) {
      deltaUpfrontPercent = ((candUpfront - baseUpfront) / baseUpfront) * 100;
    }
  }

  const allCategories = Object.keys(P40_CATEGORY_LABELS) as P40MaterialCategory[];
  const materialDifferences = allCategories.map((cat) => {
    const baseItems = baseEval.itemResults.filter((i) => i.category === cat && i.status !== 'excluded-double-counting');
    const candItems = candEval.itemResults.filter((i) => i.category === cat && i.status !== 'excluded-double-counting');

    const baseCatKg =
      baseItems.length > 0 && baseItems.every((i) => i.totalEmbodiedAtoCKgCO2e !== null)
        ? baseItems.reduce((s, i) => s + (i.totalEmbodiedAtoCKgCO2e ?? 0), 0)
        : null;
    const candCatKg =
      candItems.length > 0 && candItems.every((i) => i.totalEmbodiedAtoCKgCO2e !== null)
        ? candItems.reduce((s, i) => s + (i.totalEmbodiedAtoCKgCO2e ?? 0), 0)
        : null;

    const dKg =
      areBoundariesCompatible && baseCatKg !== null && candCatKg !== null ? candCatKg - baseCatKg : null;
    const dPct =
      dKg !== null && baseCatKg !== null && baseCatKg > 0 ? (dKg / baseCatKg) * 100 : null;

    const baseMatNames = baseItems.map((i) => i.materialName).join(', ') || 'None';
    const candMatNames = candItems.map((i) => i.materialName).join(', ') || 'None';

    const baseSources = Array.from(new Set(baseItems.map((i) => i.linkedFactor?.sourceIdentifierOrLink || 'Unlinked'))).join(', ');
    const candSources = Array.from(new Set(candItems.map((i) => i.linkedFactor?.sourceIdentifierOrLink || 'Unlinked'))).join(', ');

    return {
      category: cat,
      baselineMaterialName: baseMatNames,
      candidateMaterialName: candMatNames,
      baselineKgCO2e: baseCatKg,
      candidateKgCO2e: candCatKg,
      deltaKgCO2e: dKg,
      deltaPercent: dPct,
      factorSourceComparison: `${baseSources} → ${candSources}`,
    };
  });

  const includedStagesBaseline = (Object.keys(baselineScenario.boundarySettings.includedStages) as P40LifecycleStageCode[]).filter(
    (k) => baselineScenario.boundarySettings.includedStages[k]
  );
  const includedStagesCandidate = (Object.keys(candidateScenario.boundarySettings.includedStages) as P40LifecycleStageCode[]).filter(
    (k) => candidateScenario.boundarySettings.includedStages[k]
  );

  return {
    baselineScenarioId: baselineScenario.scenarioId,
    baselineScenarioName: baselineScenario.name,
    candidateScenarioId: candidateScenario.scenarioId,
    candidateScenarioName: candidateScenario.name,
    areBoundariesCompatible,
    compatibilityIssues,
    baselineEmbodiedAtoCKgCO2e: baseEmbodied,
    candidateEmbodiedAtoCKgCO2e: candEmbodied,
    deltaEmbodiedAtoCKgCO2e: deltaEmbodiedKg,
    deltaEmbodiedPercent,
    baselineUpfrontA1A5KgCO2e: baseUpfront,
    candidateUpfrontA1A5KgCO2e: candUpfront,
    deltaUpfrontKgCO2e: deltaUpfrontKg,
    deltaUpfrontPercent,
    includedStagesBaseline,
    includedStagesCandidate,
    baselineCompleteness: baseEval.completenessStatus,
    candidateCompleteness: candEval.completenessStatus,
    materialDifferences,
    circularityComparison: {
      baselineReversibleSharePercent: baseEval.circularitySummary.reversibleDisassemblyMassSharePercent,
      candidateReversibleSharePercent: candEval.circularitySummary.reversibleDisassemblyMassSharePercent,
      baselineRecycledContentPercent: baseEval.circularitySummary.weightedRecycledContentPercent,
      candidateRecycledContentPercent: candEval.circularitySummary.weightedRecycledContentPercent,
      summaryNote: areBoundariesCompatible
        ? `Reversible disassembly mass share changes from ${baseEval.circularitySummary.reversibleDisassemblyMassSharePercent ?? 'N/A'}% to ${candEval.circularitySummary.reversibleDisassemblyMassSharePercent ?? 'N/A'}%.`
        : 'Scenario boundaries are incompatible; unify assessment period, functional unit, and included stages before ranking.',
    },
    tradeoffsAndWarnings: [
      ...compatibilityIssues,
      ...candidateScenario.keyTradeoffs,
    ],
  };
}

/**
 * PHASE 10 — Safe Project State Validation, Snapshot Creation & Apply
 * Validates the complete proposed P40 state before mutating the project, and creates an immutable
 * pre-apply rollback snapshot via versioningService.
 */
export function validateP40AuditState(state: ProjectP40AuditState): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!state || typeof state !== 'object') {
    return { isValid: false, errors: ['P40 state payload is null or not an object.'] };
  }
  if (state.schemaVersion !== P40_SCHEMA_VERSION) {
    errors.push(`Unsupported P40 schemaVersion "${state.schemaVersion}". Expected "${P40_SCHEMA_VERSION}".`);
  }
  if (!Array.isArray(state.scenarios) || state.scenarios.length === 0) {
    errors.push('P40 state must contain at least one audit scenario.');
  } else {
    const scenIds = new Set<string>();
    for (const s of state.scenarios) {
      if (!s.scenarioId || !s.name) {
        errors.push('Every P40 scenario must have a non-empty scenarioId and name.');
      }
      if (scenIds.has(s.scenarioId)) {
        errors.push(`Duplicate scenarioId "${s.scenarioId}" detected.`);
      }
      scenIds.add(s.scenarioId);
      if (!Array.isArray(s.inventory)) {
        errors.push(`Scenario "${s.name}" has an invalid inventory array.`);
      }
    }
    if (!scenIds.has(state.activeScenarioId)) {
      errors.push(`activeScenarioId "${state.activeScenarioId}" does not match any scenario in scenarios[].`);
    }
  }
  if (!Array.isArray(state.evidenceLedger) || state.evidenceLedger.length === 0) {
    errors.push('P40 evidenceLedger must contain at least one reference record.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function applyP40AuditStateToProject(
  project: Project,
  proposedState: ProjectP40AuditState
): {
  updatedProject: Project;
  snapshotId: string;
} {
  const validation = validateP40AuditState(proposedState);
  if (!validation.isValid) {
    throw new Error(`Cannot apply invalid P40 Audit state: ${validation.errors.join(' ')}`);
  }

  // Create pre-apply rollback checkpoint before modifying project
  const snapshot = createProjectSnapshot(project, {
    trigger: 'auto-checkpoint',
    label: 'Pre-P40 Whole-Life Carbon & Circularity Audit Apply',
    description: `Automated rollback checkpoint captured prior to saving P40 Audit (${proposedState.scenarios.length} scenario(s)).`,
  });

  const nowIso = new Date().toISOString();
  const updatedProject: Project = {
    ...project,
    carbonCircularityAudit: {
      ...proposedState,
      updatedAt: nowIso,
      lastPreApplySnapshotId: snapshot.id,
    },
    updatedAt: nowIso,
  };

  return {
    updatedProject,
    snapshotId: snapshot.id,
  };
}

/**
 * PHASE 9 & 11 — Export & Serialization Generator (JSON, Markdown, CSV)
 */
export function exportP40AuditReport(
  project: Project,
  state: ProjectP40AuditState,
  activeScenario: P40AuditScenario,
  calcResult: P40CalculationResult,
  comparisonResult: P40ScenarioComparisonResult | null,
  format: 'json' | 'markdown' | 'csv'
): {
  fileName: string;
  mimeType: string;
  content: string;
} {
  const safeProjName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  if (format === 'json') {
    const payload = {
      reportType: 'Plotify P40 Whole-Life Carbon & Circularity Audit',
      schemaVersion: state.schemaVersion,
      engineVersion: state.engineVersion,
      exportedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        unit: project.unit,
        plotWidth: project.plotWidth,
        plotLength: project.plotLength,
        floors: project.floors,
      },
      activeScenario,
      calculationResult: calcResult,
      scenarioComparison: comparisonResult,
      evidenceLedger: state.evidenceLedger,
    };
    return {
      fileName: `p40-carbon-circularity-${safeProjName}.json`,
      mimeType: 'application/json',
      content: JSON.stringify(payload, null, 2),
    };
  }

  if (format === 'csv') {
    const headers = [
      'itemId',
      'materialName',
      'assemblyOrElementName',
      'category',
      'quantity',
      'unit',
      'quantityProvenance',
      'linkedFactorId',
      'status',
      'A1_A3_kgCO2e',
      'A4_kgCO2e',
      'A5_kgCO2e',
      'B4_B5_kgCO2e',
      'C1_C4_kgCO2e',
      'Total_Embodied_A_to_C_kgCO2e',
      'Module_D_Separate_kgCO2e',
      'disassemblyRating',
      'localRecoveryAvailability',
    ];
    const rows = activeScenario.inventory.map((item) => {
      const res = calcResult.itemResults.find((r) => r.itemId === item.itemId);
      const st = res?.stageEmissionsKgCO2e;
      return [
        item.itemId,
        `"${item.materialName.replace(/"/g, '""')}"`,
        `"${item.assemblyOrElementName.replace(/"/g, '""')}"`,
        item.category,
        item.quantity ?? 'MISSING',
        item.unit,
        item.quantityProvenance,
        item.linkedFactorId ?? 'UNLINKED',
        res?.status ?? 'unassessed',
        st?.['A1-A3'] !== null && st?.['A1-A3'] !== undefined ? st['A1-A3'].toFixed(2) : 'MISSING_OR_EXCLUDED',
        st?.['A4'] !== null && st?.['A4'] !== undefined ? st['A4'].toFixed(2) : 'MISSING_OR_EXCLUDED',
        st?.['A5'] !== null && st?.['A5'] !== undefined ? st['A5'].toFixed(2) : 'MISSING_OR_EXCLUDED',
        st?.['B4-B5'] !== null && st?.['B4-B5'] !== undefined ? st['B4-B5'].toFixed(2) : 'MISSING_OR_EXCLUDED',
        st?.['C1-C4'] !== null && st?.['C1-C4'] !== undefined ? st['C1-C4'].toFixed(2) : 'MISSING_OR_EXCLUDED',
        res?.totalEmbodiedAtoCKgCO2e !== null && res?.totalEmbodiedAtoCKgCO2e !== undefined
          ? res.totalEmbodiedAtoCKgCO2e.toFixed(2)
          : 'MISSING',
        res?.moduleDBenefitOrLoadKgCO2e !== null && res?.moduleDBenefitOrLoadKgCO2e !== undefined
          ? res.moduleDBenefitOrLoadKgCO2e.toFixed(2)
          : 'MISSING_OR_EXCLUDED',
        item.disassemblyRating,
        item.localRecoveryAvailability,
      ].join(',');
    });
    return {
      fileName: `p40-inventory-breakdown-${safeProjName}.csv`,
      mimeType: 'text/csv',
      content: [headers.join(','), ...rows].join('\n'),
    };
  }

  // Markdown format
  const lines: string[] = [
    `# Plotify P40 — Whole-Life Carbon & Circularity Audit Report`,
    ``,
    `- **Project:** ${project.name} (\`${project.id}\`)`,
    `- **Active Scenario:** ${activeScenario.name}`,
    `- **Schema / Engine Version:** \`${state.schemaVersion}\` / \`${state.engineVersion}\``,
    `- **Assessment Completeness:** **${calcResult.completenessStatus.toUpperCase()}** — ${calcResult.completenessExplanation}`,
    `- **Reference Study Period:** ${activeScenario.boundarySettings.assessmentPeriodYears} years`,
    `- **Functional Unit (GIA):** ${activeScenario.boundarySettings.grossInternalFloorAreaM2 ?? 'Unspecified'} m²`,
    ``,
    `## 1. Embodied & Lifecycle Carbon Summary`,
    ``,
    `| Metric | Value (kgCO₂e) | Value (tCO₂e) | Intensity (kgCO₂e/m²) |`,
    `| :--- | :---: | :---: | :---: |`,
    `| **Product Stage (A1–A3)** | ${calcResult.totals.productStageA1A3KgCO2e !== null ? calcResult.totals.productStageA1A3KgCO2e.toFixed(1) : 'Missing/Excluded'} | ${calcResult.totals.productStageA1A3KgCO2e !== null ? (calcResult.totals.productStageA1A3KgCO2e / 1000).toFixed(2) : 'N/A'} | — |`,
    `| **Upfront Embodied (A1–A5)** | ${calcResult.totals.upfrontEmbodiedA1A5KgCO2e !== null ? calcResult.totals.upfrontEmbodiedA1A5KgCO2e.toFixed(1) : 'Missing'} | ${calcResult.totals.upfrontEmbodiedA1A5KgCO2e !== null ? (calcResult.totals.upfrontEmbodiedA1A5KgCO2e / 1000).toFixed(2) : 'N/A'} | — |`,
    `| **In-Use Embodied (B1–B5)** | ${calcResult.totals.inUseEmbodiedB1B5KgCO2e !== null ? calcResult.totals.inUseEmbodiedB1B5KgCO2e.toFixed(1) : 'Excluded/Missing'} | ${calcResult.totals.inUseEmbodiedB1B5KgCO2e !== null ? (calcResult.totals.inUseEmbodiedB1B5KgCO2e / 1000).toFixed(2) : 'N/A'} | — |`,
    `| **End-of-Life Embodied (C1–C4)** | ${calcResult.totals.endOfLifeC1C4KgCO2e !== null ? calcResult.totals.endOfLifeC1C4KgCO2e.toFixed(1) : 'Excluded/Missing'} | ${calcResult.totals.endOfLifeC1C4KgCO2e !== null ? (calcResult.totals.endOfLifeC1C4KgCO2e / 1000).toFixed(2) : 'N/A'} | — |`,
    `| **Total Embodied Carbon (A–C)** | **${calcResult.totals.totalEmbodiedAtoCKgCO2e !== null ? calcResult.totals.totalEmbodiedAtoCKgCO2e.toFixed(1) : 'Incomplete'}** | **${calcResult.totals.totalEmbodiedAtoCTCO2e !== null ? calcResult.totals.totalEmbodiedAtoCTCO2e.toFixed(2) : 'N/A'}** | **${calcResult.totals.embodiedIntensityKgCO2ePerM2 !== null ? calcResult.totals.embodiedIntensityKgCO2ePerM2.toFixed(1) : 'N/A'}** |`,
    `| **Operational Energy (B6, Separate)** | ${calcResult.totals.operationalCarbonB6B7KgCO2e !== null ? calcResult.totals.operationalCarbonB6B7KgCO2e.toFixed(1) : 'Separate / Not Included'} | — | — |`,
    `| **Module D (Beyond Boundary, Separate)** | ${calcResult.totals.moduleDSeparateKgCO2e !== null ? calcResult.totals.moduleDSeparateKgCO2e.toFixed(1) : 'Not Assessed'} | — | — |`,
    ``,
    `## 2. Lifecycle Stage Breakdown (EN 15978)`,
    ``,
    `| Stage | Status | Emissions (kgCO₂e) | Explanation |`,
    `| :--- | :---: | :---: | :--- |`,
    ...calcResult.stageBreakdown.map(
      (s) =>
        `| **${s.stageCode}** | \`${s.inclusionStatus}\` | ${s.emissionsKgCO2e !== null ? s.emissionsKgCO2e.toFixed(1) : 'NULL (Missing/Excluded)'} | ${s.explanation} |`
    ),
    ``,
    `## 3. Circularity Intelligence Summary`,
    ``,
    `- **Total Evaluated Material Mass:** ${calcResult.circularitySummary.totalEvaluatedMassKg ?? 'Unknown'} kg`,
    `- **Weighted Recycled Content (Known Mass):** ${calcResult.circularitySummary.weightedRecycledContentPercent ?? 'Unknown'}%`,
    `- **Reversible Mechanical Disassembly Mass Share:** ${calcResult.circularitySummary.reversibleDisassemblyMassSharePercent ?? 'Unknown'}%`,
    `- **Verified Local Recovery Infrastructure Share:** ${calcResult.circularitySummary.verifiedLocalRecoveryMassSharePercent ?? 'Unknown'}%`,
    `- **Theoretical Recyclability Share:** ${calcResult.circularitySummary.theoreticalRecyclableMassSharePercent ?? 'Unknown'}%`,
    ``,
    `## 4. Warnings, Provenance & Limitations`,
    ``,
    ...(calcResult.warningsAndLimitations.length > 0
      ? calcResult.warningsAndLimitations.map((w) => `- ${w}`)
      : ['- No calculation warnings raised for current inputs.']),
  ];

  return {
    fileName: `p40-audit-report-${safeProjName}.md`,
    mimeType: 'text/markdown',
    content: lines.join('\n'),
  };
}
