import type { DungeonDocument } from './types/dungeon';
import type { IsoQuarter, IsoViewMode } from './utils/isoProjection';

export interface JinklineExportView {
  mode?: IsoViewMode;
  quarter?: IsoQuarter;
  wallHeightCells?: number;
}

export interface JinklineExportApi {
  loadDocument(doc: DungeonDocument, view?: JinklineExportView): Promise<void>;
  exportSvg(): Promise<string>;
  exportPng(): Promise<string>;
}

declare global {
  interface Window {
    __jinkline?: JinklineExportApi;
  }
}
