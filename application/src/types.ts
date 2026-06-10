// ─── App State & Theme ───────────────────────────────────────
export type AppState = 'ready' | 'analyzing' | 'hazard' | 'guidance' | 'critical';
export type Theme    = 'operational' | 'critical';
export type SheetPos = 'collapsed' | 'half' | 'full';
export type ZoomLevel = '0.5x' | '1.0x' | '2.0x' | '5.0x';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type NavTab = 'guide' | 'measure' | 'notes' | 'more';

// ─── Bounding Box ────────────────────────────────────────────
export interface BoundingBox {
  top: string;
  left: string;
  width: string;
  height: string;
}

// ─── Action Step ─────────────────────────────────────────────
export interface ActionStep {
  id: string;
  stepNumber: number;
  icon: string;          // lucide icon name
  title: string;
  subtitle: string;
  isCritical: boolean;
  estimatedTime?: string;
  arAnchorId?: string;
}

// ─── Hazard ──────────────────────────────────────────────────
export interface Hazard {
  id: string;
  title: string;
  subtitle: string;
  riskLevel: RiskLevel;
  confidence: number;
  component: string;
  reading: string;
  readingUnit: string;
  description: string;
  reason: string;
  whyItMatters: string;
  tags: string[];
  boundingBox: BoundingBox;
  actions: ActionStep[];
}
