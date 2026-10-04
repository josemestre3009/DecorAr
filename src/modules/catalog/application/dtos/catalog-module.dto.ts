export interface CatalogModuleDto {
  readonly id: string;
  readonly name: string;
  readonly priceCop: number;
  readonly areaM2: number;
  readonly widthM: number;
  readonly heightM: number;
  readonly depthM: number;
  readonly glbUrl: string;
  readonly usdzUrl: string;
  readonly posterUrl: string | null;
  readonly assetId: string;
  readonly version: number;
}
